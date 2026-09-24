import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const VITE_ENTRY = ["node_modules", "vite", "bin", "vite.js"] as const;
const READY_MARKER = "Local";
const PLAIN_OUTPUT_ENV = { NO_COLOR: "1", FORCE_COLOR: "0" } as const;

/** Absolute path of the pinned Vite CLI inside the site package. */
function viteBin(siteDir: string): string {
  return resolve(siteDir, ...VITE_ENTRY);
}

/** Run `vite build` synchronously and fail loudly if it does not succeed. */
export function buildSite(siteDir: string): void {
  const result = spawnSync(process.execPath, [viteBin(siteDir), "build"], {
    cwd: siteDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`vite build exited with status ${String(result.status)}`);
  }
}

/** Resolve once the preview server prints its address, reject if it exits first. */
function waitForReadyLine(child: ChildProcess): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(READY_MARKER)) resolveReady();
    });
    child.once("exit", (code) => {
      rejectReady(
        new Error(`vite preview exited early (${String(code)}): ${output}`),
      );
    });
  });
}

/** Start `vite preview` on a fixed port and confirm the page answers with 200. */
export async function startPreview(
  siteDir: string,
  url: string,
  port: number,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [viteBin(siteDir), "preview", "--port", String(port), "--strictPort"],
    {
      cwd: siteDir,
      env: { ...process.env, ...PLAIN_OUTPUT_ENV },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await waitForReadyLine(child);
  const response = await fetch(url);
  if (!response.ok) {
    child.kill();
    throw new Error(
      `Preview server answered ${String(response.status)} for ${url}`,
    );
  }
  return child;
}

const API_SCRIPT = ["..", "scripts", "site-api.ts"] as const;
const API_READY_MARKER = "site api listening";

/** Start the repo's keyless replay API on a port, at instant pace, and wait until it listens. */
export async function startApi(
  siteDir: string,
  port: number,
): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      resolve(siteDir, ...API_SCRIPT),
      "--port",
      String(port),
      "--pace",
      "instant",
    ],
    { cwd: siteDir, stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolveReady, rejectReady) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(API_READY_MARKER)) resolveReady();
    });
    child.once("exit", (code) => {
      rejectReady(
        new Error(`site api exited early (${String(code)}): ${output}`),
      );
    });
  });
  return child;
}
