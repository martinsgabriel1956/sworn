// Formulário do cliente → request enviada ao proxy. Puro: o web/ chama antes do POST /__sworn/send.
import { interpolate, type Vars } from "./interpolate.js";
import type { SecurityScheme } from "./openapi.js";
import { mediaExample, type OpenApiDoc, type OperationDetail, type Parameter } from "./openapi.js";
import { resolve } from "./refs.js";

export type Auth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; in: "header" | "query" | "cookie"; name: string; value: string };

/** O que o usuário preencheu numa operação, com as {{variáveis}} ainda sem resolver. */
export type Draft = {
  /** Valor por parâmetro, na chave de `paramKey`. Vazio = não envia. */
  params: Record<string, string>;
  contentType?: string;
  body: string;
};

/** O que o POST /__sworn/send recebe. */
export type SendRequest = {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
};

/** O que o POST /__sworn/send devolve. */
export type SendResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  /** Texto, ou base64 quando `isBinary`. */
  body: string;
  isBinary: boolean;
  truncated: boolean;
  timeMs: number;
  sizeBytes: number;
};

/** O que GET/PUT /__sworn/workspace trocam: ambientes, segredos, ambiente ativo e auth global. */
export type Workspace = {
  envs: Record<string, Vars>;
  secrets: Record<string, Vars>;
  active?: string;
  auth: Auth;
};

/** Uma linha de .sworn/local/history.jsonl. Guarda o rascunho, nunca a request interpolada. */
export type HistoryEntry = {
  at: string;
  opId: string;
  method: string;
  path: string;
  draft: Draft;
  outcome: { status: number; timeMs: number; sizeBytes: number } | { error: string };
};

export const paramKey = (p: Pick<Parameter, "in" | "name">) => `${p.in}:${p.name}`;

/** Rascunho inicial: parâmetros vazios e o body de exemplo da spec, se houver. */
export function initialDraft(doc: OpenApiDoc, detail: OperationDetail): Draft {
  const [contentType, media] = Object.entries(detail.requestBody?.content ?? {})[0] ?? [];
  const example = media ? mediaExample(doc, media) : undefined;
  const body =
    example === undefined
      ? ""
      : typeof example.value === "string"
        ? example.value
        : JSON.stringify(example.value, null, 2);
  return { params: {}, contentType, body };
}

/** A operação pede auth? `security: []` na operação a declara pública. */
export const needsAuth = (doc: OpenApiDoc, detail: OperationDetail) =>
  (detail.security ?? doc.security)?.length !== 0;

/** Auth sugerida pelo primeiro securityScheme da spec, com os valores em branco. */
export function authFromSpec(doc: OpenApiDoc): Auth {
  const first = Object.values(doc.components?.securitySchemes ?? {})[0];
  const scheme = resolve<SecurityScheme>(doc, first).value;
  if (scheme?.type === "http" && scheme.scheme?.toLowerCase() === "basic") {
    return { type: "basic", username: "", password: "" };
  }
  if (scheme?.type === "apiKey" && scheme.name && scheme.in) {
    return { type: "apikey", in: scheme.in, name: scheme.name, value: "" };
  }
  if (scheme) return { type: "bearer", token: "" }; // http bearer, oauth2, openIdConnect
  return { type: "none" };
}

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export function buildRequest({
  method,
  path,
  detail,
  draft,
  vars,
  auth,
  baseUrl,
}: {
  method: string;
  path: string;
  detail: OperationDetail;
  draft: Draft;
  vars: Vars;
  auth: Auth;
  baseUrl: string;
}): SendRequest {
  const sub = (text: string) => interpolate(text, vars);
  const value = (p: Parameter) => sub(draft.params[paramKey(p)] ?? "");
  const byIn = (where: Parameter["in"]) =>
    detail.parameters.filter((p) => p.in === where && value(p) !== "");

  const filledPath = path.replace(/\{([^}]+)\}/g, (raw, name: string) => {
    const p = detail.parameters.find((x) => x.in === "path" && x.name === name);
    return p && value(p) !== "" ? encodeURIComponent(value(p)) : raw;
  });

  // ponytail: valor de query vai como texto (array = "a,b" digitado). Estilos explode/deepObject
  // da spec ficam para quando alguém precisar.
  const query = new URLSearchParams(byIn("query").map((p) => [p.name, value(p)]));
  const headers: [string, string][] = byIn("header").map((p) => [p.name, value(p)]);
  const cookies = byIn("cookie").map((p) => `${p.name}=${encodeURIComponent(value(p))}`);

  if (auth.type === "bearer") headers.push(["authorization", `Bearer ${sub(auth.token)}`]);
  if (auth.type === "basic") {
    headers.push([
      "authorization",
      `Basic ${base64(`${sub(auth.username)}:${sub(auth.password)}`)}`,
    ]);
  }
  if (auth.type === "apikey" && auth.name) {
    if (auth.in === "header") headers.push([auth.name, sub(auth.value)]);
    if (auth.in === "query") query.append(auth.name, sub(auth.value));
    if (auth.in === "cookie") cookies.push(`${auth.name}=${encodeURIComponent(sub(auth.value))}`);
  }
  if (cookies.length > 0) headers.push(["cookie", cookies.join("; ")]);

  const hasBody = detail.requestBody !== undefined && draft.body.trim() !== "";
  if (hasBody && draft.contentType) headers.push(["content-type", draft.contentType]);

  const qs = query.toString();
  return {
    method: method.toUpperCase(),
    url: `${sub(baseUrl).replace(/\/+$/, "")}${filledPath}${qs ? `?${qs}` : ""}`,
    headers,
    body: hasBody ? sub(draft.body) : undefined,
  };
}
