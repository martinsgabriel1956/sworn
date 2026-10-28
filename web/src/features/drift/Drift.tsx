// Página #/drift: onde a API divergiu da spec no uso do dia a dia, a partir do histórico.
import { checkedLabel, driftMarkdown, driftReport } from "@core/drift";
import type { OpenApiDoc } from "@core/openapi";
import { useMemo, useState } from "react";
import { useClient } from "../../store";
import { Button, Method, PathText } from "../../ui";

export function DriftPage({ doc }: { doc: OpenApiDoc }) {
  const history = useClient((s) => s.history);
  const report = useMemo(() => driftReport(history), [history]);
  const markdown = () => driftMarkdown(report, doc.info?.title);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(markdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown" }));
    a.download = "sworn-drift.md";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <article>
      <h1 className="font-semibold text-2xl">Drift</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Onde as respostas reais divergiram da spec
        {report.since && ` desde ${new Date(report.since).toLocaleDateString()}`}:{" "}
        {checkedLabel(report.checked)} nas últimas 500 requests do histórico.
      </p>
      {report.checked > 0 && (
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" onClick={copy}>
            {copied ? "Copiado" : "Copiar Markdown"}
          </Button>
          <Button variant="ghost" onClick={download}>
            Baixar .md
          </Button>
        </div>
      )}

      {report.checked === 0 && (
        <p className="mt-8 text-sm text-zinc-500">
          Nenhuma resposta conferida ainda. Envie requests pelo cliente e elas aparecem aqui.
        </p>
      )}
      {report.checked > 0 && report.ops.length === 0 && (
        <p className="mt-8 text-emerald-700 text-sm dark:text-emerald-400">
          ✓ Nenhuma divergência: todas as respostas bateram com a spec.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {report.ops.map((op) => (
          <section key={op.opId}>
            <a
              href={`#/op/${encodeURIComponent(op.opId)}`}
              className="flex flex-wrap items-center gap-2 text-sm hover:underline"
            >
              <Method method={op.method} />
              <PathText path={op.path} />
            </a>
            <p className="mt-1 text-xs text-zinc-500">
              Divergiu em {op.divergent} de {op.checked} respostas
            </p>
            <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {op.issues.map((i) => (
                <li key={`${i.level}${i.kind}${i.path}`} className="flex gap-3 px-3 py-2">
                  <span
                    className={`w-10 shrink-0 font-semibold text-xs ${i.level === "error" ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}
                  >
                    {i.level === "error" ? "erro" : "aviso"}
                  </span>
                  <span className="min-w-0 flex-1">
                    {i.path && <code className="mr-1 font-mono text-xs">{i.path}</code>}
                    {i.messages.join("; ")}
                  </span>
                  <span
                    className="shrink-0 text-xs text-zinc-500"
                    title={`Última vez: ${new Date(i.lastAt).toLocaleString()}`}
                  >
                    {i.count}×
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
