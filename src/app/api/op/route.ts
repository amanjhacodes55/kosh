import { body, handle, requireSession, sameOrigin } from "@/lib/http";
import { execute } from "@/lib/ops";
import { actorFor, hashPassword, mutateBank } from "@/lib/tenancy";

// Every change to the books goes through here: { op, args } runs one operation from src/lib/ops.ts
// inside a transaction on the bank's document.
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const s = await requireSession();
    const x = await body(req);
    const op = String(x.op ?? "");
    const args = (x.args && typeof x.args === "object" ? x.args : {}) as Record<string, unknown>;
    // passwords are hashed here, outside the transaction, so a retry doesn't hash twice
    if (typeof args.password === "string") {
      if (args.password.length < 8) return Response.json({ error: "Use a password of at least 8 characters." }, { status: 400 });
      args.passwordHash = await hashPassword(args.password);
      delete args.password;
    }
    const { result } = await mutateBank(s.bankId, (b) => execute(b, actorFor(b, s), op, args));
    return result;
  });
}
