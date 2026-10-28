// Exemplos de resposta: o que a spec declara ou, sem isso, um gerado do schema.
// Aparecem no cliente enquanto não há resposta real.
import { bodyExample } from "@core/examples";
import type { OpenApiDoc, OperationDetail } from "@core/openapi";
import { useMemo, useState } from "react";
import { Tabs } from "../../ui";

export function ResponseExamples({ doc, detail }: { doc: OpenApiDoc; detail: OperationDetail }) {
  const examples = useMemo(
    () =>
      detail.responses.flatMap(([status, r]) => {
        for (const [mediaType, media] of Object.entries(r.content ?? {})) {
          const ex = bodyExample(doc, mediaType, media, "response");
          if (ex) return [{ status, ...ex }];
        }
        return [];
      }),
    [doc, detail],
  );
  const [picked, setPicked] = useState<string>();
  const active = examples.find((e) => e.status === picked) ?? examples[0];

  if (!active) {
    return <p className="text-zinc-500">A spec não descreve o corpo das respostas.</p>;
  }
  return (
    <>
      <Tabs
        items={examples.map((e) => ({ key: e.status, label: e.status }))}
        active={active.status}
        onChange={setPicked}
      />
      {active.generated && (
        <p className="mt-2 text-xs text-zinc-500">Gerado do schema: a spec não traz exemplo.</p>
      )}
      <pre className="mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">
        {typeof active.value === "string" ? active.value : JSON.stringify(active.value, null, 2)}
      </pre>
    </>
  );
}
