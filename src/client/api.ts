"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** JSON in, JSON out, and the server's error message thrown as an Error */
export async function call<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    // the session ended mid-use: a full load of the sign-in page drops everything held for it
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/signin";
  }
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Request failed (${res.status})`), { status: res.status });
  return json as T;
}

// ---------------------------------------------------------------------------------------------
// After any change to the books, every view on screen loads again.

let version = 0;
const listeners = new Set<() => void>();
export function refreshAll() {
  version++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);

/** One screen's data from /api/view/<name>; keeps the last data while reloading */
export function useView<T>(name: string | null, params: Record<string, string | undefined> = {}) {
  const v = useVersion();
  const qs = new URLSearchParams(Object.entries(params).filter(([, x]) => x !== undefined && x !== "") as [string, string][]).toString();
  const path = name ? `/api/view/${name}${qs ? `?${qs}` : ""}` : null;
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string }>({ path: null, data: null, error: "" });
  useEffect(() => {
    if (!path) return;
    let live = true;
    call<T>(path).then(
      (data) => live && setState({ path, data, error: "" }),
      (e) => live && setState((s) => ({ path, data: s.path === path ? s.data : null, error: e.message })),
    );
    return () => {
      live = false;
    };
  }, [path, v]);
  const fresh = state.path === path;
  return { data: fresh ? state.data : null, error: fresh ? state.error : "", loading: !fresh };
}

// ---------------------------------------------------------------------------------------------
// Toasts

export type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const t = { id: Date.now() + Math.random(), text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, kind === "error" ? 6000 : 3800);
}
export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
}

/**
 * Runs an operation. A result over the user's limit comes back as `pending`: it is waiting for a
 * manager. Errors are toasted and rethrown so forms can stay open.
 */
export async function op<T = unknown>(name: string, args: Record<string, unknown>, success?: string): Promise<{ result?: T; pending?: string }> {
  try {
    // the server answers { result } when the operation posted, { pending } when it is queued
    const r = await call<{ result?: T; pending?: string }>("/api/op", "POST", { op: name, args });
    refreshAll();
    if (r.pending) {
      toast(`Sent for authorisation (${r.pending}): it posts once a manager approves it.`, "info");
      return { pending: r.pending };
    }
    if (success) toast(success);
    return { result: r.result };
  } catch (e) {
    toast((e as Error).message, "error");
    throw e;
  }
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

export type Me = {
  bank: { id: string; code: string; name: string; date: string; sandbox: boolean; branches: { code: string; name: string; city: string; ifsc: string }[] };
  user: { id: string; name: string; role: string; roleLabel: string; cif?: string };
  kind: "staff" | "customer";
  people: { staff: { id: string; username: string; name: string; role: string; roleLabel: string }[]; customers: { cif: string; name: string }[] } | null;
};

export function useMe() {
  const v = useVersion();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    call<Me>("/api/me").then(setMe, () => setMe(null));
  }, [v]);
  return me;
}
