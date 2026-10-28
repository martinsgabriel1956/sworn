// Índice da busca (Cmd+K): operações por método, path, resumo, operationId e tag, e também pelos
// nomes de campo dos parâmetros e schemas ("email" acha quem recebe ou devolve email).
import { type OpenApiDoc, type Operation, operationDetail } from "./openapi.js";
import { type Ref, resolve } from "./refs.js";
import { mergeAllOf, type Schema } from "./schema.js";

export type SearchEntry = { op: Operation; main: string; fields: string[] };
export type SearchHit = { op: Operation; field?: string };

const FIELD_DEPTH = 3;

function collectFields(
  doc: unknown,
  node: Schema | Ref | undefined,
  out: Set<string>,
  depth = 0,
  seen = new Set<string>(),
) {
  const { value: raw, ref } = resolve<Schema>(doc, node);
  if (!raw || depth > FIELD_DEPTH || (ref && seen.has(ref))) return;
  if (ref) seen.add(ref);
  const s = mergeAllOf(doc, raw);
  for (const v of [...(s.oneOf ?? []), ...(s.anyOf ?? [])]) collectFields(doc, v, out, depth, seen);
  if (s.items) collectFields(doc, s.items, out, depth, seen);
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    out.add(name);
    collectFields(doc, prop, out, depth + 1, seen);
  }
}

export function buildIndex(doc: OpenApiDoc, ops: Operation[]): SearchEntry[] {
  return ops.map((op) => {
    const detail = operationDetail(doc, op);
    const fields = new Set<string>(detail?.parameters.map((p) => p.name));
    const contents = [
      detail?.requestBody?.content,
      ...(detail?.responses.map(([, r]) => r.content) ?? []),
    ];
    for (const content of contents) {
      for (const media of Object.values(content ?? {})) collectFields(doc, media.schema, fields);
    }
    const main = [op.method, op.path, op.summary, op.id, op.tag].join(" ").toLowerCase();
    return { op, main, fields: [...fields] };
  });
}

/**
 * Todo termo precisa aparecer no texto principal ou num nome de campo. Casar no texto principal
 * vale mais que casar só num campo; empate mantém a ordem da spec.
 */
export function search(index: SearchEntry[], query: string, limit = 50): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return index.slice(0, limit).map(({ op }) => ({ op }));
  const hits: (SearchHit & { score: number; i: number })[] = [];
  index.forEach((entry, i) => {
    let score = 0;
    let field: string | undefined;
    for (const term of terms) {
      if (entry.main.includes(term)) {
        score += entry.main.includes(` ${term}`) || entry.main.startsWith(term) ? 3 : 2;
        continue;
      }
      const f = entry.fields.find((name) => name.toLowerCase().includes(term));
      if (!f) return;
      field ??= f;
      score += 1;
    }
    hits.push({ op: entry.op, field, score, i });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ op, field }) => ({ op, field }));
}
