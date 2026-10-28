import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { bodyExample, exampleFor } from "../src/core/examples.js";
import type { MediaType, OpenApiDoc, Operation } from "../src/core/openapi.js";
import { buildIndex, search } from "../src/core/search.js";
import { snippet } from "../src/core/snippets.js";
import { validatorFor } from "../src/core/validate.js";
import { loadSpec } from "../src/spec.js";

let doc: OpenApiDoc;
beforeAll(async () => {
  const spec = loadSpec(new URL("./fixtures/petstore.yaml", import.meta.url).pathname);
  const state = await spec.reload();
  spec.close();
  if (!state.doc) throw new Error(state.error);
  doc = state.doc;
});

const op = (method: string, path: string, extra: Partial<Operation> = {}): Operation => ({
  id: `${method} ${path}`,
  method,
  path,
  tag: "",
  deprecated: false,
  ...extra,
});

describe("exampleFor", () => {
  it("usa formato, nome do campo e limites", () => {
    expect(
      exampleFor(
        {},
        {
          type: "object",
          properties: {
            email: { type: "string" },
            criado: { type: "string", format: "date-time" },
            nota: { type: "integer", minimum: 3, maximum: 5 },
            preco: { type: "number", exclusiveMaximum: 5 },
            sigla: { type: "string", maxLength: 2 },
            status: { type: "string", enum: [null, "ativo"] },
            tags: { type: "array", items: { type: "string" }, minItems: 2 },
          },
        },
      ),
    ).toEqual({
      email: "ana@exemplo.com",
      criado: "2026-01-15T10:30:00Z",
      nota: 3,
      preco: 4.5,
      sigla: "te",
      status: "ativo",
      tags: ["texto", "texto"],
    });
  });

  it("no body da request deixa de fora readOnly; na resposta, writeOnly", () => {
    const s = {
      type: "object",
      properties: {
        id: { type: "integer", readOnly: true },
        senha: { type: "string", writeOnly: true },
      },
    };
    expect(exampleFor({}, s, "request")).toEqual({ senha: "s3nh4-forte" });
    expect(exampleFor({}, s, "response")).toEqual({ id: 1 });
  });

  it("schema recursivo para no primeiro ciclo e discriminator sai com o valor do ramo", () => {
    const tree = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { name: { type: "string" }, child: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    expect(exampleFor(tree, { $ref: "#/components/schemas/Node" })).toEqual({ name: "Ana Souza" });
    expect(exampleFor(doc, { $ref: "#/components/schemas/Owner" }, "response")).toEqual({
      kind: "pessoa",
      name: "Ana Souza",
      email: "ana@exemplo.com",
    });
  });

  it("todo exemplo gerado passa na própria validação da spec", () => {
    // O gerador e o validador precisam concordar: exemplo gerado que diverge da spec é bug.
    const checks: [Operation, number][] = [
      [op("get", "/pets"), 200],
      [op("get", "/pets/{petId}"), 200],
      [op("get", "/owners/{ownerId}"), 200],
      [op("get", "/owners/{ownerId}"), 500],
      [op("get", "/store/inventory"), 200],
    ];
    for (const [o, status] of checks) {
      const operation = doc.paths?.[o.path]?.[o.method] as { responses: Record<string, unknown> };
      const responses = operation.responses;
      const key = String(status) in responses ? String(status) : "default";
      const media = (responses[key] as { content: Record<string, MediaType> }).content[
        "application/json"
      ];
      const ex = bodyExample(
        doc,
        "application/json",
        { ...media, example: undefined, examples: undefined },
        "response",
      );
      const body = JSON.stringify(ex?.value);
      const ct: [string, string][] = [["content-type", "application/json"]];
      expect(validatorFor(doc).response(o, status, ct, body), `${o.path} ${status}`).toEqual([]);
    }
  });

  it("não gera exemplo JSON para corpo que não é JSON", () => {
    const media = { schema: { type: "object", properties: { a: { type: "string" } } } };
    expect(bodyExample({}, "application/x-www-form-urlencoded", media, "request")).toBeUndefined();
    expect(bodyExample({}, "application/problem+json", media, "request")).toEqual({
      value: { a: "texto" },
      generated: true,
    });
  });
});

describe("snippets", () => {
  const req = {
    method: "POST",
    url: "http://api.local/pets?q=it's",
    headers: [["content-type", "application/json"]] as [string, string][],
    body: `{"name":"D'Artagnan","n":"a\\"b"}`,
  };

  it("curl com aspas simples escapadas roda no shell e chega igual", () => {
    const code = snippet(req, "curl");
    // Troca curl por um printf dos argumentos e confere o que o shell entrega.
    const out = execFileSync("sh", ["-c", code.replace(/^curl /, "printf '%s\\n' ")], {
      encoding: "utf8",
    });
    expect(out.split("\n")).toContain("http://api.local/pets?q=it's");
    expect(out.split("\n")).toContain(req.body);
  });

  it("fetch e Python usam literais de string válidos", () => {
    const fetchCode = snippet(req, "fetch");
    expect(fetchCode).toContain(`body: ${JSON.stringify(req.body)},`);
    expect(snippet(req, "python")).toContain(`data=${JSON.stringify(req.body)}.encode(),`);
    expect(snippet({ method: "GET", url: "http://x", headers: [] }, "fetch")).not.toContain(
      "headers",
    );
  });
});

describe("busca", () => {
  const ops = () => [
    op("get", "/pets", { id: "listPets", summary: "Lista os pets", tag: "pets" }),
    op("post", "/pets", { id: "createPet", summary: "Cadastra um pet", tag: "pets" }),
    op("get", "/owners/{ownerId}", { id: "getOwner", summary: "Busca o dono", tag: "owners" }),
  ];

  it("acha por termos combinados e por nome de campo", () => {
    const index = buildIndex(doc, ops());
    expect(search(index, "post pets").map((h) => h.op.id)).toEqual(["createPet"]);
    expect(search(index, "cnpj")).toEqual([
      { op: expect.objectContaining({ id: "getOwner" }), field: "cnpj" },
    ]);
    expect(search(index, "nada-disso")).toEqual([]);
    expect(search(index, "")).toHaveLength(3);
  });
});

describe("exemplo de spec grande", () => {
  it("cadeia longa de $ref opcional para no terceiro nível", async () => {
    const { bigSpec } = await import("../scripts/big-spec.js");
    const big = bigSpec(50);
    const ex = exampleFor(big, { $ref: "#/components/schemas/Resource9" }, "request");
    let depth = 0;
    for (let node = ex as { related?: unknown }; node?.related; node = node.related as never)
      depth++;
    expect(depth).toBe(2);
  });
});
