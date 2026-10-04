"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { PLATFORM } from "./lib";

export function PlatformPill({ platform }: { platform: string }) {
  const p = PLATFORM[platform] ?? { label: platform, pill: "bg-stone-100 text-stone-700" };
  // fixed width so Mercari and Craigslist pills match, with the label centred
  return <span className={`pill w-24! shrink-0 ${p.pill}`}>{p.label}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name.replace(/^@/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials}</span>;
}

// In-app confirmation dialog (replaces window.confirm). Usage:
//   const [dialog, ask] = useConfirm();  ...  if (await ask({ title, body, confirm })) {...}  ...  {dialog}
type ConfirmOptions = { title: string; body: ReactNode; confirm: string; danger?: boolean };
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const dialog = state && (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/40 p-4 backdrop-blur-[2px]" onClick={() => close(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl">
        <div className="flex gap-3 p-5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${state.danger ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700"}`}>
            {state.danger ? <TriangleAlert size={18} /> : <Send size={17} />}
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-semibold text-stone-900">{state.title}</h2>
            <div className="mt-1 text-sm text-stone-600">{state.body}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
          {/* for destructive actions focus starts on Cancel, so Enter can't confirm by reflex */}
          <button autoFocus={!!state.danger} className="btn-secondary" onClick={() => close(false)}>Cancel</button>
          <button autoFocus={!state.danger} onClick={() => close(true)}
            className={state.danger ? "btn bg-red-600 text-white shadow-sm hover:bg-red-700" : "btn-primary"}>
            {state.confirm}
          </button>
        </div>
      </div>
    </div>
  );
  return [dialog, ask];
}
