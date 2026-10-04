import { Hono } from "hono";
import { waitUntil } from "@neon/functions";
import { Webhook } from "svix";
import { q, USER_ID } from "./db.ts";
import { putPhoto } from "./storage.ts";
import { enqueue, runAccountQueue, sweepStale } from "./jobs.ts";
import { listingSchema } from "./listing.ts";
import * as craigslist from "./platforms/craigslist.ts";
import { draftReplyFor, draftText } from "./mastra/index.ts";

const app = new Hono();

// The Function URL is public: everything except the (Svix-signed) webhook needs the app key.
app.use("*", async (c, next) => {
  if (c.req.path === "/webhooks/agentmail") return next();
  if (c.req.header("authorization") !== `Bearer ${process.env.APP_API_KEY}`) return c.json({ error: "unauthorized" }, 401);
  return next();
});

// Starts work after the response is sent (≤ 15 min on Neon; just runs locally).
const kick = (accountIds: number[]) => {
  for (const id of new Set(accountIds)) waitUntil(runAccountQueue(id).catch((e) => console.error("queue", id, e)));
};
const sweepAndKick = async () => kick(await sweepStale());

const accountFor = async (platform: string) => (await q("SELECT * FROM accounts WHERE user_id=$1 AND platform=$2", [USER_ID, platform]))[0];

// ---------- accounts ----------

app.get("/accounts", async (c) => c.json(await q("SELECT id, platform, status FROM accounts WHERE user_id=$1 ORDER BY id", [USER_ID])));

// Only Mercari needs syncing; Craigslist messages arrive by email on their own.
const refresh = async (accountIds: number[]) => {
  for (const id of accountIds) await enqueue(id, "sync_inbox");
  kick(accountIds);
};
app.post("/accounts/refresh", async (c) => {
  const ids = (await q("SELECT id FROM accounts WHERE user_id=$1 AND platform='mercari'", [USER_ID])).map((a) => a.id);
  await refresh(ids);
  return c.json({ queued: ids.length });
});
app.post("/accounts/:id/refresh", async (c) => {
  const [a] = await q("SELECT id FROM accounts WHERE id=$1 AND platform='mercari'", [Number(c.req.param("id"))]);
  if (!a) return c.json({ error: "only Mercari accounts sync" }, 400);
  await refresh([a.id]);
  return c.json({ queued: 1 });
});

// ---------- products & listings ----------

app.post("/draft-text", async (c) => {
  const { site, notes } = await c.req.json();
  if (site !== "mercari" && site !== "craigslist") return c.json({ error: "site must be mercari or craigslist" }, 400);
  return c.json(await draftText(site, String(notes ?? "")));
});

app.post("/products", async (c) => {
  const form = await c.req.formData();
  const parsed = listingSchema.safeParse(JSON.parse(String(form.get("listing") ?? "{}")));
  if (!parsed.success) return c.json({ error: "invalid listing", issues: parsed.error.issues }, 400);
  const sites = (["mercari", "craigslist"] as const).filter((s) => parsed.data[s]);
  if (!sites.length) return c.json({ error: "fill in at least one site" }, 400);
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length || files.length > 12) return c.json({ error: "add 1–12 photos" }, 400);

  const keys: string[] = [];
  for (const f of files) {
    const key = `${crypto.randomUUID()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
    await putPhoto(key, new Uint8Array(await f.arrayBuffer()), f.type || "image/jpeg");
    keys.push(key);
  }
  const [product] = await q("INSERT INTO products (user_id, photo_keys) VALUES ($1,$2) RETURNING *", [USER_ID, keys]);
  const listings = [];
  for (const s of sites) {
    const account = await accountFor(s);
    const fields = parsed.data[s]!;
    listings.push(
      (await q("INSERT INTO listings (product_id, account_id, title, fields) VALUES ($1,$2,$3,$4) RETURNING id, status, title",
        [product.id, account.id, fields.title, fields]))[0],
    );
  }
  return c.json({ product, listings });
});

app.post("/products/:id/list", async (c) => {
  const rows = await q(
    "UPDATE listings SET status='posting', error=NULL, updated_at=now() WHERE product_id=$1 AND status IN ('draft','failed') RETURNING id, account_id",
    [Number(c.req.param("id"))],
  );
  for (const l of rows) await enqueue(l.account_id, "post_listing", { listingId: l.id });
  kick(rows.map((l) => l.account_id));
  return c.json({ listings: rows });
});

app.get("/products", async (c) => {
  await sweepAndKick();
  const products = await q(
    `SELECT p.id, p.photo_keys, p.created_at,
       json_agg(json_build_object('id', l.id, 'platform', a.platform, 'title', l.title, 'status', l.status, 'url', l.url, 'error', l.error) ORDER BY a.platform) AS listings
     FROM products p JOIN listings l ON l.product_id=p.id JOIN accounts a ON a.id=l.account_id
     WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,
    [USER_ID],
  );
  const busy = await q("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1");
  return c.json({ products, syncing: busy.length > 0 });
});

// ---------- inbox ----------

app.get("/threads", async (c) => {
  await sweepAndKick();
  const threads = await q(
    `SELECT t.id, a.platform, t.buyer_name, COALESCE(l.title, t.listing_title) AS listing_title, t.unread, t.last_message_at,
       (SELECT body FROM messages m WHERE m.thread_id=t.id AND m.status<>'draft' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message
     FROM threads t JOIN accounts a ON a.id=t.account_id LEFT JOIN listings l ON l.id=t.listing_id
     WHERE a.user_id=$1 ORDER BY t.last_message_at DESC`,
    [USER_ID],
  );
  const syncing = await q("SELECT 1 FROM jobs WHERE kind='sync_inbox' AND status IN ('queued','running') LIMIT 1");
  return c.json({ threads, syncing: syncing.length > 0 });
});

app.get("/threads/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [thread] = await q(
    `UPDATE threads t SET unread=false FROM accounts a WHERE t.id=$1 AND a.id=t.account_id
     RETURNING t.id, t.buyer_name, t.listing_title, t.listing_id, a.platform`,
    [id],
  );
  if (!thread) return c.json({ error: "not found" }, 404);
  const [listing] = thread.listing_id ? await q("SELECT id, title, url, status FROM listings WHERE id=$1", [thread.listing_id]) : [null];
  const messages = await q("SELECT id, direction, body, status, error, sent_at FROM messages WHERE thread_id=$1 ORDER BY sent_at, id", [id]);
  return c.json({ thread, listing, messages });
});

// Sends a Craigslist reply right away (no browser); returns the updated message row.
async function sendCraigslist(messageId: number) {
  const [m] = await q(
    `SELECT m.body, t.id AS thread_id, t.external_key AS relay, COALESCE(l.title, t.listing_title) AS title,
       (SELECT email_message_id FROM messages i WHERE i.thread_id=t.id AND i.direction='in' ORDER BY i.sent_at DESC, i.id DESC LIMIT 1) AS in_reply_to
     FROM messages m JOIN threads t ON t.id=m.thread_id LEFT JOIN listings l ON l.id=t.listing_id WHERE m.id=$1`,
    [messageId],
  );
  try {
    const sentId = await craigslist.sendReply(m.relay, m.title, m.body, m.in_reply_to ?? undefined);
    await q("UPDATE messages SET status='sent', sent_at=now(), email_message_id=$2, error=NULL WHERE id=$1", [messageId, sentId]);
  } catch (e: any) {
    await q("UPDATE messages SET status='failed', error=$2 WHERE id=$1", [messageId, String(e?.message ?? e).slice(0, 2000)]);
  }
  return (await q("SELECT id, direction, body, status, error, sent_at FROM messages WHERE id=$1", [messageId]))[0];
}

app.post("/threads/:id/reply", async (c) => {
  const threadId = Number(c.req.param("id"));
  const { body } = await c.req.json();
  if (!String(body ?? "").trim()) return c.json({ error: "empty reply" }, 400);
  const [t] = await q("SELECT t.account_id, a.platform FROM threads t JOIN accounts a ON a.id=t.account_id WHERE t.id=$1", [threadId]);
  if (!t) return c.json({ error: "not found" }, 404);
  // the draft row (if any) becomes the outgoing message
  await q("DELETE FROM messages WHERE thread_id=$1 AND status='draft'", [threadId]);
  const [m] = await q(
    "INSERT INTO messages (thread_id, direction, body, status) VALUES ($1,'out',$2,'sending') RETURNING id",
    [threadId, String(body).trim()],
  );
  await q("UPDATE threads SET last_message_at=now() WHERE id=$1", [threadId]);
  if (t.platform === "craigslist") return c.json({ message: await sendCraigslist(m.id) });
  await enqueue(t.account_id, "send_reply", { messageId: m.id });
  kick([t.account_id]);
  return c.json({ message: { id: m.id, direction: "out", body, status: "sending" } });
});

app.post("/messages/:id/retry", async (c) => {
  const id = Number(c.req.param("id"));
  const [m] = await q(
    "SELECT m.id, t.account_id, a.platform FROM messages m JOIN threads t ON t.id=m.thread_id JOIN accounts a ON a.id=t.account_id WHERE m.id=$1 AND m.status='failed'",
    [id],
  );
  if (!m) return c.json({ error: "no failed message with that id" }, 404);
  await q("UPDATE messages SET status='sending', error=NULL WHERE id=$1", [id]);
  if (m.platform === "craigslist") return c.json({ message: await sendCraigslist(id) });
  await enqueue(m.account_id, "send_reply", { messageId: id });
  kick([m.account_id]);
  return c.json({ message: { id, status: "sending" } });
});

// ---------- AgentMail webhook: Craigslist buyer emails ----------

app.post("/webhooks/agentmail", async (c) => {
  const raw = await c.req.text(); // verify the raw body before parsing, or the signature breaks
  let event: any;
  try {
    event = new Webhook(process.env.AGENTMAIL_WEBHOOK_SECRET!).verify(raw, {
      "svix-id": c.req.header("svix-id") ?? "",
      "svix-timestamp": c.req.header("svix-timestamp") ?? "",
      "svix-signature": c.req.header("svix-signature") ?? "",
    });
    event = event ?? JSON.parse(raw);
  } catch {
    return c.text("bad signature", 400);
  }
  if (event.event_type !== "message.received" || !event.message) return c.text("ignored");
  const fresh = await q("INSERT INTO inbound_emails (agentmail_message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1", [event.message.message_id]);
  if (!fresh.length) return c.text("duplicate");
  waitUntil(handleInbound(event.message).catch((e) => console.error("inbound", e)));
  return c.text("ok");
});

export async function handleInbound(message: any) {
  if (!message.extracted_text && !message.text) {
    // large bodies can be omitted from the webhook payload
    const url = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(message.inbox_id)}/messages/${encodeURIComponent(message.message_id)}`;
    message = await (await fetch(url, { headers: { Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}` } })).json();
  }
  const mail = craigslist.parseInbound(message);
  if (!mail) return console.log("ignored inbound email from", message.from); // e.g. Gmail forwarding confirmations
  const account = await accountFor("craigslist");
  // the footer link's slug is in the posting URL we saved; the subject is buyer-editable, so it's only a fallback
  const [listing] = await q(
    `SELECT id, title FROM listings WHERE account_id=$1 AND (($2::text IS NOT NULL AND url LIKE '%/d/' || $2 || '/%') OR lower(title)=lower($3))
     ORDER BY ($2::text IS NOT NULL AND url LIKE '%/d/' || $2 || '/%') DESC, updated_at DESC LIMIT 1`,
    [account.id, mail.postSlug, mail.listingTitle],
  );
  const [thread] = await q(
    `INSERT INTO threads (account_id, listing_id, external_key, buyer_name, listing_title) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (account_id, external_key) DO UPDATE SET listing_id=COALESCE(threads.listing_id, EXCLUDED.listing_id)
     RETURNING id`,
    [account.id, listing?.id ?? null, mail.relayAddress, mail.buyerName, listing?.title ?? mail.listingTitle],
  );
  const inserted = await q(
    `INSERT INTO messages (thread_id, direction, body, status, external_key, email_message_id)
     VALUES ($1,'in',$2,'received',$3,$3) ON CONFLICT (thread_id, external_key) DO NOTHING RETURNING id`,
    [thread.id, mail.body, mail.messageId],
  );
  if (!inserted.length) return;
  await q("UPDATE threads SET unread=true, last_message_at=now() WHERE id=$1", [thread.id]);
  await draftReplyFor(thread.id);
}

app.get("/health", (c) => c.text("ok"));

export default app;
