// Coluna direita: a request e os exemplos que a spec declara. Na etapa 3 vira o cliente
// editável; na etapa 5 ganha exemplos gerados do schema quando a spec não traz nenhum.
import {
  type MediaType,
  mediaExample,
  type OpenApiDoc,
  type Operation,
  type OperationDetail,
} from "@core/openapi";
import { useState } from "react";
import { Method, PathText, Tabs } from "../../ui";

export function Examples({
  doc,
  op,
  detail,
}: {
  doc: OpenApiDoc;
  op: Operation;
  detail: OperationDetail;
}) {
  const bodyExample = firstExample(doc, detail.requestBody?.content);
  const responses = detail.responses.flatMap(([status, r]) => {
    const ex = firstExample(doc, r.content);
    return ex ? [{ status, ...ex }] : [];
  });
  const [picked, setPicked] = useState<string>();
  const active = responses.find((r) => r.status === picked) ?? responses[0];

  return (
    <div className="space-y-6 text-sm">
      <div>
        <h2 className="mb-2 font-semibold">Request</h2>
        <div className="break-all rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <Method method={op.method} className="mr-2 text-xs" />
          <span className="font-mono text-zinc-500">{detail.server}</span>
          <PathText path={op.path} />
        </div>
      </div>

      {bodyExample && (
        <div>
          <h2 className="mb-2 font-semibold">Body de exemplo</h2>
          <Json value={bodyExample.value} />
        </div>
      )}

      <div>
        <h2 className="mb-2 font-semibold">Resposta de exemplo</h2>
        {active ? (
          <>
            <Tabs
              items={responses.map((r) => ({
                key: r.status,
                label: r.status,
              }))}
              active={active.status}
              onChange={setPicked}
            />
            <div className="mt-2">
              <Json value={active.value} />
            </div>
          </>
        ) : (
          <p className="text-zinc-500">A spec não traz exemplos de resposta para esta operação.</p>
        )}
      </div>
    </div>
  );
}

function firstExample(doc: OpenApiDoc, content: Record<string, MediaType> | undefined) {
  for (const media of Object.values(content ?? {})) {
    const ex = mediaExample(doc, media);
    if (ex) return ex;
  }
  return undefined;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
