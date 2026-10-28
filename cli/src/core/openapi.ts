// Lógica pura sobre o documento OpenAPI. Sem Node nem React: o web/ importa daqui.

export type OpenApiDoc = {
  openapi: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, unknown> | undefined>;
};

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
