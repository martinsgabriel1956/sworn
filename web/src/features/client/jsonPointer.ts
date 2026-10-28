// JSON Pointer ("/0/tag") → trecho do texto no editor, pela árvore de sintaxe do JSON.
import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type Node = NonNullable<ReturnType<typeof ensureSyntaxTree>>["topNode"];

const PUNCTUATION = new Set(["[", "]", "{", "}", ",", ":"]);

function keyText(state: EditorState, node: Node) {
  const raw = state.sliceDoc(node.from, node.to);
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

/**
 * Onde marcar: a chave (mais o valor, quando é simples) para um campo de objeto; o `{`/`[`
 * de um elemento de array composto; o valor inteiro nos outros casos.
 */
export function pointerRange(state: EditorState, ptr: string) {
  const tree = ensureSyntaxTree(state, state.doc.length, 500);
  let node: Node | null = tree?.topNode.firstChild ?? null;
  let key: Node | null = null;
  const segments = ptr === "" ? [] : ptr.split("/").slice(1);
  for (const raw of segments) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node?.name === "Object") {
      const prop = node.getChildren("Property").find((p) => {
        const name = p.getChild("PropertyName");
        return name !== null && keyText(state, name) === segment;
      });
      if (!prop) return undefined;
      key = prop.getChild("PropertyName");
      node = prop.lastChild;
    } else if (node?.name === "Array") {
      const items: Node[] = [];
      for (let c = node.firstChild; c; c = c.nextSibling)
        if (!PUNCTUATION.has(c.name)) items.push(c);
      node = items[Number(segment)] ?? null;
      key = null;
    } else {
      return undefined;
    }
  }
  if (!node) return undefined;
  const compound = node.name === "Object" || node.name === "Array";
  if (key) return { from: key.from, to: compound ? key.to : node.to };
  return { from: node.from, to: compound ? node.from + 1 : node.to };
}
