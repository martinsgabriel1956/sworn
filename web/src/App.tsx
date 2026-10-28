// Layout em 3 colunas: navegação | documentação | exemplos. A operação aberta vive no hash
// (#/op/<id>), o que dá deep link e o botão voltar do browser sem roteador.
import { groupOperations, operationDetail, type SpecState } from "@core/openapi";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, onSpecChange } from "./api";
import { Nav } from "./features/nav/Nav";
import { Examples } from "./features/operation/Examples";
import { Intro, OperationPage } from "./features/operation/Operation";

const subscribeHash = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

export function App() {
  const [state, setState] = useState<SpecState>();
  const [fetchError, setFetchError] = useState<string>();
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const mainRef = useRef<HTMLElement>(null);

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

  const doc = state?.doc;
  const groups = useMemo(() => (doc ? groupOperations(doc) : []), [doc]);
  const selectedId = hash.startsWith("#/op/") ? decodeURIComponent(hash.slice(5)) : undefined;
  const op = useMemo(
    () => groups.flatMap(([, ops]) => ops).find((o) => o.id === selectedId),
    [groups, selectedId],
  );
  const detail = useMemo(() => (doc && op ? operationDetail(doc, op) : undefined), [doc, op]);

  // Chaves no corpo: no Chromium recente scrollTo devolve uma Promise, e o React a trataria como cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: volta ao topo só quando troca de operação
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [selectedId]);

  const banners = (
    <>
      {fetchError && <Banner>Sem conexão com o cli ({fetchError}). Ele ainda está rodando?</Banner>}
      {state?.error && (
        <Banner>
          <strong className="font-semibold">Erro na spec.</strong>{" "}
          {doc ? "Mostrando a última versão válida. " : ""}
          Corrija o arquivo e a página atualiza sozinha.
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{state.error}</pre>
        </Banner>
      )}
    </>
  );

  return (
    <div className="grid h-screen grid-cols-[260px_minmax(0,1fr)] bg-white text-zinc-900 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,440px)] dark:bg-zinc-950 dark:text-zinc-100">
      <Nav doc={doc} groups={groups} selectedId={selectedId} />

      <main ref={mainRef} className="overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {banners}
          {doc && !selectedId && state && <Intro doc={doc} state={state} groups={groups} />}
          {doc && op && detail && <OperationPage doc={doc} op={op} detail={detail} />}
          {doc && selectedId && !op && (
            <p className="text-zinc-500">
              A operação <code className="font-mono">{selectedId}</code> não existe nesta versão da
              spec.{" "}
              <a href="#/" className="underline">
                Voltar ao início
              </a>
            </p>
          )}
          {/* Em telas estreitas os exemplos descem para baixo da documentação. */}
          {doc && op && detail && (
            <div className="mt-10 lg:hidden">
              <Examples doc={doc} op={op} detail={detail} />
            </div>
          )}
        </div>
      </main>

      <aside className="hidden overflow-y-auto border-zinc-200 border-l bg-zinc-50 lg:block dark:border-zinc-800 dark:bg-zinc-900">
        {doc && op && detail && (
          <div className="px-6 py-8">
            <Examples doc={doc} op={op} detail={detail} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
      {children}
    </div>
  );
}
