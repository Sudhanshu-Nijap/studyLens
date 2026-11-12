-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Notebooks (TEXT id supports both UUIDs and slug IDs like 'algorithms-dsa')
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notebooks (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description TEXT        NOT NULL DEFAULT '' CHECK (char_length(description) <= 250),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notebooks_id_owner_unique UNIQUE (id, owner_id)
);

CREATE INDEX IF NOT EXISTS notebooks_owner_updated_idx
  ON public.notebooks (owner_id, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Materials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materials (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notebook_id       TEXT        NOT NULL,
  owner_id          UUID        NOT NULL,
  kind              TEXT        NOT NULL CHECK (kind IN ('pdf', 'txt', 'md', 'note', 'video')),
  title             TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  original_filename TEXT,
  storage_path      TEXT,
  mime_type         TEXT,
  byte_size         INTEGER,
  content_text      TEXT,
  status            TEXT        NOT NULL DEFAULT 'ready'
                      CHECK (status IN ('processing', 'ready', 'failed')),
  index_status      TEXT        NOT NULL DEFAULT 'ready'
                      CHECK (index_status IN ('pending', 'indexing', 'ready', 'failed', 'unsupported')),
  index_error       TEXT,
  indexed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT materials_notebook_owner_fk
    FOREIGN KEY (notebook_id, owner_id)
    REFERENCES public.notebooks (id, owner_id) ON DELETE CASCADE,
  CONSTRAINT materials_identity_owner_unique
    UNIQUE (id, notebook_id, owner_id)
);

CREATE INDEX IF NOT EXISTS materials_notebook_created_idx
  ON public.materials (notebook_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Material Chunks  (enriched for grounded RAG)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.material_chunks (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  material_id     TEXT        NOT NULL,
  notebook_id     TEXT        NOT NULL,
  owner_id        UUID        NOT NULL,
  chunk_index     INTEGER     NOT NULL CHECK (chunk_index >= 0),
  chunk_type      TEXT        NOT NULL DEFAULT 'text'
                    CHECK (chunk_type IN ('text', 'table', 'image_desc')),
  page_number     INTEGER     CHECK (page_number > 0),
  section_heading TEXT,
  start_time      INTEGER,    -- YouTube: seconds from start
  end_time        INTEGER,    -- YouTube: seconds from start
  content         TEXT        NOT NULL,
  embedding       vector(3072) NOT NULL,  -- gemini-embedding-001 outputs 3072 dims
  keyword_tokens  tsvector    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (material_id, chunk_index),
  FOREIGN KEY (material_id, notebook_id, owner_id)
    REFERENCES public.materials (id, notebook_id, owner_id) ON DELETE CASCADE
);

-- Sparse / keyword index (BM25-style via GIN)
CREATE INDEX IF NOT EXISTS material_chunks_keyword_idx
  ON public.material_chunks USING gin (keyword_tokens);

-- Composite index for notebook scoping
CREATE INDEX IF NOT EXISTS material_chunks_notebook_idx
  ON public.material_chunks (notebook_id, material_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conversations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notebook_id TEXT        NOT NULL,
  owner_id    UUID        NOT NULL,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, notebook_id, owner_id),
  FOREIGN KEY (notebook_id, owner_id)
    REFERENCES public.notebooks (id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversations_notebook_updated_idx
  ON public.conversations (notebook_id, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Chat Messages  (stores full conversation history for query rewriting)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT        NOT NULL,
  notebook_id     TEXT        NOT NULL,
  owner_id        UUID        NOT NULL,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL,
  citations       JSONB       NOT NULL DEFAULT '[]'::jsonb
                    CHECK (jsonb_typeof(citations) = 'array'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, notebook_id, owner_id)
    REFERENCES public.conversations (id, notebook_id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON public.chat_messages (conversation_id, created_at ASC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Hybrid Search RPC  (Dense + Sparse via Reciprocal Rank Fusion)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_material_chunks(
  p_notebook_id     TEXT,
  p_query_embedding vector(3072),
  p_query_text      TEXT,
  p_limit           INTEGER DEFAULT 8
)
RETURNS TABLE (
  chunk_id        TEXT,
  material_id     TEXT,
  material_title  TEXT,
  chunk_type      TEXT,
  section_heading TEXT,
  page_number     INTEGER,
  start_time      INTEGER,
  end_time        INTEGER,
  content         TEXT,
  similarity      DOUBLE PRECISION,
  rrf_score       DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  WITH
  -- Dense retrieval: top 20 by vector cosine similarity
  dense AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> p_query_embedding) AS dense_rank
    FROM public.material_chunks c
    JOIN public.materials m ON m.id = c.material_id
    WHERE c.notebook_id = p_notebook_id
      AND m.index_status = 'ready'
      AND m.status = 'ready'
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT 20
  ),
  -- Sparse retrieval: top 20 by keyword match (BM25-style)
  sparse AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.keyword_tokens, plainto_tsquery('english', p_query_text)) DESC) AS sparse_rank
    FROM public.material_chunks c
    JOIN public.materials m ON m.id = c.material_id
    WHERE c.notebook_id = p_notebook_id
      AND m.index_status = 'ready'
      AND m.status = 'ready'
      AND c.keyword_tokens @@ plainto_tsquery('english', p_query_text)
    ORDER BY ts_rank_cd(c.keyword_tokens, plainto_tsquery('english', p_query_text)) DESC
    LIMIT 20
  ),
  -- Reciprocal Rank Fusion (k=60 is a standard default)
  rrf AS (
    SELECT
      COALESCE(d.id, s.id) AS id,
      COALESCE(1.0 / (60.0 + d.dense_rank),  0.0)
      + COALESCE(1.0 / (60.0 + s.sparse_rank), 0.0) AS rrf_score
    FROM dense d
    FULL OUTER JOIN sparse s ON d.id = s.id
  )
  -- Final result with full chunk data
  SELECT
    c.id              AS chunk_id,
    c.material_id,
    m.title           AS material_title,
    c.chunk_type,
    c.section_heading,
    c.page_number,
    c.start_time,
    c.end_time,
    c.content,
    (1 - (c.embedding <=> p_query_embedding))::DOUBLE PRECISION AS similarity,
    rrf.rrf_score
  FROM rrf
  JOIN public.material_chunks c ON c.id = rrf.id
  JOIN public.materials        m ON m.id = c.material_id
  ORDER BY rrf.rrf_score DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 20);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Default dev user and seed notebooks
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.users (id, email, password_hash, display_name)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'student@studylens.local',
  'local_dev_hash',
  'StudyLens Student'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.notebooks (id, owner_id, title, description)
VALUES 
  ('algorithms-dsa', '00000000-0000-0000-0000-000000000001', 'Algorithms & DSA', 'Graph traversal, complexity, and revision notes'),
  ('database-systems', '00000000-0000-0000-0000-000000000001', 'Database Systems', 'Indexes, queries, and database design'),
  ('machine-learning', '00000000-0000-0000-0000-000000000001', 'Machine Learning Basics', 'Models, evaluation, and core concepts'),
  ('exam-planning', '00000000-0000-0000-0000-000000000001', 'Exam Planning', 'A place to collect final revision material')
ON CONFLICT (id) DO NOTHING;
