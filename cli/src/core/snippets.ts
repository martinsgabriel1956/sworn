// A request montada pelo cliente em curl, fetch e Python. Três templates à mão; adotar
// httpsnippet-lite quando entrarem mais linguagens (PLANNING §2).
import type { SendRequest } from "./request.js";

export const SNIPPET_LANGS = ["curl", "fetch", "python"] as const;
export type SnippetLang = (typeof SNIPPET_LANGS)[number];

/** Aspas simples do shell: a única coisa a escapar é a própria aspa simples. */
const sh = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// JSON.stringify gera literal de string válido em JS e em Python.
const str = (text: string) => JSON.stringify(text);

function curl(req: SendRequest) {
  const lines = [`curl -X ${req.method} ${sh(req.url)}`];
  for (const [k, v] of req.headers) lines.push(`  -H ${sh(`${k}: ${v}`)}`);
  if (req.body !== undefined) lines.push(`  --data-raw ${sh(req.body)}`);
  return lines.join(" \\\n");
}

function fetchJs(req: SendRequest) {
  const options = [`  method: ${str(req.method)},`];
  if (req.headers.length > 0) {
    options.push("  headers: {");
    for (const [k, v] of req.headers) options.push(`    ${str(k)}: ${str(v)},`);
    options.push("  },");
  }
  if (req.body !== undefined) options.push(`  body: ${str(req.body)},`);
  return [
    `const res = await fetch(${str(req.url)}, {`,
    ...options,
    "});",
    "const data = await res.json();",
  ].join("\n");
}

function python(req: SendRequest) {
  const lines = ["import requests", "", "res = requests.request(", `    ${str(req.method)},`];
  lines.push(`    ${str(req.url)},`);
  if (req.headers.length > 0) {
    lines.push("    headers={");
    for (const [k, v] of req.headers) lines.push(`        ${str(k)}: ${str(v)},`);
    lines.push("    },");
  }
  if (req.body !== undefined) lines.push(`    data=${str(req.body)}.encode(),`);
  lines.push(")", "print(res.status_code, res.text)");
  return lines.join("\n");
}

export function snippet(req: SendRequest, lang: SnippetLang): string {
  if (lang === "curl") return curl(req);
  if (lang === "fetch") return fetchJs(req);
  return python(req);
}
