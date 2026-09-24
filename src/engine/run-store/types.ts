import { z } from "zod";
import { GameSpec } from "../../contract/spec.ts";
import type { ProgressEvent, StoredEvent } from "../events.ts";
import { RunStatus } from "../lifecycle.ts";
import { Attribution } from "../schemas.ts";

export type { ProgressEvent, StoredEvent };

/** The artifact committed to a complete row; the relay's terminal event is built from it. */
export const CommittedArtifact = z.object({
  version: z.string(),
  sha256: z.string(),
  bytes: z.int().min(0),
  html: z.string(),
});
export type CommittedArtifact = z.infer<typeof CommittedArtifact>;

/** One run row (§5.3). Times are milliseconds from the injected clock. */
export const RunRow = z.object({
  id: z.string(),
  runKey: z.string(),
  prompt: z.string(),
  status: RunStatus,
  claims: z.int().min(0),
  maxClaims: z.int().min(1),
  owner: z.string().nullable(),
  heartbeatAt: z.number().nullable(),
  sealOwner: z.string().nullable(),
  sealUntil: z.number().nullable(),
  spec: GameSpec.nullable(),
  artifact: CommittedArtifact.nullable(),
  e1Score: z.number().nullable(),
  attribution: Attribution.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RunRow = z.infer<typeof RunRow>;

/**
 * `create` refuses a second open run for one run key: both would write the same artifact
 * directory and cassette set (§5.3).
 */
export class RunKeyBusyError extends Error {
  readonly runKey: string;

  /**
   * @param runKey the run key that already has an open run
   */
  constructor(runKey: string) {
    super(`run key ${runKey} already has an open run`);
    this.name = "RunKeyBusyError";
    this.runKey = runKey;
  }
}

export interface CreateRunInput {
  readonly id: string;
  readonly runKey: string;
  readonly prompt: string;
  readonly maxClaims: number;
}

export interface CompleteResult {
  readonly spec: GameSpec;
  readonly artifact: CommittedArtifact;
  readonly e1Score: number;
}

/**
 * Run table plus event log (§5.3). Every transition is one conditional write; the boolean says
 * whether this caller's write won. `abandon` and `release` succeed for the `active` owner or the
 * `sealing` seal owner, so a failed commit can still settle its row.
 */
export interface RunStore {
  /** @throws RunKeyBusyError when the run key already has a non-terminal row */
  create(input: CreateRunInput): Promise<RunRow>;
  get(id: string): Promise<RunRow | null>;
  claim(id: string, owner: string, now: number): Promise<boolean>;
  heartbeat(id: string, owner: string, now: number): Promise<boolean>;
  beginSeal(id: string, owner: string, now: number): Promise<boolean>;
  completeSeal(
    id: string,
    owner: string,
    result: CompleteResult,
  ): Promise<boolean>;
  abandon(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean>;
  release(
    id: string,
    owner: string,
    attribution: Attribution,
  ): Promise<boolean>;
  /**
   * Appends to the run's event log only while `owner` holds the lease (the `active` owner or the
   * `sealing` seal owner), so a driver that lost its claim cannot write into the next claim's log.
   * @returns the new seq, or null when the caller does not hold the lease
   */
  /**
   * Abandons a row whose lease expired with no claims left (`canReap`).
   * @returns true when this call abandoned the row
   */
  reap(id: string, now: number, attribution: Attribution): Promise<boolean>;
  /** Rows that are not terminal yet (`waiting`, `active`, `sealing`), oldest first. */
  listOpen(): Promise<RunRow[]>;
  appendEvent(
    id: string,
    owner: string,
    event: ProgressEvent,
  ): Promise<number | null>;
  listEvents(id: string, afterSeq: number): Promise<StoredEvent[]>;
}
