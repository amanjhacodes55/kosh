"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useMe } from "@/client/api";
import { allowed, NAV, Shell } from "../shell";
import { Empty, Loading } from "../ui";
import { Admin } from "./admin";
import { Approvals } from "./approvals";
import { AuditTrail } from "./audit";
import { AccountPage, CustomerPage, Customers } from "./customers";
import { Dashboard } from "./dashboard";
import { DepositPage, Deposits } from "./deposits";
import { EndOfDay } from "./eod";
import { Ledger } from "./ledger";
import { ApplicationPage, LoanPage, Loans } from "./loans";
import { Rates } from "./rates";
import { Reports } from "./reports";
import { Teller } from "./teller";
import { Treasury } from "./treasury";

export function Console() {
  return (
    <Suspense>
      <Router />
    </Suspense>
  );
}

function Router() {
  const me = useMe();
  const router = useRouter();
  const parts = usePathname().replace(/^\/app\/?/, "").split("/").filter(Boolean);
  const q = useSearchParams();
  useEffect(() => {
    if (me === null) router.replace("/signin");
    else if (me?.kind === "customer") router.replace("/netbanking");
  }, [me, router]);
  if (!me || me.kind !== "staff") return <div className="p-8"><Loading /></div>;
  const [page = "", id] = parts;
  const role = me.user.role;
  const nav = NAV.find((n) => n.path === page);
  let body;
  if (nav && !allowed(role, nav.roles)) body = <Empty>That screen isn&apos;t part of your role.</Empty>;
  else if (page === "") body = <Dashboard me={me} />;
  else if (page === "customers") body = id ? <CustomerPage cif={id} me={me} /> : <Customers me={me} q={q.get("q") ?? ""} />;
  else if (page === "accounts" && id) body = <AccountPage id={id} me={me} />;
  else if (page === "teller") body = <Teller me={me} />;
  else if (page === "deposits") body = id ? <DepositPage id={id} me={me} /> : <Deposits me={me} />;
  else if (page === "loans") body = id ? <LoanPage id={id} me={me} /> : <Loans me={me} />;
  else if (page === "applications" && id) body = <ApplicationPage id={id} me={me} />;
  else if (page === "approvals") body = <Approvals me={me} />;
  else if (page === "treasury") body = <Treasury me={me} />;
  else if (page === "rates") body = <Rates me={me} />;
  else if (page === "ledger") body = <Ledger />;
  else if (page === "reports") body = <Reports />;
  else if (page === "eod") body = <EndOfDay me={me} />;
  else if (page === "audit") body = <AuditTrail />;
  else if (page === "admin") body = <Admin />;
  else body = <Empty>Nothing here.</Empty>;
  return <Shell me={me}>{body}</Shell>;
}
