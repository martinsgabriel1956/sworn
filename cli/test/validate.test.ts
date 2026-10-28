import { beforeAll, describe, expect, it } from "vitest";
import type { OpenApiDoc, Operation } from "../src/core/openapi.js";
import { from30, type Issue, validatorFor } from "../src/core/validate.js";
import { loadSpec } from "../src/spec.js";

let doc: OpenApiDoc;
beforeAll(async () => {
  const spec = loadSpec(new URL("./fixtures/petstore.yaml", import.meta.url).pathname);
  const state = await spec.reload();
  spec.close();
  if (!state.doc) throw new Error(state.error);
  doc = state.doc;
});

const op = (method: string, path: string): Operation => ({
  id: `${method} ${path}`,
  method,
  path,
  tag: "",
  deprecated: false,
});
const JSON_CT: [string, string][] = [["Content-Type", "application/json; charset=utf-8"]];
const listPets = (body: unknown, status = 200, headers = JSON_CT) =>
  validatorFor(doc).response(op("get", "/pets"), status, headers, JSON.stringify(body));
const getOwner = (body: unknown) =>
  validatorFor(doc).response(op("get", "/owners/{ownerId}"), 200, JSON_CT, JSON.stringify(body));
const brief = (issues: Issue[]) => issues.map((i) => `${i.level} ${i.path} ${i.message}`);

describe("from30", () => {
  it("converte nullable e exclusivos booleanos", () => {
    expect(from30({ type: "string", nullable: true, enum: ["a"] })).toEqual({
      type: ["string", "null"],
      enum: ["a", null],
    });
    expect(from30({ $ref: "#/x", nullable: true })).toEqual({
      anyOf: [{ $ref: "#/x" }, { type: "null" }],
    });
    expect(
      from30({ minimum: 0, exclusiveMinimum: true, maximum: 9, exclusiveMaximum: false }),
    ).toEqual({ exclusiveMinimum: 0, maximum: 9 });
    // Propriedade chamada "nullable" não é a palavra-chave.
    expect(from30({ properties: { nullable: { type: "boolean" } } })).toEqual({
      properties: { nullable: { type: "boolean" } },
    });
  });
});

describe("resposta", () => {
  it("resposta conforme: nenhum issue, com nullable de 3.0 e herança por allOf", () => {
    expect(listPets([{ id: 1, name: "Rex", tag: null, category: { name: "Cães" } }])).toEqual([]);
  });

  it("tipo errado, obrigatório ausente e campo não documentado, cada um no caminho certo", () => {
    expect(
      brief(listPets([{ id: "1", name: "Rex", tag: 42, dono: "Ana" }, { name: "Mimi" }])),
    ).toEqual([
      "error /0/id esperado integer, veio string",
      "error /0/tag esperado string ou null, veio integer",
      "error /1 campo obrigatório ausente: id",
      "warning /0/dono campo não documentado na spec: dono",
    ]);
  });

  it("não aponta campo herdado do allOf como não documentado", () => {
    const issues = listPets([
      { id: 1, name: "Rex", category: { name: "x", parent: { name: "y" } } },
    ]);
    expect(issues).toEqual([]);
  });

  it("discriminator: erros do ramo escolhido, não ruído de todos os ramos", () => {
    expect(brief(getOwner({ kind: "pessoa", name: "", email: "não-é-email" }))).toEqual([
      'error /email "não-é-email" não é email válido',
      "error /name texto com 0 caracteres; mínimo 1",
    ]);
    expect(brief(getOwner({ kind: "empresa", cnpj: "123", extra: 1 }))).toEqual([
      'error /cnpj "123" não segue o padrão ^\\d{14}$',
      "warning /extra campo não documentado na spec: extra",
    ]);
  });

  it("discriminator com valor desconhecido", () => {
    expect(brief(getOwner({ kind: "robo" }))).toEqual([
      'error /kind kind = "robo" não corresponde a nenhum formato (pessoa, empresa)',
    ]);
  });

  it("status: exato, default e não documentado", () => {
    expect(listPets({}, 503)[0]).toMatchObject({
      kind: "undocumented-status",
      message: "Status 503 não está documentado. A spec documenta: 200, 400.",
    });
    const owner = validatorFor(doc).response(
      op("get", "/owners/{ownerId}"),
      500,
      JSON_CT,
      JSON.stringify({ code: 500 }),
    );
    expect(brief(owner)).toEqual(["error  campo obrigatório ausente: message"]);
  });

  it("content-type fora da spec e corpo inválido", () => {
    expect(listPets([], 200, [["content-type", "text/html"]])[0]).toMatchObject({
      kind: "content-type",
      level: "error",
    });
    const broken = validatorFor(doc).response(op("get", "/pets"), 200, JSON_CT, "{oops");
    expect(brief(broken)).toEqual(["error  O body não é JSON válido."]);
  });

  it("mapa (additionalProperties) confere os valores, não as chaves", () => {
    const inventory = op("get", "/store/inventory");
    const check = (body: unknown) =>
      validatorFor(doc).response(inventory, 200, JSON_CT, JSON.stringify(body));
    expect(check({ disponivel: 3, qualquer: 1 })).toEqual([]);
    expect(brief(check({ disponivel: "3" }))).toEqual([
      "error /disponivel esperado integer, veio string",
    ]);
  });

  it("corpo vazio não é conferido", () => {
    expect(validatorFor(doc).response(op("get", "/pets"), 200, JSON_CT, "")).toEqual([]);
  });
});

describe("body da request", () => {
  it("valida o body contra o schema do content type", () => {
    const v = validatorFor(doc);
    const create = op("post", "/pets");
    expect(v.requestBody(create, "application/json", '{"name":"Rex"}')).toEqual([]);
    expect(brief(v.requestBody(create, "application/json", '{"tag":1}'))).toEqual([
      "error  campo obrigatório ausente: name",
      "error /tag esperado string ou null, veio integer",
    ]);
    expect(v.requestBody(create, "application/json", "")).toEqual([]);
  });
});
