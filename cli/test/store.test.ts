import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HistoryEntry, Workspace } from "../src/core/request.js";
import { createStore } from "../src/store.js";

const temp = () => join(mkdtempSync(join(tmpdir(), "sworn-store-")), ".sworn");

const ws: Workspace = {
  envs: { dev: { baseUrl: "http://localhost:3000" }, staging: { baseUrl: "https://stg" } },
  secrets: { dev: { token: "s3cr3t" } },
  active: "dev",
  auth: { type: "bearer", token: "{{token}}" },
};

describe("store", () => {
  it("não cria nada antes do primeiro save", async () => {
    const dir = temp();
    expect(await createStore(dir).read()).toEqual({
      envs: {},
      secrets: {},
      auth: { type: "none" },
    });
    expect(existsSync(dir)).toBe(false);
  });

  it("separa o que vai para o git do que fica só local", async () => {
    const dir = temp();
    const store = createStore(dir);
    await store.write(ws);
    expect(await store.read()).toEqual(ws);
    expect(readdirSync(join(dir, "env")).sort()).toEqual(["dev.json", "staging.json"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("local/\n");
    // O segredo nunca vai para os arquivos versionados.
    expect(readFileSync(join(dir, "env/dev.json"), "utf8")).not.toContain("s3cr3t");
  });

  it("apaga o arquivo do ambiente removido", async () => {
    const dir = temp();
    const store = createStore(dir);
    await store.write(ws);
    await store.write({ ...ws, envs: { dev: ws.envs.dev } });
    expect(readdirSync(join(dir, "env"))).toEqual(["dev.json"]);
  });

  it("recusa nome de ambiente que escaparia da pasta", async () => {
    const store = createStore(temp());
    for (const name of ["../x", "a/b", ".hidden"]) {
      await expect(store.write({ ...ws, envs: { [name]: {} } })).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it("histórico: mais recente primeiro e podado", async () => {
    const store = createStore(temp());
    const entry = (i: number): HistoryEntry => ({
      at: String(i),
      opId: "op",
      method: "get",
      path: "/",
      draft: { params: {}, body: "" },
      outcome: { status: 200, timeMs: 1, sizeBytes: 1 },
    });
    for (let i = 0; i < 601; i++) await store.addHistory(entry(i));
    const history = await store.history();
    expect(history).toHaveLength(500);
    expect(history[0].at).toBe("600");
  });
});
