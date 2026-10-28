// CodeMirror 6 enxuto: JSON com realce, erro de sintaxe e os issues do validador marcados
// no lugar certo do texto. Sem o basicSetup inteiro.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import type { Issue } from "@core/validate";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { pointerRange } from "./jsonPointer";

// Classes do Tailwind em vez de cores fixas: o realce acompanha o dark mode.
const highlight = HighlightStyle.define([
  { tag: t.propertyName, class: "text-sky-800 dark:text-sky-300" },
  { tag: t.string, class: "text-emerald-700 dark:text-emerald-400" },
  { tag: t.number, class: "text-amber-700 dark:text-amber-400" },
  { tag: [t.bool, t.null], class: "text-violet-700 dark:text-violet-400" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "12px", maxHeight: "28rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 10px" },
});

export function Editor({
  value,
  onChange,
  onSubmit,
  isJson = true,
  readOnly = false,
  placeholder,
  label,
  issues,
}: {
  value: string;
  onChange?: (value: string) => void;
  /** Ctrl/Cmd+Enter dentro do editor. */
  onSubmit?: () => void;
  isJson?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  label: string;
  /** Issues do validador para o texto atual; viram marcações pelo `path` de cada um. */
  issues?: (text: string) => Issue[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  // Callbacks mudam a cada render; o editor lê sempre a versão atual sem ser recriado.
  const callbacks = useRef({ onChange, onSubmit, issues });
  callbacks.current = { onChange, onSubmit, issues };

  // biome-ignore lint/correctness/useExhaustiveDependencies: o valor inicial entra aqui; as mudanças, no efeito de baixo
  useEffect(() => {
    const extensions: Extension[] = [
      // Antes do defaultKeymap, que usa Mod-Enter para inserir linha.
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            callbacks.current.onSubmit?.();
            return true;
          },
        },
      ]),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      bracketMatching(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) callbacks.current.onChange?.(u.state.doc.toString());
      }),
    ];
    if (isJson) {
      const lint = linter(
        (v) => {
          const text = v.state.doc.toString();
          if (text === "") return []; // body vazio é válido: sem body
          const syntax = jsonParseLinter()(v);
          if (syntax.length > 0) return syntax; // JSON quebrado: o erro de sintaxe basta
          const out: Diagnostic[] = [];
          for (const issue of callbacks.current.issues?.(text) ?? []) {
            // Issue sem caminho (status, content-type) aparece na lista, não no texto.
            if (issue.path === "" && issue.kind !== "schema") continue;
            const range = pointerRange(v.state, issue.path);
            if (range) out.push({ ...range, severity: issue.level, message: issue.message });
          }
          return out;
        },
        { delay: 300 },
      );
      extensions.push(json(), lint, lintGutter());
    }
    if (readOnly) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    if (placeholder) extensions.push(placeholderExt(placeholder));
    const v = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({ doc: value, extensions }),
    });
    view.current = v;
    return () => v.destroy();
  }, [isJson, readOnly, placeholder, label]);

  // Valor trocado de fora (outra operação, restaurar do histórico, nova resposta).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={host}
      className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    />
  );
}
