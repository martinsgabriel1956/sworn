// Sidebar virtualizada: só as linhas visíveis vão para o DOM, então specs com milhares
// de operações rolam sem travar.
import type { OpenApiDoc, Operation } from "@core/openapi";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { Method } from "../../ui";
import { Search } from "../search/Search";

type Row = { kind: "tag"; tag: string } | { kind: "op"; op: Operation };

const ROW_HEIGHT = { tag: 36, op: 30 };

export function Nav({
  doc,
  groups,
  selectedId,
}: {
  doc?: OpenApiDoc;
  groups: [string, Operation[]][];
  selectedId?: string;
}) {
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap(([tag, ops]) => [
        { kind: "tag" as const, tag },
        ...ops.map((op) => ({ kind: "op" as const, op })),
      ]),
    [groups],
  );
  const ops = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT[rows[i].kind],
    overscan: 12,
  });

  // Deep link: ao abrir direto numa operação, rola a sidebar até ela.
  useEffect(() => {
    const i = rows.findIndex((r) => r.kind === "op" && r.op.id === selectedId);
    if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
  }, [rows, selectedId, virtualizer]);

  return (
    <aside className="flex min-h-0 flex-col border-zinc-200 border-r bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <a href="#/" className="block border-zinc-200 border-b px-4 py-3 dark:border-zinc-800">
        <span className="block truncate font-semibold text-sm">
          {doc?.info?.title ?? "Carregando…"}
        </span>
        {doc?.info?.version && <span className="text-xs text-zinc-500">v{doc.info.version}</span>}
      </a>
      <Search doc={doc} ops={ops} />

      <nav ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Operações">
        <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <li
                key={item.key}
                className="absolute inset-x-0"
                style={{ top: item.start, height: item.size }}
              >
                {row.kind === "tag" ? (
                  <p className="truncate px-4 pt-4 pb-1 font-medium text-[11px] text-zinc-500 uppercase tracking-wide">
                    {row.tag}
                  </p>
                ) : (
                  <a
                    href={`#/op/${encodeURIComponent(row.op.id)}`}
                    title={row.op.summary}
                    aria-current={row.op.id === selectedId ? "page" : undefined}
                    className="mx-2 flex h-full items-center gap-2 rounded px-2 text-sm hover:bg-zinc-200/60 aria-[current=page]:bg-zinc-200 dark:aria-[current=page]:bg-zinc-800 dark:hover:bg-zinc-800/60"
                  >
                    <Method method={row.op.method} className="w-12 shrink-0 text-[11px]" />
                    <span
                      className={`truncate font-mono text-[13px] ${row.op.deprecated ? "line-through opacity-60" : ""}`}
                    >
                      {row.op.path}
                    </span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
