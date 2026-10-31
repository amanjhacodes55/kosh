import { handle, requireSession } from "@/lib/http";
import { actorFor, loadBank } from "@/lib/tenancy";
import { bankInfo, people, userInfo } from "@/lib/views";

export async function GET() {
  return handle(async () => {
    const s = await requireSession();
    const b = await loadBank(s.bankId);
    const actor = actorFor(b, s);
    return { bank: bankInfo(b), user: userInfo(b, actor), kind: s.kind, people: b.sandbox ? people(b) : null };
  });
}
