import { q } from "./db.ts";
import { getPhoto } from "./storage.ts";
import { NeedsReconnectError } from "./kernel.ts";
import * as mercari from "./platforms/mercari.ts";
import * as craigslist from "./platforms/craigslist.ts";
import { draftReplyFor } from "./mastra/index.ts";

type Job = { id: number; account_id: number; kind: "post_listing" | "sync_inbox" | "send_reply" | "delist_listing"; payload: any };

export async function enqueue(accountId: number, kind: Job["kind"], payload: object = {}) {
  if (kind === "sync_inbox") {
    const queued = await q("SELECT 1 FROM jobs WHERE account_id=$1 AND kind='sync_inbox' AND status='queued'", [accountId]);
    if (queued.length) return;
  }
  await q("INSERT INTO jobs (account_id, kind, payload) VALUES ($1,$2,$3)", [accountId, kind, payload]);
}

// No cron: called on every enqueue and page load. A crashed invocation leaves a job
// `running` forever and stalls that account, so time those out and restart the queue.
export async function sweepStale(): Promise<number[]> {
  const stale = await q<Job>(
    "UPDATE jobs SET status='failed', error='timed out' WHERE status='running' AND started_at < now() - interval '10 minutes' RETURNING *",
  );
  for (const j of stale) await markJobTargetFailed(j, "timed out");
  const accounts = await q<{ account_id: number }>("SELECT DISTINCT account_id FROM jobs WHERE status='queued'");
  return accounts.map((a) => a.account_id);
}

// Runs every queued job for the account, one at a time. The partial unique index
// (one running job per account) makes concurrent invocations safe.
export async function runAccountQueue(accountId: number) {
  for (;;) {
    let job: Job | undefined;
    try {
      [job] = await q<Job>(
        `UPDATE jobs SET status='running', started_at=now()
         WHERE id = (SELECT id FROM jobs WHERE account_id=$1 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
           AND NOT EXISTS (SELECT 1 FROM jobs WHERE account_id=$1 AND status='running')
         RETURNING *`,
        [accountId],
      );
    } catch (e: any) {
      if (e.code === "23505") return; // another invocation just started one
      throw e;
    }
    if (!job) return;
    try {
      await runJob(job);
      await q("UPDATE jobs SET status='done' WHERE id=$1", [job.id]);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 2000);
      if (e instanceof NeedsReconnectError) await q("UPDATE accounts SET status='needs_reconnect' WHERE id=$1", [accountId]);
      await q("UPDATE jobs SET status='failed', error=$2 WHERE id=$1", [job.id, msg]);
      await markJobTargetFailed(job, msg);
    }
  }
}

async function markJobTargetFailed(job: Job, msg: string) {
  if (job.kind === "post_listing") await q("UPDATE listings SET status='failed', error=$2, updated_at=now() WHERE id=$1", [job.payload.listingId, msg]);
  if (job.kind === "send_reply") await q("UPDATE messages SET status='failed', error=$2 WHERE id=$1", [job.payload.messageId, msg]);
  // a failed removal leaves the listing live (it still is), with the reason
  if (job.kind === "delist_listing") await q("UPDATE listings SET status='live', error=$2, updated_at=now() WHERE id=$1", [job.payload.listingId, `Could not remove: ${msg}`]);
}

async function runJob(job: Job) {
  if (job.kind === "post_listing") return postListingJob(job.payload.listingId);
  if (job.kind === "sync_inbox") return syncMercari(job.account_id);
  if (job.kind === "send_reply") return sendMercariReply(job.payload.messageId);
  if (job.kind === "delist_listing") return delistListingJob(job.payload.listingId);
}

async function delistListingJob(listingId: number) {
  const [l] = await q("SELECT l.url, a.platform FROM listings l JOIN accounts a ON a.id=l.account_id WHERE l.id=$1", [listingId]);
  if (l.url) await (l.platform === "mercari" ? mercari.delistListing(l.url) : craigslist.delistListing(l.url));
  await q("UPDATE listings SET status='removed', error=NULL, updated_at=now() WHERE id=$1", [listingId]);
}

async function postListingJob(listingId: number) {
  const [l] = await q(
    `SELECT l.*, a.platform, p.photo_keys FROM listings l JOIN accounts a ON a.id=l.account_id JOIN products p ON p.id=l.product_id WHERE l.id=$1`,
    [listingId],
  );
  await q("UPDATE listings SET status='posting', error=NULL, updated_at=now() WHERE id=$1", [listingId]);
  const photos = await Promise.all((l.photo_keys as string[]).map(getPhoto));
  const res = l.platform === "mercari"
    ? await mercari.postListing(l.fields, photos)
    : await craigslist.postListing(l.fields, photos);
  await q("UPDATE listings SET status='live', url=$2, updated_at=now() WHERE id=$1", [listingId, res.url]);
}

async function syncMercari(accountId: number) {
  const threads = await mercari.syncInbox();
  for (const t of threads) {
    const [listing] = await q("SELECT id FROM listings WHERE account_id=$1 AND url LIKE $2", [accountId, `%/item/${t.itemId}/%`]);
    const [thread] = await q(
      `INSERT INTO threads (account_id, listing_id, external_key, buyer_name, listing_title)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_id, external_key) DO UPDATE SET buyer_name=EXCLUDED.buyer_name, listing_title=EXCLUDED.listing_title,
         listing_id=COALESCE(threads.listing_id, EXCLUDED.listing_id)
       RETURNING id`,
      [accountId, listing?.id ?? null, `${t.itemId}:${t.guestId}`, t.buyerName, t.itemTitle],
    );
    let newBuyerMessage = false;
    for (const m of t.messages) {
      const inserted = await q(
        `INSERT INTO messages (thread_id, direction, body, status, external_key) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (thread_id, external_key) DO NOTHING RETURNING id`,
        [thread.id, m.self ? "out" : "in", m.text, m.self ? "sent" : "received", m.key],
      );
      if (inserted.length && !m.self) newBuyerMessage = true;
    }
    if (newBuyerMessage) {
      await q("UPDATE threads SET unread=true, last_message_at=now() WHERE id=$1", [thread.id]);
      await draftReplyFor(thread.id);
    }
  }
}

async function sendMercariReply(messageId: number) {
  const [m] = await q("SELECT m.body, t.external_key FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.id=$1", [messageId]);
  const [itemId, guestId] = (m.external_key as string).split(":");
  const res = await mercari.sendReply(itemId, guestId, m.body);
  if (!res.sent) throw new Error("Reply not visible in the Mercari chat after sending");
  await q("UPDATE messages SET status='sent', sent_at=now(), external_key=$2, error=NULL WHERE id=$1", [messageId, res.key]);
}
