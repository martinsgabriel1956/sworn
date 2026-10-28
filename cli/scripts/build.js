// Gera o pacote publicado: dist/main.js (o CLI) + dist/web (o build do web/, servido pelo cli).
import { cpSync, existsSync, rmSync } from "node:fs";
import { build } from "esbuild";

const dist = new URL("../dist/", import.meta.url).pathname;
const web = new URL("../../web/dist/", import.meta.url).pathname;
if (!existsSync(web)) throw new Error("web/dist não existe: rode `npm run build` na raiz.");

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: [new URL("../src/main.ts", import.meta.url).pathname],
  outfile: `${dist}main.js`,
  bundle: true,
  // As dependências vêm do npm junto com o pacote; só o código do cli vai no bundle.
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
});
cpSync(web, `${dist}web`, { recursive: true });
