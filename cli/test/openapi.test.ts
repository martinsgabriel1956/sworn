import { describe, expect, it } from "vitest";
import { assertOpenApi3, groupOperations, type OpenApiDoc } from "../src/core/openapi.js";

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
