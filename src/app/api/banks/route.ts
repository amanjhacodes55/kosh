import { body, handle, sameOrigin, setSession } from "@/lib/http";
import { createBank } from "@/lib/tenancy";

export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const { bank, token } = await createBank(await body(req));
    await setSession(token);
    return { code: bank.code };
  });
}
