// Coluna direita: o cliente da operação aberta. Formulário → buildRequest (core) → proxy do cli.
import { unresolved } from "@core/interpolate";
import type { OpenApiDoc, Operation, OperationDetail, Parameter } from "@core/openapi";
import { resolve } from "@core/refs";
import {
  type Auth,
  buildRequest,
  initialDraft,
  needsAuth,
  paramKey,
  type SendResponse,
} from "@core/request";
import { type Schema, typeLabel } from "@core/schema";
import { type KeyboardEvent, useMemo, useState } from "react";
import { activeVars, type Result, useClient } from "../../store";
import { Button, inputClass, Method, statusColor, Tabs } from "../../ui";
import { EnvBar } from "../env/EnvBar";
import { ResponseExamples } from "../operation/Examples";
import { Editor } from "./Editor";

const NO_AUTH: Auth = { type: "none" };
const GROUPS: [Parameter["in"], string][] = [
  ["path", "Path"],
  ["query", "Query"],
  ["header", "Headers"],
  ["cookie", "Cookies"],
];

export function Client({
  doc,
  op,
  detail,
}: {
  doc: OpenApiDoc;
  op: Operation;
  detail: OperationDetail;
}) {
  const ws = useClient((s) => s.ws);
  const stored = useClient((s) => s.drafts[op.id]);
  const setDraft = useClient((s) => s.setDraft);
  const result = useClient((s) => s.results[op.id]);
  const sending = useClient((s) => s.sending?.opId === op.id);
  const send = useClient((s) => s.send);
  const cancel = useClient((s) => s.cancel);

  const initial = useMemo(() => initialDraft(doc, detail), [doc, detail]);
  const draft = stored ?? initial;
  const vars = activeVars(ws);
  const auth = ws && needsAuth(doc, detail) ? ws.auth : NO_AUTH;
  const request = buildRequest({
    method: op.method,
    path: op.path,
    detail,
    draft,
    vars,
    auth,
    baseUrl: vars.baseUrl ?? detail.server,
  });
  const missingVars = unresolved(request);
  const missingParams = detail.parameters.filter(
    (p) => p.required && !(draft.params[paramKey(p)] ?? "").trim(),
  );

  const submit = () => {
    if (!sending) send({ opId: op.id, method: op.method, path: op.path, draft }, request);
  };
  // Ctrl/Cmd+Enter em qualquer campo. O editor trata o próprio atalho e marca defaultPrevented.
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.defaultPrevented) {
      e.preventDefault();
      submit();
    }
  };
  const setParam = (p: Parameter, value: string) =>
    setDraft(op.id, { ...draft, params: { ...draft.params, [paramKey(p)]: value } });

  const types = Object.keys(detail.requestBody?.content ?? {});
  const contentType = draft.contentType ?? types[0];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: só captura o atalho de teclado dos campos internos
    <div className="space-y-6 text-sm" onKeyDown={onKeyDown}>
      <EnvBar doc={doc} />

      <div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 break-all rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <Method method={op.method} className="mr-2" />
            {request.url}
          </div>
          {sending ? (
            <Button onClick={cancel}>Cancelar</Button>
          ) : (
            <Button
              variant="primary"
              onClick={submit}
              title="Ctrl+Enter"
              aria-keyshortcuts="Control+Enter"
            >
              Enviar
            </Button>
          )}
        </div>
        {(missingVars.length > 0 || missingParams.length > 0) && (
          <ul className="mt-2 space-y-0.5 text-amber-700 text-xs dark:text-amber-400">
            {missingVars.map((v) => (
              <li key={v}>
                Variável <code className="font-mono">{`{{${v}}}`}</code> sem valor no ambiente
                ativo.
              </li>
            ))}
            {missingParams.map((p) => (
              <li key={paramKey(p)}>
                Parâmetro obrigatório <code className="font-mono">{p.name}</code> vazio.
              </li>
            ))}
          </ul>
        )}
      </div>

      {GROUPS.map(([where, title]) => {
        const params = detail.parameters.filter((p) => p.in === where);
        if (params.length === 0) return null;
        return (
          <fieldset key={where}>
            <legend className="mb-2 font-semibold">{title}</legend>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2 gap-y-1.5">
              {params.map((p) => (
                <ParamField
                  key={paramKey(p)}
                  doc={doc}
                  param={p}
                  value={draft.params[paramKey(p)] ?? ""}
                  onChange={(v) => setParam(p, v)}
                />
              ))}
            </div>
          </fieldset>
        );
      })}

      {detail.requestBody && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-semibold">Body</h3>
            {types.length > 1 && (
              <select
                aria-label="Content-Type"
                value={contentType}
                onChange={(e) => setDraft(op.id, { ...draft, contentType: e.target.value })}
                className={inputClass}
              >
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            {draft.body !== initial.body && (
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => setDraft(op.id, { ...draft, body: initial.body })}
              >
                Restaurar exemplo
              </Button>
            )}
          </div>
          <Editor
            label="Body da request"
            value={draft.body}
            isJson={/json/i.test(contentType ?? "")}
            placeholder={types.length ? `Body em ${contentType}` : undefined}
            onChange={(body) => setDraft(op.id, { ...draft, body })}
            onSubmit={submit}
          />
        </div>
      )}

      <div>
        <h3 className="mb-2 font-semibold">Resposta</h3>
        {sending ? (
          <p className="text-zinc-500">Enviando…</p>
        ) : result ? (
          <ResultView result={result} />
        ) : (
          <>
            <p className="mb-2 text-xs text-zinc-500">
              Ainda não enviada. Abaixo, o exemplo que a spec declara.
            </p>
            <ResponseExamples doc={doc} detail={detail} />
          </>
        )}
      </div>

      <OpHistory opId={op.id} />
    </div>
  );
}

function ParamField({
  doc,
  param,
  value,
  onChange,
}: {
  doc: OpenApiDoc;
  param: Parameter;
  value: string;
  onChange: (value: string) => void;
}) {
  const schema = resolve<Schema>(doc, param.schema).value;
  const hint = param.example ?? schema?.example ?? schema?.default;
  const id = `param-${param.in}-${param.name}`;
  return (
    <>
      <label htmlFor={id} className="truncate font-mono text-xs" title={param.description}>
        {param.name}
        {param.required && <span className="text-rose-600"> *</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint === undefined ? typeLabel(doc, param.schema) : String(hint)}
        list={schema?.enum ? `${id}-enum` : undefined}
        className={`${inputClass} w-full`}
      />
      {schema?.enum && (
        <datalist id={`${id}-enum`}>
          {schema.enum.map((v) => (
            <option key={String(v)} value={String(v)} />
          ))}
        </datalist>
      )}
    </>
  );
}

const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;

function pretty(res: SendResponse) {
  if (res.isBinary) return "";
  try {
    return JSON.stringify(JSON.parse(res.body), null, 2);
  } catch {
    return res.body; // texto, ou JSON cortado pelo limite
  }
}

function ResultView({ result }: { result: Result }) {
  const [tab, setTab] = useState("body");
  const res = result.response;
  const body = useMemo(() => (res ? pretty(res) : ""), [res]);

  if (!res) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
        {result.error}
      </div>
    );
  }
  const isJson =
    body !== res.body ||
    /json/i.test(res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "");
  return (
    <div>
      <p className="mb-2 flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
        <span className={`font-semibold ${statusColor(String(res.status))}`}>
          {res.status} {res.statusText}
        </span>
        <span className="text-zinc-500">{res.timeMs} ms</span>
        <span className="text-zinc-500">{bytes(res.sizeBytes)}</span>
      </p>
      <Tabs
        items={[
          { key: "body", label: "Body" },
          { key: "headers", label: `Headers (${res.headers.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-2">
        {tab === "headers" ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
            {res.headers.map(([k, v], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: headers repetem nome (set-cookie)
              <div key={i} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        ) : res.isBinary ? (
          <p className="text-zinc-500">Resposta binária ({bytes(res.sizeBytes)}).</p>
        ) : body === "" ? (
          <p className="text-zinc-500">Sem body.</p>
        ) : (
          <>
            {res.truncated && (
              <p className="mb-2 text-amber-700 text-xs dark:text-amber-400">
                Resposta maior que 5 MB: mostrando só o começo.
              </p>
            )}
            <Editor label="Body da resposta" value={body} isJson={isJson} readOnly />
          </>
        )}
      </div>
    </div>
  );
}

function OpHistory({ opId }: { opId: string }) {
  const entries = useClient((s) => s.history)
    .filter((h) => h.opId === opId)
    .slice(0, 20);
  const setDraft = useClient((s) => s.setDraft);
  if (entries.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer font-semibold">Histórico ({entries.length})</summary>
      <ul className="mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {entries.map((h) => (
          <li key={h.at} className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-xs">
            <time dateTime={h.at} className="text-zinc-500">
              {new Date(h.at).toLocaleString()}
            </time>
            {"status" in h.outcome ? (
              <>
                <span className={statusColor(String(h.outcome.status))}>{h.outcome.status}</span>
                <span className="text-zinc-500">{h.outcome.timeMs} ms</span>
              </>
            ) : (
              <span className="truncate text-rose-600" title={h.outcome.error}>
                erro
              </span>
            )}
            <Button variant="ghost" className="ml-auto" onClick={() => setDraft(opId, h.draft)}>
              Restaurar
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
