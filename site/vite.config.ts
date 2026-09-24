import { defineConfig } from "vite";

const DEV_PORT = 4280;
const PREVIEW_PORT = 4281;
const API_PORT = Number(process.env.CARTRIDGE_API_PORT ?? "4282");
const API_TARGET = `http://127.0.0.1:${String(API_PORT)}`;
const proxy = { "/api": { target: API_TARGET, changeOrigin: false } };

export default defineConfig({
  base: "/",
  server: {
    port: DEV_PORT,
    strictPort: true,
    fs: { allow: [".."] },
    proxy,
  },
  preview: {
    port: PREVIEW_PORT,
    strictPort: true,
    proxy,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
