import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpecState } from "../src/core/openapi.js";
import { loadSpec, type Spec } from "../src/spec.js";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;
let spec: Spec | undefined;
afterEach(() => spec?.close());

/** Cópia das fixtures numa pasta temporária, para os testes poderem editar os arquivos. */
function tempFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "sworn-"));
  cpSync(fixtures, dir, { recursive: true });
  return dir;
}

const nextChange = async (s: Spec) => (await once(s.events, "change"))[0] as SpecState;

describe("loadSpec", () => {
  it("junta os $ref externos e mantém os internos como referência", async () => {
    spec = loadSpec(join(fixtures, "petstore.yaml"));
    const state = await spec.reload();
    expect(state.error).toBeUndefined();
    const json = JSON.stringify(state.doc);
    expect(json).not.toContain("pet.yaml");
    expect(json).toContain('"$ref":"#/');
  });

  it("recarrega quando um arquivo referenciado muda", async () => {
    const dir = tempFixtures();
    spec = loadSpec(join(dir, "petstore.yaml"));
    await spec.reload();
    const pet = join(dir, "components/pet.yaml");
    writeFileSync(
      pet,
      readFileSync(pet, "utf8").replace("name: { type: string }", "nome: { type: string }"),
    );
    const state = await nextChange(spec);
    expect(JSON.stringify(state.doc)).toContain('"nome"');
  });

  it("mantém o último documento válido quando a spec quebra, e se recupera", async () => {
    const dir = tempFixtures();
    const file = join(dir, "petstore.yaml");
    const original = readFileSync(file, "utf8");
    spec = loadSpec(file);
    await spec.reload();

    writeFileSync(file, "openapi: 3.0.3\npaths: [quebrado");
    const broken = await nextChange(spec);
    expect(broken.error).toBeTruthy();
    expect(broken.doc?.info?.title).toBe("Petstore");

    writeFileSync(file, original);
    const fixed = await nextChange(spec);
    expect(fixed.error).toBeUndefined();
  });

  it("reporta erro de arquivo inexistente sem lançar", async () => {
    spec = loadSpec(join(fixtures, "nao-existe.yaml"));
    const state = await spec.reload();
    expect(state.error).toBeTruthy();
    expect(state.doc).toBeUndefined();
  });
});
