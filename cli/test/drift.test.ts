import { describe, expect, it } from "vitest";
import { compactIssues, driftMarkdown, driftReport } from "../src/core/drift.js";
import type { HistoryEntry } from "../src/core/request.js";
import type { Issue } from "../src/core/validate.js";

const nullEmail = (i: number): Issue => ({
  level: "error",
  kind: "schema",
  path: `/data/${i}/email`,
  message: "esperado string, veio null",
});
const extra: Issue = {
  level: "warning",
  kind: "undocumented-field",
  path: "/data/0/apelido",
  message: "campo não documentado na spec: apelido",
};

let n = 0;
const entry = (opId: string, issues?: Issue[], status = 200): HistoryEntry => ({
  at: `2026-10-${String(28 - n++).padStart(2, "0")}T10:00:00Z`,
  opId,
  method: "get",
  path: opId === "listUsers" ? "/users" : "/pets",
  draft: { params: {}, body: "" },
  outcome: { status, timeMs: 1, sizeBytes: 1, issues },
});

describe("drift", () => {
  it("compacta índices de array e repetições", () => {
    expect(compactIssues([nullEmail(0), nullEmail(1), nullEmail(7), extra])).toEqual([
      { ...nullEmail(0), path: "/data/*/email" },
      { ...extra, path: "/data/*/apelido" },
    ]);
  });

  it("conta divergências por operação e ignora entradas sem conferência", () => {
    n = 0;
    const history = [
      entry("listUsers", compactIssues([nullEmail(0), extra])),
      entry("listUsers", compactIssues([nullEmail(3)])),
      entry("listUsers", []),
      entry("listPets", []),
      entry("listPets", undefined), // gravada antes do drift existir
      { ...entry("listPets"), outcome: { error: "ECONNREFUSED" } },
    ];
    const report = driftReport(history);
    expect(report.checked).toBe(4);
    expect(report.since).toBe(history[3].at);
    expect(report.ops).toEqual([
      {
        opId: "listUsers",
        method: "get",
        path: "/users",
        checked: 3,
        divergent: 2,
        issues: [
          {
            level: "error",
            kind: "schema",
            path: "/data/*/email",
            count: 2,
            messages: ["esperado string, veio null"],
            lastAt: history[0].at,
          },
          expect.objectContaining({ path: "/data/*/apelido", count: 1 }),
        ],
      },
    ]);
    const md = driftMarkdown(report, "Petstore");
    expect(md).toContain("## GET /users");
    expect(md).toContain("Divergiu em 2 de 3 respostas.");
    expect(md).toContain("- **erro** `/data/*/email` esperado string, veio null (2 vezes)");
    expect(driftMarkdown(driftReport([entry("listPets", [])]))).toContain(
      "Nenhuma divergência em 1 resposta conferida.",
    );
  });
});
