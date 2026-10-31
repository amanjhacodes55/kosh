import { body, handle, requireSession, sameOrigin, sessionToken, setSession } from "@/lib/http";
import { endSession, switchUser } from "@/lib/tenancy";

// Sandboxes only: see the bank as another member of staff, or as a customer in net banking
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const s = await requireSession();
    const x = await body(req);
    const token = await switchUser(s, { kind: x.kind === "customer" ? "customer" : "staff", id: String(x.id ?? "") });
    await endSession(await sessionToken());
    await setSession(token);
    return { kind: x.kind === "customer" ? "customer" : "staff" };
  });
}
