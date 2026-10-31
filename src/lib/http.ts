import { cookies } from "next/headers";
import { BankError } from "./errors";
import { readSession, SESSION_COOKIE, SESSION_HOURS, type Session } from "./tenancy";

/** Runs a handler, turning BankErrors into JSON errors with their status and hiding anything else */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const result = await fn();
    return Response.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof BankError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse(await req.text());
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Refuses requests sent from other sites (on top of the SameSite=Lax cookie) */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {}
  if (host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new BankError(403, "Cross-site request refused.");
}

export async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600 });
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function requireSession(): Promise<Session> {
  const s = await readSession(await sessionToken());
  if (!s) throw new BankError(401, "Your session has ended. Sign in again.");
  return s;
}
