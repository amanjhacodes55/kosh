import { handle, requireSession } from "@/lib/http";
import { actorFor, loadBank } from "@/lib/tenancy";
import { view } from "@/lib/views";

export async function GET(req: Request, ctx: RouteContext<"/api/view/[name]">) {
  return handle(async () => {
    const s = await requireSession();
    const b = await loadBank(s.bankId);
    const { name } = await ctx.params;
    return view(b, actorFor(b, s), name, Object.fromEntries(new URL(req.url).searchParams));
  });
}
