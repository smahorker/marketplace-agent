import type { ReactNode } from "react";
import { PLATFORM } from "./lib";

export function PlatformPill({ platform }: { platform: string }) {
  const p = PLATFORM[platform] ?? { label: platform, pill: "bg-stone-100 text-stone-700" };
  return <span className={`pill ${p.pill}`}>{p.label}</span>;
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
