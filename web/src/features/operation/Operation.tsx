// Coluna central: a página de uma operação, e a página inicial quando nenhuma está aberta.
import type {
  MediaType,
  OpenApiDoc,
  Operation,
  OperationDetail,
  Parameter,
  SpecState,
} from "@core/openapi";
import { resolve } from "@core/refs";
import { constraints, type Schema, typeLabel } from "@core/schema";
import { type ReactNode, useState } from "react";
import { Markdown, Method, PathText, statusColor, Tabs, Tag } from "../../ui";
import { SchemaView } from "../schema/SchemaView";

const PARAM_GROUPS: [Parameter["in"], string][] = [
  ["path", "Parâmetros de path"],
  ["query", "Query"],
  ["header", "Headers"],
  ["cookie", "Cookies"],
];

export function OperationPage({
  doc,
  op,
  detail,
}: {
  doc: OpenApiDoc;
  op: Operation;
  detail: OperationDetail;
}) {
  const firstOk = detail.responses.find(([s]) => s.startsWith("2"))?.[0];
  return (
    <article>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Method method={op.method} />
        <PathText path={op.path} />
        {detail.deprecated && <Tag tone="rose">obsoleta</Tag>}
      </div>
      <h1 className="mt-2 font-semibold text-2xl">{detail.summary ?? op.path}</h1>
      {detail.operationId && (
        <p className="mt-1 font-mono text-xs text-zinc-500">{detail.operationId}</p>
      )}
      {detail.description && <Markdown className="mt-4">{detail.description}</Markdown>}

      {PARAM_GROUPS.map(([where, title]) => {
        const params = detail.parameters.filter((p) => p.in === where);
        if (params.length === 0) return null;
        return (
          <Section key={where} title={title}>
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {params.map((p) => (
                <ParameterRow key={p.name} doc={doc} param={p} />
              ))}
            </ul>
          </Section>
        );
      })}

      {detail.requestBody && (
        <Section
          title="Body"
          aside={detail.requestBody.required ? <Tag tone="rose">obrigatório</Tag> : undefined}
        >
          {detail.requestBody.description && (
            <Markdown className="mb-3">{detail.requestBody.description}</Markdown>
          )}
          <Content doc={doc} content={detail.requestBody.content} />
        </Section>
      )}

      <Section title="Respostas">
        {detail.responses.length === 0 ? (
          <p className="text-sm text-zinc-500">A spec não documenta respostas.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {detail.responses.map(([status, response]) => (
              <ResponseRow
                key={status}
                doc={doc}
                status={status}
                description={response.description}
                content={response.content}
                defaultOpen={status === firstOk}
              />
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}

function ParameterRow({ doc, param }: { doc: OpenApiDoc; param: Parameter }) {
  const schema = resolve<Schema>(doc, param.schema).value;
  const extra = schema ? constraints(schema) : [];
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium font-mono">{param.name}</span>
        <span className="font-mono text-xs text-zinc-500">{typeLabel(doc, param.schema)}</span>
        {param.required && <Tag tone="rose">obrigatório</Tag>}
        {param.deprecated && <Tag>obsoleto</Tag>}
      </div>
      {(param.description ?? schema?.description) && (
        <Markdown className="mt-1">{param.description ?? schema?.description ?? ""}</Markdown>
      )}
      {extra.length > 0 && (
        <p className="mt-1 font-mono text-xs text-zinc-500">{extra.join(" · ")}</p>
      )}
    </li>
  );
}

function ResponseRow({
  doc,
  status,
  description,
  content,
  defaultOpen,
}: {
  doc: OpenApiDoc;
  status: string;
  description?: string;
  content?: Record<string, MediaType>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = Object.keys(content ?? {}).length > 0;
  return (
    <li className="text-sm">
      <button
        type="button"
        disabled={!hasBody}
        aria-expanded={hasBody ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline gap-3 px-3 py-2 text-left enabled:hover:bg-zinc-50 dark:enabled:hover:bg-zinc-900"
      >
        <span className={`min-w-12 shrink-0 font-mono font-semibold ${statusColor(status)}`}>
          {status}
        </span>
        <span className="flex-1 text-zinc-600 dark:text-zinc-300">{description}</span>
        {hasBody && <span className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>}
      </button>
      {hasBody && open && (
        <div className="px-3 pb-3">
          <Content doc={doc} content={content} />
        </div>
      )}
    </li>
  );
}

/** Schema por content type, com abas quando há mais de um. */
function Content({ doc, content }: { doc: OpenApiDoc; content?: Record<string, MediaType> }) {
  const types = Object.keys(content ?? {});
  const [picked, setPicked] = useState(types[0]);
  const active = content?.[picked] ? picked : types[0];
  if (!active || !content) return <p className="text-sm text-zinc-500">Sem corpo.</p>;
  return (
    <div>
      {types.length > 1 ? (
        <Tabs
          items={types.map((t) => ({ key: t, label: t }))}
          active={active}
          onChange={setPicked}
        />
      ) : (
        <p className="font-mono text-xs text-zinc-500">{active}</p>
      )}
      <div className="mt-2">
        {content[active].schema ? (
          <SchemaView doc={doc} schema={content[active].schema} />
        ) : (
          <p className="text-sm text-zinc-500">Sem schema declarado.</p>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-sm">
        {title}
        {aside}
      </h2>
      {children}
    </section>
  );
}

export function Intro({
  doc,
  state,
  groups,
}: {
  doc: OpenApiDoc;
  state: SpecState;
  groups: [string, Operation[]][];
}) {
  const total = groups.reduce((n, [, ops]) => n + ops.length, 0);
  return (
    <article>
      <h1 className="font-semibold text-3xl">{doc.info?.title ?? "API sem título"}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {doc.info?.version && `v${doc.info.version} · `}OpenAPI {doc.openapi} · {total}{" "}
        {total === 1 ? "operação" : "operações"}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-zinc-500">{state.source}</p>
      {doc.info?.description && <Markdown className="mt-6">{doc.info.description}</Markdown>}
      {doc.servers && doc.servers.length > 0 && (
        <Section title="Servidores">
          <ul className="space-y-1 text-sm">
            {doc.servers.map((s) => (
              <li key={s.url}>
                <code className="font-mono">{s.url}</code>
                {s.description && <span className="text-zinc-500"> · {s.description}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}
