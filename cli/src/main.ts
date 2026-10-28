import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildServer } from "./server.js";
import { loadSpec } from "./spec.js";
import { createStore } from "./store.js";

const HELP = `Uso: sworn [spec] [opções]

  spec            arquivo ou URL da spec OpenAPI 3.0/3.1
                  (padrão: openapi.yaml, openapi.yml ou openapi.json na pasta atual)

  -p, --port      porta do servidor (padrão: 4000, ou outra livre se ocupada)
      --no-open   não abre o browser
  -h, --help      mostra esta ajuda`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    port: { type: "string", short: "p" },
    open: { type: "boolean", default: true },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const input =
  positionals[0] ?? ["openapi.yaml", "openapi.yml", "openapi.json"].find((f) => existsSync(f));
if (!input) {
  console.error(`Nenhuma spec encontrada na pasta atual.\n\n${HELP}`);
  process.exit(1);
}

const spec = loadSpec(input);
const state = await spec.reload();
const token = process.env.SWORN_TOKEN ?? randomBytes(32).toString("base64url");
// Após o build, o web/ fica em dist/web, ao lado deste arquivo. Em dev a pasta não existe e o Vite serve a página.
const webDir = fileURLToPath(new URL("./web/", import.meta.url));
// .sworn/ fica ao lado da spec; com spec por URL, na pasta atual.
const store = createStore(join(/^https?:\/\//i.test(input) ? "." : dirname(input), ".sworn"));
const app = await buildServer({ spec, store, token, webDir });

const explicitPort = values.port ?? process.env.PORT;
let url: string;
try {
  url = await app.listen({ host: "127.0.0.1", port: Number(explicitPort ?? 4000) });
} catch (err) {
  if (explicitPort || (err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  url = await app.listen({ host: "127.0.0.1", port: 0 });
}

console.log(`Sworn em ${url}\nSpec: ${state.source}`);
if (state.error) console.error(`Erro na spec: ${state.error}`);
spec.events.on("change", (s) =>
  console.log(
    s.error ? `Erro na spec: ${s.error}` : `Spec recarregada (${new Date().toLocaleTimeString()})`,
  ),
);

if (values.open) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}
