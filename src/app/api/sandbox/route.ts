import { body, handle, sameOrigin, setSession } from "@/lib/http";
import { createSandbox } from "@/lib/tenancy";

export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const { bank, token } = await createSandbox(String((await body(req)).name ?? ""));
    await setSession(token);
    return { code: bank.code };
  });
}
