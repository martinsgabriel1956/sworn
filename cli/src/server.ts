import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { HistoryEntry, SendRequest, Workspace } from "./core/request.js";
import { send } from "./proxy.js";
import type { Spec } from "./spec.js";
import type { Store } from "./store.js";

type Options = {
  spec: Spec;
  store: Store;
  token: string;
  /** Build do web/. Ausente em dev, quando quem serve a página é o Vite. */
  webDir?: string;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const vars = { type: "object", additionalProperties: { type: "string" } };
const varsByEnv = { type: "object", additionalProperties: vars };

// Schemas dos bodies: o Fastify valida antes do handler e responde 400 com o motivo.
const SEND_BODY = {
  type: "object",
  required: ["method", "url", "headers"],
  additionalProperties: false,
  properties: {
    method: { type: "string", pattern: "^[A-Z]+$" },
    url: { type: "string" },
    headers: {
      type: "array",
      items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
    },
    body: { type: "string" },
  },
};
const WORKSPACE_BODY = {
  type: "object",
  required: ["envs", "secrets", "auth"],
  properties: {
    envs: varsByEnv,
    secrets: varsByEnv,
    active: { type: "string" },
    auth: {
      type: "object",
      required: ["type"],
      properties: { type: { enum: ["none", "bearer", "basic", "apikey"] } },
    },
  },
};
const HISTORY_BODY = {
  type: "object",
  required: ["at", "opId", "method", "path", "draft", "outcome"],
};

/** Erro com `status` (proxy, store) vira esse status; o resto é falha do upstream (502). */
function errorReply(err: unknown) {
  const { status = 502, message, code } = err as Error & { status?: number; code?: string };
  // AggregateError (ex.: ECONNREFUSED em ::1 e 127.0.0.1) vem sem message.
  return { status, error: message || code || String(err) };
}

export async function buildServer({ spec, store, token, webDir }: Options) {
  const app = Fastify();
  const expected = Buffer.from(token);

  // Fronteira de confiança: o /__sworn/send executa qualquer URL. Sem estas duas checagens,
  // qualquer site aberto no browser usaria o Sworn para alcançar a rede interna.
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

  app.post<{ Body: SendRequest }>(
    "/__sworn/send",
    { schema: { body: SEND_BODY }, bodyLimit: 10 * 1024 * 1024 },
    async (req, reply) => {
      // Cancelar = a web aborta o fetch; a conexão fecha e o upstream é abortado junto.
      const cancel = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) cancel.abort();
      });
      try {
        return await send(req.body, cancel.signal);
      } catch (err) {
        const { status, error } = errorReply(err);
        return reply.code(status).send({ error });
      }
    },
  );

  app.get("/__sworn/workspace", async () => store.read());

  app.put<{ Body: Workspace }>(
    "/__sworn/workspace",
    { schema: { body: WORKSPACE_BODY } },
    async (req, reply) => {
      try {
        await store.write(req.body);
        return store.read();
      } catch (err) {
        const { status, error } = errorReply(err);
        return reply.code(status === 502 ? 500 : status).send({ error });
      }
    },
  );

  app.get("/__sworn/history", async () => store.history());

  app.post<{ Body: HistoryEntry }>(
    "/__sworn/history",
    { schema: { body: HISTORY_BODY } },
    async (req, reply) => {
      await store.addHistory(req.body);
      return reply.code(204).send();
    },
  );

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
