// Executa a request que a web montou (já interpolada) e devolve a resposta crua.
// Base: o executor do Patchbay (../http-client/api/src/lib/http.ts), sem cookie jar, proxy,
// certificados e tempos detalhados, que o Sworn ainda não usa.
import { isUtf8 } from "node:buffer";
import { STATUS_CODES } from "node:http";
import { pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { request } from "undici";
import type { SendRequest, SendResponse } from "./core/request.js";

const LIMIT = 5 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const TIMEOUT_MS = 30_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TEXT = /^text\/|json|xml|javascript|x-www-form-urlencoded|yaml/i;
const DECODERS: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: createGunzip,
  "x-gzip": createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

/** Erro com o status que a rota devolve para a web (400 request inválida, 504 timeout). */
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

export async function send(req: SendRequest, signal: AbortSignal): Promise<SendResponse> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const abort = AbortSignal.any([signal, timeout]);

  let url =
    URL.parse(req.url) ??
    fail(400, `URL inválida: ${req.url}. Defina baseUrl no ambiente se a spec não tem servers.`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(400, `protocolo não suportado: ${url.protocol}`);
  }
  let method = req.method;
  let body = req.body;
  let headers = [...req.headers];
  const has = (name: string) => headers.some(([key]) => key.toLowerCase() === name);
  if (!has("user-agent")) headers.push(["user-agent", "sworn"]);
  if (!has("accept")) headers.push(["accept", "*/*"]);

  const start = performance.now();
  try {
    for (let hop = 0; ; hop++) {
      const res = await request(url, {
        method,
        headers: headers.flat(),
        body,
        signal: abort,
        responseHeaders: "raw",
      });
      const raw = res.headers as unknown as string[];
      const pairs: [string, string][] = [];
      for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], raw[i + 1]]);
      const get = (name: string) => pairs.find(([key]) => key.toLowerCase() === name)?.[1];

      const location = get("location");
      if (location && REDIRECTS.has(res.statusCode) && hop < MAX_REDIRECTS) {
        await res.body.dump();
        const next = new URL(location, url);
        // Como os browsers: credencial não vaza para outra origem.
        if (next.origin !== url.origin) {
          headers = headers.filter(([key]) => !/^(authorization|cookie)$/i.test(key));
        }
        if (res.statusCode === 303 || (res.statusCode < 303 && method === "POST")) {
          if (method !== "HEAD") method = "GET";
          body = undefined;
          headers = headers.filter(([key]) => !/^content-/i.test(key));
        }
        url = next;
        continue;
      }

      const encoding = get("content-encoding")?.trim().toLowerCase();
      const decoder = encoding && encoding !== "identity" ? DECODERS[encoding] : undefined;
      let sizeBytes = 0;
      const counted = async function* () {
        for await (const chunk of res.body) {
          sizeBytes += chunk.length;
          yield chunk as Buffer;
        }
      };
      // Descomprime só para exibir; sizeBytes conta o que trafegou.
      const stream = decoder ? pipeline(counted, decoder(), () => {}) : counted();
      const chunks: Buffer[] = [];
      let decoded = 0;
      let truncated = false;
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
        decoded += chunk.length;
        if (decoded > LIMIT) {
          truncated = true; // sair do loop destrói o stream e fecha o upstream
          break;
        }
      }
      const data = Buffer.concat(chunks).subarray(0, LIMIT);
      const contentType = get("content-type");
      const undecodable = encoding !== undefined && encoding !== "identity" && !decoder;
      const isBinary = undecodable || (contentType ? !TEXT.test(contentType) : !isUtf8(data));

      return {
        status: res.statusCode,
        statusText: STATUS_CODES[res.statusCode] ?? "",
        headers: pairs,
        body: data.toString(isBinary ? "base64" : "utf8"),
        isBinary,
        truncated,
        timeMs: Math.round(performance.now() - start),
        sizeBytes,
      };
    }
  } catch (err) {
    if (timeout.aborted && !signal.aborted) fail(504, `sem resposta em ${TIMEOUT_MS / 1000}s`);
    throw err;
  }
}
