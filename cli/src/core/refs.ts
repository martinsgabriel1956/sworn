// Resolve $ref interno sob demanda. A spec chega do cli com os $ref externos já juntados
// e os internos intactos: só o trecho que aparece na tela é resolvido.

export type Ref = { $ref: string };

export const isRef = (v: unknown): v is Ref => typeof (v as Ref | null)?.$ref === "string";

/** Valor no JSON Pointer de um $ref interno ("#/components/schemas/Pet"). */
export function pointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  try {
    return ref
      .slice(1)
      .split("/")
      .slice(1)
      .map((s) => decodeURIComponent(s).replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], doc);
  } catch {
    return undefined; // %XX inválido no ponteiro
  }
}

/**
 * Segue a cadeia de $ref até um valor concreto. `ref` é o primeiro $ref seguido, que identifica
 * o alvo (detecção de recursão, nome). Uma cadeia em ciclo ($ref → $ref → ...) devolve `value` vazio.
 */
export function resolve<T>(doc: unknown, node: T | Ref | undefined): { value?: T; ref?: string } {
  const ref = isRef(node) ? node.$ref : undefined;
  const seen = new Set<string>();
  let cur: unknown = node;
  while (isRef(cur)) {
    if (seen.has(cur.$ref)) return { ref };
    seen.add(cur.$ref);
    cur = pointer(doc, cur.$ref);
  }
  return { value: cur as T | undefined, ref };
}

/** Nome legível de um $ref de components ("#/components/schemas/Pet" → "Pet"). Outros refs não têm nome. */
export function refName(ref: string | undefined): string | undefined {
  const m = ref?.match(/^#\/components\/[^/]+\/([^/]+)$/);
  return m ? m[1].replaceAll("~1", "/").replaceAll("~0", "~") : undefined;
}
