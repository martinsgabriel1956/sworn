// Barra do cliente: ambiente ativo e auth global, com os diálogos para editar os dois.
import type { Vars } from "@core/interpolate";
import type { OpenApiDoc } from "@core/openapi";
import { type Auth, authFromSpec, type Workspace } from "@core/request";
import { useState } from "react";
import { useClient } from "../../store";
import { Button, Dialog, inputClass } from "../../ui";

const AUTH_LABEL: Record<Auth["type"], string> = {
  none: "sem auth",
  bearer: "Bearer",
  basic: "Basic",
  apikey: "API key",
};

export function EnvBar({ doc }: { doc: OpenApiDoc }) {
  const ws = useClient((s) => s.ws);
  const save = useClient((s) => s.saveWorkspace);
  const error = useClient((s) => s.wsError);
  const [dialog, setDialog] = useState<"env" | "auth">();
  if (!ws) return null;
  const names = Object.keys(ws.envs);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select
        aria-label="Ambiente ativo"
        value={ws.active ?? ""}
        onChange={(e) => save({ ...ws, active: e.target.value || undefined })}
        className={`${inputClass} font-sans`}
      >
        <option value="">sem ambiente</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <Button variant="ghost" onClick={() => setDialog("env")}>
        Ambientes
      </Button>
      <Button variant="ghost" onClick={() => setDialog("auth")} className="ml-auto">
        Auth: {AUTH_LABEL[ws.auth.type]}
      </Button>
      <EnvDialog open={dialog === "env"} onClose={() => setDialog(undefined)} ws={ws} />
      <AuthDialog
        open={dialog === "auth"}
        onClose={() => setDialog(undefined)}
        ws={ws}
        suggested={authFromSpec(doc)}
      />
      {error && !dialog && <p className="w-full text-rose-600">{error}</p>}
    </div>
  );
}

type Rows = [key: string, value: string][];
const toRows = (vars: Vars = {}): Rows => Object.entries(vars);
const toVars = (rows: Rows): Vars =>
  Object.fromEntries(rows.filter(([k]) => k.trim() !== "").map(([k, v]) => [k.trim(), v]));

function EnvDialog({ open, onClose, ws }: { open: boolean; onClose: () => void; ws: Workspace }) {
  const save = useClient((s) => s.saveWorkspace);
  const error = useClient((s) => s.wsError);
  // Cópia editável: nada vai para o disco até Salvar.
  const [envs, setEnvs] = useState<Record<string, { vars: Rows; secrets: Rows }>>({});
  const [current, setCurrent] = useState<string>();
  const [newName, setNewName] = useState("");
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setEnvs(
        Object.fromEntries(
          Object.keys(ws.envs).map((n) => [
            n,
            { vars: toRows(ws.envs[n]), secrets: toRows(ws.secrets[n]) },
          ]),
        ),
      );
      setCurrent(ws.active ?? Object.keys(ws.envs)[0]);
      setNewName("");
    }
  }

  const env = current ? envs[current] : undefined;
  const update = (part: "vars" | "secrets", rows: Rows) =>
    current && setEnvs({ ...envs, [current]: { ...envs[current], [part]: rows } });

  function create() {
    const name = newName.trim();
    if (!name || envs[name]) return;
    // O primeiro ambiente já nasce com baseUrl, que é o que quase todo mundo troca entre ambientes.
    setEnvs({ ...envs, [name]: { vars: [["baseUrl", ""]], secrets: [] } });
    setCurrent(name);
    setNewName("");
  }

  function remove() {
    if (!current) return;
    const { [current]: _, ...rest } = envs;
    setEnvs(rest);
    setCurrent(Object.keys(rest)[0]);
  }

  async function submit() {
    const names = Object.keys(envs);
    const ok = await save({
      ...ws,
      envs: Object.fromEntries(names.map((n) => [n, toVars(envs[n].vars)])),
      secrets: Object.fromEntries(
        names.map((n) => [n, toVars(envs[n].secrets)]).filter(([, v]) => Object.keys(v).length),
      ),
      active: ws.active && names.includes(ws.active) ? ws.active : (current ?? names[0]),
    });
    if (ok) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ambientes"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(envs).map((n) => (
          <Button
            key={n}
            variant={n === current ? "primary" : "secondary"}
            onClick={() => setCurrent(n)}
          >
            {n}
          </Button>
        ))}
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value.replace(/[^\w.-]/g, ""))}
            placeholder="novo ambiente"
            aria-label="Nome do novo ambiente"
            className={`${inputClass} w-36`}
          />
          <Button type="submit">Criar</Button>
        </form>
      </div>

      {env && current ? (
        <div className="mt-5 space-y-5">
          <KvEditor
            title="Variáveis"
            hint={`Versionadas em .sworn/env/${current}.json. A variável baseUrl substitui o server da spec.`}
            rows={env.vars}
            onChange={(rows) => update("vars", rows)}
          />
          <KvEditor
            title="Segredos"
            hint="Só nesta máquina, em .sworn/local/secrets.json (fora do git). Sobrescrevem variáveis de mesmo nome."
            rows={env.secrets}
            onChange={(rows) => update("secrets", rows)}
            secret
          />
          <Button variant="ghost" onClick={remove} className="text-rose-600 dark:text-rose-400">
            Excluir o ambiente {current}
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-zinc-500">
          Sem ambientes. Sem nenhum, a URL base é o primeiro server da spec.
        </p>
      )}
      {error && <p className="mt-3 text-rose-600">{error}</p>}
    </Dialog>
  );
}

function KvEditor({
  title,
  hint,
  rows,
  onChange,
  secret = false,
}: {
  title: string;
  hint: string;
  rows: Rows;
  onChange: (rows: Rows) => void;
  secret?: boolean;
}) {
  const set = (i: number, at: 0 | 1, value: string) =>
    onChange(rows.map((r, j) => (j === i ? (at === 0 ? [value, r[1]] : [r[0], value]) : r)));
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      <p className="mb-2 text-xs text-zinc-500">{hint}</p>
      <div className="space-y-1">
        {rows.map(([key, value], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a chave pode estar sendo digitada, o índice é a identidade da linha
          <div key={i} className="flex gap-1">
            <input
              value={key}
              onChange={(e) => set(i, 0, e.target.value)}
              placeholder="nome"
              // biome-ignore lint/a11y/noAutofocus: foco na linha que a pessoa acabou de criar com "+ Adicionar"
              autoFocus={key === "" && i === rows.length - 1}
              aria-label="Nome"
              className={`${inputClass} w-2/5 shrink-0`}
            />
            <input
              value={value}
              type={secret ? "password" : "text"}
              autoComplete="off"
              onChange={(e) => set(i, 1, e.target.value)}
              placeholder="valor"
              aria-label={`Valor de ${key || "nova variável"}`}
              className={`${inputClass} w-full`}
            />
            <Button
              variant="ghost"
              aria-label={`Remover ${key}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="mt-1" onClick={() => onChange([...rows, ["", ""]])}>
        + Adicionar
      </Button>
    </section>
  );
}

function AuthDialog({
  open,
  onClose,
  ws,
  suggested,
}: {
  open: boolean;
  onClose: () => void;
  ws: Workspace;
  suggested: Auth;
}) {
  const save = useClient((s) => s.saveWorkspace);
  const error = useClient((s) => s.wsError);
  const [auth, setAuth] = useState<Auth>(ws.auth);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    // Sem auth configurada, começa pelo que a spec declara (securitySchemes).
    if (open) setAuth(ws.auth.type === "none" ? suggested : ws.auth);
  }

  function pick(type: Auth["type"]) {
    if (type === suggested.type) setAuth(suggested);
    else if (type === "bearer") setAuth({ type, token: "" });
    else if (type === "basic") setAuth({ type, username: "", password: "" });
    else if (type === "apikey") setAuth({ type, in: "header", name: "", value: "" });
    else setAuth({ type: "none" });
  }

  const field = (label: string, value: string, onChange: (v: string) => void, secret = false) => (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input
        value={value}
        type={secret ? "password" : "text"}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} w-full`}
      />
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Auth"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (await save({ ...ws, auth })) onClose();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-zinc-500">
        Vale para todas as operações, menos as que a spec declara públicas (security: []). Fica só
        nesta máquina, em .sworn/local/state.json. Use {"{{nome}}"} para ler um segredo do ambiente
        ativo.
      </p>
      <select
        aria-label="Tipo de auth"
        value={auth.type}
        onChange={(e) => pick(e.target.value as Auth["type"])}
        className={`${inputClass} font-sans`}
      >
        {Object.entries(AUTH_LABEL).map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </select>
      <div className="mt-3 space-y-3">
        {auth.type === "bearer" &&
          field("Token", auth.token, (token) => setAuth({ ...auth, token }), true)}
        {auth.type === "basic" && (
          <>
            {field("Usuário", auth.username, (username) => setAuth({ ...auth, username }))}
            {field("Senha", auth.password, (password) => setAuth({ ...auth, password }), true)}
          </>
        )}
        {auth.type === "apikey" && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Enviar em</span>
              <select
                value={auth.in}
                onChange={(e) => setAuth({ ...auth, in: e.target.value as "header" })}
                className={`${inputClass} font-sans`}
              >
                <option value="header">header</option>
                <option value="query">query</option>
                <option value="cookie">cookie</option>
              </select>
            </label>
            {field("Nome", auth.name, (name) => setAuth({ ...auth, name }))}
            {field("Valor", auth.value, (value) => setAuth({ ...auth, value }), true)}
          </>
        )}
      </div>
      {error && <p className="mt-3 text-rose-600">{error}</p>}
    </Dialog>
  );
}
