import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type Actor, customer } from "./bank";
import { BankError, fail } from "./errors";
import type { Bank } from "./model";
import { addDays } from "./dates";
import { newBank, SANDBOX_DAYS, seedSandbox } from "./seed";
import { kv, transact } from "./store";

// Banks (tenants), sign-in and sessions.
//
// Keys:
//   banks/<id>            one bank's books (see model.ts)
//   codes/<CODE>          { id }: the 4-letter bank code people sign in with
//   sessions/<sha256>     { bankId, kind, userId, expiresAt }

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "kosh_session";
export const SESSION_HOURS = 12;
export const DEMO_PASSWORD = "kosh@demo";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const bankKey = (id: string) => `banks/${id}`;
const codeKey = (code: string) => `codes/${code}`;
const sessionKey = (token: string) => `sessions/${sha256(token)}`;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await scrypt(pw, salt, 32)).toString("base64")}`;
}

async function checkPassword(pw: string, stored: string) {
  const [, salt, want] = stored.split("$");
  if (!salt || !want) return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"), 32);
  return timingSafeEqual(got, Buffer.from(want, "base64"));
}

export interface Session {
  bankId: string;
  kind: "staff" | "customer";
  userId: string;
  expiresAt: number;
}

async function newSession(s: Omit<Session, "expiresAt">) {
  const token = randomBytes(32).toString("base64url");
  await kv().put(sessionKey(token), { ...s, expiresAt: Date.now() + SESSION_HOURS * 3_600_000 });
  return token;
}

export async function readSession(token: string | undefined) {
  if (!token) return null;
  const s = (await kv().get<Session>(sessionKey(token)))?.value;
  return s && s.expiresAt > Date.now() ? s : null;
}

export async function endSession(token: string | undefined) {
  if (token) await kv().delete(sessionKey(token));
}

export async function loadBank(id: string) {
  const b = (await kv().get<Bank>(bankKey(id)))?.value;
  return b ?? fail("That bank no longer exists.", 404);
}

export async function mutateBank<R>(id: string, fn: (b: Bank) => R) {
  try {
    return await transact<Bank, R>(bankKey(id), fn);
  } catch (e) {
    if ((e as { notFound?: boolean }).notFound) throw new BankError(404, "That bank no longer exists.");
    throw e;
  }
}

/** The person behind a session, as the engine sees them */
export function actorFor(b: Bank, s: Session): Actor {
  if (s.kind === "customer") {
    const c = b.customers.find((x) => x.cif === s.userId);
    if (!c?.netbanking) fail("Your net banking access has been withdrawn.", 401);
    return { id: c!.cif, name: c!.name, role: "customer", cif: c!.cif };
  }
  const u = b.staff.find((x) => x.id === s.userId);
  if (!u?.active) fail("Your user has been disabled.", 401);
  return { id: u!.id, name: u!.name, role: u!.role };
}

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return "K" + Array.from(randomBytes(3), (n) => letters[n % letters.length]).join("");
}

async function claimCode(code: string, id: string) {
  return kv().put(codeKey(code), { id }, null);
}

const today = () => new Date().toISOString().slice(0, 10);

/** A sandbox: the sample bank, five months in, with every role's user. Signs in as the administrator. */
export async function createSandbox(name?: string) {
  const id = randomBytes(8).toString("hex");
  let code = randomCode();
  for (let i = 0; !(await claimCode(code, id)); i++) {
    if (i > 10) fail("Couldn't allocate a bank code; try again.", 503);
    code = randomCode();
  }
  const hash = await hashPassword(DEMO_PASSWORD);
  const b = newBank({ id, code, name: (name ?? "").trim().slice(0, 60) || "Kaveri National Bank", date: addDays(today(), -SANDBOX_DAYS), sandbox: true, adminHash: hash, adminName: "Aman" });
  seedSandbox(b, hash, today());
  await kv().put(bankKey(id), b, null);
  const token = await newSession({ bankId: id, kind: "staff", userId: "U100" });
  return { bank: b, token };
}

/** A real, empty bank with one administrator */
export async function createBank(x: { name?: unknown; code?: unknown; adminName?: unknown; password?: unknown }) {
  const name = String(x.name ?? "").trim().slice(0, 60);
  const code = String(x.code ?? "").trim().toUpperCase();
  const password = String(x.password ?? "");
  if (name.length < 3) fail("Name the bank.");
  if (!/^[A-Z]{4}$/.test(code)) fail("The bank code is 4 letters, as in an IFSC.");
  if (password.length < 10) fail("Use a password of at least 10 characters for the administrator.");
  const id = randomBytes(8).toString("hex");
  if (!(await claimCode(code, id))) fail("That bank code is taken.", 409);
  const b = newBank({ id, code, name, date: today(), sandbox: false, adminHash: await hashPassword(password), adminName: String(x.adminName ?? "").trim() || "Administrator" });
  await kv().put(bankKey(id), b, null);
  const token = await newSession({ bankId: id, kind: "staff", userId: "U100" });
  return { bank: b, token };
}

export async function signIn(x: { code?: unknown; user?: unknown; password?: unknown; kind?: unknown }) {
  const code = String(x.code ?? "").trim().toUpperCase();
  const user = String(x.user ?? "").trim().toLowerCase();
  const password = String(x.password ?? "");
  const wrong = () => fail("Bank code, user ID or password is wrong.", 401);
  const ref = (await kv().get<{ id: string }>(codeKey(code)))?.value;
  if (!ref) return wrong();
  const b = await loadBank(ref.id);
  if (x.kind === "customer") {
    const c = b.customers.find((k) => k.cif === user);
    if (!c?.netbanking || !(await checkPassword(password, c.netbanking.passwordHash))) return wrong();
    return { bank: b, token: await newSession({ bankId: b.id, kind: "customer", userId: c.cif }) };
  }
  const s = b.staff.find((u) => u.username === user && u.active);
  if (!s || !(await checkPassword(password, s.passwordHash))) return wrong();
  await mutateBank(b.id, (bk) => bk.audit.push({ at: Date.now(), date: bk.date, user: s.id, name: s.name, role: s.role, action: "Signed in", detail: "Staff sign-in" }));
  return { bank: b, token: await newSession({ bankId: b.id, kind: "staff", userId: s.id }) };
}

/** Sandboxes only: become another user without a password, to see each role */
export async function switchUser(s: Session, to: { kind: "staff" | "customer"; id: string }) {
  const b = await loadBank(s.bankId);
  if (!b.sandbox) fail("Switching users is only for sandboxes.", 403);
  if (to.kind === "customer") {
    const c = customer(b, to.id);
    if (!c.netbanking) fail("That customer hasn't got net banking.");
  } else if (!b.staff.some((u) => u.id === to.id && u.active)) fail("No such user.");
  return newSession({ bankId: b.id, kind: to.kind, userId: to.id });
}
