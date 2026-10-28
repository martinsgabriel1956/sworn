// Drift acumulado (ROADMAP V2): junta os issues gravados no histórico e diz onde a API diverge
// da spec com frequência. Puro: roda no web/ e pode virar `sworn drift` no terminal.
import type { HistoryEntry } from "./request.js";
import type { Issue } from "./validate.js";

const MAX_ISSUES = 50;

/**
 * Issues como vão para o histórico: índice de array vira "*" (o mesmo campo errado em 200 itens
 * é um problema só) e o resto sai deduplicado e limitado.
 */
export function compactIssues(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>();
  for (const i of issues) {
    const path = i.path.replace(/\/\d+(?=\/|$)/g, "/*");
    const key = `${i.level}|${i.kind}|${path}`;
    if (!seen.has(key)) seen.set(key, { ...i, path });
  }
  return [...seen.values()].slice(0, MAX_ISSUES);
}

export type DriftIssue = Pick<Issue, "level" | "kind" | "path"> & {
  /** Em quantas respostas apareceu. */
  count: number;
  /** Até 3 mensagens diferentes, a mais recente primeiro. */
  messages: string[];
  lastAt: string;
};

export type DriftOp = {
  opId: string;
  method: string;
  path: string;
  /** Respostas conferidas (as gravadas antes do drift existir não contam). */
  checked: number;
  divergent: number;
  issues: DriftIssue[];
};

export type DriftReport = { since?: string; checked: number; ops: DriftOp[] };

/** `history` vem do store, mais recente primeiro. */
export function driftReport(history: HistoryEntry[]): DriftReport {
  const ops = new Map<string, DriftOp & { byKey: Map<string, DriftIssue> }>();
  let checked = 0;
  let since: string | undefined;
  for (const h of history) {
    if (!("status" in h.outcome) || !h.outcome.issues) continue;
    checked++;
    since = h.at;
    const { opId, method, path } = h;
    const op = ops.get(opId) ?? {
      opId,
      method,
      path,
      checked: 0,
      divergent: 0,
      issues: [] as DriftIssue[],
      byKey: new Map(),
    };
    ops.set(opId, op);
    op.checked++;
    if (h.outcome.issues.length > 0) op.divergent++;
    for (const i of h.outcome.issues) {
      const key = `${i.level}|${i.kind}|${i.path}`;
      const found = op.byKey.get(key);
      if (!found) {
        const issue = {
          level: i.level,
          kind: i.kind,
          path: i.path,
          count: 1,
          messages: [i.message],
          lastAt: h.at,
        };
        op.byKey.set(key, issue);
        op.issues.push(issue);
      } else {
        found.count++;
        if (found.messages.length < 3 && !found.messages.includes(i.message))
          found.messages.push(i.message);
      }
    }
  }
  const list = [...ops.values()]
    .filter((o) => o.divergent > 0)
    .map(({ byKey: _, ...o }) => ({
      ...o,
      issues: o.issues.sort(
        (a, b) =>
          Number(a.level === "warning") - Number(b.level === "warning") || b.count - a.count,
      ),
    }))
    .sort((a, b) => b.divergent - a.divergent || a.path.localeCompare(b.path));
  return { since, checked, ops: list };
}

const times = (n: number) => `${n} ${n === 1 ? "vez" : "vezes"}`;
export const checkedLabel = (n: number) =>
  `${n} ${n === 1 ? "resposta conferida" : "respostas conferidas"}`;

/** O relatório para colar em issue, PR ou chat. */
export function driftMarkdown(report: DriftReport, title = "API"): string {
  const lines = [`# Drift: ${title}`, ""];
  if (report.ops.length === 0) {
    lines.push(`Nenhuma divergência em ${checkedLabel(report.checked)}.`);
    return `${lines.join("\n")}\n`;
  }
  const since = report.since ? ` desde ${report.since.slice(0, 10)}` : "";
  lines.push(`${checkedLabel(report.checked)}${since}.`, "");
  for (const op of report.ops) {
    lines.push(
      `## ${op.method.toUpperCase()} ${op.path}`,
      "",
      `Divergiu em ${op.divergent} de ${op.checked} respostas.`,
      "",
    );
    for (const i of op.issues) {
      const where = i.path ? `\`${i.path}\` ` : "";
      lines.push(
        `- **${i.level === "error" ? "erro" : "aviso"}** ${where}${i.messages.join("; ")} (${times(i.count)})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
