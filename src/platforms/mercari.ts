import { runInBrowser } from "../kernel.ts";
import type { MercariListing } from "../listing.ts";

const PROFILE = "seller-mercari";
const PHOTO_DIR = "/tmp/photos";
const CONDITION_TEST_IDS = { New: "ConditionNew", "Like new": "ConditionLikeNew", Good: "ConditionGood", Fair: "ConditionFair", Poor: "ConditionPoor" } as const;

// Runs inside the Kernel VM. Every field is set explicitly from `params.listing`;
// Mercari's photo autofill and defaults are overwritten, and each value is read
// back so a mismatch fails the job instead of posting something we didn't ask for.
const POST_LISTING = `
const L = params.listing;
const tid = (id) => page.locator('[data-testid="' + id + '"]');
const dialog = () => page.getByRole("dialog").last();
await page.goto("https://www.mercari.com/sell/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
if (page.url().includes("/login")) throw new Error("NEEDS_RECONNECT");
await page.getByRole("button", { name: "Got it" }).first().click({ timeout: 2000 }).catch(() => {});

await tid("SellPhotoInput").setInputFiles(params.photoPaths);
// let Mercari's photo recognition finish so it can't overwrite our values afterwards
for (let i = 0; i < 20 && !(await tid("Title").inputValue()); i++) await page.waitForTimeout(500);
await page.waitForTimeout(2000);
await tid("ListingTemplatesEducationGotIt").click({ timeout: 2000 }).catch(() => {});

await tid("Title").fill(L.title);
await tid("Description").fill(L.description);

await tid("SellCategoryFieldButton").click();
for (const name of ["Electronics", "Computers & Laptops", "Laptops"]) {
  await dialog().getByText(name, { exact: true }).click();
  await page.waitForTimeout(800);
}
const category = await tid("SellCategoryFieldButton").innerText();
if (category.trim() !== "Electronics > Computers & Laptops > Laptops") throw new Error("Category not set: " + category);

if (L.brand) {
  await tid("Brand").fill(L.brand);
  await page.waitForTimeout(1200);
  const opt = page.getByRole("option", { name: L.brand, exact: true });
  if (await opt.count()) await opt.first().click();
  else await page.getByText(L.brand, { exact: true }).last().click();
} else {
  await page.getByText("No brand / Not sure").click();
}
await page.waitForTimeout(500);

await tid(params.conditionTestId).click();

const S = L.shipping;
if (S.method === "own") {
  await tid("ShipOnYourOwn").click();
} else {
  await tid("MercariShipping").click();
  await tid("SelectShipping").click();
  await page.waitForTimeout(1500);
  await dialog().getByRole("button", { name: "Got it" }).click({ timeout: 2000 }).catch(() => {});
  await tid("ItemWeightInPounds").fill(String(S.weightLb));
  await tid("ItemWeightInOunces").fill(String(S.weightOz));
  await tid(S.fitsShoebox ? "FitsInShoeboxYes" : "FitsInShoeboxNo").check();
  if (!S.fitsShoebox && S.lengthIn) {
    await tid("InputLength").fill(String(S.lengthIn));
    await tid("InputWidth").fill(String(S.widthIn));
    await tid("InputHeight").fill(String(S.heightIn));
  }
  await dialog().getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(2500);
  const carrier = dialog().getByText(S.carrier, { exact: true });
  if (!(await carrier.count())) throw new Error("Carrier not offered for this package: " + S.carrier);
  await carrier.click();
  await tid("SelectCarrierSaveButton").click();
  await page.waitForTimeout(1500);
  await tid("ShippingPayerOption").selectOption({ label: S.freeShipping ? "Yes (Recommended)" : "No" }).catch(async () => {
    await tid("ShippingPayerOption").click();
    await page.getByText(S.freeShipping ? "Yes (Recommended)" : "No", { exact: true }).last().click();
  });
}

// formatted input: fill() appends to Mercari's suggested price, so clear it first
await tid("Price").click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await tid("Price").pressSequentially(String(L.price));

const smart = tid("SmartPricingButton");
const smartOn = (await smart.innerText()).trim() === "ON";
if (smartOn !== L.smartPricing) {
  await smart.click();
  if (!L.smartPricing) await tid("SmartPricingTurnOffButton").click();
  await page.waitForTimeout(1000);
}
if (L.smartPricing) await tid("SmartPricingFloorPrice").locator("input").first().fill(String(L.smartPricingMin)).catch(async () => {
  await tid("SmartPricingFloorPrice").fill(String(L.smartPricingMin));
});

const filled = {
  title: await tid("Title").inputValue(),
  description: await tid("Description").inputValue(),
  category,
  brand: await tid("Brand").inputValue(),
  shipping: S.method === "own" ? "Ship on your own" : await tid("SelectShipping").inputValue().catch(() => "prepaid"),
  price: await tid("Price").inputValue(),
  smartPricing: (await smart.innerText()).trim(),
  freeShipping: S.method === "prepaid" ? (await tid("ShippingPayerOption").innerText()).trim() : "n/a",
};
if (S.method === "prepaid" && !filled.freeShipping.startsWith(S.freeShipping ? "Yes" : "No")) throw new Error("Free shipping not set: " + filled.freeShipping);
if (filled.title !== L.title || filled.description !== L.description) throw new Error("Title/description did not stick");
if (Number(filled.price) !== Number(L.price)) throw new Error("Price did not stick: " + filled.price);
if (filled.smartPricing !== (L.smartPricing ? "ON" : "OFF")) throw new Error("Smart pricing not set");
if (params.dryRun) return { filled };

// the cookie banner can sit over the List button; dismiss it inside its own container
const cookie = tid("CookieConsentBanner").getByRole("button", { name: "Got it" });
if (await cookie.count()) { await cookie.click(); await page.waitForTimeout(500); }
await tid("ListButton").click();

// Mercari stays on a /sell/... confirmation page after listing, so don't rely on the URL.
// Wait for its "could not be listed" error or for the form to go away, then find the
// new item's URL by title on the active-listings page.
const FAIL = "could not be listed";
for (let i = 0; i < 45; i++) {
  const body = await page.locator("body").innerText();
  if (body.includes(FAIL)) throw new Error("Mercari refused the listing: " + body.slice(body.indexOf(FAIL) - 40, body.indexOf(FAIL) + 120));
  if (!(await tid("ListButton").count())) break;
  await page.waitForTimeout(1000);
}
if (await tid("ListButton").count()) {
  const dialogs = await page.getByRole("dialog").allInnerTexts();
  throw new Error("Mercari did not finish listing. Dialogs: " + JSON.stringify(dialogs).slice(0, 800));
}
await page.goto("https://www.mercari.com/mypage/listings/active/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const url = await page.locator('a[href*="/item/"]', { hasText: L.title }).first().getAttribute("href").catch(() => null);
if (!url) throw new Error("Listed, but could not find it on the active listings page");
return { filled, url: new URL(url, "https://www.mercari.com").href };
`;

// Bubbles are NotSelfMessage (buyer: "<text>\n\n<time>") and SelfMessage (seller: "<time>\n\n<text>",
// with the text in an inner ChatMessage). Messages are append-only, so index + text is a stable key.
const READ_CHAT = `
const readChat = async () => {
  const u = new URL(page.url());
  const bubbles = await page.$$eval('[data-testid="ChatMessagesList"] [data-testid="NotSelfMessage"], [data-testid="ChatMessagesList"] [data-testid="SelfMessage"]', (els) =>
    els.map((e) => {
      const self = e.getAttribute("data-testid") === "SelfMessage";
      const inner = e.querySelector('[data-testid="ChatMessage"]');
      const text = inner ? inner.innerText : self ? e.innerText.replace(/^[^\\n]*\\n+/, "") : e.innerText.replace(/\\n+[^\\n]*$/, "");
      return { self, text: text.trim() };
    }));
  return {
    itemId: u.searchParams.get("item_id"),
    guestId: u.searchParams.get("guest_id"),
    buyerName: (await page.locator('[data-testid="Name"]').first().innerText().catch(() => "")).trim(),
    itemTitle: (await page.locator('[data-testid="ItemPreviewTitle"]').first().innerText().catch(() => "")).trim(),
    messages: bubbles.map((b, i) => ({ ...b, key: i + ":" + b.text })),
  };
};
`;

const OPEN = `
const open = async (url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (page.url().includes("/login")) throw new Error("NEEDS_RECONNECT");
  await page.getByRole("button", { name: "Got it" }).first().click({ timeout: 2000 }).catch(() => {});
};
`;

const SYNC_INBOX = `${READ_CHAT}${OPEN}
await open("https://www.mercari.com/mypage/chat/selling/");
const n = await page.locator('[data-testid="ConversationContainer"]').count();
const threads = [];
for (let i = 0; i < n; i++) {
  await page.locator('[data-testid="ConversationContainer"]').nth(i).locator("button").first().click();
  await page.waitForURL((u) => u.searchParams.has("guest_id"), { timeout: 15000 });
  await page.waitForTimeout(1500);
  threads.push(await readChat());
}
return threads;
`;

const SEND_REPLY = `${READ_CHAT}${OPEN}
await open("https://www.mercari.com/mypage/chat/all/?item_id=" + params.itemId + "&guest_id=" + params.guestId);
await page.locator('[data-testid="EnterMessage"]').fill(params.body);
await page.locator('[data-testid="SendMessage"]').click();
await page.waitForTimeout(3000);
const chat = await readChat();
const last = chat.messages.filter((m) => m.self).pop();
return { sent: !!last && last.text === params.body.trim(), key: last ? last.key : null };
`;

export type MercariMessage = { self: boolean; text: string; key: string };
export type MercariThread = { itemId: string; guestId: string; buyerName: string; itemTitle: string; messages: MercariMessage[] };

export async function syncInbox(): Promise<MercariThread[]> {
  return runInBrowser({ profile: PROFILE, code: SYNC_INBOX, timeoutSec: 300 });
}

export async function sendReply(itemId: string, guestId: string, body: string): Promise<{ sent: boolean; key: string | null }> {
  return runInBrowser({ profile: PROFILE, code: SEND_REPLY, params: { itemId, guestId, body } });
}

export async function postListing(
  listing: MercariListing,
  photos: Uint8Array[],
  dryRun = false,
): Promise<{ filled: Record<string, string>; url?: string }> {
  const files = photos.map((contents, i) => ({ path: `${PHOTO_DIR}/${i}.jpg`, contents }));
  return runInBrowser({
    profile: PROFILE,
    code: POST_LISTING,
    params: { listing, photoPaths: files.map((f) => f.path), conditionTestId: CONDITION_TEST_IDS[listing.condition], dryRun },
    files,
    timeoutSec: 300,
  });
}
