import io
import os
import re
from typing import List, Optional, Tuple
from urllib.parse import urlparse, parse_qs
import requests
import pypdf
import pdfplumber
import docx
from youtube_transcript_api import YouTubeTranscriptApi

from ingestion.chunker import Chunk, recursive_chunk_text, is_heading
from ingestion.multimodal import describe_diagram_or_image, format_table_to_searchable
from storage import storage_manager

def parse_pdf(file_bytes: bytes, material_id: str = "doc", max_pages: int = 200) -> List[Chunk]:
    """
    Extract text, tables, and images from PDF documents.
    Extracts and stores diagrams in storage/images/ and attaches image URLs to metadata.
    """
    chunks: List[Chunk] = []
    chunk_index = 0

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total_pages = min(len(pdf.pages), max_pages)

        for page_num in range(1, total_pages + 1):
            page = pdf.pages[page_num - 1]

            # 1. Extract and process tables
            try:
                tables = page.extract_tables()
                if tables:
                    for table in tables:
                        if len(table) > 1:
                            headers = [str(c or "") for c in table[0]]
                            rows = [[str(c or "") for c in r] for r in table[1:]]
                            table_text = format_table_to_searchable(headers, rows)
                            if len(table_text) > 20:
                                chunks.append(
                                    Chunk(
                                        chunk_index=chunk_index,
                                        content=f"Table on page {page_num}: {table_text}",
                                        chunk_type="table",
                                        page_number=page_num
                                    )
                                )
                                chunk_index += 1
            except Exception as e:
                print(f"[PDF] Table extraction note on p{page_num}: {e}")

            # 2. Extract regular text
            text = page.extract_text() or ""
            if text.strip():
                page_chunks = recursive_chunk_text(
                    text=text,
                    page_number=page_num,
                    start_index=chunk_index
                )
                chunks.extend(page_chunks)
                chunk_index += len(page_chunks)

            # 3. Extract images/diagrams, save to disk, and generate vision description
            if len(chunks) < 50 and page.images:
                try:
                    for img_idx, img_meta in enumerate(page.images[:2]):  # up to 2 figures per page
                        if "stream" in img_meta:
                            raw_img = img_meta["stream"].get_data()
                            # Save to disk
                            img_path, img_url = storage_manager.save_image(
                                material_id=material_id,
                                page_number=page_num,
                                image_index=img_idx + 1,
                                image_bytes=raw_img
                            )
                            # Generate vision description
                            desc = describe_diagram_or_image(raw_img, mime_type="image/png", context=text[:300])
                            if desc and len(desc) > 30:
                                chunks.append(
                                    Chunk(
                                        chunk_index=chunk_index,
                                        content=f"Visual diagram on page {page_num}: {desc}",
                                        chunk_type="image_desc",
                                        page_number=page_num,
                                        metadata={
                                            "image_url": img_url,
                                            "image_path": img_path
                                        }
                                    )
                                )
                                chunk_index += 1
                except Exception as e:
                    print(f"[PDF] Image processing note: {e}")

    return chunks

def parse_docx(file_bytes: bytes, material_id: str = "doc") -> List[Chunk]:
    """Parse DOCX files, preserving headings, paragraphs, and tables."""
    chunks: List[Chunk] = []
    doc = docx.Document(io.BytesIO(file_bytes))
    chunk_index = 0
    current_heading: Optional[str] = None

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        if para.style.name.startswith("Heading") or is_heading(text):
            current_heading = text.lstrip("#").strip()
            continue

        para_chunks = recursive_chunk_text(
            text=text,
            page_number=None,
            start_index=chunk_index
        )
        for c in para_chunks:
            c.section_heading = current_heading
        chunks.extend(para_chunks)
        chunk_index += len(para_chunks)

    # Process tables
    for table in doc.tables:
        rows_data = []
        for row in table.rows:
            rows_data.append([c.text.strip() for c in row.cells])
        if len(rows_data) > 1:
            headers = rows_data[0]
            rows = rows_data[1:]
            table_summary = format_table_to_searchable(headers, rows)
            if len(table_summary) > 20:
                chunks.append(
                    Chunk(
                        chunk_index=chunk_index,
                        content=f"Document Table: {table_summary}",
                        chunk_type="table",
                        section_heading=current_heading
                    )
                )
                chunk_index += 1

    return chunks

def extract_youtube_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats using regex and urlparse."""
    match = re.search(r"(?:v=|\/|youtu\.be\/)([0-9A-Za-z_-]{11})(?:\&|\?|\/|$|\s)", url)
    if match:
        return match.group(1)
    try:
        first_line = url.strip().split("\n")[0].strip()
        parsed = urlparse(first_line)
        if "youtube.com" in parsed.netloc:
            return parse_qs(parsed.query).get("v", [None])[0]
        elif "youtu.be" in parsed.netloc:
            return parsed.path.lstrip("/").split("/")[0]
    except Exception:
        pass
    return None

def parse_youtube(url: str, material_id: str = "yt") -> List[Chunk]:
    """
    Extract YouTube transcript preserving timestamp ranges.
    Chunks transcript into topic/time blocks of ~90-120 seconds.
    Saves full transcript to storage/transcripts/.
    Gracefully falls back to SerpAPI and text parsing if transcript API fails.
    """
    first_line = url.strip().split("\n")[0].strip()
    video_id = extract_youtube_video_id(first_line)
    
    # If the input already contains transcript text after the URL
    lines = [l.strip() for l in url.strip().split("\n") if l.strip()]
    if len(lines) > 2:
        transcript_text = "\n".join(lines[1:])
        storage_manager.save_transcript(material_id, transcript_text)
        return recursive_chunk_text(transcript_text, page_number=None)

    entries = []
    if video_id:
        # 1. Fast Path: YouTubeTranscriptApi direct (sub-second)
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            api = YouTubeTranscriptApi()
            raw_entries = None
            try:
                raw_entries = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
            except Exception:
                transcript_list = api.list(video_id)
                try:
                    transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
                except Exception:
                    transcript = next(iter(transcript_list), None)
                if transcript:
                    raw_entries = transcript.fetch()

            if raw_entries:
                for item in raw_entries:
                    start_val = getattr(item, "start", None) or (item.get("start") if isinstance(item, dict) else 0)
                    start_sec = int(float(start_val or 0))
                    duration_val = getattr(item, "duration", None) or (item.get("duration") if isinstance(item, dict) else 5)
                    text_val = (getattr(item, "text", None) or (item.get("text") if isinstance(item, dict) else str(item)) or "").strip()
                    if text_val:
                        entries.append({
                            "start": start_sec,
                            "duration": int(float(duration_val or 5)),
                            "text": text_val
                        })
        except Exception as fast_err:
            print(f"[YouTube] Direct fast fetch note for {video_id}: {fast_err}")

        # 2. Fallback: SerpAPI (if direct fetch is blocked)
        if not entries:
            serp_key = (
                os.getenv("SERP_API_KEY")
                or os.getenv("VITE_SERP_API_KEY")
                or "f13124b6029a1c5388dfa2c856bf2fd6128410bf314e49a5d935b0a67cb0bc8a"
            )
            if serp_key:
                try:
                    res = requests.get(
                        f"https://serpapi.com/search.json?engine=youtube_video_transcript&v={video_id}&api_key={serp_key}",
                        timeout=12
                    )
                    if res.status_code == 200:
                        data = res.json()
                        raw_items = data.get("transcript", [])
                        for item in raw_items:
                            start_ms = item.get("start_ms", 0)
                            sec = int(start_ms / 1000) if start_ms else 0
                            text_val = item.get("snippet") or item.get("text", "")
                            if text_val:
                                entries.append({
                                    "start": sec,
                                    "duration": 5,
                                    "text": text_val
                                })
                except Exception as se:
                    print(f"[YouTube] SerpAPI note: {se}")

    if not entries:
        # If no transcript could be retrieved, do not crash with 400!
        # Treat available text/metadata as a single chunk
        fallback_content = url.strip() or f"YouTube Video: {first_line}"
        storage_manager.save_transcript(material_id, fallback_content)
        return [
            Chunk(
                chunk_index=0,
                content=fallback_content,
                chunk_type="text",
                metadata={"video_id": video_id or "", "video_url": first_line}
            )
        ]

    chunks: List[Chunk] = []
    chunk_index = 0

    full_transcript_text = "\n".join([f"[{int(e['start'])}s] {e['text']}" for e in entries])
    storage_manager.save_transcript(material_id, full_transcript_text)

    # Group into ~90-second blocks
    current_block: List[str] = []
    block_start: Optional[int] = None
    last_end: int = 0

    for item in entries:
        start_sec = int(item["start"])
        duration = int(item["duration"])
        end_sec = start_sec + duration
        text = item["text"].strip()

        if block_start is None:
            block_start = start_sec

        current_block.append(text)
        last_end = end_sec

        # Trigger chunk if block exceeds 90 seconds or ~800 chars
        if (end_sec - block_start >= 90) or (len(" ".join(current_block)) > 800):
            content = " ".join(current_block).strip()
            if content:
                chunks.append(
                    Chunk(
                        chunk_index=chunk_index,
                        content=content,
                        chunk_type="text",
                        start_time=block_start,
                        end_time=last_end,
                        metadata={
                            "video_id": video_id,
                            "video_url": f"{first_line}&t={block_start}s"
                        }
                    )
                )
                chunk_index += 1
            current_block = []
            block_start = None

    if current_block:
        content = " ".join(current_block).strip()
        if content:
            chunks.append(
                Chunk(
                    chunk_index=chunk_index,
                    content=content,
                    chunk_type="text",
                    start_time=block_start or 0,
                    end_time=last_end,
                    metadata={
                        "video_id": video_id,
                        "video_url": f"{first_line}&t={block_start or 0}s"
                    }
                )
            )

    return chunks

def parse_text(text: str, material_id: str = "note") -> List[Chunk]:
    """Parse plain text or Markdown notes and save copy to transcripts."""
    storage_manager.save_transcript(material_id, text)
    return recursive_chunk_text(text=text, page_number=None)
