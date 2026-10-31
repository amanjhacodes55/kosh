"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/client/api";

/** Creates a sandbox bank and opens it, signed in as its administrator */
export function SandboxButton({ small = false, id }: { small?: boolean; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col items-center">
      <button
        id={id}
        className={`btn btn-primary ${small ? "" : "h-11 px-5"}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await call("/api/sandbox", "POST", {});
            router.push("/app");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
        {busy ? "Opening the bank…" : small ? "Open a sandbox" : "Open a sandbox bank"}
        {!busy && !small && <ArrowRight size={16} />}
      </button>
      {error && <span className="mt-2 text-sm text-danger">{error}</span>}
    </span>
  );
}
