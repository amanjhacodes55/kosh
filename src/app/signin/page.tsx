"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/client/api";
import { SandboxButton } from "@/components/site";
import { Field, Logo, Tabs } from "@/components/ui";

export default function SignIn() {
  const router = useRouter();
  const [tab, setTab] = useState<"staff" | "customer" | "new">("staff");
  const [f, setF] = useState({ code: "", user: "", password: "", name: "", adminName: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "new") await call("/api/banks", "POST", { name: f.name, code: f.code, adminName: f.adminName, password: f.password });
      else await call("/api/auth/signin", "POST", { code: f.code, user: f.user, password: f.password, kind: tab });
      router.push(tab === "customer" ? "/netbanking" : "/app");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="bg-grid grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={34} />
          <span className="text-xl font-semibold tracking-tight">Kosh</span>
        </Link>
        <div className="card pop p-6" style={{ boxShadow: "var(--shadow)" }}>
          <div className="flex justify-center">
            <Tabs value={tab} onChange={(t) => (setTab(t), setError(""))} items={[{ value: "staff", label: "Staff" }, { value: "customer", label: "Net banking" }, { value: "new", label: "New bank" }]} />
          </div>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            {tab === "new" && (
              <>
                <Field label="Bank name"><input className="input" value={f.name} onChange={set("name")} required /></Field>
                <Field label="Your name (administrator)"><input className="input" value={f.adminName} onChange={set("adminName")} /></Field>
              </>
            )}
            <Field label="Bank code" hint={tab === "new" ? "4 letters; it starts every IFSC, as in ABCD0000001" : undefined}>
              <input id="code" className="input font-mono uppercase" value={f.code} onChange={set("code")} maxLength={4} required />
            </Field>
            {tab !== "new" && (
              <Field label={tab === "customer" ? "Customer ID (CIF)" : "User ID"}>
                <input id="user" className="input" value={f.user} onChange={set("user")} required />
              </Field>
            )}
            <Field label={tab === "new" ? "Administrator password" : "Password"} hint={tab === "new" ? "At least 10 characters. You sign in as user admin." : undefined}>
              <input id="password" className="input" type="password" value={f.password} onChange={set("password")} required />
            </Field>
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button id="signin" className="btn btn-primary h-11 w-full" disabled={busy}>{busy ? "One moment…" : tab === "new" ? "Create the bank" : "Sign in"}</button>
          </form>
          <p className="mt-5 text-center text-xs text-muted">Sandbox banks: every user&apos;s password is <span className="font-mono">kosh@demo</span>.</p>
        </div>
        <div className="mt-6 flex justify-center"><SandboxButton id="sandbox-signin" /></div>
      </div>
    </main>
  );
}
