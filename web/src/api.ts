// Conversa com o cli em /__sworn/*. Toda rota exige o token da sessão.

const meta = document.querySelector<HTMLMetaElement>('meta[name="sworn-token"]')?.content ?? "";
// Em dev o placeholder não é trocado: quem injeta o token é o proxy do Vite.
const token = meta === "__SWORN_TOKEN__" ? "" : meta;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/__sworn/${path}`, {
    ...init,
    headers: { ...init?.headers, "x-sworn-token": token },
  });
  if (!res.ok) throw new Error(`${res.status} em /__sworn/${path}`);
  return res.json();
}

/** Avisa a cada recarga da spec. EventSource não envia header, então o token vai na query. */
export function onSpecChange(fn: () => void): () => void {
  const es = new EventSource(`/__sworn/events?token=${encodeURIComponent(token)}`);
  es.onmessage = fn;
  return () => es.close();
}
