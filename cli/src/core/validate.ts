// Resposta real (ou body de request) x schema da spec (PLANNING §6). Puro: roda no web/ e,
// na V3, no `sworn check`.
//
// A spec inteira entra no Ajv como um schema só ("doc"), e cada validação compila o trecho
// pelo ponteiro ("doc#/paths/~1pets/get/responses/200/content/application~1json/schema"):
// os $ref internos e a recursão funcionam sem reescrever nada.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { OpenApiDoc, Operation } from "./openapi.js";
import { isRef, pointer, type Ref, refName, resolve } from "./refs.js";
import { mergeAllOf, type Schema } from "./schema.js";

export type Issue = {
  level: "error" | "warning";
  kind: "schema" | "undocumented-field" | "undocumented-status" | "content-type";
  /** JSON Pointer no body ("/data/0/email"); vazio quando é sobre a resposta inteira. */
  path: string;
  message: string;
};

export type Validator = {
  response(op: Operation, status: number, headers: [string, string][], body: string): Issue[];
  requestBody(op: Operation, contentType: string | undefined, body: string): Issue[];
};

// ajv-formats é CJS: no Node e no Vite o default já é a função; os tipos dizem `{ default }`.
type AddFormats = (ajv: Ajv2020) => unknown;
const addFormats = ((addFormatsModule as unknown as { default?: AddFormats }).default ??
  addFormatsModule) as AddFormats;

const esc = (s: string) => s.replaceAll("~", "~0").replaceAll("/", "~1");
const json = (v: unknown) => JSON.stringify(v);
const isJson = (mediaType: string) => /[/+]json\b/i.test(mediaType);
const MAX_DEPTH = 32;

/**
 * OpenAPI 3.0 → JSON Schema 2020-12: `nullable` e `exclusiveMinimum/Maximum` booleanos.
 * Percorre o documento inteiro; só mexe em objetos com `nullable: true` ou exclusivo booleano,
 * que fora de schema não existem na spec.
 */
export function from30(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(from30);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = from30(v);
  for (const [exclusive, limit] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    if (typeof out[exclusive] !== "boolean") continue;
    if (out[exclusive] && typeof out[limit] === "number") {
      out[exclusive] = out[limit];
      delete out[limit];
    } else delete out[exclusive];
  }
  if (typeof out.nullable === "boolean") {
    const nullable = out.nullable;
    delete out.nullable;
    if (!nullable) return out;
    if (typeof out.type === "string") {
      out.type = [out.type, "null"];
      if (Array.isArray(out.enum)) out.enum = [...out.enum, null];
      return out;
    }
    // $ref, allOf ou sem type: vira "isso ou null".
    return { anyOf: [out, { type: "null" }] };
  }
  return out;
}

const validators = new WeakMap<object, Validator>();

/** Um validador por versão da spec; os trechos compilados ficam em cache dentro dele. */
export function validatorFor(doc: OpenApiDoc): Validator {
  let v = validators.get(doc);
  if (!v) {
    v = createValidator(doc);
    validators.set(doc, v);
  }
  return v;
}

function createValidator(doc: OpenApiDoc): Validator {
  const schemaDoc = doc.openapi.startsWith("3.0") ? (from30(doc) as OpenApiDoc) : doc;
  // strict: false porque o documento tem chaves que não são JSON Schema (openapi, paths...).
  // verbose: os erros trazem o dado e o schema pai, usados nas mensagens e no oneOf.
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    verbose: true,
    validateSchema: false,
    logger: false,
  });
  addFormats(ajv);
  ajv.addFormat("int32", {
    type: "number",
    validate: (n: number) => Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31,
  });
  ajv.addFormat("int64", { type: "number", validate: Number.isInteger });
  ajv.addFormat("byte", /^[A-Za-z0-9+/]*={0,2}$/);
  for (const f of ["float", "double", "binary", "password"]) ajv.addFormat(f, true);
  ajv.addSchema(schemaDoc as object, "doc");

  const compiled = new Map<string, ValidateFunction | Error>();
  function compile(ptr: string) {
    let fn = compiled.get(ptr);
    if (!fn) {
      try {
        fn = ajv.getSchema(`doc${ptr}`) ?? new Error(`ponteiro inexistente: ${ptr}`);
      } catch (err) {
        fn = err as Error;
      }
      compiled.set(ptr, fn);
    }
    return fn;
  }

  /** Segue $ref (response e requestBody podem ser $ref para components) e devolve o ponteiro final. */
  function follow(ptr: string) {
    const seen = new Set<string>();
    let node = pointer(doc, ptr);
    while (isRef(node) && !seen.has(node.$ref)) {
      seen.add(node.$ref);
      ptr = node.$ref;
      node = pointer(doc, ptr);
    }
    return { ptr, node };
  }

  function toIssues(errors: ErrorObject[], prefix = ""): Issue[] {
    const dropped = new Set<ErrorObject>();
    const extra: Issue[] = [];
    const under = (e: ErrorObject, path: string) =>
      e.instancePath === path || e.instancePath.startsWith(`${path}/`);

    // oneOf/anyOf: o Ajv reporta o erro de cada ramo, quase sempre ruído. Do mais externo para dentro.
    const composites = errors
      .filter((e) => e.keyword === "oneOf" || e.keyword === "anyOf")
      .sort((a, b) => a.instancePath.length - b.instancePath.length);
    for (const c of composites) {
      if (dropped.has(c)) continue;
      const parent = c.parentSchema as Schema;
      const branches = (parent[c.keyword as "oneOf"] ?? []) as (Schema | Ref)[];
      const real = branches.filter((b) => resolve<Schema>(schemaDoc, b).value?.type !== "null");

      if (real.length === 1) {
        // "X ou null" (nullable): os erros do ramo X são os que interessam.
        dropped.add(c);
        for (const e of errors) {
          const p = e.params as { type?: unknown };
          if (e.instancePath === c.instancePath && e.keyword === "type" && p.type === "null") {
            dropped.add(e);
          }
        }
        continue;
      }

      for (const e of errors) if (e !== c && under(e, c.instancePath)) dropped.add(e);
      const pick = discriminated(schemaDoc, parent, branches, c.data);
      if (pick && "ref" in pick) {
        // Com discriminator, valida só contra o ramo escolhido: erros precisos em vez de "nenhum formato".
        dropped.add(c);
        const branch = compile(pick.ref);
        if (!(branch instanceof Error) && !branch(c.data)) {
          extra.push(...toIssues(branch.errors ?? [], `${prefix}${c.instancePath}`));
        }
      } else if (pick) {
        dropped.add(c);
        extra.push({
          level: "error",
          kind: "schema",
          path: `${prefix}${c.instancePath}/${esc(pick.property)}`,
          message: `${pick.property} = ${json(pick.value)} não corresponde a nenhum formato (${pick.known.join(", ")})`,
        });
      }
    }

    return [
      ...errors
        .filter((e) => !dropped.has(e))
        .map((e): Issue => {
          const p = e.params as Record<string, string>;
          const extraKey = p.additionalProperty ?? p.unevaluatedProperty;
          return {
            level: "error",
            kind: "schema",
            path: `${prefix}${e.instancePath}${extraKey === undefined ? "" : `/${esc(extraKey)}`}`,
            message: describe(e),
          };
        }),
      ...extra,
    ];
  }

  function validateBody(ptr: string, mediaType: string, text: string, schema: unknown): Issue[] {
    if (schema === undefined || !isJson(mediaType)) return []; // ponytail: só corpo JSON por enquanto
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return [{ level: "error", kind: "schema", path: "", message: "O body não é JSON válido." }];
    }
    const validate = compile(ptr);
    if (validate instanceof Error) {
      const message = `Não deu para validar: o schema da spec não compila (${validate.message}).`;
      return [{ level: "warning", kind: "schema", path: "", message }];
    }
    const issues = validate(data) ? [] : toIssues(validate.errors ?? []);
    // Erros antes dos avisos; dentro de cada grupo, na ordem do caminho.
    return [...issues, ...undocumented(doc, schema as Schema, data, "")].sort(
      (a, b) =>
        Number(a.level === "warning") - Number(b.level === "warning") ||
        a.path.localeCompare(b.path),
    );
  }

  const opPtr = (op: Operation) => `#/paths/${esc(op.path)}/${op.method}`;

  return {
    response(op, status, headers, body) {
      const responses = (pointer(doc, `${opPtr(op)}/responses`) ?? {}) as Record<string, unknown>;
      const code = String(status);
      const key = [code, `${code[0]}XX`, `${code[0]}xx`, "default"].find((k) =>
        Object.hasOwn(responses, k),
      );
      if (!key) {
        const known = Object.keys(responses).join(", ") || "nenhum";
        return [
          {
            level: "error",
            kind: "undocumented-status",
            path: "",
            message: `Status ${status} não está documentado. A spec documenta: ${known}.`,
          },
        ];
      }
      // ponytail: corpo vazio não é conferido (204, HEAD, erro sem corpo).
      if (body === "") return [];

      const { ptr, node } = follow(`${opPtr(op)}/responses/${esc(key)}`);
      const content = (node as { content?: Record<string, { schema?: unknown }> })?.content ?? {};
      const types = Object.keys(content);
      if (types.length === 0) {
        const message = `A spec não documenta corpo para ${key}, mas a resposta trouxe um.`;
        return [{ level: "warning", kind: "content-type", path: "", message }];
      }
      const received = (headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const mediaType =
        types.find((t) => t.toLowerCase() === received) ??
        types.find((t) => t === "*/*" || (t.endsWith("/*") && received.startsWith(t.slice(0, -1))));
      if (!mediaType) {
        return [
          {
            level: "error",
            kind: "content-type",
            path: "",
            message: `Content-Type ${received || "(ausente)"} não documentado para ${key}. A spec documenta: ${types.join(", ")}.`,
          },
        ];
      }
      return validateBody(
        `${ptr}/content/${esc(mediaType)}/schema`,
        mediaType,
        body,
        content[mediaType].schema,
      );
    },

    requestBody(op, contentType, body) {
      if (!contentType || body.trim() === "") return [];
      const { ptr, node } = follow(`${opPtr(op)}/requestBody`);
      const schema = (node as { content?: Record<string, { schema?: unknown }> })?.content?.[
        contentType
      ]?.schema;
      return validateBody(`${ptr}/content/${esc(contentType)}/schema`, contentType, body, schema);
    },
  };
}

type Pick = { ref: string } | { property: string; value: unknown; known: string[] } | undefined;

/** Ramo do oneOf/anyOf escolhido pelo discriminator, ou o valor que não casa com nenhum. */
function discriminated(
  doc: unknown,
  parent: Schema,
  branches: (Schema | Ref)[],
  data: unknown,
): Pick {
  const property = parent.discriminator?.propertyName;
  if (!property || !data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const value = (data as Record<string, unknown>)[property];
  const mapped = typeof value === "string" ? parent.discriminator?.mapping?.[value] : undefined;
  if (mapped) return { ref: mapped.startsWith("#") ? mapped : `#/components/schemas/${mapped}` };
  const known: string[] = [];
  for (const b of branches) {
    if (!isRef(b)) continue;
    // Sem mapping: vale o nome do schema (regra do OpenAPI) ou o enum/const da propriedade.
    if (refName(b.$ref) === value) return { ref: b.$ref };
    const target = resolve<Schema>(doc, b).value;
    const prop = target
      ? resolve<Schema>(doc, mergeAllOf(doc, target).properties?.[property]).value
      : undefined;
    if (prop?.const === value || prop?.enum?.includes(value)) return { ref: b.$ref };
    known.push(...(prop?.enum?.map(String) ?? [refName(b.$ref) ?? "?"]));
  }
  for (const v of Object.keys(parent.discriminator?.mapping ?? {})) known.push(v);
  return { property, value, known: [...new Set(known)] };
}

/**
 * Campos presentes no dado e ausentes no schema. O Ajv aceita campo extra calado quando a spec
 * não declara additionalProperties, que é o caso da maioria; por isso este passeio separado,
 * que entende allOf (herança), discriminator e $ref.
 */
function undocumented(
  doc: unknown,
  node: Schema | Ref | undefined,
  data: unknown,
  path: string,
  depth = 0,
): Issue[] {
  if (depth > MAX_DEPTH || data === null || typeof data !== "object") return [];
  const raw = resolve<Schema>(doc, node).value;
  if (!raw) return [];
  const s = mergeAllOf(doc, raw);

  const variants = s.oneOf ?? s.anyOf;
  if (variants) {
    const pick = discriminated(doc, s, variants, data);
    if (pick && "ref" in pick) return undocumented(doc, { $ref: pick.ref }, data, path, depth + 1);
    // Sem discriminator: aceita a união dos campos de todas as variantes (menos falso positivo).
    const merged = variants.map((v) => mergeAllOf(doc, resolve<Schema>(doc, v).value ?? {}));
    if (
      merged.some((m) => m.additionalProperties !== undefined && m.additionalProperties !== false)
    ) {
      return [];
    }
    const union: Schema = { properties: Object.assign({}, ...merged.map((m) => m.properties)) };
    return undocumented(doc, union, data, path, depth + 1);
  }

  if (Array.isArray(data)) {
    return data.flatMap((item, i) => undocumented(doc, s.items, item, `${path}/${i}`, depth + 1));
  }

  const record = data as Record<string, unknown>;
  if (typeof s.additionalProperties === "object") {
    // Mapa (`{ [chave]: X }`): todas as chaves valem, confere só os valores.
    return Object.entries(record).flatMap(([k, v]) =>
      undocumented(doc, s.additionalProperties as Schema, v, `${path}/${esc(k)}`, depth + 1),
    );
  }
  const props = s.properties ?? {};
  // Objeto livre (sem properties) ou que aceita extras explicitamente: nada a apontar.
  if (Object.keys(props).length === 0 || s.additionalProperties === true) return [];

  return Object.entries(record).flatMap(([k, v]): Issue[] => {
    const at = `${path}/${esc(k)}`;
    if (Object.hasOwn(props, k)) return undocumented(doc, props[k], v, at, depth + 1);
    // additionalProperties: false já virou erro do Ajv; não repete como aviso.
    if (s.additionalProperties === false) return [];
    return [
      {
        level: "warning",
        kind: "undocumented-field",
        path: at,
        message: `campo não documentado na spec: ${k}`,
      },
    ];
  });
}

const kindOf = (v: unknown) =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? "array"
      : typeof v === "number" && Number.isInteger(v)
        ? "integer"
        : typeof v;

function describe(e: ErrorObject): string {
  const p = e.params as Record<string, never>;
  switch (e.keyword) {
    case "type":
      return `esperado ${[p.type].flat().join(" ou ")}, veio ${kindOf(e.data)}`;
    case "required":
      return `campo obrigatório ausente: ${p.missingProperty}`;
    case "enum":
      return `${json(e.data)} fora dos valores permitidos: ${(p.allowedValues as unknown[]).map(json).join(", ")}`;
    case "const":
      return `esperado ${json(p.allowedValue)}, veio ${json(e.data)}`;
    case "format":
      return `${json(e.data)} não é ${p.format} válido`;
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return `${e.data} deveria ser ${p.comparison} ${p.limit}`;
    case "minLength":
    case "maxLength":
      return `texto com ${String(e.data).length} caracteres; ${e.keyword === "minLength" ? "mínimo" : "máximo"} ${p.limit}`;
    case "minItems":
    case "maxItems":
      return `${(e.data as unknown[]).length} itens; ${e.keyword === "minItems" ? "mínimo" : "máximo"} ${p.limit}`;
    case "pattern":
      return `${json(e.data)} não segue o padrão ${p.pattern}`;
    case "additionalProperties":
    case "unevaluatedProperties":
      return `campo não permitido pela spec: ${p.additionalProperty ?? p.unevaluatedProperty}`;
    case "uniqueItems":
      return `itens repetidos nas posições ${p.j} e ${p.i}`;
    case "oneOf":
      return p.passingSchemas
        ? "corresponde a mais de um formato do oneOf"
        : "não corresponde a nenhum formato do oneOf";
    case "anyOf":
      return "não corresponde a nenhum formato do anyOf";
    default:
      return e.message ?? e.keyword;
  }
}
