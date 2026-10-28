import { describe, expect, it } from "vitest";
import { pointer, refName, resolve } from "../src/core/refs.js";
import {
  constraints,
  hasChildren,
  isNullable,
  mergeAllOf,
  type Schema,
  typeLabel,
} from "../src/core/schema.js";

const doc = {
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" }, tag: { type: "string", nullable: true } },
      },
      Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } },
      "a/b": { type: "string" },
      LoopA: { $ref: "#/components/schemas/LoopB" },
      LoopB: { $ref: "#/components/schemas/LoopA" },
      Dog: {
        allOf: [
          { $ref: "#/components/schemas/Pet" },
          { type: "object", required: ["bark"], properties: { bark: { type: "boolean" } } },
        ],
      },
    },
  },
};

describe("refs", () => {
  it("segue JSON Pointer com escapes", () => {
    expect(pointer(doc, "#/components/schemas/a~1b")).toEqual({ type: "string" });
    expect(pointer(doc, "#")).toBe(doc);
    expect(pointer(doc, "outro.yaml#/x")).toBeUndefined();
    expect(pointer(doc, "#/%E0%A4%A")).toBeUndefined();
  });

  it("resolve guarda o primeiro $ref e não trava em ciclo de $ref", () => {
    expect(resolve(doc, { $ref: "#/components/schemas/Pet" }).ref).toBe("#/components/schemas/Pet");
    expect(resolve(doc, { $ref: "#/components/schemas/LoopA" }).value).toBeUndefined();
    expect(resolve(doc, { type: "string" }).value).toEqual({ type: "string" });
  });

  it("dá nome só a refs de components", () => {
    expect(refName("#/components/schemas/Pet")).toBe("Pet");
    expect(refName("#/paths/~1pets/get")).toBeUndefined();
  });
});

describe("schema", () => {
  it("rotula tipos", () => {
    expect(typeLabel(doc, { type: "string", format: "email" })).toBe("string<email>");
    expect(typeLabel(doc, { type: "array", items: { $ref: "#/components/schemas/Pet" } })).toBe(
      "Pet[]",
    );
    expect(typeLabel(doc, { type: ["integer", "null"] })).toBe("integer");
    expect(typeLabel(doc, { oneOf: [{ type: "string" }, { type: "null" }] })).toBe("string");
    expect(typeLabel(doc, { properties: {} })).toBe("object");
    expect(typeLabel(doc, {})).toBe("any");
  });

  it("detecta nullable de 3.0 e 3.1", () => {
    expect(isNullable(doc, { type: "string", nullable: true })).toBe(true);
    expect(isNullable(doc, { type: ["string", "null"] })).toBe(true);
    expect(isNullable(doc, { anyOf: [{ type: "string" }, { type: "null" }] })).toBe(true);
    expect(isNullable(doc, { type: "string" })).toBe(false);
  });

  it("junta allOf: propriedades e required dos membros", () => {
    const dog = mergeAllOf(doc, doc.components.schemas.Dog as Schema);
    expect(Object.keys(dog.properties ?? {})).toEqual(["id", "tag", "bark"]);
    expect(dog.required).toEqual(["id", "bark"]);
    expect(dog.type).toBe("object");
    expect(dog.allOf).toBeUndefined();
  });

  it("sabe quando há filhos, inclusive em schema recursivo", () => {
    expect(hasChildren(doc, { $ref: "#/components/schemas/Node" })).toBe(true);
    expect(hasChildren(doc, { type: "array", items: { type: "string" } })).toBe(false);
    expect(hasChildren(doc, { type: "array", items: { $ref: "#/components/schemas/Pet" } })).toBe(
      true,
    );
  });

  it("descreve restrições de 3.0 e 3.1", () => {
    expect(constraints({ minimum: 1, maximum: 100, default: 20 })).toEqual([
      "padrão: 20",
      "≥ 1",
      "≤ 100",
    ]);
    expect(constraints({ minimum: 0, exclusiveMinimum: true })).toEqual(["> 0"]);
    expect(constraints({ exclusiveMinimum: 0 })).toEqual(["> 0"]);
    expect(constraints({ enum: ["a", "b"], maxLength: 5 })).toEqual([
      'valores: "a", "b"',
      "tamanho: 0..5",
    ]);
  });
});
