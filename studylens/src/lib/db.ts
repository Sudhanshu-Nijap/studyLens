// Pure REST client for PostgreSQL via PostgREST
// All queries are chainable and lazy — they only run when you await them.

const BASE_URL = import.meta.env.VITE_DB_URL || "http://localhost:8000";

export type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type MutationType = "insert" | "update" | "delete" | "select";

class TableQuery<T = any> {
  private table: string;
  private filters: string[] = [];
  private selectColumns: string = "*";
  private orderParam: string | null = null;
  private limitParam: number | null = null;
  private mutation: MutationType = "select";
  private mutationBody: any = null;

  constructor(table: string) {
    this.table = table;
  }

  // ── Setters (all return `this` for chaining) ──────────────────────────────

  select(columns: string = "*"): this {
    this.selectColumns = columns;
    return this;
  }

  eq(column: string, value: any): this {
    this.filters.push(`${column}=eq.${encodeURIComponent(value)}`);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    const dir = options.ascending === false ? "desc" : "asc";
    this.orderParam = `${column}.${dir}`;
    return this;
  }

  limit(count: number): this {
    this.limitParam = count;
    return this;
  }

  insert(data: any): this {
    this.mutation = "insert";
    this.mutationBody = data;
    return this;
  }

  update(data: any): this {
    this.mutation = "update";
    this.mutationBody = data;
    return this;
  }

  delete(): this {
    this.mutation = "delete";
    return this;
  }

  // ── Terminal methods ───────────────────────────────────────────────────────

  /** Execute and return the first item, or null. */
  async single(): Promise<QueryResult<T>> {
    const result = await this.execute();
    if (result.error) return result as any;
    const list = Array.isArray(result.data) ? result.data : [result.data];
    return { data: (list[0] as T) ?? null, error: null };
  }

  /** Same as single() but doesn't error if nothing found. */
  async maybeSingle(): Promise<QueryResult<T>> {
    return this.single();
  }

  // ── Make it awaitable ─────────────────────────────────────────────────────

  then<TResult1 = QueryResult<T[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected);
  }

  // ── Core fetch logic ──────────────────────────────────────────────────────

  private async execute(): Promise<QueryResult<any>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Build query string
    const params: string[] = [...this.filters];
    if (this.mutation === "select" || this.mutation === "insert" || this.mutation === "update") {
      params.push(`select=${encodeURIComponent(this.selectColumns)}`);
    }
    if (this.orderParam) params.push(`order=${this.orderParam}`);
    if (this.limitParam !== null) params.push(`limit=${this.limitParam}`);

    const query = params.length ? `?${params.join("&")}` : "";
    const url = `${BASE_URL}/${this.table}${query}`;

    try {
      let res: Response;

      if (this.mutation === "insert") {
        res = await fetch(url, {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(this.mutationBody),
        });
      } else if (this.mutation === "update") {
        res = await fetch(url, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(this.mutationBody),
        });
      } else if (this.mutation === "delete") {
        res = await fetch(url, { method: "DELETE", headers });
        if (!res.ok) {
          return { data: null, error: { message: await res.text() } };
        }
        return { data: null, error: null };
      } else {
        res = await fetch(url, { headers });
      }

      if (!res.ok) {
        return { data: null, error: { message: await res.text() } };
      }

      // Some responses (204 No Content) have no body
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message || "Network error" } };
    }
  }
}

class PostgresClient {
  from<T = any>(table: string): TableQuery<T> {
    return new TableQuery<T>(table);
  }

  async rpc<T = any>(fn: string, params: Record<string, any>): Promise<QueryResult<T>> {
    try {
      const res = await fetch(`${BASE_URL}/rpc/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        return { data: null, error: { message: await res.text() } };
      }
      const data = await res.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message || "Network error" } };
    }
  }
}

export const pg = new PostgresClient();

// ── Local User Session ────────────────────────────────────────────────────────

export type LocalUser = {
  id: string;
  email: string;
  displayName: string;
};

const STORAGE_KEY = "studylens_user";

export function getLocalUser(): LocalUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function setLocalUser(user: LocalUser | null) {
  if (!user) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }
}
