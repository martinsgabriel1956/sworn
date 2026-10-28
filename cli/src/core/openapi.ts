// Lógica pura sobre o documento OpenAPI. Sem Node nem React: o web/ importa daqui.
import { type Ref, resolve } from "./refs.js";
import type { Schema } from "./schema.js";

type Server = {
  url: string;
  description?: string;
  variables?: Record<string, { default: string }>;
};

export type OpenApiDoc = {
  openapi: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Server[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, unknown> | undefined>;
};

export type Parameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: Schema | Ref;
};

export type MediaType = {
  schema?: Schema | Ref;
  example?: unknown;
  examples?: Record<string, { summary?: string; value?: unknown } | Ref>;
};

export type RequestBody = {
  description?: string;
  required?: boolean;
  content?: Record<string, MediaType>;
};

export type Response = { description?: string; content?: Record<string, MediaType> };

type OperationObject = {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: (Parameter | Ref)[];
  requestBody?: RequestBody | Ref;
  responses?: Record<string, Response | Ref>;
  servers?: Server[];
};

/** A operação com os $ref de parâmetros, body e respostas resolvidos. */
export type OperationDetail = Omit<OperationObject, "parameters" | "requestBody" | "responses"> & {
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: [status: string, Response][];
  /** URL base do primeiro server (operação → path → doc), com as variáveis no valor padrão. */
  server: string;
};

export function operationDetail(doc: OpenApiDoc, op: Operation): OperationDetail | undefined {
  const item = doc.paths?.[op.path] as
    | (Record<string, unknown> & { parameters?: (Parameter | Ref)[]; servers?: Server[] })
    | undefined;
  const raw = item?.[op.method] as OperationObject | undefined;
  if (!item || !raw) return undefined;

  // Parâmetro da operação sobrescreve o do path com mesmo nome e local.
  const params = new Map<string, Parameter>();
  for (const p of [...(item.parameters ?? []), ...(raw.parameters ?? [])]) {
    const v = resolve<Parameter>(doc, p).value;
    if (v) params.set(`${v.in}:${v.name}`, v);
  }

  const server = (raw.servers ?? item.servers ?? doc.servers)?.[0];
  return {
    ...raw,
    parameters: [...params.values()],
    requestBody: resolve<RequestBody>(doc, raw.requestBody).value,
    responses: Object.entries(raw.responses ?? {}).map(([status, r]) => [
      status,
      resolve<Response>(doc, r).value ?? {},
    ]),
    server: server
      ? server.url.replace(/\{([^}]+)\}/g, (m, v: string) => server.variables?.[v]?.default ?? m)
      : "",
  };
}

/** Exemplo declarado na spec: `example`, o primeiro de `examples`, ou o `example` do schema. */
export function mediaExample(doc: unknown, media: MediaType): { value: unknown } | undefined {
  if (media.example !== undefined) return { value: media.example };
  const first = Object.values(media.examples ?? {})[0];
  const ex = resolve<{ value?: unknown }>(doc, first).value;
  if (ex?.value !== undefined) return { value: ex.value };
  const schema = resolve<Schema>(doc, media.schema).value;
  if (schema?.example !== undefined) return { value: schema.example };
  return undefined;
}

/** O que o cli/ entrega em GET /__sworn/spec. */
export type SpecState = {
  source: string;
  /** Último documento válido. Continua aqui quando a spec quebra, para a UI não sumir. */
  doc?: OpenApiDoc;
  /** Erro da última tentativa de carregar; some quando a spec volta a ser válida. */
  error?: string;
  loadedAt: number;
};

export type Operation = {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary?: string;
  deprecated: boolean;
};

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Operações agrupadas pela primeira tag, na ordem de `tags` da spec e depois na ordem em que aparecem. */
export function groupOperations(doc: OpenApiDoc): [tag: string, ops: Operation[]][] {
  const groups = new Map<string, Operation[]>((doc.tags ?? []).map((t) => [t.name, []]));
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method] as
        | { operationId?: string; tags?: string[]; summary?: string; deprecated?: boolean }
        | undefined;
      if (!op) continue;
      const tag = op.tags?.[0] ?? "default";
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)?.push({
        id: op.operationId ?? `${method}-${path}`,
        method,
        path,
        tag,
        summary: op.summary,
        deprecated: op.deprecated === true,
      });
    }
  }
  return [...groups].filter(([, ops]) => ops.length > 0);
}

/** Lança erro legível quando o documento não é OpenAPI 3.0/3.1. */
export function assertOpenApi3(doc: unknown): asserts doc is OpenApiDoc {
  const d = doc as { openapi?: unknown; swagger?: unknown } | null;
  if (typeof d?.openapi === "string" && /^3\.[01]\./.test(d.openapi)) return;
  if (d?.swagger) {
    throw new Error("Swagger 2.0 ainda não é suportado. Converta para OpenAPI 3 (suporte na V2).");
  }
  throw new Error(
    'O arquivo não é uma spec OpenAPI 3.0 ou 3.1 (campo "openapi" ausente ou inválido).',
  );
}
