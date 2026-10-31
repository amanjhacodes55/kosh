// Records the Kosh walkthrough in the running app, one browser per desk: the administrator opens a
// sandbox bank; a customer service officer onboards a customer; the teller takes cash and a
// withdrawal over limit that the branch manager authorises; a fixed deposit; the credit desk
// appraises a home loan that needs the manager's sanction; the treasury dealer lends call money and
// enters an RBI repo cut; end of day runs two months and a loan turns NPA; a customer uses net
// banking; the auditor reads the ledger and the audit trail. Narrated by Kokoro, with small captions.
//
//   1. npm run build && npx next start -p 3031   (a fresh server)
//   2. node docs/video/demo.mjs   (TTS_PYTHON / VOICE optional, see tts.py; LIVE_URL for the outro)
//
// Output: docs/media/kosh-demo.mp4 (captions burned in); the .srt goes to build/.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, newContext, pointer, sleep, startRecording } from "./rec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build");
const MEDIA = path.join(HERE, "../media");
const LEAD = 0.35; // beat starts, then the voice comes in
const TAIL = 0.6; // breathing room after a line before the next beat
const PYTHON = process.env.TTS_PYTHON || path.join(process.env.HOME, ".local/share/kokoro-tts/venv/bin/python");
const VOICE = process.env.VOICE || "af_heart";
const LIVE = process.env.LIVE_URL || "Try a sandbox bank: every role, no sign-up";
fs.mkdirSync(path.join(BUILD, "voice"), { recursive: true });

function voice(text, caption = text) {
  const key = crypto.createHash("sha1").update(`${VOICE}\n${text}`).digest("hex").slice(0, 12);
  const file = path.join(BUILD, "voice", key + ".wav");
  if (!fs.existsSync(file)) execFileSync(PYTHON, [path.join(HERE, "tts.py"), file], { input: text, env: { ...process.env, VOICE }, stdio: ["pipe", "ignore", "inherit"] });
  return { file, seconds: probe(file), cues: cues(caption, file) };
}
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// ---------------------------------------------------------------------------------------------
// Captions: one short line at a time, each break snapped to the pause the voice takes there.

const MAX_CHARS = 44;

function phrases(text) {
  const parts = text.match(/[^,.:;!?]+[,.:;!?]*\s*/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (last && !/[.:;!?]$/.test(last) && last.length + 1 + p.length <= MAX_CHARS) out[out.length - 1] = `${last} ${p}`;
    else if (p.length <= MAX_CHARS) out.push(p);
    else out.push(...split(p));
  }
  return out;
}

const JOIN = new Set(["and", "or", "but", "so", "with", "to", "that", "for", "in", "on", "all", "then"]);
const STICKY = new Set(["a", "an", "the", "to", "of", "your", "its", "their"]);
function split(p) {
  if (p.length <= MAX_CHARS) return [p];
  const w = p.split(" ");
  let best = 1, score = Infinity;
  for (let i = 1; i < w.length; i++) {
    const left = w.slice(0, i).join(" "), right = w.slice(i).join(" ");
    let sc = Math.abs(left.length - right.length) + 20 * (Math.max(left.length, right.length) > MAX_CHARS);
    if (JOIN.has(w[i].toLowerCase())) sc -= 12;
    if (STICKY.has(w[i - 1].toLowerCase())) sc += 40;
    if (sc < score) { score = sc; best = i; }
  }
  return [...split(w.slice(0, best).join(" ")), ...split(w.slice(best).join(" "))];
}

function pauses(file) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=n=-38dB:d=0.12", "-f", "null", "-"]).stderr.toString();
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ s, e: ends[i] ?? s })).filter((p) => p.e > p.s);
}

function cues(text, file) {
  const lines = phrases(text);
  const total = probe(file);
  const gaps = pauses(file);
  const chars = lines.reduce((n, l) => n + l.length, 0);
  let acc = 0, start = 0;
  return lines.map((line, i) => {
    acc += line.length;
    let end = i === lines.length - 1 ? total : (acc / chars) * total;
    if (i < lines.length - 1) {
      const near = gaps.filter((g) => Math.abs((g.s + g.e) / 2 - end) < 0.7).sort((a, b) => Math.abs((a.s + a.e) / 2 - end) - Math.abs((b.s + b.e) / 2 - end))[0];
      if (near) end = near.s + 0.05;
    }
    const cue = { line, start, end };
    start = end;
    return cue;
  });
}

// ---------------------------------------------------------------------------------------------
// One browser per desk, each signed in as that person. The administrator opens the sandbox on
// camera; the others sign in to it off camera. Net banking is filmed in the light theme.

const browser = await launch();
async function desk(colorScheme = "dark") {
  const ctx = await newContext(browser, { colorScheme, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn("[page]", e.message));
  return page;
}
const admin = await desk();
await admin.goto(BASE);
await admin.waitForLoadState("networkidle");

const card = await (await newContext(browser)).newPage();
const icon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(HERE, "../../src/app/icon.svg")).toString("base64")}`;
await card.setContent(fs.readFileSync(path.join(HERE, "outro.html"), "utf8").replace("{{LIVE}}", LIVE).replace("{{ICON}}", icon), { waitUntil: "networkidle" });

const pages = {};
const ptr = {};
async function signIn(key, user, kind = "staff", scheme = "dark") {
  const code = (await (await admin.request.get(`${BASE}/api/me`)).json()).bank.code;
  const page = await desk(scheme);
  const r = await page.request.post(`${BASE}/api/auth/signin`, { data: { code, user, password: "kosh@demo", kind } });
  if (!r.ok()) throw new Error(`${user}: ${await r.text()}`);
  pages[key] = page;
  ptr[key] = pointer(page);
}
const open = async (key, url) => {
  await pages[key].goto(`${BASE}${url}`);
  await pages[key].waitForLoadState("networkidle");
  await sleep(500);
};
const A = pointer(admin);
const side = (page, name) => page.locator("aside").getByRole("link", { name });
const toast = (page, re) => page.locator("[role=status]").filter({ hasText: re }).first().waitFor({ timeout: 20000 });
async function typeInto(P, page, sel, text, cps = 14) {
  await P.click(page.locator(sel));
  await page.keyboard.press("ControlOrMeta+a");
  await P.type(text, { cps });
}

const beats = [
  { page: admin, text: "This is Kosh, an open-source core banking system for Indian banks: customers and KYC, deposits, loans, the treasury desk and a double-entry general ledger, in one web app.", run: async () => {
    await sleep(1800);
    await A.hover(admin.locator("#sandbox"));
    await sleep(800);
    await A.scroll(620, 1600);
    await sleep(2600);
    await A.scroll(-620, 1400);
    await sleep(600);
  } },
  { page: admin, text: "Aman, the administrator, opens a sandbox: a sample bank, five months into business. Every figure on his dashboard comes from the ledger: deposits, advances, NPAs, and the bank's CRR and SLR position.", run: async () => {
    await A.click(admin.locator("#sandbox"));
    await admin.waitForURL("**/app");
    await admin.getByText("Total deposits").waitFor();
    await sleep(1500);
    await A.hover(admin.getByText("Total deposits"));
    await sleep(900);
    await A.hover(admin.getByText("Gross NPA"));
    await sleep(900);
    await A.hover(admin.getByText("Reserve requirements"));
    await sleep(1200);
    await A.hover(admin.locator("svg[role=img]"), { dx: 0.7 });
    await sleep(800);
  } },
  { page: null, key: "officer", prep: async () => {
    for (const [k, u] of [["officer", "pnair"], ["teller", "skumar"], ["manager", "rmehta"], ["credit", "fsheikh"], ["dealer", "viyer"], ["auditor", "ldsouza"]]) await signIn(k, u);
    await signIn("customer", "10000001", "customer", "light");
    await open("officer", "/app/customers");
  }, text: "Priya, a customer service officer, onboards a new customer. Each customer gets one CIF, shared by every account, deposit and loan, with PAN and Aadhaar checks and an anti-money-laundering risk category.", run: async () => {
    const p = pages.officer, P = ptr.officer;
    await P.click(p.locator("#new-customer"));
    await sleep(400);
    await typeInto(P, p, "#c-name", "Rohit Bansal", 20);
    await P.click(p.locator("#c-dob"));
    await p.fill("#c-dob", "1989-03-14");
    await typeInto(P, p, "#c-pan", "BXRPB4417K", 18);
    await typeInto(P, p, "#c-aadhaar", "583921476120", 26);
    await typeInto(P, p, "#c-mobile", "9811204477", 26);
    await typeInto(P, p, "#c-email", "rohit.bansal@example.in", 36);
    await typeInto(P, p, "#c-occupation", "Salaried: civil engineer", 36);
    await typeInto(P, p, "#c-income", "185000", 16);
    await sleep(300);
    await P.click(p.locator("#submit"));
    await p.waitForURL(/\/app\/customers\/\d+/);
    await sleep(900);
  } },
  { key: "officer", text: "Once KYC is verified, she opens a savings account. Interest is worked out on the daily balance and credited at the end of every quarter.", run: async () => {
    const p = pages.officer, P = ptr.officer;
    await P.click(p.locator("#verify-kyc"));
    await p.locator("#open-account").waitFor();
    await sleep(700);
    await P.click(p.locator("#open-account"));
    await sleep(400);
    await P.click(p.locator("#type-SB"));
    await P.click(p.getByPlaceholder("Name and relationship"));
    await P.type("Neha Bansal, spouse", { cps: 18 });
    await P.click(p.locator("#submit"));
    await p.locator("tbody tr").first().waitFor();
    await sleep(1200);
  } },
  { key: "teller", prep: () => open("teller", "/app/teller"), text: "At the counter, Sanjay the teller takes a cash deposit of four and a half lakh. Cash of fifty thousand or more needs PAN, and every posting is a balanced voucher in the ledger.", run: async () => {
    const p = pages.teller, P = ptr.teller;
    await P.click(p.locator("#teller-search"));
    await P.type("Rohit", { cps: 10 });
    await sleep(300);
    await P.click(p.locator("[data-account]").first());
    await sleep(500);
    await P.click(p.locator("#t-deposit"));
    await sleep(300);
    await P.type("450000", { cps: 9 });
    await sleep(900);
    await P.click(p.locator("#submit"));
    await toast(p, /deposited/);
    await sleep(1600);
  } },
  { key: "teller", text: "Kabir wants three lakh in cash. That's over a teller's two-lakh limit, so it doesn't post. It waits for a second person to authorise it.", run: async () => {
    const p = pages.teller, P = ptr.teller;
    await P.click(p.locator("#teller-search"));
    await p.keyboard.press("ControlOrMeta+a");
    await P.type("Kabir", { cps: 10 });
    await P.click(p.locator("[data-account]").first());
    await sleep(400);
    await P.click(p.locator("#t-withdraw"));
    await sleep(300);
    await P.type("300000", { cps: 9 });
    await sleep(500);
    await P.click(p.locator("#submit"));
    await toast(p, /authorisation/);
    await sleep(2200);
  } },
  { key: "manager", prep: () => open("manager", "/app/approvals"), text: "Rohan, the branch manager, finds it in his authorisation queue. Maker and checker are always different people, and the audit trail keeps both names.", run: async () => {
    const p = pages.manager, P = ptr.manager;
    await sleep(800);
    await P.hover(p.locator("[data-approval]").first(), { dx: 0.3 });
    await sleep(1600);
    await P.click(p.locator("[data-authorise]").first());
    await toast(p, /authorised/);
    await sleep(1800);
  } },
  { key: "officer", prep: () => pages.officer.reload().then(() => sleep(1200)), text: "Back with Priya: Rohit puts two lakh into a fixed deposit for two years. The card rate applies, with half a percent more for senior citizens, and the maturity value is worked out as she types.", run: async () => {
    const p = pages.officer, P = ptr.officer;
    await P.click(p.locator("#open-fd"));
    await sleep(300);
    await P.type("200000", { cps: 9 });
    await P.click(p.locator("#fd-tenure"));
    await p.selectOption("#fd-tenure", "24m");
    await sleep(500);
    await P.hover(p.getByText("Maturity value"));
    await sleep(2200);
    await P.click(p.locator("#submit"));
    await toast(p, /Fixed deposit opened/);
    await sleep(1500);
  } },
  { key: "credit", prep: () => open("credit", "/app/loans"), text: "On the credit desk, Farah appraises Divya's home loan. The credit report, FOIR and loan-to-value are checked against the product's rules.", run: async () => {
    const p = pages.credit, P = ptr.credit;
    await sleep(600);
    await P.click(p.locator("[data-app]", { hasText: "Divya" }));
    await p.locator("#appraise").waitFor();
    await sleep(800);
    await P.click(p.locator("#appraise"));
    await p.getByText("Recommendation:").waitFor();
    await sleep(700);
    await P.hover(p.getByText("Credit score").first());
    await sleep(900);
    await P.hover(p.getByText("Loan to value").last());
    await sleep(1400);
  } },
  { key: "credit", text: "At eighty-five lakh, it's above her sanction limit, so the sanction goes to the branch manager instead of straight through.", run: async () => {
    const p = pages.credit, P = ptr.credit;
    await P.hover(p.getByText(/goes to the branch manager/));
    await sleep(1200);
    await P.click(p.locator("#sanction"));
    await sleep(500);
    await P.click(p.locator("#submit"));
    await toast(p, /authorisation/);
    await sleep(1800);
  } },
  { key: "manager", prep: () => pages.manager.reload().then(() => sleep(1200)), text: "Rohan reviews the appraisal and authorises the sanction.", run: async () => {
    const p = pages.manager, P = ptr.manager;
    await P.hover(p.locator("[data-approval]").first(), { dx: 0.3 });
    await sleep(900);
    await P.click(p.locator("[data-authorise]").first());
    await toast(p, /authorised/);
    await sleep(1200);
  } },
  { key: "credit", prep: () => pages.credit.reload().then(() => sleep(1200)), text: "Farah disburses it into Divya's account, net of the processing fee and GST, and the EMI schedule is set on the repo-linked rate.", run: async () => {
    const p = pages.credit, P = ptr.credit;
    await P.click(p.locator("#disburse"));
    await sleep(700);
    await P.click(p.locator("#submit"));
    await toast(p, /disbursed/);
    await sleep(500);
    await P.click(p.getByRole("button", { name: "View loan" }));
    await p.getByText("Repayment schedule").waitFor();
    await sleep(1000);
    await P.hover(p.getByText("Repayment schedule"));
    await P.scroll(260, 1200);
    await sleep(1200);
  } },
  { key: "dealer", prep: () => open("dealer", "/app/treasury"), text: "Vikram, the treasury dealer, watches the reserve position. CRR and SLR are worked out on net demand and time liabilities, straight from the ledger.", run: async () => {
    const p = pages.dealer, P = ptr.dealer;
    await sleep(700);
    await P.hover(p.getByText(/Cash reserve ratio/));
    await sleep(1500);
    await P.hover(p.getByText(/Statutory liquidity ratio/));
    await sleep(1500);
    await P.hover(p.getByText("NDTL", { exact: true }));
    await sleep(1500);
  } },
  { key: "dealer", text: "There's a surplus with the RBI this morning, so he lends six crore overnight in the call money market, inside the prudential limit of half the bank's capital funds.", run: async () => {
    const p = pages.dealer, P = ptr.dealer;
    await P.click(p.locator("#deal-lend"));
    await sleep(300);
    await typeInto(P, p, "#deal-amount", "60000000", 9);
    await typeInto(P, p, "#deal-rate", "5.55", 6);
    await sleep(400);
    await P.hover(p.getByText(/receivable at maturity/));
    await sleep(1400);
    await P.click(p.locator("#submit"));
    await toast(p, /Lent/);
    await sleep(600);
    await P.hover(p.getByText("Call money limits"));
    await sleep(1600);
  } },
  { key: "dealer", text: "When the RBI cuts the repo rate, he enters the new policy rates, and every floating-rate loan reprices at once.", run: async () => {
    const p = pages.dealer, P = ptr.dealer;
    await P.click(p.locator("#policy-rates"));
    await sleep(400);
    await typeInto(P, p, "#p-repo", "5.25", 6);
    await typeInto(P, p, "#p-sdf", "5", 6);
    await typeInto(P, p, "#p-msf", "5.5", 6);
    await sleep(300);
    await P.click(p.locator("#submit"));
    await toast(p, /repriced/);
    await sleep(2200);
  } },
  { key: "manager", prep: () => open("manager", "/app/eod"), text: "At close of business, end of day runs the batch: EMIs collected by NACH, interest accrued, deposits matured, loans classified. Here it runs a whole quarter in one go.", run: async () => {
    const p = pages.manager, P = ptr.manager;
    await sleep(600);
    await P.click(p.locator("#eod-days"));
    await p.selectOption("#eod-days", "92");
    await sleep(400);
    await P.click(p.locator("#run-eod"));
    await toast(p, /days closed/);
    await sleep(800);
    await P.hover(p.getByText("Recent runs"));
    await sleep(600);
    await P.hover(p.getByText("Asset classification").first(), { dx: 1.6 });
    await sleep(1800);
  } },
  { key: "manager", text: "A quarter on, Imran has stopped paying, and his loan is more than ninety days overdue. It's now a non-performing asset: unpaid interest moves to suspense, and the provision goes up.", run: async () => {
    const p = pages.manager, P = ptr.manager;
    await P.click(side(p, "Regulatory reports"));
    await p.getByText("Imran Qureshi").waitFor();
    await sleep(800);
    await P.hover(p.locator("tr", { hasText: "Imran Qureshi" }), { dx: 0.45 });
    await sleep(2400);
    await P.hover(p.locator("tr", { hasText: "Imran Qureshi" }), { dx: 0.95 });
    await sleep(1500);
  } },
  { key: "customer", prep: () => open("customer", "/netbanking"), text: "Customers bank online too. Ananya opens a fixed deposit herself, and sees the rate and maturity value before she confirms.", run: async () => {
    const p = pages.customer, P = ptr.customer;
    await sleep(900);
    await P.click(p.locator("#nb-fd"));
    await sleep(300);
    await P.type("100000", { cps: 9 });
    await P.click(p.locator("#fd-tenure"));
    await p.selectOption("#fd-tenure", "12m");
    await sleep(1200);
    await P.click(p.locator("#submit"));
    await toast(p, /Fixed deposit opened/);
    await sleep(800);
    await P.hover(p.getByText("Deposits", { exact: true }));
    await sleep(1000);
  } },
  { key: "auditor", prep: () => open("auditor", "/app/ledger"), text: "Leena, the auditor, has read-only access to the books. The balance sheet, profit and loss and trial balance come straight from the double-entry ledger.", run: async () => {
    const p = pages.auditor, P = ptr.auditor;
    await sleep(800);
    await P.hover(p.getByText("Capital and liabilities"));
    await sleep(1200);
    await P.click(p.getByRole("tab", { name: "Trial balance" }));
    await sleep(800);
    await P.scroll(900, 1800);
    await sleep(600);
    await P.hover(p.getByText("Balanced", { exact: true }));
    await sleep(1400);
  } },
  { key: "auditor", text: "And the audit trail shows who did what, and when: every posting, authorisation, rate change and batch run.", run: async () => {
    const p = pages.auditor, P = ptr.auditor;
    await P.click(side(p, "Audit trail"));
    await p.getByText("Authorised").first().waitFor();
    await sleep(1000);
    await P.hover(p.getByText("Policy rates updated").first());
    await sleep(1500);
    await P.scroll(500, 1600);
    await sleep(800);
  } },
  { page: card, text: "Kosh is free and open source, under the MIT license. One installation can serve many banks, each with its own books. Try a sandbox, or run your own.", run: async () => {
    await card.evaluate(() => document.body.classList.add("in"));
  } },
];
for (const b of beats) if (!b.page) Object.defineProperty(b, "page", { get: () => pages[b.key] });

// ---------------------------------------------------------------------------------------------
// Record every beat, then lay the voice and captions over the joined clips.

const only = process.env.ONLY ? Number(process.env.ONLY) : null;
const clips = [];
for (const [i, b] of beats.entries()) {
  if (only !== null && i > only) break;
  const vo = voice(b.say ?? b.text, b.text);
  const want = LEAD + vo.seconds + TAIL;
  if (b.prep) await b.prep();
  await b.page.bringToFront();
  const rec = await startRecording(b.page);
  const started = Date.now();
  await b.run().catch(async (e) => {
    await b.page.screenshot({ path: path.join(BUILD, `failed-beat${i}.png`) });
    throw e;
  });
  const left = want - (Date.now() - started) / 1000;
  if (left > 0) await sleep(left * 1000);
  const out = path.join(BUILD, `beat${String(i).padStart(2, "0")}.mp4`);
  await rec.stop(out);
  clips.push({ out, vo, text: b.text, seconds: probe(out) });
  console.log(`beat ${i}: ${clips.at(-1).seconds.toFixed(1)}s (voice ${vo.seconds.toFixed(1)}s)`);
}
await browser.close();

const list = path.join(BUILD, "clips.txt");
fs.writeFileSync(list, clips.map((c) => `file '${c.out}'`).join("\n"));
const total = clips.reduce((s, c) => s + c.seconds, 0);
const args = ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
const graph = [];
let t = 0, srt = "", n = 0;
const ass = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Cap,Noto Sans,34,&H00FFFFFF,&H00FFFFFF,&H5A16131F,&H00000000,0,0,0,0,100,100,0.3,0,3,9,0,2,40,40,46,1",
  "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
const stamp = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace(".", ",");
const assStamp = (s) => { const d = new Date(s * 1000).toISOString(); return `${Number(d.slice(11, 13))}${d.slice(13, 22)}`; };
clips.forEach((c, i) => {
  args.push("-i", c.vo.file);
  graph.push(`[${i + 1}:a]aresample=48000,adelay=${Math.round((t + LEAD) * 1000)}:all=1[a${i}]`);
  for (const q of c.vo.cues) {
    const a = t + LEAD + q.start, b = t + LEAD + q.end + (q === c.vo.cues.at(-1) ? 0.25 : -0.02);
    srt += `${++n}\n${stamp(a)} --> ${stamp(b)}\n${q.line}\n\n`;
    ass.push(`Dialogue: 0,${assStamp(a)},${assStamp(b)},Cap,,0,0,0,,{\\fad(120,120)}${q.line}`);
  }
  t += c.seconds;
});
const assFile = path.join(BUILD, "captions.ass");
fs.writeFileSync(assFile, ass.join("\n") + "\n");

graph.push(`${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,`
  + `highpass=f=70,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=6500:t=q:w=1.5:g=-2,`
  + `acompressor=threshold=-20dB:ratio=2.5:attack=8:release=180,aformat=channel_layouts=stereo,`
  + `loudnorm=I=-16:TP=-1.5,aresample=48000,apad,atrim=0:${total.toFixed(3)}[a]`);
graph.push(`[0:v]ass='${assFile.replace(/'/g, "\\'")}',fade=t=in:d=0.5,fade=t=out:st=${(total - 0.9).toFixed(3)}:d=0.9[v]`);
const out = path.join(only !== null ? BUILD : MEDIA, "kosh-demo.mp4");
execFileSync("ffmpeg", [...args, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
fs.writeFileSync(path.join(BUILD, "kosh-demo.srt"), srt);
console.log(`done: ${out} (${total.toFixed(1)}s)`);
