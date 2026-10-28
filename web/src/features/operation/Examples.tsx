// Exemplos de resposta que a spec declara. Aparecem no cliente enquanto não há resposta real.
import { mediaExample, type OpenApiDoc, type OperationDetail } from "@core/openapi";
import { useState } from "react";
import { Tabs } from "../../ui";

export function ResponseExamples({ doc, detail }: { doc: OpenApiDoc; detail: OperationDetail }) {
  const examples = detail.responses.flatMap(([status, r]) => {
    for (const media of Object.values(r.content ?? {})) {
      const ex = mediaExample(doc, media);
      if (ex) return [{ status, value: ex.value }];
    }
    return [];
  });
  const [picked, setPicked] = useState<string>();
  const active = examples.find((e) => e.status === picked) ?? examples[0];

  if (!active) {
    return (
      <p className="text-zinc-500">A spec não traz exemplos de resposta para esta operação.</p>
    );
  }
  return (
    <>
      <Tabs
        items={examples.map((e) => ({ key: e.status, label: e.status }))}
        active={active.status}
        onChange={setPicked}
      />
      <pre className="mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">
        {typeof active.value === "string" ? active.value : JSON.stringify(active.value, null, 2)}
      </pre>
    </>
  );
}
