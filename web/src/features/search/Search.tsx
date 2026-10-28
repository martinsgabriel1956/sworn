// Busca Cmd/Ctrl+K: operações por método, path, resumo e nome de campo. O índice só é montado
// na primeira vez que a busca abre, e de novo quando a spec muda.
import type { OpenApiDoc, Operation } from "@core/openapi";
import { buildIndex, search } from "@core/search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Method } from "../../ui";

export function Search({ doc, ops }: { doc?: OpenApiDoc; ops: Operation[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [used, setUsed] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const index = useMemo(() => (doc && used ? buildIndex(doc, ops) : []), [doc, ops, used]);
  const hits = useMemo(() => search(index, query), [index, query]);

  const open = useCallback(() => {
    setUsed(true);
    setQuery("");
    setActive(0);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (op?: Operation) => {
    if (!op) return;
    location.hash = `#/op/${encodeURIComponent(op.id)}`;
    dialog.current?.close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), hits.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]?.op);
    }
  };

  // Mantém o item ativo visível ao navegar pelas setas.
  useEffect(() => {
    document.getElementById(`search-hit-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="mx-3 mt-3 flex items-center gap-2 rounded border border-zinc-300 bg-white px-2 py-1 text-left text-xs text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
      >
        Buscar operação ou campo
        <kbd className="ml-auto font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Buscar"
        className="mx-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {/* showModal() já põe o foco no primeiro campo do diálogo. */}
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="search-hits"
          aria-activedescendant={hits.length ? `search-hit-${active}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="get pets, createPet, email…"
          className="w-full border-zinc-200 border-b bg-transparent px-4 py-3 text-sm outline-none dark:border-zinc-800"
        />
        <div id="search-hits" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {hits.map((hit, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: o teclado é tratado no input (setas e Enter)
            <div
              key={hit.op.id}
              tabIndex={-1}
              id={`search-hit-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => go(hit.op)}
              onMouseMove={() => setActive(i)}
              className="flex cursor-pointer items-baseline gap-3 px-4 py-1.5 text-sm aria-selected:bg-zinc-100 dark:aria-selected:bg-zinc-800"
            >
              <Method method={hit.op.method} className="w-12 shrink-0 text-[11px]" />
              <span className="truncate font-mono text-[13px]">{hit.op.path}</span>
              <span className="truncate text-xs text-zinc-500">
                {hit.field ? `campo ${hit.field}` : hit.op.summary}
              </span>
            </div>
          ))}
          {hits.length === 0 && (
            <p className="px-4 py-3 text-sm text-zinc-500">Nada encontrado para “{query}”.</p>
          )}
        </div>
      </dialog>
    </>
  );
}
