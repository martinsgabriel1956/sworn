// Peças pequenas usadas em mais de uma feature.
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const METHOD_COLOR: Record<string, string> = {
  get: "text-sky-700 dark:text-sky-400",
  post: "text-emerald-700 dark:text-emerald-400",
  put: "text-amber-700 dark:text-amber-400",
  patch: "text-violet-700 dark:text-violet-400",
  delete: "text-rose-700 dark:text-rose-400",
};

export function Method({ method, className = "" }: { method: string; className?: string }) {
  return (
    <span
      className={`font-mono font-semibold uppercase ${METHOD_COLOR[method] ?? "text-zinc-500"} ${className}`}
    >
      {method}
    </span>
  );
}

/** Path com os parâmetros ({petId}) destacados. */
export function PathText({ path }: { path: string }) {
  return (
    <code className="font-mono">
      {path.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith("{") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: partes do path não mudam de ordem
          <span key={i} className="text-amber-700 dark:text-amber-400">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </code>
  );
}

export function statusColor(status: string): string {
  if (status.startsWith("2")) return "text-emerald-700 dark:text-emerald-400";
  if (status.startsWith("3")) return "text-sky-700 dark:text-sky-400";
  if (status.startsWith("4")) return "text-amber-700 dark:text-amber-400";
  if (status.startsWith("5")) return "text-rose-700 dark:text-rose-400";
  return "text-zinc-500";
}

/** Markdown da spec. react-markdown não renderiza HTML cru e bloqueia links javascript:. */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div
      className={`prose prose-sm prose-zinc max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Tag({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "rose" }) {
  const color =
    tone === "rose"
      ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${color}`}>{children}</span>;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: { key: string; label: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={it.key === active}
          onClick={() => onChange(it.key)}
          className={`rounded px-2 py-0.5 font-mono text-xs ${
            it.key === active
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "min-w-0 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950";

const BUTTON = {
  primary:
    "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
  secondary: "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
  ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded px-2.5 py-1 text-xs disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

/** <dialog> nativo: Esc, foco preso e backdrop vêm do browser. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {open && (
        <div className="flex max-h-[80vh] flex-col">
          <h2 className="border-zinc-200 border-b px-5 py-3 font-semibold dark:border-zinc-800">
            {title}
          </h2>
          <div className="overflow-y-auto px-5 py-4 text-sm">{children}</div>
          <div className="flex justify-end gap-2 border-zinc-200 border-t px-5 py-3 dark:border-zinc-800">
            {footer}
          </div>
        </div>
      )}
    </dialog>
  );
}
