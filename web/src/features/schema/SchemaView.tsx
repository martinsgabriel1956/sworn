// Visualizador de schema. Cada nível só é resolvido e renderizado quando aberto, o que segura
// schemas enormes e recursivos (o $ref que já está na cadeia de pais vira "recursivo", não expande).
import type { Ref } from "@core/refs";
import { refName, resolve } from "@core/refs";
import {
  constraints,
  hasChildren,
  isNullable,
  mergeAllOf,
  type Schema,
  typeLabel,
} from "@core/schema";
import { useState } from "react";
import { Markdown, Tabs, Tag } from "../../ui";

type Node = Schema | Ref | undefined;

export function SchemaView({ doc, schema }: { doc: unknown; schema: Node }) {
  return (
    <div className="rounded-md border border-zinc-200 text-sm dark:border-zinc-800">
      <p className="border-zinc-200 border-b px-3 py-1.5 font-mono text-xs text-zinc-500 dark:border-zinc-800">
        {typeLabel(doc, schema)}
      </p>
      <Body doc={doc} node={schema} ancestry={[]} depth={0} />
    </div>
  );
}

/** O conteúdo de um schema: propriedades, variantes (oneOf/anyOf) ou os itens de um array. */
function Body({
  doc,
  node,
  ancestry,
  depth,
}: {
  doc: unknown;
  node: Node;
  ancestry: string[];
  depth: number;
}) {
  const { value: raw, ref } = resolve<Schema>(doc, node);
  if (!raw) return <p className="px-3 py-2 text-rose-600">Schema não encontrado: {ref}</p>;
  const chain = ref ? [...ancestry, ref] : ancestry;
  const s = mergeAllOf(doc, raw);

  const variants = (s.oneOf ?? s.anyOf)?.filter(
    (v) => resolve<Schema>(doc, v).value?.type !== "null",
  );
  if (variants && variants.length > 1) {
    return <Variants doc={doc} schema={s} variants={variants} ancestry={chain} depth={depth} />;
  }
  if (variants?.length === 1)
    return <Body doc={doc} node={variants[0]} ancestry={chain} depth={depth} />;

  const props = Object.entries(s.properties ?? {});
  const extra = typeof s.additionalProperties === "object" ? s.additionalProperties : undefined;
  if (props.length === 0 && !extra) {
    if (s.items !== undefined)
      return <Body doc={doc} node={s.items} ancestry={chain} depth={depth} />;
    return <Leaf doc={doc} schema={s} />;
  }
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
      {props.map(([name, p]) => (
        <Property
          key={name}
          doc={doc}
          name={name}
          node={p}
          required={s.required?.includes(name) ?? false}
          ancestry={chain}
          depth={depth}
        />
      ))}
      {extra && (
        <Property
          doc={doc}
          name="[chave]"
          node={extra}
          required={false}
          ancestry={chain}
          depth={depth}
        />
      )}
    </ul>
  );
}

function Property({
  doc,
  name,
  node,
  required,
  ancestry,
  depth,
}: {
  doc: unknown;
  name: string;
  node: Node;
  required: boolean;
  ancestry: string[];
  depth: number;
}) {
  const { value: raw, ref } = resolve<Schema>(doc, node);
  const recursive = ref !== undefined && ancestry.includes(ref);
  const expandable = !recursive && hasChildren(doc, node);
  const [open, setOpen] = useState(depth < 1);
  const s = raw ? mergeAllOf(doc, raw) : undefined;
  const extra = s ? constraints(s) : [];

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="font-medium font-mono hover:underline"
          >
            <span className="mr-1 inline-block w-3 text-zinc-400">{open ? "▾" : "▸"}</span>
            {name}
          </button>
        ) : (
          <span className="font-medium font-mono">
            <span className="mr-1 inline-block w-3" />
            {name}
          </span>
        )}
        <span className="font-mono text-xs text-zinc-500">{typeLabel(doc, node)}</span>
        {required && <Tag tone="rose">obrigatório</Tag>}
        {s && isNullable(doc, s) && <Tag>nullable</Tag>}
        {s?.readOnly && <Tag>só leitura</Tag>}
        {s?.writeOnly && <Tag>só escrita</Tag>}
        {s?.deprecated && <Tag>obsoleto</Tag>}
        {recursive && <Tag>recursivo ↻</Tag>}
      </div>
      <div className="pl-4">
        {s?.description && <Markdown className="mt-1">{s.description}</Markdown>}
        {extra.length > 0 && (
          <p className="mt-1 font-mono text-xs text-zinc-500">{extra.join(" · ")}</p>
        )}
      </div>
      {expandable && open && (
        <div className="mt-2 ml-1.5 border-zinc-200 border-l dark:border-zinc-800">
          <Body doc={doc} node={node} ancestry={ancestry} depth={depth + 1} />
        </div>
      )}
    </li>
  );
}

function Variants({
  doc,
  schema,
  variants,
  ancestry,
  depth,
}: {
  doc: unknown;
  schema: Schema;
  variants: (Schema | Ref)[];
  ancestry: string[];
  depth: number;
}) {
  const [picked, setPicked] = useState(0);
  const active = Math.min(picked, variants.length - 1);
  const mapping = Object.entries(schema.discriminator?.mapping ?? {});
  const label = (v: Schema | Ref, i: number) => {
    const ref = "$ref" in v ? v.$ref : undefined;
    return (
      mapping.find(([, target]) => target === ref)?.[0] ??
      refName(ref) ??
      resolve<Schema>(doc, v).value?.title ??
      `Opção ${i + 1}`
    );
  };
  return (
    <div className="px-3 py-2">
      <p className="mb-2 text-xs text-zinc-500">
        {schema.oneOf ? "Exatamente um destes formatos" : "Um ou mais destes formatos"}
        {schema.discriminator && (
          <>
            , escolhido pelo campo{" "}
            <code className="font-mono">{schema.discriminator.propertyName}</code>
          </>
        )}
      </p>
      <Tabs
        items={variants.map((v, i) => ({ key: String(i), label: label(v, i) }))}
        active={String(active)}
        onChange={(k) => setPicked(Number(k))}
      />
      <div className="mt-2 rounded border border-zinc-200 dark:border-zinc-800">
        <Body doc={doc} node={variants[active]} ancestry={ancestry} depth={depth + 1} />
      </div>
    </div>
  );
}

/** Schema sem filhos (string, número...): tipo, descrição e restrições. */
function Leaf({ doc, schema }: { doc: unknown; schema: Schema }) {
  const extra = constraints(schema);
  return (
    <div className="px-3 py-2">
      <span className="font-mono text-xs">{typeLabel(doc, schema)}</span>
      {isNullable(doc, schema) && (
        <span className="ml-2">
          <Tag>nullable</Tag>
        </span>
      )}
      {schema.description && <Markdown className="mt-1">{schema.description}</Markdown>}
      {extra.length > 0 && (
        <p className="mt-1 font-mono text-xs text-zinc-500">{extra.join(" · ")}</p>
      )}
    </div>
  );
}
