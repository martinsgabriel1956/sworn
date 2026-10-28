import { describe, expect, it } from "vitest";
import { interpolate, unresolved } from "../src/core/interpolate.js";
import type { OpenApiDoc, OperationDetail } from "../src/core/openapi.js";
import {
  type Auth,
  authFromSpec,
  buildRequest,
  initialDraft,
  needsAuth,
} from "../src/core/request.js";

const detail: OperationDetail = {
  server: "http://api.local",
  responses: [],
  parameters: [
    { name: "id", in: "path", required: true },
    { name: "q", in: "query" },
    { name: "page", in: "query" },
    { name: "X-Trace", in: "header" },
    { name: "session", in: "cookie" },
  ],
  requestBody: { content: { "application/json": { example: { name: "Rex" } } } },
};

const build = (params: Record<string, string>, auth: Auth = { type: "none" }, body = "") =>
  buildRequest({
    method: "post",
    path: "/pets/{id}",
    detail,
    draft: { params, contentType: "application/json", body },
    vars: { token: "abc", nome: "Ana Maria" },
    auth,
    baseUrl: "http://api.local/v1/",
  });

describe("interpolate", () => {
  it("troca variáveis definidas e deixa as outras", () => {
    expect(interpolate("{{ a }}-{{b}}-{{a b}}", { a: "1" })).toBe("1-{{b}}-{{a b}}");
    expect(unresolved({ url: "{{x}}/{{x}}", h: "{{y}}" })).toEqual(["x", "y"]);
  });
});

describe("buildRequest", () => {
  it("monta URL com path codificado, query só com valores preenchidos e variáveis", () => {
    const req = build({ "path:id": "a/b", "query:q": "{{nome}}", "query:page": "" });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://api.local/v1/pets/a%2Fb?q=Ana+Maria");
  });

  it("deixa {id} no path quando vazio, para o aviso de obrigatório aparecer", () => {
    expect(build({}).url).toBe("http://api.local/v1/pets/{id}");
  });

  it("headers, cookies e content-type só com body", () => {
    const req = build({ "header:X-Trace": "t1", "cookie:session": "s 1" }, undefined, '{"a":1}');
    expect(req.headers).toEqual([
      ["X-Trace", "t1"],
      ["cookie", "session=s%201"],
      ["content-type", "application/json"],
    ]);
    expect(req.body).toBe('{"a":1}');
    expect(build({}).body).toBeUndefined();
  });

  it("aplica cada tipo de auth, com variáveis", () => {
    expect(build({}, { type: "bearer", token: "{{token}}" }).headers).toContainEqual([
      "authorization",
      "Bearer abc",
    ]);
    expect(build({}, { type: "basic", username: "ana", password: "ç" }).headers).toContainEqual([
      "authorization",
      `Basic ${Buffer.from("ana:ç").toString("base64")}`,
    ]);
    const key = (where: "header" | "query" | "cookie") =>
      build({}, { type: "apikey", in: where, name: "k", value: "{{token}}" });
    expect(key("header").headers).toContainEqual(["k", "abc"]);
    expect(key("query").url).toContain("?k=abc");
    expect(key("cookie").headers).toContainEqual(["cookie", "k=abc"]);
  });
});

describe("auth da spec", () => {
  const doc = (schemes: object, security?: object[]): OpenApiDoc => ({
    openapi: "3.1.0",
    components: { securitySchemes: schemes as never },
    security: security as never,
  });

  it("sugere a auth do primeiro securityScheme", () => {
    expect(authFromSpec(doc({ a: { type: "http", scheme: "bearer" } }))).toEqual({
      type: "bearer",
      token: "",
    });
    expect(authFromSpec(doc({ a: { type: "http", scheme: "Basic" } })).type).toBe("basic");
    expect(authFromSpec(doc({ a: { type: "apiKey", in: "query", name: "key" } }))).toEqual({
      type: "apikey",
      in: "query",
      name: "key",
      value: "",
    });
    expect(authFromSpec(doc({}))).toEqual({ type: "none" });
  });

  it("security: [] na operação a declara pública", () => {
    const d = doc({}, [{ a: [] }]);
    expect(needsAuth(d, { ...detail, security: [] })).toBe(false);
    expect(needsAuth(d, detail)).toBe(true);
    expect(needsAuth(doc({}), detail)).toBe(true);
  });
});

describe("initialDraft", () => {
  it("pré-preenche o body com o exemplo da spec", () => {
    const draft = initialDraft({ openapi: "3.1.0" }, detail);
    expect(draft).toEqual({
      params: {},
      contentType: "application/json",
      body: '{\n  "name": "Rex"\n}',
    });
  });
});
