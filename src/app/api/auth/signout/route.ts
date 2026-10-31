import { cookies } from "next/headers";
import { handle, sameOrigin, sessionToken } from "@/lib/http";
import { endSession, SESSION_COOKIE } from "@/lib/tenancy";

export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    await endSession(await sessionToken());
    (await cookies()).delete(SESSION_COOKIE);
  });
}
