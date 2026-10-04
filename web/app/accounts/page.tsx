"use client";
import { CheckCircle2, Mail, RefreshCw, TriangleAlert } from "lucide-react";
import { usePolling } from "../lib";
import { PageHeader, PlatformPill } from "../ui";

type Account = { id: number; platform: string; status: string };

const ABOUT: Record<string, { how: string; detail: string }> = {
  mercari: { how: "Synced with Refresh all in the Inbox", detail: "A cloud browser logged in as you reads new chats and types your replies on mercari.com." },
  craigslist: { how: "Automatic by email", detail: "Buyer emails are forwarded from your Gmail; replies go out from your Gmail through Craigslist's relay." },
};

export default function Accounts() {
  const a = usePolling<Account[]>("/accounts", () => false);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Accounts" subtitle="Your marketplace accounts, logged in once in a secure cloud browser." />
      {a.error && <p className="mb-3 text-sm text-red-600">{a.error}</p>}
      <div className="grid gap-4">
        {a.data?.map((acc) => {
          const ok = acc.status === "connected";
          const about = ABOUT[acc.platform];
          return (
            <div key={acc.id} className="card flex items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <PlatformPill platform={acc.platform} />
                  <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? "text-brand-700" : "text-red-600"}`}>
                    {ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
                    {ok ? "Connected" : "Needs reconnect"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                    {acc.platform === "craigslist" ? <Mail size={13} /> : <RefreshCw size={13} />} {about?.how}
                  </span>
                </div>
                <p className="mt-2 text-sm text-stone-500">{about?.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-xs text-stone-400">
        If an account shows “Needs reconnect”, log in to it again in a Kernel live view.
      </p>
    </div>
  );
}
