"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? `${data.error}${data.issues ? ": " + JSON.stringify(data.issues) : ""}` : `HTTP ${res.status}`);
  return data;
}

export const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

// Loads `path`, and re-loads every 2 s while `busy(data)` is true (UI refresh, not marketplace polling).
export function usePolling<T>(path: string | null, busy: (d: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!data || !busyRef.current(data)) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [data, load]);
  return { data, error, reload: load };
}

export const PLATFORM = {
  mercari: { label: "Mercari", pill: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" },
  craigslist: { label: "Craigslist", pill: "bg-violet-50 text-violet-700 ring-1 ring-violet-200" },
} as Record<string, { label: string; pill: string }>;

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
