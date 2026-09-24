import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createClient,
  type Client,
  type InValue,
  type Row,
} from "@libsql/client";
import type { Clock } from "../clock.ts";
import { ProgressEvent, type StoredEvent } from "../events.ts";
import { SEAL_LEASE_MS, STALE_ACTIVE_MS } from "../lifecycle.ts";
import type { Attribution } from "../schemas.ts";
import {
  RunRow,
  type CompleteResult,
  type CreateRunInput,
  type RunStore,
} from "./types.ts";

const DEFAULT_DB_PATH = ".data/cartridge.db";
const FILE_SCHEME = "file:";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  claims INTEGER NOT NULL,
  max_claims INTEGER NOT NULL,
  owner TEXT,
  heartbeat_at INTEGER,
  seal_owner TEXT,
  seal_until INTEGER,
  spec_json TEXT,
  artifact_json TEXT,
  artifact_sha TEXT,
  e1_score REAL,
  attribution_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);`;

const CLAIM_SQL = `UPDATE runs SET status = 'active', claims = claims + 1, owner = ?, heartbeat_at = ?, updated_at = ?
  WHERE id = ? AND claims < max_claims AND (status = 'waiting'
    OR (status = 'active' AND COALESCE(heartbeat_at, 0) < ?)
    OR (status = 'sealing' AND COALESCE(seal_until, 0) < ?))`;
const HEARTBEAT_SQL = `UPDATE runs SET heartbeat_at = ?, updated_at = ?
  WHERE id = ? AND status = 'active' AND owner = ?`;
const BEGIN_SEAL_SQL = `UPDATE runs SET status = 'sealing', seal_owner = ?, seal_until = ?, updated_at = ?
  WHERE id = ? AND status = 'active' AND owner = ?`;
const COMPLETE_SQL = `UPDATE runs SET status = 'complete', spec_json = ?, artifact_json = ?, artifact_sha = ?,
  e1_score = ?, updated_at = ?
  WHERE id = ? AND ((status = 'sealing' AND seal_owner = ?) OR (status = 'complete' AND artifact_sha = ?))`;
const HOLDS_LEASE = `((status = 'active' AND owner = ?) OR (status = 'sealing' AND seal_owner = ?))`;
const ABANDON_SQL = `UPDATE runs SET status = 'abandoned', attribution_json = ?, updated_at = ?
  WHERE id = ? AND ${HOLDS_LEASE}`;
const RELEASE_SQL = `UPDATE runs SET status = 'waiting', owner = NULL, heartbeat_at = NULL, attribution_json = ?,
  updated_at = ? WHERE id = ? AND ${HOLDS_LEASE}`;
const APPEND_SQL = `INSERT INTO run_events (run_id, seq, type, data_json, at)
  SELECT id, (SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?), ?, ?, ?
  FROM runs WHERE id = ? AND ${HOLDS_LEASE} RETURNING seq`;

/**
 * Resolves the database URL: `CARTRIDGE_DB_URL`, or `file:.data/cartridge.db` made absolute so two
 * processes started from different directories share one file (§5.3).
 * @param env environment to read
 * @param cwd directory a relative default resolves against
 */
export function resolveDbUrl(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): string {
  const url = env.CARTRIDGE_DB_URL ?? `${FILE_SCHEME}${DEFAULT_DB_PATH}`;
  if (!url.startsWith(FILE_SCHEME)) return url;
  const path = resolve(cwd, url.slice(FILE_SCHEME.length));
  mkdirSync(dirname(path), { recursive: true });
  return `${FILE_SCHEME}${path}`;
}

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : null;
}

function toRunRow(row: Row): RunRow {
  return RunRow.parse({
    id: row.id,
    runKey: row.run_key,
    prompt: row.prompt,
    status: row.status,
    claims: row.claims,
    maxClaims: row.max_claims,
    owner: row.owner,
    heartbeatAt: row.heartbeat_at,
    sealOwner: row.seal_owner,
    sealUntil: row.seal_until,
    spec: parseJson(row.spec_json),
    artifact: parseJson(row.artifact_json),
    e1Score: row.e1_score,
    attribution: parseJson(row.attribution_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Run store over `@libsql/client` (§5.3): every transition is one `UPDATE … WHERE`. */
export class LibSqlRunStore implements RunStore {
  readonly #client: Client;
  readonly #clock: Clock;

  private constructor(client: Client, clock: Clock) {
    this.#client = client;
    this.#clock = clock;
  }

  /**
   * Opens the database and creates the tables if needed.
   * @param url libSQL URL (`file:…` or `:memory:`)
   * @param clock time source
   */
  static async open(url: string, clock: Clock): Promise<LibSqlRunStore> {
    const client = createClient({ url });
    await client.executeMultiple(SCHEMA);
    return new LibSqlRunStore(client, clock);
  }

  /** Closes the connection. */
  close(): void {
    this.#client.close();
  }

  async #write(sql: string, args: InValue[]): Promise<boolean> {
    const result = await this.#client.execute({ sql, args });
    return result.rowsAffected === 1;
  }

  /** @inheritdoc */
  async create(input: CreateRunInput): Promise<RunRow> {
    const now = this.#clock.now();
    await this.#client.execute({
      sql: `INSERT INTO runs (id, run_key, prompt, status, claims, max_claims, created_at, updated_at)
            VALUES (?, ?, ?, 'waiting', 0, ?, ?, ?)`,
      args: [input.id, input.runKey, input.prompt, input.maxClaims, now, now],
    });
    const row = await this.get(input.id);
    if (!row) throw new Error(`run ${input.id} was not created`);
    return row;
  }

  /** @inheritdoc */
  async get(id: string): Promise<RunRow | null> {
    const result = await this.#client.execute({
      sql: "SELECT * FROM runs WHERE id = ?",
      args: [id],
    });
    const [row] = result.rows;
    return row ? toRunRow(row) : null;
  }

  /** @inheritdoc */
  claim(id: string, owner: string, now: number): Promise<boolean> {
    return this.#write(CLAIM_SQL, [
      owner,
      now,
      this.#clock.now(),
      id,
      now - STALE_ACTIVE_MS,
      now,
    ]);
  }

  /** @inheritdoc */
  heartbeat(id: string, owner: string, now: number): Promise<boolean> {
    return this.#write(HEARTBEAT_SQL, [now, this.#clock.now(), id, owner]);
  }

  /** @inheritdoc */
  beginSeal(id: string, owner: string, now: number): Promise<boolean> {
    return this.#write(BEGIN_SEAL_SQL, [
      owner,
      now + SEAL_LEASE_MS,
      this.#clock.now(),
      id,
      owner,
    ]);
  }

  /** @inheritdoc */
  completeSeal(
    id: string,
    owner: string,
    result: CompleteResult,
  ): Promise<boolean> {
    const { spec, artifact, e1Score } = result;
    return this.#write(COMPLETE_SQL, [
      json(spec),
      json(artifact),
      artifact.sha256,
      e1Score,
      this.#clock.now(),
      id,
      owner,
      artifact.sha256,
    ]);
  }

  /** @inheritdoc */
  abandon(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean> {
    return this.#write(ABANDON_SQL, [
      json(attribution),
      this.#clock.now(),
      id,
      owner,
      owner,
    ]);
  }

  /** @inheritdoc */
  release(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean> {
    return this.#write(RELEASE_SQL, [
      json(attribution),
      this.#clock.now(),
      id,
      owner,
      owner,
    ]);
  }

  /** @inheritdoc */
  async appendEvent(
    id: string,
    owner: string,
    event: ProgressEvent,
  ): Promise<number | null> {
    const parsed = ProgressEvent.parse(event);
    const result = await this.#client.execute({
      sql: APPEND_SQL,
      args: [
        id,
        parsed.kind,
        JSON.stringify(parsed.data),
        this.#clock.now(),
        id,
        owner,
        owner,
      ],
    });
    const [row] = result.rows;
    return row ? Number(row.seq) : null;
  }

  /** @inheritdoc */
  async listEvents(id: string, afterSeq: number): Promise<StoredEvent[]> {
    const result = await this.#client.execute({
      sql: "SELECT seq, type, data_json, at FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq",
      args: [id, afterSeq],
    });
    return result.rows.map((row) => ({
      seq: Number(row.seq),
      at: Number(row.at),
      event: ProgressEvent.parse({
        kind: row.type,
        data: parseJson(row.data_json),
      }),
    }));
  }
}
