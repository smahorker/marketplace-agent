import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { q } from "../db.ts";

const MODEL = "neon/claude-sonnet-5";

// No tools: agents only draft text. Code posts and sends, after the seller approves.
const replyDrafter = new Agent({
  id: "reply-drafter",
  name: "Reply drafter",
  model: MODEL,
  instructions:
    "You draft a short, friendly reply from a private seller to a buyer on a marketplace. " +
    "Use only facts from the listing and the conversation; never invent details, discounts or meeting times. " +
    "Never share personal contact details or payment instructions, and don't agree to move off the platform. " +
    "Reply with the message text only.",
});

const listingDrafter = new Agent({
  id: "listing-drafter",
  name: "Listing drafter",
  model: MODEL,
  instructions:
    "You write a marketplace listing title and description for a laptop from the seller's notes. " +
    "Use only facts in the notes; never invent specs, condition or accessories. Plain text, no emojis, no prices. " +
    "Write only buyer-facing listing text: never mention the notes, the seller's input, missing or limited details, " +
    "or these instructions. If the notes are brief, keep the description brief (1-2 sentences built from what is given), " +
    "but always at least 5 words.",
});

const LIMITS = { mercari: { title: 80, description: 1000 }, craigslist: { title: 70, description: 4000 } } as const;

export async function draftText(site: keyof typeof LIMITS, notes: string) {
  const lim = LIMITS[site];
  const res = await listingDrafter.generate(
    `Site: ${site}. Title at most ${lim.title} characters; description at most ${lim.description} characters` +
      ` and at least 5 words.\n\nSeller notes:\n${notes}`,
    {
      structuredOutput: { schema: z.object({ title: z.string(), description: z.string() }), jsonPromptInjection: true },
      abortSignal: AbortSignal.timeout(70_000),
    },
  );
  const o = res.object as { title: string; description: string };
  return { title: o.title.slice(0, lim.title), description: o.description.slice(0, lim.description) };
}

// Replaces the thread's draft with a fresh suggestion. Failure just leaves no draft.
export async function draftReplyFor(threadId: number) {
  try {
    const [t] = await q(
      `SELECT t.listing_title, a.platform, l.fields FROM threads t JOIN accounts a ON a.id=t.account_id
       LEFT JOIN listings l ON l.id=t.listing_id WHERE t.id=$1`,
      [threadId],
    );
    const msgs = await q("SELECT direction, body FROM messages WHERE thread_id=$1 AND status<>'draft' ORDER BY sent_at, id", [threadId]);
    const listing = t.fields ? JSON.stringify(t.fields) : `Title: ${t.listing_title ?? "unknown"}`;
    const convo = msgs.map((m) => `${m.direction === "in" ? "Buyer" : "Seller"}: ${m.body}`).join("\n");
    const res = await replyDrafter.generate(`Platform: ${t.platform}\nListing: ${listing}\n\nConversation:\n${convo}\n\nDraft the seller's next reply.`, {
      abortSignal: AbortSignal.timeout(70_000),
    });
    await q("DELETE FROM messages WHERE thread_id=$1 AND status='draft'", [threadId]);
    await q("INSERT INTO messages (thread_id, direction, body, status) VALUES ($1,'out',$2,'draft')", [threadId, res.text.trim()]);
  } catch (e) {
    console.error("draftReplyFor failed", threadId, e);
  }
}
