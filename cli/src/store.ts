// Arquivos do usuário em .sworn/ (PLANNING §7). Nada é criado só por abrir a doc: as pastas
// aparecem no primeiro save de ambiente, auth ou histórico.
//
//   env/<nome>.json      variáveis, versionadas
//   local/secrets.json   { "<ambiente>": { ... } }, nunca vai para o git
//   local/state.json     { active, auth }
//   local/history.jsonl  uma request por linha
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry, Workspace } from "./core/request.js";

const HISTORY_KEEP = 500;
/** Nome de ambiente vira nome de arquivo: nada de "/" nem "..". */
export const ENV_NAME = /^[\w-][\w.-]*$/;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback; // não existe ou foi editado à mão com erro
  }
}

/** Escreve só se mudou, para não sujar o `git status` com arquivos idênticos. */
async function writeIfChanged(file: string, text: string) {
  const current = await readFile(file, "utf8").catch(() => undefined);
  if (current !== text) await writeFile(file, text);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function createStore(dir: string) {
  const envDir = join(dir, "env");
  const local = join(dir, "local");
  const historyFile = join(local, "history.jsonl");

  async function ensureLocal() {
    await mkdir(local, { recursive: true });
    // "wx": cria só se não existe; o usuário pode ter editado o .gitignore.
    await writeFile(join(dir, ".gitignore"), "local/\n", { flag: "wx" }).catch(() => {});
  }

  return {
    async read(): Promise<Workspace> {
      const envs: Workspace["envs"] = {};
      for (const file of await readdir(envDir).catch(() => [])) {
        const name = file.replace(/\.json$/, "");
        if (name !== file && ENV_NAME.test(name))
          envs[name] = await readJson(join(envDir, file), {});
      }
      const state = await readJson<Partial<Workspace>>(join(local, "state.json"), {});
      return {
        envs,
        secrets: await readJson(join(local, "secrets.json"), {}),
        active: state.active,
        auth: state.auth ?? { type: "none" },
      };
    },

    async write(ws: Workspace) {
      const names = Object.keys(ws.envs);
      const invalid = names.find((n) => !ENV_NAME.test(n));
      if (invalid)
        throw Object.assign(new Error(`nome de ambiente inválido: ${invalid}`), { status: 400 });
      const existing = await readdir(envDir).catch(() => []);
      if (names.length > 0 || existing.length > 0) await mkdir(envDir, { recursive: true });
      for (const [name, vars] of Object.entries(ws.envs)) {
        await writeIfChanged(join(envDir, `${name}.json`), json(vars));
      }
      for (const file of existing) {
        const name = file.replace(/\.json$/, "");
        if (name !== file && !Object.hasOwn(ws.envs, name)) await rm(join(envDir, file));
      }
      await ensureLocal();
      await writeIfChanged(join(local, "secrets.json"), json(ws.secrets));
      await writeIfChanged(join(local, "state.json"), json({ active: ws.active, auth: ws.auth }));
    },

    /** Mais recente primeiro. */
    async history(): Promise<HistoryEntry[]> {
      const text = await readFile(historyFile, "utf8").catch(() => "");
      const entries: HistoryEntry[] = [];
      for (const line of text.split("\n")) {
        try {
          if (line) entries.push(JSON.parse(line));
        } catch {} // linha cortada por um crash no meio da escrita
      }
      return entries.reverse();
    },

    async addHistory(entry: HistoryEntry) {
      await ensureLocal();
      await appendFile(historyFile, `${JSON.stringify(entry)}\n`);
      // ponytail: relê o arquivo inteiro a cada envio para podar; com 500 linhas é instantâneo.
      const lines = (await readFile(historyFile, "utf8")).split("\n").filter(Boolean);
      if (lines.length > HISTORY_KEEP + 100) {
        await writeFile(historyFile, `${lines.slice(-HISTORY_KEEP).join("\n")}\n`);
      }
    },
  };
}

export type Store = ReturnType<typeof createStore>;
