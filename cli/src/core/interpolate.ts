// {{variável}} → valor. Mesmas regras do Patchbay (../http-client/api/src/core/interpolate.ts).

export type Vars = Record<string, string>;

/** `{{nome}}` ou `{{ nome }}`. Nome sem espaço nem chave; `{{}}` e `{{a b}}` não são variável. */
const VAR = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** Uma passada só: valor que contém `{{` não é reinterpretado. Indefinida fica como está. */
export const interpolate = (text: string, vars: Vars) =>
  text.replace(VAR, (raw, name: string) => (Object.hasOwn(vars, name) ? vars[name] : raw));

/** Nomes das `{{var}}` que sobraram em algo já interpolado (sem valor no ambiente). */
export const unresolved = (value: unknown) => [
  ...new Set([...JSON.stringify(value).matchAll(VAR)].map((m) => m[1])),
];
