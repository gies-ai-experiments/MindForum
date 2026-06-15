// Records public/demo.mp4's raw footage: a multi-participant MindForum demo.
//
// Usage:
//   1. npm i --no-save playwright   (if not already present)
//   2. Create a FRESH room:  curl -s -X POST http://localhost:3000/api/room \
//        -H "content-type: application/json" \
//        -d '{"name":"AI Ethics Workshop — Planning","systemPrompt":"...concise, 3 bullets..."}'
//   3. Put the demo doc at /tmp/workshop-outline.md
//   4. ROOM_URL=http://localhost:3000/room/<id> node scripts/record-demo.mjs
//   5. Polish with ffmpeg using the moments printed at the end (trim pre-join load,
//      ~1.3x interaction, ~1.15x AI stream, 1x final hold, fade in/out 0.4/0.7s),
//      then encode: libx264, crf 26, yuv420p, +faststart, no audio → public/demo.mp4
//
// Flow: Marcus + Elena join and Marcus uploads workshop-outline.md (pre-roll,
// not recorded) → Priya's view records: join → welcome modal → message →
// Marcus replies live via SSE → @ai question → streamed AI reply → hold.

import { chromium } from "playwright";
import fs from "node:fs";

const ROOM_URL = process.env.ROOM_URL ?? "http://localhost:3000/room/CHANGE_ME";
const OUT_DIR = "/tmp/mf-demo";
const DOC_PATH = "/tmp/workshop-outline.md";

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const moments = [];
let t0;
const log = (label) => {
  const t = t0 ? Date.now() - t0 : 0;
  moments.push({ t, label });
  console.log(`[${(t / 1000).toFixed(2)}s] ${label}`);
};

async function joinRoom(page, name, email) {
  await page.goto(ROOM_URL, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const nameInput = page.locator('input[placeholder="Your name"]');
  await nameInput.waitFor();
  await nameInput.fill(name);
  await page.locator('input[placeholder="Email"]').fill(email);
  await page.locator('button:has-text("Join")').click();
  await page.locator('textarea[placeholder^="Type a message"]').waitFor({ timeout: 15000 });
  // Welcome/catch-up modal may open on join
  const gotIt = page.locator('button:has-text("Got it")');
  try {
    await gotIt.waitFor({ timeout: 3500 });
    await gotIt.click({ timeout: 20000 });
  } catch {
    /* no modal */
  }
}

const browser = await chromium.launch({ headless: true });

// ---- Pre-roll (not recorded): seed participants + file ----
const ctxMarcus = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const marcus = await ctxMarcus.newPage();
await joinRoom(marcus, "Marcus Webb", "marcus@illinois.edu");
await marcus.locator('button:has-text("Attach")').click();
await marcus.locator('input[type="file"]').setInputFiles(DOC_PATH);
await marcus.locator("text=workshop-outline.md").first().waitFor({ timeout: 20000 });
console.log("pre-roll: Marcus joined + uploaded workshop-outline.md");

const ctxElena = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const elena = await ctxElena.newPage();
await joinRoom(elena, "Elena Ruiz", "elena@illinois.edu");
await elena.close();
console.log("pre-roll: Elena joined");

// ---- Recorded take: Priya's view ----
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
t0 = Date.now();
log("video-start");

await page.goto(ROOM_URL, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
log("join-screen");
await page.waitForTimeout(800);

const nameInput = page.locator('input[placeholder="Your name"]');
await nameInput.click();
await nameInput.pressSequentially("Priya Sharma", { delay: 60 });
const emailInput = page.locator('input[placeholder="Email"]');
await emailInput.click();
await emailInput.pressSequentially("priya@illinois.edu", { delay: 35 });
log("join-filled");
await page.waitForTimeout(400);
await page.locator('button:has-text("Join")').click();
log("join-clicked");

const composer = page.locator('textarea[placeholder^="Type a message"]');
await composer.waitFor({ timeout: 15000 });
log("room-loaded");
// Welcome modal: show it briefly, then dismiss
const gotIt = page.locator('button:has-text("Got it")');
try {
  await gotIt.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1600);
  await gotIt.click({ timeout: 20000 });
  log("catchup-dismissed");
} catch {
  log("no-catchup-modal");
}
// Beat to take in participants sidebar + file in Files panel
await page.waitForTimeout(1700);

// Priya's first message
await composer.click();
await composer.pressSequentially(
  "Kicking off planning for our AI ethics workshop — 90 minutes, undergrads.",
  { delay: 42 }
);
await page.waitForTimeout(300);
await composer.press("Enter");
log("msg1-sent");

// Marcus replies live from his own session — arrives over SSE on camera
await page.waitForTimeout(700);
const marcusComposer = marcus.locator('textarea[placeholder^="Type a message"]');
await marcusComposer.fill("I added the draft outline to Files — structure ideas welcome.");
await marcusComposer.press("Enter");
log("marcus-sent");
await page.waitForTimeout(2000);

// Priya asks the AI
await composer.click();
await composer.pressSequentially(
  "@ai give us three ways we could structure the session.",
  { delay: 55 }
);
await page.waitForTimeout(450);
await composer.press("Enter");
log("ai-sent");

// Detect stream start/end by watching body text growth
const baseline = await page.evaluate(() => document.body.innerText.length);
let streamStarted = false;
let lastLen = baseline;
let stableSince = Date.now();
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  await page.waitForTimeout(400);
  const len = await page.evaluate(() => document.body.innerText.length);
  if (!streamStarted && len > baseline + 40) {
    streamStarted = true;
    log("stream-start");
  }
  if (len !== lastLen) {
    lastLen = len;
    stableSince = Date.now();
  } else if (streamStarted && Date.now() - stableSince > 2500) {
    log("stream-end");
    break;
  }
}
if (!streamStarted) log("stream-timeout");

await page.waitForTimeout(2600);
log("end");

const video = page.video();
await context.close();
await ctxMarcus.close();
await ctxElena.close();
await browser.close();
const path = await video.path();
fs.writeFileSync(`${OUT_DIR}/moments.json`, JSON.stringify(moments, null, 2));
console.log("VIDEO:", path);
