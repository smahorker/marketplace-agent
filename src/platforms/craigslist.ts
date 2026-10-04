import nodemailer from "nodemailer";
import { runInBrowser } from "../kernel.ts";
import type { CraigslistListing } from "../listing.ts";

// ---- Inbound: buyer messages arrive as relay emails forwarded into AgentMail ----

export type CraigslistEmail = {
  relayAddress: string; // <hash>@reply.craigslist.org — the thread key and reply-to address
  buyerName: string;
  listingTitle: string; // the email subject — the buyer can change it, so only a fallback
  postSlug: string | null; // "<area>-<title-slug>" from the footer link; also in the posting's own URL
  body: string;
  messageId: string;
};

const FOOTER = /\n?-{5,}[\s\S]*$|\n?Original craigslist post:[\s\S]*$/;

// `msg` is an AgentMail message (from the message.received webhook).
export function parseInbound(msg: { from: string; subject?: string; extracted_text?: string; text?: string; message_id: string }): CraigslistEmail | null {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+@reply\.craigslist\.org)>\s*$/i.exec(msg.from) ?? /()([^\s<>]+@reply\.craigslist\.org)/i.exec(msg.from);
  if (!m) return null;
  const body = (msg.extracted_text ?? msg.text ?? "").replace(FOOTER, "").trim();
  const slug = /craigslist\.org\/view\/d\/([^/\s]+)\//i.exec(msg.text ?? msg.extracted_text ?? "");
  return {
    relayAddress: m[2].toLowerCase(),
    buyerName: m[1].trim() || "Craigslist buyer",
    listingTitle: (msg.subject ?? "").replace(/^\s*re:\s*/i, "").trim(),
    postSlug: slug ? slug[1].toLowerCase() : null,
    body,
    messageId: msg.message_id,
  };
}

// ---- Replies: sent from the seller's own Gmail (AgentMail sends were rejected as spam) ----

const smtp = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: process.env.SELLER_GMAIL, pass: process.env.GMAIL_APP_PASSWORD },
});

export async function sendReply(to: string, listingTitle: string, body: string, inReplyTo?: string): Promise<string> {
  const info = await smtp.sendMail({
    from: process.env.SELLER_GMAIL,
    to,
    subject: `Re: ${listingTitle}`,
    text: body,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  return info.messageId;
}

const PROFILE = "seller-craigslist";
const PHOTO_DIR = "/tmp/photos";

// Runs inside the Kernel VM. Walks Craigslist's posting wizard (SF bay area,
// for sale by owner > computers), sets every field from `params.listing`, forces
// contact to email only, and reads the edit form back before continuing.
const POST_LISTING = `
const L = params.listing;
const next = async () => {
  const b = page.getByRole("button", { name: "continue" });
  if (await b.count()) await b.first().click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
};
const step = () => new URL(page.url()).searchParams.get("s");

await page.goto("https://post.craigslist.org/c/sfo", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
if (page.url().includes("/login")) throw new Error("NEEDS_RECONNECT");
if (step() === "copyfromanother") { await page.getByText("skip", { exact: true }).click(); await page.waitForTimeout(1500); }
if (step() === "area") await next();
if (step() === "subarea") { await page.getByText(L.subarea, { exact: true }).click(); await next(); }
if (step() === "hood") {
  await page.getByText(L.neighborhood || "bypass this step", { exact: true }).click();
  await next();
}
if (step() === "type") { await page.getByText("for sale by owner", { exact: true }).click(); await next(); }
if (step() === "cat") { await page.getByText("computers", { exact: true }).click(); await next(); }
if (step() !== "edit") throw new Error("Unexpected Craigslist step: " + step());

const f = (name) => page.locator('[name="' + name + '"]');
await f("PostingTitle").fill(L.title);
await f("price").fill(String(L.price));
await f("postal").fill(L.zip);
await f("PostingBody").fill(L.description);
await f("sale_manufacturer").fill(L.make);
await f("sale_model").fill(L.model);
await f("sale_size").fill(L.size);
await f("condition").selectOption({ label: L.condition }, { force: true }); // hidden behind a jQuery UI selectmenu
await f("language").selectOption({ label: L.language }, { force: true });
await f("crypto_currency_ok").setChecked(L.cryptoOk);
await f("delivery_available").setChecked(L.deliveryAvailable);
await f("see_my_other").setChecked(L.moreAdsLink);
// email only: every buyer message must arrive by email to reach the unified inbox
for (const n of ["contact_chat_ok", "show_phone_ok", "contact_phone_ok", "contact_text_ok"]) await f(n).setChecked(false);
await f("show_address_ok").setChecked(L.showAddress);
if (L.showAddress) { // these inputs are disabled unless "show address" is ticked
  await f("xstreet0").fill(L.street);
  await f("xstreet1").fill(L.crossStreet);
  await f("city").fill(L.city);
}

const filled = {
  title: await f("PostingTitle").inputValue(),
  price: await f("price").inputValue(),
  zip: await f("postal").inputValue(),
  condition: await f("condition").evaluate((s) => s.options[s.selectedIndex].text),
  make: await f("sale_manufacturer").inputValue(),
  model: await f("sale_model").inputValue(),
  chat: await f("contact_chat_ok").isChecked(),
};
if (filled.title !== L.title || Number(filled.price) !== Number(L.price) || filled.condition !== L.condition || filled.chat) {
  throw new Error("Craigslist form did not stick: " + JSON.stringify(filled));
}
await next();

if (step() === "geoverify") await next();
if (step() === "editimage") {
  await page.locator('input[type="file"]').first().setInputFiles(params.photoPaths);
  const want = "has " + params.photoPaths.length + " image";
  for (let i = 0; i < 30 && !(await page.locator("body").innerText()).includes(want); i++) await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "done with images" }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
}
if (step() !== "preview") throw new Error("Unexpected Craigslist step before publish: " + step());
if (params.dryRun) return { filled, preview: page.url() };

await page.getByRole("button", { name: "publish" }).first().click();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);
const link = page.locator('a[href*="craigslist.org/"][href$=".html"]').first();
const url = (await link.count()) ? await link.getAttribute("href") : page.url();
return { filled, url, page: (await page.locator("body").innerText()).slice(0, 400) };
`;

export async function postListing(
  listing: CraigslistListing,
  photos: Uint8Array[],
  dryRun = false,
): Promise<{ filled: Record<string, unknown>; url?: string }> {
  const files = photos.map((contents, i) => ({ path: `${PHOTO_DIR}/${i}.jpg`, contents }));
  return runInBrowser({
    profile: PROFILE,
    code: POST_LISTING,
    params: { listing, photoPaths: files.map((f) => f.path), dryRun },
    files,
    timeoutSec: 300,
  });
}
