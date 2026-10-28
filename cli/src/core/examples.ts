// Exemplo realista a partir do schema, quando a spec não traz um. Determinístico: o mesmo schema
// gera sempre o mesmo valor, para o body e os snippets não mudarem a cada render.
import { type MediaType, mediaExample } from "./openapi.js";
import { isRef, type Ref, refName, resolve } from "./refs.js";
import { mergeAllOf, type Schema } from "./schema.js";

/** request: sem campos readOnly (o servidor preenche). response: sem campos writeOnly. */
export type ExampleMode = "request" | "response";

const MAX_DEPTH = 6;

const BY_FORMAT: Record<string, unknown> = {
  email: "ana@exemplo.com",
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  date: "2026-01-15",
  "date-time": "2026-01-15T10:30:00Z",
  time: "10:30:00",
  uri: "https://exemplo.com",
  url: "https://exemplo.com",
  hostname: "api.exemplo.com",
  ipv4: "192.168.0.10",
  ipv6: "2001:db8::1",
  byte: "U3dvcm4=",
  password: "s3nh4-forte",
};

// Pelo nome do campo, quando o schema só diz "string". Ordem importa: o primeiro que casar vence.
const BY_NAME: [RegExp, string][] = [
  [/e-?mail/i, "ana@exemplo.com"],
  [/phone|telefone|celular/i, "+55 11 91234-5678"],
  [/url|link|site|website/i, "https://exemplo.com"],
  [/^(first_?name|nome)$/i, "Ana"],
  [/name|nome/i, "Ana Souza"],
  [/city|cidade/i, "São Paulo"],
  [/country|pais/i, "BR"],
  [/currency|moeda/i, "BRL"],
  [/(^|_)id$|Id$/, "a1b2c3"],
  [/token/i, "tok_123"],
  [/senha|password/i, "s3nh4-forte"],
  [/description|descri/i, "Uma descrição curta."],
];

export function exampleFor(
  doc: unknown,
  node: Schema | Ref | undefined,
  mode: ExampleMode = "request",
  name = "",
  ancestry: string[] = [],
): unknown {
  const { value: raw, ref } = resolve<Schema>(doc, node);
  if (!raw || ancestry.length > MAX_DEPTH) return undefined;
  if (ref && ancestry.includes(ref)) return undefined; // recursão: o campo some do exemplo
  const chain = ref ? [...ancestry, ref] : ancestry;
  const s = mergeAllOf(doc, raw);

  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum.find((v) => v !== null) ?? s.enum[0];

  const variants = (s.oneOf ?? s.anyOf)?.filter(
    (v) => resolve<Schema>(doc, v).value?.type !== "null",
  );
  if (variants?.length) {
    const first = variants[0];
    const value = exampleFor(doc, first, mode, name, chain);
    // Com discriminator, o exemplo já sai com o valor que escolhe essa variante.
    const property = s.discriminator?.propertyName;
    if (property && value && typeof value === "object" && isRef(first)) {
      const key = Object.entries(s.discriminator?.mapping ?? {}).find(
        ([, target]) => target === first.$ref,
      )?.[0];
      const fallback = (value as Record<string, unknown>)[property] ?? refName(first.$ref);
      return { ...(value as object), [property]: key ?? fallback };
    }
    return value;
  }

  const types = (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []).filter(
    (t) => t !== "null",
  );
  const type =
    types[0] ?? (s.properties || s.additionalProperties ? "object" : s.items ? "array" : undefined);

  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(s.properties ?? {})) {
        const p = resolve<Schema>(doc, prop).value;
        if ((mode === "request" && p?.readOnly) || (mode === "response" && p?.writeOnly)) continue;
        const value = exampleFor(doc, prop, mode, key, chain);
        if (value !== undefined) out[key] = value;
      }
      if (Object.keys(out).length === 0 && typeof s.additionalProperties === "object") {
        const value = exampleFor(doc, s.additionalProperties, mode, "", chain);
        if (value !== undefined) out.chave = value;
      }
      return out;
    }
    case "array": {
      const item = exampleFor(doc, s.items, mode, name, chain);
      return item === undefined ? [] : Array(Math.max(1, s.minItems ?? 1)).fill(item);
    }
    case "integer":
    case "number": {
      const step = type === "integer" ? 1 : 0.5;
      const min =
        typeof s.exclusiveMinimum === "number"
          ? s.exclusiveMinimum + step
          : s.minimum !== undefined
            ? s.minimum + (s.exclusiveMinimum ? step : 0)
            : undefined;
      const max =
        typeof s.exclusiveMaximum === "number"
          ? s.exclusiveMaximum - step
          : s.maximum !== undefined
            ? s.maximum - (s.exclusiveMaximum ? step : 0)
            : undefined;
      const base = type === "integer" ? 1 : 9.9;
      return Math.min(Math.max(base, min ?? base), max ?? Number.POSITIVE_INFINITY);
    }
    case "boolean":
      return true;
    case "string": {
      const text =
        (s.format && BY_FORMAT[s.format]) ??
        BY_NAME.find(([re]) => re.test(name))?.[1] ??
        // ponytail: com `pattern` não dá para gerar sem uma lib de regex reversa; vai o texto genérico.
        "texto";
      if (typeof text !== "string") return text;
      const min = s.minLength ?? 0;
      const padded = text.length < min ? text.padEnd(min, "x") : text;
      return s.maxLength !== undefined ? padded.slice(0, s.maxLength) : padded;
    }
    default:
      return undefined;
  }
}

/**
 * Exemplo de um corpo: o que a spec declara ou, se não houver, um gerado do schema.
 * Só gera para JSON: um exemplo JSON num corpo form-urlencoded ou XML ensinaria errado.
 */
export function bodyExample(
  doc: unknown,
  mediaType: string,
  media: MediaType,
  mode: ExampleMode,
): { value: unknown; generated: boolean } | undefined {
  const declared = mediaExample(doc, media);
  if (declared) return { value: declared.value, generated: false };
  if (!/[/+]json\b/i.test(mediaType) || !media.schema) return undefined;
  const value = exampleFor(doc, media.schema, mode);
  return value === undefined ? undefined : { value, generated: true };
}
