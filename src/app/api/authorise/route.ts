import { body, handle, requireSession, sameOrigin } from "@/lib/http";
import { authorise } from "@/lib/ops";
import { actorFor, mutateBank } from "@/lib/tenancy";

export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const s = await requireSession();
    const x = await body(req);
    const { result } = await mutateBank(s.bankId, (b) => authorise(b, actorFor(b, s), { id: String(x.id ?? ""), approve: Boolean(x.approve), note: String(x.note ?? "") }));
    return { status: result.approval.status };
  });
}
