import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Spec } from "./spec.js";

type Options = {
  spec: Spec;
  token: string;
  /** Build do web/. Ausente em dev, quando quem serve a página é o Vite. */
  webDir?: string;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function buildServer({ spec, token, webDir }: Options) {
  const app = Fastify();
  const expected = Buffer.from(token);

  // Fronteira de confiança: o /__sworn/send da etapa 3 vai executar qualquer URL. Sem estas duas
  // checagens, qualquer site aberto no browser usaria o Sworn para alcançar a rede interna.
  app.addHook("onRequest", async (req, reply) => {
    // Bloqueia DNS rebinding: um domínio externo apontado para 127.0.0.1 chega com outro Host.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return reply.code(403).send({ error: "host não permitido" });
    if (!req.url.startsWith("/__sworn/")) return;
    // EventSource não envia header, então o SSE aceita o token na query.
    const given = Buffer.from(
      String(req.headers["x-sworn-token"] ?? (req.query as { token?: string }).token ?? ""),
    );
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: "token inválido" });
    }
  });

  app.get("/__sworn/spec", async () => spec.get());

  app.post("/__sworn/reload", async () => spec.reload());

  app.get("/__sworn/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(": ok\n\n");
    const send = () => reply.raw.write("data: spec\n\n");
    spec.events.on("change", send);
    req.raw.on("close", () => spec.events.off("change", send));
  });

  if (webDir && existsSync(join(webDir, "index.html"))) {
    // O token vai embutido no HTML: outros sites não conseguem ler esta página (same-origin).
    const html = readFileSync(join(webDir, "index.html"), "utf8").replace("__SWORN_TOKEN__", token);
    await app.register(fastifyStatic, { root: webDir, index: false, wildcard: true });
    app.get("/", (_req, reply) => reply.type("text/html").send(html));
  }

  return app;
}
