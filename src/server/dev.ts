import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FsArtifactStore } from "../engine/artifacts/fs.ts";
import { MemoryArtifactStore } from "../engine/artifacts/memory.ts";
import type { ArtifactStore } from "../engine/artifacts/types.ts";
import { createCartridge, type Cartridge } from "../engine/cartridge.ts";
import { systemClock } from "../engine/clock.ts";
import { driveRun } from "../engine/driver.ts";
import { LibSqlRunStore, resolveDbUrl } from "../engine/run-store/libsql.ts";
import type { RunStore } from "../engine/run-store/types.ts";
import type { RunInput } from "../engine/schemas.ts";
import { cartridgePort } from "../engine/workflow-port.ts";
import { demoMockModels } from "../models/mock.ts";
import {
  createModel,
  modelModeFromEnv,
  type ModelMode,
} from "../models/port.ts";
import { createDevHandler } from "./handlers.ts";
import { toNodeHandler } from "./node-adapter.ts";
import {
  DRIVER_CONCURRENCY,
  createDriverQueue,
  type DriverQueue,
} from "./queue.ts";

/** Default dev port (§12.1). */
export const DEV_PORT = 4270;
const LOCALHOST = "127.0.0.1";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Env = Readonly<Record<string, string | undefined>>;

export interface DevServerOptions {
  readonly port?: number;
  readonly mode?: ModelMode;
  readonly store?: RunStore;
  readonly env?: Env;
  readonly root?: string;
}

export interface DevServer {
  readonly url: string;
  readonly queue: DriverQueue;
  close(): Promise<void>;
}

function artifactStoreFor(mode: ModelMode, root: string): ArtifactStore {
  const persists = mode === "live" || mode === "record";
  return persists
    ? new FsArtifactStore(join(root, "games"))
    : new MemoryArtifactStore();
}

function cartridgeFactory(
  mode: ModelMode,
  env: Env,
  root: string,
): (input: RunInput) => Cartridge {
  return (input) => {
    if (mode === "mock") {
      return createCartridge({
        models: demoMockModels(),
        artifacts: new MemoryArtifactStore(),
      });
    }
    const cassetteDir = join(root, "cassettes", input.runKey);
    return createCartridge({
      models: {
        planner: createModel("planner", mode, { cassetteDir, env }),
        builder: createModel("builder", mode, { cassetteDir, env }),
      },
      artifacts: artifactStoreFor(mode, root),
    });
  };
}

/**
 * Starts the local dev server: `POST /runs` and `GET /runs/:id/events`, with drivers running
 * in-process through a small queue (§5.4, §6.3).
 * @param options port, model mode, run store, environment and repo root
 */
export async function startDevServer(
  options: DevServerOptions = {},
): Promise<DevServer> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? modelModeFromEnv(env);
  const root = options.root ?? REPO_ROOT;
  const store =
    options.store ??
    (await LibSqlRunStore.open(resolveDbUrl(env, root), systemClock));
  const startWorkflowStream = cartridgePort(cartridgeFactory(mode, env, root));
  const owner = `dev-${randomUUID()}`;
  const queue = createDriverQueue(DRIVER_CONCURRENCY, (runId) =>
    driveRun(runId, { store, clock: systemClock, owner, startWorkflowStream }),
  );
  const node = toNodeHandler(
    createDevHandler({
      store,
      enqueue: (runId) => {
        queue.enqueue(runId);
      },
    }),
  );
  const server = createServer((incoming, outgoing) => {
    node(incoming, outgoing).catch((error: unknown) => {
      process.stderr.write(`request failed: ${String(error)}
`);
      outgoing.destroy();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? DEV_PORT, LOCALHOST, resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${LOCALHOST}:${port}`,
    queue,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

if (import.meta.main) {
  const server = await startDevServer();
  process.stdout.write(
    `cartridge dev server on ${server.url} (mode ${modelModeFromEnv(process.env)})\n`,
  );
}
