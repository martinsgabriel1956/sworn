import { describe, expect, it } from "vitest";
import {
  assertOpenApi3,
  groupOperations,
  mediaExample,
  type OpenApiDoc,
  operationDetail,
} from "../src/core/openapi.js";

describe("groupOperations", () => {
  it("agrupa pela primeira tag, respeita a ordem de `tags` e descarta tags vazias", () => {
    const doc: OpenApiDoc = {
      openapi: "3.1.0",
      tags: [{ name: "b" }, { name: "a" }, { name: "vazia" }],
      paths: {
        "/x": { get: { tags: ["a"] }, post: { operationId: "criaX", tags: ["b", "a"] } },
        "/y": { get: { summary: "sem tag" }, parameters: [] },
      },
    };
    const groups = groupOperations(doc);
    expect(groups.map(([tag]) => tag)).toEqual(["b", "a", "default"]);
    expect(groups[0][1][0]).toMatchObject({ id: "criaX", method: "post", path: "/x" });
    expect(groups[1][1][0].id).toBe("get-/x");
    expect(groups[2][1][0].summary).toBe("sem tag");
  });
});

describe("assertOpenApi3", () => {
  it("aceita 3.0 e 3.1", () => {
    expect(() => assertOpenApi3({ openapi: "3.0.3" })).not.toThrow();
    expect(() => assertOpenApi3({ openapi: "3.1.0" })).not.toThrow();
  });

  it("explica quando é Swagger 2.0 ou outra coisa", () => {
    expect(() => assertOpenApi3({ swagger: "2.0" })).toThrow(/Swagger 2.0/);
    expect(() => assertOpenApi3({ openapi: "4.0.0" })).toThrow(/OpenAPI 3.0 ou 3.1/);
    expect(() => assertOpenApi3(null)).toThrow(/OpenAPI 3.0 ou 3.1/);
  });
});

describe("operationDetail", () => {
  it("junta parâmetros do path e da operação, resolve $ref e monta o server", async () => {
    const { loadSpec } = await import("../src/spec.js");
    const spec = loadSpec(new URL("./fixtures/petstore.yaml", import.meta.url).pathname);
    const { doc } = await spec.reload();
    spec.close();
    if (!doc) throw new Error("fixture não carregou");

    const getPet = operationDetail(doc, {
      id: "getPet",
      method: "get",
      path: "/pets/{petId}",
      tag: "pets",
      deprecated: false,
    });
    expect(getPet?.parameters.map((p) => `${p.in}:${p.name}`)).toEqual(["path:petId"]);
    expect(getPet?.server).toBe("http://localhost:3000");
    expect(getPet?.responses.map(([s]) => s)).toEqual(["200", "404"]);

    const list = operationDetail(doc, {
      id: "listPets",
      method: "get",
      path: "/pets",
      tag: "pets",
      deprecated: false,
    });
    const error = list?.responses.find(([s]) => s === "400")?.[1];
    const media = error?.content?.["application/json"];
    expect(media && mediaExample(doc, media)).toEqual({
      value: { code: 400, message: "limit deve estar entre 1 e 100" },
    });
  });

  it("devolve undefined para operação que não existe", () => {
    const doc: OpenApiDoc = { openapi: "3.1.0", paths: {} };
    const op = { id: "x", method: "get", path: "/x", tag: "default", deprecated: false };
    expect(operationDetail(doc, op)).toBeUndefined();
  });
});
