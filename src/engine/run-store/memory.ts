import type { Clock } from "../clock.ts";
import { ProgressEvent, type StoredEvent } from "../events.ts";
import { SEAL_LEASE_MS, canClaim } from "../lifecycle.ts";
import type { Attribution } from "../schemas.ts";
import type {
  CompleteResult,
  CreateRunInput,
  RunRow,
  RunStore,
} from "./types.ts";

/**
 * A `Map`-backed run store. Every method checks and writes synchronously inside one call, so there
 * is no `await` between a guard and its write (§5.3).
 */
export class MemoryRunStore implements RunStore {
  readonly #rows = new Map<string, RunRow>();
  readonly #events = new Map<string, StoredEvent[]>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  #update(
    id: string,
    guard: (row: RunRow) => boolean,
    patch: (row: RunRow) => Partial<RunRow>,
  ): boolean {
    const row = this.#rows.get(id);
    if (!row || !guard(row)) return false;
    this.#rows.set(id, { ...row, ...patch(row), updatedAt: this.#clock.now() });
    return true;
  }

  /** @inheritdoc */
  create(input: CreateRunInput): Promise<RunRow> {
    const now = this.#clock.now();
    const row: RunRow = {
      ...input,
      status: "waiting",
      claims: 0,
      owner: null,
      heartbeatAt: null,
      sealOwner: null,
      sealUntil: null,
      spec: null,
      artifact: null,
      e1Score: null,
      attribution: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#rows.set(input.id, row);
    return Promise.resolve(row);
  }

  /** @inheritdoc */
  get(id: string): Promise<RunRow | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  /** @inheritdoc */
  claim(id: string, owner: string, now: number): Promise<boolean> {
    const won = this.#update(
      id,
      (row) => canClaim(row, now),
      (row) => ({
        status: "active",
        claims: row.claims + 1,
        owner,
        heartbeatAt: now,
      }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  heartbeat(id: string, owner: string, now: number): Promise<boolean> {
    const won = this.#update(
      id,
      (row) => row.status === "active" && row.owner === owner,
      () => ({ heartbeatAt: now }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  beginSeal(id: string, owner: string, now: number): Promise<boolean> {
    const won = this.#update(
      id,
      (row) => row.status === "active" && row.owner === owner,
      () => ({
        status: "sealing",
        sealOwner: owner,
        sealUntil: now + SEAL_LEASE_MS,
      }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  completeSeal(
    id: string,
    owner: string,
    result: CompleteResult,
  ): Promise<boolean> {
    const won = this.#update(
      id,
      (row) =>
        (row.status === "sealing" && row.sealOwner === owner) ||
        (row.status === "complete" &&
          row.artifact?.sha256 === result.artifact.sha256),
      () => ({
        status: "complete",
        spec: result.spec,
        artifact: result.artifact,
        e1Score: result.e1Score,
      }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  abandon(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean> {
    const won = this.#update(
      id,
      (row) => row.status === "active" && row.owner === owner,
      () => ({ status: "abandoned", attribution }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  release(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean> {
    const won = this.#update(
      id,
      (row) => row.status === "active" && row.owner === owner,
      () => ({
        status: "waiting",
        owner: null,
        heartbeatAt: null,
        attribution,
      }),
    );
    return Promise.resolve(won);
  }

  /** @inheritdoc */
  appendEvent(id: string, event: ProgressEvent): Promise<number> {
    const events = this.#events.get(id) ?? [];
    const seq = events.length + 1;
    events.push({
      seq,
      at: this.#clock.now(),
      event: ProgressEvent.parse(event),
    });
    this.#events.set(id, events);
    return Promise.resolve(seq);
  }

  /** @inheritdoc */
  listEvents(id: string, afterSeq: number): Promise<StoredEvent[]> {
    const events = this.#events.get(id) ?? [];
    return Promise.resolve(events.filter((stored) => stored.seq > afterSeq));
  }
}
