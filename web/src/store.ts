// Estado do cliente: workspace (ambientes, segredos, auth), rascunho e última resposta por
// operação, histórico. Os rascunhos vivem só na memória; o histórico guarda o que foi enviado.
import { compactIssues } from "@core/drift";
import type { Vars } from "@core/interpolate";
import type { Draft, HistoryEntry, SendRequest, SendResponse, Workspace } from "@core/request";
import type { Issue } from "@core/validate";
import { create } from "zustand";
import { api } from "./api";

export type Result = { request: SendRequest; response?: SendResponse; error?: string };

type State = {
  ws?: Workspace;
  wsError?: string;
  drafts: Record<string, Draft>;
  results: Record<string, Result>;
  sending?: { opId: string; abort: AbortController };
  history: HistoryEntry[];
  load(): Promise<void>;
  /** false quando o cli recusa; o motivo fica em wsError. */
  saveWorkspace(ws: Workspace): Promise<boolean>;
  setDraft(opId: string, draft: Draft): void;
  /** `check` confere a resposta com a spec; o resultado vai para o histórico (drift). */
  send(
    meta: Omit<HistoryEntry, "at" | "outcome">,
    request: SendRequest,
    check: (res: SendResponse) => Issue[],
  ): Promise<void>;
  cancel(): void;
};

export const useClient = create<State>()((set, get) => ({
  drafts: {},
  results: {},
  history: [],

  async load() {
    const [ws, history] = await Promise.all([
      api<Workspace>("workspace"),
      api<HistoryEntry[]>("history"),
    ]);
    set({ ws, history });
  },

  async saveWorkspace(ws) {
    try {
      set({
        ws: await api<Workspace>("workspace", { method: "PUT", json: ws }),
        wsError: undefined,
      });
      return true;
    } catch (err) {
      set({ wsError: (err as Error).message });
      return false;
    }
  },

  setDraft: (opId, draft) => set((s) => ({ drafts: { ...s.drafts, [opId]: draft } })),

  async send(meta, request, check) {
    get().sending?.abort.abort();
    const abort = new AbortController();
    set({ sending: { opId: meta.opId, abort } });
    let result: Result;
    let outcome: HistoryEntry["outcome"];
    try {
      const response = await api<SendResponse>("send", {
        method: "POST",
        json: request,
        signal: abort.signal,
      });
      result = { request, response };
      outcome = {
        status: response.status,
        timeMs: response.timeMs,
        sizeBytes: response.sizeBytes,
        issues: compactIssues(check(response)),
      };
    } catch (err) {
      const error = abort.signal.aborted ? "Cancelada." : (err as Error).message;
      result = { request, error };
      outcome = { error };
    }
    const entry: HistoryEntry = { ...meta, at: new Date().toISOString(), outcome };
    set((s) => ({
      sending: s.sending?.abort === abort ? undefined : s.sending,
      results: { ...s.results, [meta.opId]: result },
      history: [entry, ...s.history],
    }));
    // Falha ao gravar o histórico não atrapalha quem está testando a API.
    api("history", { method: "POST", json: entry }).catch(() => {});
  },

  cancel: () => get().sending?.abort.abort(),
}));

/** Variáveis do ambiente ativo, com os segredos por cima. */
export const activeVars = (ws?: Workspace): Vars =>
  ws?.active ? { ...ws.envs[ws.active], ...ws.secrets[ws.active] } : {};

/** Como activeVars, mas sem os segredos: eles ficam como {{nome}} (snippets que vão para fora). */
export const publicVars = (ws?: Workspace): Vars => {
  const vars = activeVars(ws);
  for (const name of Object.keys((ws?.active && ws.secrets[ws.active]) || {})) delete vars[name];
  return vars;
};
