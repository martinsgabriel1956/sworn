import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev (scripts/dev.js) passa porta fixa e token por env; o proxy injeta o token,
// então a página em dev não precisa dele. No build, o cli embute o token no HTML.
const { PORT, SWORN_TOKEN } = process.env;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @core: a lógica pura de cli/src/core, a mesma que roda no cli.
  resolve: {
    alias: { "@core": new URL("../cli/src/core", import.meta.url).pathname },
  },
  clearScreen: false,
  // O chunk do cliente (CodeMirror + Ajv) passa de 500 KB sem gzip; com gzip são ~165 KB.
  build: { chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: SWORN_TOKEN
      ? {
          "/__sworn": {
            target: `http://127.0.0.1:${PORT}`,
            changeOrigin: true,
            headers: { "x-sworn-token": SWORN_TOKEN },
          },
        }
      : undefined,
  },
});
