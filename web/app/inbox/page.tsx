"use client";
import { useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { AlertCircle, Check, ExternalLink, Inbox as InboxIcon, Loader2, RefreshCw, SendHorizontal, Sparkles } from "lucide-react";
import { post, timeAgo, usePolling } from "../lib";
import { Avatar, PageHeader, PlatformPill } from "../ui";

type Thread = { id: number; platform: string; buyer_name: string; listing_title: string; unread: boolean; last_message: string; last_message_at: string };
type Message = { id: number; direction: "in" | "out"; body: string; status: string; error: string | null; sent_at: string };
type Detail = { thread: { id: number; buyer_name: string; platform: string; listing_title: string }; listing: { title: string; url: string } | null; messages: Message[] };

export default function Inbox() {
  const [selected, setSelected] = useState<number | null>(null);
  const list = usePolling<{ threads: Thread[]; syncing: boolean }>("/threads", (d) => d.syncing, 5000); // new Craigslist emails show up without a reload
  const [refreshing, setRefreshing] = useState(false);
  const syncing = refreshing || !!list.data?.syncing;

  async function refreshAll() {
    setRefreshing(true);
    try {
      await post("/accounts/refresh");
      await list.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader
        title="Inbox"
        subtitle="Craigslist messages arrive on their own. Mercari messages sync when you refresh."
        action={
          <button onClick={refreshAll} disabled={syncing} className="btn-primary">
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing Mercari…" : "Refresh all"}
          </button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-4 xl:grid-cols-[360px_1fr]">
        <section className="card flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-stone-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Conversations {list.data ? `· ${list.data.threads.length}` : ""}
          </div>
          {list.error && <p className="p-4 text-sm text-red-600">{list.error}</p>}
          {list.data && !list.data.threads.length ? <Empty text="No conversations yet." /> : (
          <ul className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto">
            {list.data?.threads.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t.id)}
                  className={`flex w-full gap-3 px-4 py-3 text-left transition ${selected === t.id ? "bg-brand-50" : "hover:bg-stone-50"}`}
                >
                  <Avatar name={t.buyer_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm ${t.unread ? "font-semibold text-stone-900" : "font-medium text-stone-700"}`}>{t.buyer_name}</span>
                      <span className="ml-auto shrink-0 text-xs text-stone-400">{timeAgo(t.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <PlatformPill platform={t.platform} />
                      <span className="truncate text-xs text-stone-500">{t.listing_title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`truncate text-sm ${t.unread ? "text-stone-800" : "text-stone-500"}`}>{t.last_message}</span>
                      {t.unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          )}
        </section>
        <section className="card flex min-h-0 flex-col overflow-hidden">
          {selected ? <ThreadView key={selected} id={selected} onChange={list.reload} /> : <Empty text="Select a conversation to read and reply." />}
        </section>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-stone-400">
      <InboxIcon size={28} />
      {text}
    </div>
  );
}

// The conversation pane is an assistant-ui thread on an external store: our database is
// the source of truth. Seller (us) = "user" role, buyer = "assistant" role.
function ThreadView({ id, onChange }: { id: number; onChange: () => void }) {
  const d = usePolling<Detail>(`/threads/${id}`, (x) => x.messages.some((m) => m.status === "sending"), 5000);
  const [error, setError] = useState<string | null>(null);
  const messages = d.data?.messages.filter((m) => m.status !== "draft") ?? [];
  const draft = d.data?.messages.find((m) => m.status === "draft");

  const runtime = useExternalStoreRuntime<Message>({
    messages,
    isRunning: false,
    convertMessage: (m) => ({
      id: String(m.id),
      role: m.direction === "out" ? "user" : "assistant",
      content: [{ type: "text", text: m.body }],
      createdAt: new Date(m.sent_at),
      metadata: { custom: { status: m.status, error: m.error, dbId: m.id } },
    }),
    onNew: async (message: AppendMessage) => {
      const text = message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();
      if (!text) return;
      setError(null);
      try {
        await post(`/threads/${id}/reply`, { body: text });
      } catch (e: any) {
        setError(e.message);
      }
      await d.reload();
      onChange();
    },
  });

  // Prefill the composer with the AI draft. A newer draft (a new buyer message arrived) only
  // replaces the text if the seller hasn't started editing — never overwrite what they typed.
  const lastDraft = useRef<string>("");
  useEffect(() => {
    if (!draft) return;
    const current = runtime.thread.composer.getState().text;
    if (!current.trim() || current === lastDraft.current) runtime.thread.composer.setText(draft.body);
    lastDraft.current = draft.body;
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d.data) return <Empty text={d.error ?? "Loading…"} />;
  const { thread, listing } = d.data;
  const retry = async (messageId: number) => {
    await post(`/messages/${messageId}/retry`).catch((e) => setError(e.message));
    await d.reload();
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex items-center gap-3 border-b border-stone-200 px-5 py-3">
        <Avatar name={thread.buyer_name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-900">{thread.buyer_name}</span>
            <PlatformPill platform={thread.platform} />
          </div>
          <div className="truncate text-xs text-stone-500">
            {listing?.url ? (
              <a href={listing.url} target="_blank" className="inline-flex items-center gap-1 hover:text-brand-700">
                {listing.title} <ExternalLink size={12} />
              </a>
            ) : (
              thread.listing_title
            )}
          </div>
        </div>
      </div>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col bg-stone-50/60">
        <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
          <ThreadPrimitive.Messages
            components={{
              UserMessage: () => <SellerMessage onRetry={retry} />,
              AssistantMessage: () => <BuyerMessage name={thread.buyer_name} />,
            }}
          />
        </ThreadPrimitive.Viewport>
        <div className="border-t border-stone-200 bg-white px-4 py-3">
          {draft && (
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <Sparkles size={13} /> Suggested reply drafted by AI — edit it, then send.
            </div>
          )}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-stone-300 bg-white p-2 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
            <ComposerPrimitive.Input
              rows={1}
              placeholder={`Reply to ${thread.buyer_name} on ${thread.platform === "mercari" ? "Mercari" : "Craigslist"}…`}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-stone-400"
            />
            <ComposerPrimitive.Send className="btn-primary h-10 px-4">
              <SendHorizontal size={16} /> Send
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const useMeta = () => useAuiState((s: any) => s.message.metadata?.custom) as { status: string; error: string | null; dbId: number } | undefined;
const useTime = () => useAuiState((s: any) => s.message.createdAt) as Date | undefined;

function BuyerMessage({ name }: { name: string }) {
  const at = useTime();
  return (
    <MessagePrimitive.Root className="flex flex-col">
      {/* avatar aligns with the bubble; the timestamp sits under the bubble */}
      <div className="flex items-end gap-2">
        <Avatar name={name} />
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-800 shadow-xs">
          <MessagePrimitive.Parts />
        </div>
      </div>
      {at && <div className="mt-1 pl-12 text-[11px] text-stone-400">{timeAgo(at.toISOString())}</div>}
    </MessagePrimitive.Root>
  );
}

function SellerMessage({ onRetry }: { onRetry: (id: number) => void }) {
  const meta = useMeta();
  const at = useTime();
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[70%]">
        <div className={`whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white shadow-xs ${meta?.status === "failed" ? "bg-red-700" : "bg-brand-700"}`}>
          <MessagePrimitive.Parts />
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 pr-1 text-[11px] text-stone-400">
          {at && <span>{timeAgo(at.toISOString())} ·</span>}
          {meta?.status === "sending" && (
            <span className="inline-flex items-center gap-1 text-stone-500"><Loader2 size={11} className="animate-spin" /> sending</span>
          )}
          {meta?.status === "sent" && <span className="inline-flex items-center gap-1 text-brand-700"><Check size={12} /> sent</span>}
          {meta?.status === "failed" && (
            <span className="inline-flex items-center gap-1 text-red-600" title={meta.error ?? ""}>
              <AlertCircle size={12} /> failed
              <button onClick={() => onRetry(meta.dbId)} className="ml-1 font-semibold underline">Retry</button>
            </span>
          )}
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}
