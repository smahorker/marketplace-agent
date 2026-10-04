"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Package, PlugZap, Store } from "lucide-react";

const LINKS = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/products", label: "Listings", icon: Package },
  { href: "/accounts", label: "Accounts", icon: PlugZap },
];

export function Nav() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-brand-900 bg-brand-900 text-brand-50">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-white">
          <Store size={20} />
        </span>
        <div>
          <div className="text-base font-semibold leading-tight">Marketplace Agent</div>
          <div className="text-[11px] text-brand-100/70">Craigslist · Mercari</div>
        </div>
      </div>
      <nav className="mt-2 flex flex-col gap-1 px-3">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-white/15 text-white" : "text-brand-100/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
