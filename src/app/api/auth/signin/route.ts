import { body, handle, sameOrigin, setSession } from "@/lib/http";
import { signIn } from "@/lib/tenancy";

export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const { bank, token } = await signIn(await body(req));
    await setSession(token);
    return { code: bank.code };
  });
}
