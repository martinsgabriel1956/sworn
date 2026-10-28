// Etapa 1 do PLANNING.md: lista as operações e recarrega quando a spec muda.
// O layout em 3 colunas e a página da operação chegam na etapa 2.
import { groupOperations, type SpecState } from "@core/openapi";
import { useEffect, useMemo, useState } from "react";
import { api, onSpecChange } from "./api";

const METHOD_COLOR: Record<string, string> = {
  get: "text-sky-700 dark:text-sky-400",
  post: "text-emerald-700 dark:text-emerald-400",
  put: "text-amber-700 dark:text-amber-400",
  patch: "text-violet-700 dark:text-violet-400",
  delete: "text-rose-700 dark:text-rose-400",
};

export function App() {
  const [state, setState] = useState<SpecState>();
  const [fetchError, setFetchError] = useState<string>();

  useEffect(() => {
    const load = () =>
      api<SpecState>("spec")
        .then((s) => {
          setState(s);
          setFetchError(undefined);
        })
        .catch((err: Error) => setFetchError(err.message));
    load();
    return onSpecChange(load);
  }, []);

  const groups = useMemo(() => (state?.doc ? groupOperations(state.doc) : []), [state?.doc]);
  const doc = state?.doc;

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-8">
        {fetchError && (
          <Banner>Sem conexão com o cli ({fetchError}). Ele ainda está rodando?</Banner>
        )}
        {state?.error && (
          <Banner>
            <strong className="font-semibold">Erro na spec.</strong>{" "}
            {doc ? "Mostrando a última versão válida. " : ""}
            Corrija o arquivo e a página atualiza sozinha.
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{state.error}</pre>
          </Banner>
        )}

        {doc && (
          <header className="mb-8">
            <h1 className="font-semibold text-2xl">{doc.info?.title ?? "API sem título"}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {doc.info?.version && `v${doc.info.version} · `}OpenAPI {doc.openapi} · {state.source}
            </p>
          </header>
        )}

        {groups.map(([tag, ops]) => (
          <section key={tag} className="mb-6">
            <h2 className="mb-2 font-medium text-sm text-zinc-500 uppercase tracking-wide">
              {tag}
            </h2>
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {ops.map((op) => (
                <li key={`${op.method} ${op.path}`} className="flex items-baseline gap-3 px-3 py-2">
                  <span
                    className={`w-16 shrink-0 font-mono font-semibold text-xs uppercase ${METHOD_COLOR[op.method] ?? "text-zinc-500"}`}
                  >
                    {op.method}
                  </span>
                  <code
                    className={`font-mono text-sm ${op.deprecated ? "line-through opacity-60" : ""}`}
                  >
                    {op.path}
                  </code>
                  {op.summary && (
                    <span className="truncate text-sm text-zinc-500">{op.summary}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {doc && groups.length === 0 && <p className="text-zinc-500">A spec não tem operações.</p>}
      </main>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
      {children}
    </div>
  );
}
