// README screenshots from a fresh sandbox: node docs/video/screenshots.mjs (server on BASE, default :3031)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, newContext, sleep } from "./rec.mjs";

const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), "../media");
const browser = await launch();
const ctx = await newContext(browser, { colorScheme: "dark", locale: "en-IN", timezoneId: "Asia/Kolkata" });
const page = await ctx.newPage();
await page.goto(BASE);
await page.click("#sandbox");
await page.waitForURL("**/app");
await page.getByText("Total deposits").waitFor();
await sleep(1500);
const shot = (name) => page.screenshot({ path: path.join(MEDIA, `${name}.jpg`), quality: 88, type: "jpeg" });
await shot("dashboard");
await page.goto(`${BASE}/app/treasury`);
await page.getByText("Dealing blotter").waitFor();
await sleep(1200);
await shot("treasury");
// appraisal is the credit desk's job: sign in as the credit officer in a second browser
const me = await (await page.request.get(`${BASE}/api/me`)).json();
const credit = await (await newContext(browser, { colorScheme: "dark", locale: "en-IN" })).newPage();
await credit.request.post(`${BASE}/api/auth/signin`, { data: { code: me.bank.code, user: "fsheikh", password: "kosh@demo" } });
await credit.goto(`${BASE}/app/loans`);
await credit.locator("[data-app]", { hasText: "Divya" }).click();
await credit.locator("#appraise").click();
await credit.getByText("Recommendation:").waitFor();
await sleep(1000);
await credit.screenshot({ path: path.join(MEDIA, "appraisal.jpg"), quality: 88, type: "jpeg" });
await page.goto(`${BASE}/app/loans`);
await sleep(1500);
await shot("loan-book");
await page.goto(`${BASE}/app/ledger`);
await sleep(1500);
await shot("ledger");
// net banking, in the light theme
const nb = await (await newContext(browser, { colorScheme: "light", locale: "en-IN" })).newPage();
await nb.request.post(`${BASE}/api/auth/signin`, { data: { code: me.bank.code, user: "10000001", password: "kosh@demo", kind: "customer" } });
await nb.goto(`${BASE}/netbanking`);
await nb.getByText("Welcome back,").waitFor();
await sleep(1500);
await nb.screenshot({ path: path.join(MEDIA, "netbanking.jpg"), quality: 88, type: "jpeg" });
await browser.close();
console.log("screenshots written to", MEDIA);
