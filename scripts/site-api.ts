import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { CassettePace } from "../src/models/cassette.ts";
import { toNodeHandler, type WebHandler } from "../src/server/node-adapter.ts";
import {
  createPromptsHandler,
  createReplayHandler,
} from "../src/server/replay.ts";

/** Default port for the local replay API that the site's dev and preview servers proxy to. */
export const SITE_API_PORT = 4282;
const LOCALHOST = "127.0.0.1";
const HTTP_NOT_FOUND = 404;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACES: readonly CassettePace[] = ["recorded", "instant"];

export interface SiteApiOptions {
  readonly root?: string;
  readonly port?: number;
  readonly pace?: CassettePace;
}

export interface SiteApi {
  readonly url: string;
  close(): Promise<void>;
}

function notFound(): Response {
  return Response.json({ error: "not found" }, { status: HTTP_NOT_FOUND });
}

function router(root: string, pace: CassettePace): WebHandler {
  const prompts = createPromptsHandler({ root });
  const replay = createReplayHandler({ root, pace });
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/prompts") return prompts(request);
    if (pathname === "/api/replay") return replay(request);
    return notFound();
  };
}

function listen(server: Server, port: number): Promise<string> {
  return new Promise<string>((resolve) => {
    server.listen(port, LOCALHOST, () => {
      const { port: bound } = server.address() as AddressInfo;
      resolve(`http://${LOCALHOST}:${bound}`);
    });
  });
}

/**
 * Serves the same `/api/prompts` and `/api/replay` handlers as the Vercel functions, keyless and in
 * replay mode, so the site's dev and preview servers can proxy `/api` to it.
 * @param options asset root, port (0 picks a free one) and cassette pace
 */
export async function startSiteApi(
  options: SiteApiOptions = {},
): Promise<SiteApi> {
  const handler = toNodeHandler(
    router(options.root ?? REPO_ROOT, options.pace ?? "recorded"),
  );
  const server = createServer((incoming, outgoing) => {
    void handler(incoming, outgoing);
  });
  const url = await listen(server, options.port ?? SITE_API_PORT);
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  return { url, close };
}

function parsePace(raw: string | undefined): CassettePace {
  const pace = PACES.find((candidate) => candidate === raw);
  if (raw !== undefined && pace === undefined)
    throw new Error(`--pace must be one of ${PACES.join(", ")}`);
  return pace ?? "recorded";
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const { values } = parseArgs({
    options: { port: { type: "string" }, pace: { type: "string" } },
  });
  const port = Number(
    values.port ?? process.env.CARTRIDGE_API_PORT ?? SITE_API_PORT,
  );
  const api = await startSiteApi({ port, pace: parsePace(values.pace) });
  process.stdout.write(`site api listening on ${api.url}\n`);
}
