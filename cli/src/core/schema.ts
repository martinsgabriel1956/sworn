// Leitura de JSON Schema para exibição: rótulo do tipo, restrições, allOf juntado.
import { type Ref, refName, resolve } from "./refs.js";

export type Schema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema | Ref>;
  required?: string[];
  items?: Schema | Ref;
  additionalProperties?: boolean | Schema | Ref;
  allOf?: (Schema | Ref)[];
  oneOf?: (Schema | Ref)[];
  anyOf?: (Schema | Ref)[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  nullable?: boolean;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

const MAX_DEPTH = 8;

/** "string<email>", "Pet[]", "integer | string", "Pet" (nome do components). */
export function typeLabel(doc: unknown, node: Schema | Ref | undefined, depth = 0): string {
  const { value: s, ref } = resolve<Schema>(doc, node);
  if (!s) return "?";
  const name = refName(ref);
  if (name) return name;
  if (depth > MAX_DEPTH) return "…";
  const variants = s.oneOf ?? s.anyOf;
  if (variants) {
    // A variante { type: "null" } vira a tag "nullable", não um tipo no rótulo.
    const labels = variants
      .filter((v) => resolve<Schema>(doc, v).value?.type !== "null")
      .map((v) => typeLabel(doc, v, depth + 1));
    return [...new Set(labels)].join(" | ");
  }
  const types = (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []).filter(
    (t) => t !== "null",
  );
  if (types.length === 0) {
    if (s.properties || s.allOf || s.additionalProperties) types.push("object");
    else if (s.items) types.push("array");
    else return "any";
  }
  return types
    .map((t) => {
      if (t === "array") return `${typeLabel(doc, s.items, depth + 1)}[]`;
      return s.format ? `${t}<${s.format}>` : t;
    })
    .join(" | ");
}

/** 3.0 usa `nullable: true`; 3.1 usa `type: [..., "null"]` ou uma variante `{ type: "null" }`. */
export function isNullable(doc: unknown, s: Schema): boolean {
  if (s.nullable === true) return true;
  if (Array.isArray(s.type) && s.type.includes("null")) return true;
  return [...(s.oneOf ?? []), ...(s.anyOf ?? [])].some(
    (v) => resolve<Schema>(doc, v).value?.type === "null",
  );
}

/** Junta os membros de allOf num schema só (o caso comum: herança de objeto). */
export function mergeAllOf(doc: unknown, s: Schema, depth = 0): Schema {
  if (!s.allOf || depth > MAX_DEPTH) return s;
  const { allOf, ...rest } = s;
  const out: Record<string, unknown> = { ...rest };
  const properties = { ...rest.properties };
  const required = [...(rest.required ?? [])];
  for (const member of allOf) {
    const part = resolve<Schema>(doc, member).value;
    if (!part) continue;
    const merged = mergeAllOf(doc, part, depth + 1);
    Object.assign(properties, merged.properties);
    required.push(...(merged.required ?? []));
    for (const [key, value] of Object.entries(merged)) out[key] ??= value;
  }
  return { ...out, properties, required: [...new Set(required)] } as Schema;
}

/** Tem filhos para expandir no visualizador (propriedades, variantes, itens compostos)? */
export function hasChildren(doc: unknown, node: Schema | Ref | undefined, depth = 0): boolean {
  const raw = resolve<Schema>(doc, node).value;
  if (!raw || depth > MAX_DEPTH) return false;
  const s = mergeAllOf(doc, raw);
  if (s.oneOf || s.anyOf) return true;
  if (s.properties && Object.keys(s.properties).length > 0) return true;
  if (typeof s.additionalProperties === "object") return true;
  return s.items !== undefined && hasChildren(doc, s.items, depth + 1);
}

/** Restrições em texto curto: ["valores: \"a\", \"b\"", "≥ 1", "tamanho: 1..50"]. */
export function constraints(s: Schema): string[] {
  const out: string[] = [];
  const j = (v: unknown) => JSON.stringify(v);
  if (s.enum) out.push(`valores: ${s.enum.map(j).join(", ")}`);
  if (s.const !== undefined) out.push(`fixo: ${j(s.const)}`);
  if (s.default !== undefined) out.push(`padrão: ${j(s.default)}`);
  // 3.1: exclusiveMinimum é o próprio limite; 3.0: é booleano que modifica `minimum`.
  if (typeof s.exclusiveMinimum === "number") out.push(`> ${s.exclusiveMinimum}`);
  else if (s.minimum !== undefined) out.push(`${s.exclusiveMinimum ? ">" : "≥"} ${s.minimum}`);
  if (typeof s.exclusiveMaximum === "number") out.push(`< ${s.exclusiveMaximum}`);
  else if (s.maximum !== undefined) out.push(`${s.exclusiveMaximum ? "<" : "≤"} ${s.maximum}`);
  if (s.minLength !== undefined || s.maxLength !== undefined) {
    out.push(`tamanho: ${s.minLength ?? 0}..${s.maxLength ?? "∞"}`);
  }
  if (s.pattern) out.push(`regex: ${s.pattern}`);
  if (s.minItems !== undefined || s.maxItems !== undefined) {
    out.push(`itens: ${s.minItems ?? 0}..${s.maxItems ?? "∞"}`);
  }
  if (s.uniqueItems) out.push("itens únicos");
  if (s.example !== undefined) out.push(`exemplo: ${j(s.example)}`);
  return out;
}
