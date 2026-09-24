import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
