// Carrega a spec, junta os $ref externos num documento só e recarrega quando algum arquivo muda.
import { EventEmitter } from "node:events";
import { type FSWatcher, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import { assertOpenApi3, type OpenApiDoc, type SpecState } from "./core/openapi.js";

/** Não carrega nada até o primeiro reload(). */
export type Spec = {
  get(): SpecState;
  reload(): Promise<SpecState>;
  /** Emite "change" a cada recarga, com sucesso ou erro. */
  events: EventEmitter;
  close(): void;
};

export function loadSpec(input: string): Spec {
  const isUrl = /^https?:\/\//i.test(input);
  const source = isUrl ? input : resolve(input);
  const events = new EventEmitter();
  let state: SpecState = { source, loadedAt: 0 };
  let watchers: FSWatcher[] = [];
  let watched = "";
  let timer: NodeJS.Timeout | undefined;
  let queue = Promise.resolve(state);

  async function load(): Promise<SpecState> {
    const parser = new $RefParser();
    try {
      // bundle, não dereference: $ref interno continua referência (schema recursivo não vira ciclo infinito).
      // safeUrlResolver bloquearia localhost, e ler a spec da API local é o caso mais comum.
      const doc = await parser.bundle(source, { resolve: { http: { safeUrlResolver: false } } });
      assertOpenApi3(doc);
      state = { source, doc: doc as OpenApiDoc, loadedAt: Date.now() };
      if (!isUrl) rewatch(parser.$refs.paths("file"));
    } catch (err) {
      state = {
        ...state,
        error: err instanceof Error ? err.message : String(err),
        loadedAt: Date.now(),
      };
      if (!isUrl && !watched) rewatch([source]);
    }
    events.emit("change", state);
    return state;
  }

  // Observa a pasta, não o arquivo: editores salvam escrevendo outro arquivo e renomeando,
  // e o watch preso ao arquivo antigo para de disparar.
  function rewatch(files: string[]) {
    const key = [...files].sort().join("\n");
    if (key === watched) return;
    watched = key;
    for (const w of watchers) w.close();
    const byDir = Map.groupBy(files, (f) => dirname(f));
    watchers = [...byDir].map(([dir, fs]) => {
      const names = new Set(fs.map((f) => basename(f)));
      return watch(dir, (_event, name) => {
        if (!name || !names.has(name)) return;
        // Um save gera vários eventos; espera assentar.
        clearTimeout(timer);
        timer = setTimeout(reload, 50);
      });
    });
  }

  // Uma recarga por vez, na ordem pedida.
  function reload() {
    queue = queue.then(load);
    return queue;
  }

  return {
    get: () => state,
    reload,
    events,
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
