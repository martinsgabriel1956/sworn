import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { loadSpec } from "../src/spec.js";
import { createStore } from "../src/store.js";

const token = "t".repeat(43);
const spec = loadSpec(new URL("./fixtures/petstore.yaml", import.meta.url).pathname);
const webDir = mkdtempSync(join(tmpdir(), "sworn-web-"));
writeFileSync(join(webDir, "index.html"), '<meta name="sworn-token" content="__SWORN_TOKEN__">');
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  await spec.reload();
  const store = createStore(join(mkdtempSync(join(tmpdir(), "sworn-ws-")), ".sworn"));
  app = await buildServer({ spec, store, token, webDir });
});
afterAll(() => app.close());

const local = { host: "127.0.0.1:4000" };

describe("servidor", () => {
  it("entrega a spec com o token no header", async () => {
    const res = await app.inject({
      url: "/__sworn/spec",
      headers: { ...local, "x-sworn-token": token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().doc.info.title).toBe("Petstore");
  });

  it("aceita o token na query (EventSource não envia header)", async () => {
    const res = await app.inject({ url: `/__sworn/spec?token=${token}`, headers: local });
    expect(res.statusCode).toBe(200);
  });

  it("recusa /__sworn/* sem token ou com token errado", async () => {
    for (const headers of [local, { ...local, "x-sworn-token": "errado" }]) {
      const res = await app.inject({ url: "/__sworn/spec", headers });
      expect(res.statusCode).toBe(401);
    }
  });

  it("recusa Host que não é local (DNS rebinding)", async () => {
    const res = await app.inject({
      url: "/__sworn/spec",
      headers: { host: "evil.example:4000", "x-sworn-token": token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("serve a página com o token embutido", async () => {
    const res = await app.inject({ url: "/", headers: { host: "localhost:4000" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`content="${token}"`);
  });

  const auth = { ...local, "x-sworn-token": token };

  it("valida o body do /send antes de executar", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__sworn/send",
      headers: auth,
      payload: { method: "get", url: "http://x", headers: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("/send devolve o erro de rede com status 502", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__sworn/send",
      headers: auth,
      // Porta 9 (discard) em loopback: conexão recusada na hora.
      payload: { method: "GET", url: "http://127.0.0.1:9/", headers: [] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBeTruthy();
  });

  it("grava e lê o workspace, e recusa nome de ambiente inválido", async () => {
    const ws = { envs: { dev: { baseUrl: "http://a" } }, secrets: {}, auth: { type: "none" } };
    const put = await app.inject({
      method: "PUT",
      url: "/__sworn/workspace",
      headers: auth,
      payload: ws,
    });
    expect(put.json().envs).toEqual(ws.envs);
    const bad = await app.inject({
      method: "PUT",
      url: "/__sworn/workspace",
      headers: auth,
      payload: { ...ws, envs: { "../x": {} } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
