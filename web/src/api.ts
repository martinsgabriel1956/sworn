// Conversa com o cli em /__sworn/*. Toda rota exige o token da sessão.

const meta = document.querySelector<HTMLMetaElement>('meta[name="sworn-token"]')?.content ?? "";
// Em dev o placeholder não é trocado: quem injeta o token é o proxy do Vite.
const token = meta === "__SWORN_TOKEN__" ? "" : meta;

/** `json` vira o body com content-type JSON. Erro do cli chega como `{ error }` e vira a mensagem. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/__sworn/${path}`, {
    ...rest,
    body: json === undefined ? rest.body : JSON.stringify(json),
    headers: {
      ...rest.headers,
      "x-sworn-token": token,
      ...(json === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error ?? `${res.status} em /__sworn/${path}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Avisa a cada recarga da spec. EventSource não envia header, então o token vai na query. */
export function onSpecChange(fn: () => void): () => void {
  const es = new EventSource(`/__sworn/events?token=${encodeURIComponent(token)}`);
  es.onmessage = fn;
  return () => es.close();
}
