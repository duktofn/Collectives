import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid({ hot: !process.env.VITEST })],
  build: { sourcemap: false },
  // Scan application pages rather than generated Tauri HTML under target/.
  optimizeDeps: { entries: ["index.html", "e2e/*.html"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Generated native profiles and reports can contain tens of thousands of
      // files. Watching them delays the first module request and UI startup.
      ignored: ["**/src-tauri/**", "**/artifacts/**", "**/release/**", "**/test-results/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
}));
