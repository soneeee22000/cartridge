import { defineConfig } from "vitest/config";

/** Subprocess tests share the CPU with headless Chromium in the E2 suites (arbitrary cap). */
const SUBPROCESS_TEST_TIMEOUT_MS = 20_000;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: SUBPROCESS_TEST_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        "src/engine/**": { lines: 80 },
        "src/eval/**": { lines: 80 },
        "src/eval/e1/**": { lines: 90 },
      },
    },
  },
});
