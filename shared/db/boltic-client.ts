// ============================================================
// Boltic Database client — standard PostgreSQL via `pg` driver.
// Boltic Database is managed Postgres + pgvector. Connection string
// from Boltic console → Settings → External Database Access.
//
// Encryption helpers (boltic_encrypt / boltic_decrypt /
// boltic_encrypt_searchable) live in ./encryption.ts.
// ============================================================

import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | null = null;
let vectorParserRegistered = false;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.BOLTIC_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'BOLTIC_DATABASE_URL not set. Get it from Boltic console → Settings → External Database Access → View Connection String.',
    );
  }
  const sslDisabled = /[?&]sslmode=disable\b/.test(connectionString);

  // Strip `sslmode` from the URL so node-postgres uses our explicit `ssl`
  // option below. Otherwise the URL's sslmode (e.g. require/verify) forces
  // strict certificate validation and rejects Boltic's self-signed cert
  // (DEPTH_ZERO_SELF_SIGNED_CERT) — which is what breaks the connection on
  // stricter runtimes like Node 24 on Vercel.
  let conn = connectionString;
  try {
    const u = new URL(connectionString);
    u.searchParams.delete('sslmode');
    conn = u.toString();
  } catch {
    /* not a parseable URL — use as-is */
  }

  pool = new Pool({
    connectionString: conn,
    // Boltic's proxy uses a self-signed cert, so accept it (don't verify the CA).
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: Number(process.env.BOLTIC_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => console.error('[boltic-pool] idle client error', err));
  // Lazily register pgvector type parser (string → number[]) on first use.
  void registerVectorParser(pool);
  return pool;
}

async function registerVectorParser(p: Pool): Promise<void> {
  if (vectorParserRegistered) return;
  vectorParserRegistered = true;
  try {
    const res = await p.query<{ oid: number }>(
      `SELECT oid FROM pg_type WHERE typname = 'vector'`,
    );
    const oid = res.rows[0]?.oid;
    if (typeof oid === 'number') {
      types.setTypeParser(oid, (val: string) => {
        if (typeof val !== 'string' || !val.startsWith('[')) return val as unknown as number[];
        return val.slice(1, -1).split(',').map(Number);
      });
    }
  } catch (err) {
    console.warn('[boltic] vector type parser not registered:', err);
  }
}

/** Heuristic: is this value a pgvector embedding (numeric array)? */
function isVectorValue(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length > 16 && // skip small numeric arrays that aren't embeddings
    v.every((x) => typeof x === 'number' && Number.isFinite(x))
  );
}

/** Convert a number[] to a pgvector text literal `[a,b,c]`. */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

/** Build (cols, placeholders, values) honoring vector + JSON columns.
 *
 *  - pgvector: numeric arrays > 16 long are emitted as `[a,b,c]::vector`
 *  - JSON/JSONB: objects + non-vector arrays are stringified and cast `::jsonb`.
 *    Postgres implicitly casts jsonb → json on assignment, so this works for
 *    both `json` and `jsonb` columns. We rely on this monorepo not using
 *    native Postgres array columns (text[], int[]); all "list" columns are JSON.
 */
function buildColumnSet(row: Record<string, unknown>, startIdx = 1) {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;
  for (const [col, val] of Object.entries(row)) {
    cols.push(col);
    if (isVectorValue(val)) {
      values.push(toVectorLiteral(val));
      placeholders.push(`$${idx}::vector`);
    } else if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
      // Objects + arrays (non-vector) → JSON. Stringify explicitly so pg
      // doesn't auto-encode arrays as Postgres array literals like `{a,b}`,
      // which `json` columns reject with "invalid input syntax for type json".
      values.push(JSON.stringify(val));
      placeholders.push(`$${idx}::jsonb`);
    } else {
      values.push(val);
      placeholders.push(`$${idx}`);
    }
    idx++;
  }
  return { cols, placeholders, values };
}

export class BolticClient {
  private get pool(): Pool {
    return getPool();
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res: QueryResult<T> = await this.pool.query<T>(sql, params as unknown[]);
    return res.rows.map(parseVectorFields) as T[];
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async insert<T extends QueryResultRow = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
  ): Promise<T> {
    const { cols, placeholders, values } = buildColumnSet(row);
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const rows = await this.query<T>(sql, values);
    if (rows.length === 0) throw new Error(`Insert into ${table} returned no rows`);
    return rows[0]!;
  }

  async upsert<T extends QueryResultRow = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
    onConflict: string[],
  ): Promise<T> {
    const { cols, placeholders, values } = buildColumnSet(row);
    const updateSet = cols
      .filter((c) => !onConflict.includes(c))
      .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
      .join(', ');
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders.join(', ')})
      ON CONFLICT (${onConflict.map(ident).join(', ')}) DO UPDATE SET ${updateSet}
      RETURNING *`;
    const rows = await this.query<T>(sql, values);
    if (rows.length === 0) throw new Error(`Upsert into ${table} returned no rows`);
    return rows[0]!;
  }

  async update<T extends QueryResultRow = Record<string, unknown>>(
    table: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): Promise<T[]> {
    const setBuilt = buildColumnSet(set);
    const whereBuilt = buildColumnSet(where, setBuilt.values.length + 1);
    const setClause = setBuilt.cols
      .map((c, i) => `${ident(c)} = ${setBuilt.placeholders[i]}`)
      .join(', ');
    const whereClause = whereBuilt.cols
      .map((c, i) => `${ident(c)} = ${whereBuilt.placeholders[i]}`)
      .join(' AND ');
    const sql = `UPDATE ${ident(table)} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    return this.query<T>(sql, [...setBuilt.values, ...whereBuilt.values]);
  }

  async findById<T extends QueryResultRow = Record<string, unknown>>(
    table: string,
    id: string,
  ): Promise<T | null> {
    const rows = await this.query<T>(
      `SELECT * FROM ${ident(table)} WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** pgvector cosine similarity search. */
  async vectorSearch<T extends QueryResultRow = Record<string, unknown>>(
    table: string,
    column: string,
    vector: number[],
    limit: number,
    where?: { sql: string; params: unknown[] },
  ): Promise<T[]> {
    const whereClause = where ? `WHERE ${where.sql}` : '';
    const params: unknown[] = where ? [...where.params] : [];
    params.push(toVectorLiteral(vector));
    const vectorParam = `$${params.length}::vector`;
    const sql = `SELECT *, 1 - (${ident(column)} <=> ${vectorParam}) AS similarity
      FROM ${ident(table)}
      ${whereClause}
      ORDER BY ${ident(column)} <=> ${vectorParam}
      LIMIT ${Number(limit)}`;
    return this.query<T>(sql, params);
  }
}

let cachedClient: BolticClient | null = null;
export function getBolticClient(): BolticClient {
  if (!cachedClient) cachedClient = new BolticClient();
  return cachedClient;
}

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Convert any *_embedding string fields back to number[].
 * pgvector returns vector columns as `[a,b,c]` strings by default —
 * we patch every result row.
 */
function parseVectorFields<T extends Record<string, unknown>>(row: T): T {
  if (row === null || typeof row !== 'object') return row;
  for (const key of Object.keys(row)) {
    if (!key.endsWith('_embedding')) continue;
    const v = (row as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    if (!v.startsWith('[') || !v.endsWith(']')) continue;
    try {
      const parsed = v.slice(1, -1).split(',').map(Number);
      if (parsed.every((x) => Number.isFinite(x))) {
        (row as Record<string, unknown>)[key] = parsed;
      }
    } catch {
      // leave as string
    }
  }
  return row;
}
