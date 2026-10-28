import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { loadSpec } from "../src/spec.js";

const token = "t".repeat(43);
const spec = loadSpec(new URL("./fixtures/petstore.yaml", import.meta.url).pathname);
const webDir = mkdtempSync(join(tmpdir(), "sworn-web-"));
writeFileSync(join(webDir, "index.html"), '<meta name="sworn-token" content="__SWORN_TOKEN__">');
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  await spec.reload();
  app = await buildServer({ spec, token, webDir });
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
});
