import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send } from "../src/proxy.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function serve(handler: Handler): Promise<[Server, string]> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(req, res, body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
}

let api: Server;
let other: Server;
let base: string;
let otherBase: string;

beforeAll(async () => {
  // Outra porta = outra origem: é para onde o redirect leva quando testamos vazamento de credencial.
  [other, otherBase] = await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
  });
  [api, base] = await serve((req, res, body) => {
    if (req.url === "/echo") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization }));
    } else if (req.url === "/gzip") {
      res.setHeader("content-type", "application/json");
      res.setHeader("content-encoding", "gzip");
      res.end(gzipSync('{"ok":true}'));
    } else if (req.url === "/away") {
      res.writeHead(302, { location: `${otherBase}/x` }).end();
    } else if (req.url === "/see-other") {
      res.writeHead(303, { location: "/echo" }).end();
    } else if (req.url === "/png") {
      res.setHeader("content-type", "image/png");
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } else {
      res.writeHead(404).end();
    }
  });
});
afterAll(() => {
  api.close();
  other.close();
});

const signal = new AbortController().signal;
const req = (url: string, extra: Partial<Parameters<typeof send>[0]> = {}) =>
  send({ method: "GET", url, headers: [], ...extra }, signal);

describe("proxy", () => {
  it("envia método, body e headers e devolve a resposta crua", async () => {
    const res = await req(`${base}/echo`, {
      method: "POST",
      body: "oi",
      headers: [["authorization", "Bearer x"]],
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ method: "POST", body: "oi", auth: "Bearer x" });
    expect(res.isBinary).toBe(false);
    expect(res.headers.find(([k]) => k === "content-type")?.[1]).toBe("application/json");
  });

  it("descomprime gzip para exibir e conta o tamanho que trafegou", async () => {
    const res = await req(`${base}/gzip`);
    expect(res.body).toBe('{"ok":true}');
    expect(res.sizeBytes).toBe(gzipSync('{"ok":true}').length);
  });

  it("não leva Authorization num redirect para outra origem", async () => {
    const res = await req(`${base}/away`, { headers: [["authorization", "Bearer x"]] });
    expect(JSON.parse(res.body)).toEqual({ auth: null });
  });

  it("303 vira GET sem body", async () => {
    const res = await req(`${base}/see-other`, { method: "POST", body: "x" });
    expect(JSON.parse(res.body)).toMatchObject({ method: "GET", body: "" });
  });

  it("binário vai em base64", async () => {
    const res = await req(`${base}/png`);
    expect(res.isBinary).toBe(true);
    expect(Buffer.from(res.body, "base64")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("URL inválida é 400 com dica do baseUrl", async () => {
    await expect(req("/pets")).rejects.toMatchObject({ status: 400, message: /baseUrl/ });
    await expect(req("ftp://x")).rejects.toMatchObject({ status: 400 });
  });
});
