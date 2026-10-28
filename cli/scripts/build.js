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
  // Tudo num arquivo só, dependências inclusas: o pacote publicado não tem dependências, e o
  // `npx @sworn/cli` baixa 1 pacote (~800 KB) em vez de instalar 75 (~29 MB, uns 20s).
  bundle: true,
  minify: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Dependências CommonJS dentro de um bundle ESM ainda chamam require().
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
cpSync(web, `${dist}web`, { recursive: true });
// O npm publica o README e o LICENSE da pasta do pacote; a fonte é a raiz do repositório.
for (const file of ["README.md", "LICENSE"]) {
  cpSync(new URL(`../../${file}`, import.meta.url), new URL(`../${file}`, import.meta.url));
}
