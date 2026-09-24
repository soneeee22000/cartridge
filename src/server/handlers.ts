import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_CLAIMS } from "../engine/lifecycle.ts";
import { lastEventIdOf, relayRun, type RelayOptions } from "../engine/relay.ts";
import type { RunStore } from "../engine/run-store/types.ts";
import { RunKey } from "../engine/schemas.ts";
import type { WebHandler } from "./node-adapter.ts";

const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const PROMPT_MAX_CHARS = 4_000;
const ADHOC_HASH_CHARS = 12;
const EVENTS_ROUTE = /^\/runs\/([^/]+)\/events$/;

const CreateRunBody = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_CHARS),
  promptId: RunKey.optional(),
});

export interface DevHandlerDeps {
  readonly store: RunStore;
  readonly enqueue: (runId: string) => void;
  readonly newId?: () => string;
  readonly maxClaims?: number;
  readonly relay?: Pick<RelayOptions, "clock" | "sleep" | "pollMs">;
}

/**
 * A stable run key for a prompt with no dataset id: never random, so cassettes and games land in
 * the same place for the same prompt.
 * @param prompt the brief
 */
export function adhocRunKey(prompt: string): string {
  const digest = createHash("sha256").update(prompt).digest("hex");
  return `adhoc-${digest.slice(0, ADHOC_HASH_CHARS)}`;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function createRun(
  request: Request,
  deps: DevHandlerDeps,
): Promise<Response> {
  const parsed = CreateRunBody.safeParse(await readBody(request));
  if (!parsed.success)
    return Response.json(
      { error: "expected { prompt, promptId? }" },
      { status: HTTP_BAD_REQUEST },
    );
  const { prompt, promptId } = parsed.data;
  const runId = (deps.newId ?? randomUUID)();
  await deps.store.create({
    id: runId,
    runKey: promptId ?? adhocRunKey(prompt),
    prompt,
    maxClaims: deps.maxClaims ?? MAX_CLAIMS,
  });
  deps.enqueue(runId);
  return Response.json({ runId }, { status: HTTP_ACCEPTED });
}

/**
 * The dev server's routes (§6.3): `POST /runs` and `GET /runs/:id/events`.
 * @param deps run store, queue and optional relay timing
 */
export function createDevHandler(deps: DevHandlerDeps): WebHandler {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/runs")
      return createRun(request, deps);
    const events = EVENTS_ROUTE.exec(pathname);
    if (request.method === "GET" && events?.[1])
      return relayRun({
        ...deps.relay,
        store: deps.store,
        runId: decodeURIComponent(events[1]),
        lastEventId: lastEventIdOf(request),
        signal: request.signal,
      });
    return Response.json({ error: "not found" }, { status: HTTP_NOT_FOUND });
  };
}
