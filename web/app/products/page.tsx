"use client";
import { useState, type ReactNode } from "react";
import { ExternalLink, ImagePlus, Loader2, Sparkles, Copy, X, CircleAlert } from "lucide-react";
import { api, post, usePolling } from "../lib";
import { PageHeader, PlatformPill } from "../ui";

// Mirrors src/listing.ts (the backend validates with that schema). Every field is set by
// the seller; the browser agent copies these values onto each site — nothing is guessed.
const MERCARI_CONDITIONS = ["New", "Like new", "Good", "Fair", "Poor"];
const CL_CONDITIONS = ["new", "like new", "excellent", "good", "fair", "salvage"];
const CARRIERS = ["USPS Ground Advantage", "UPS Ground", "FedEx Ground Economy", "FedEx Home", "USPS Priority Mail"];
const SUBAREAS = ["city of san francisco", "south bay area", "east bay area", "peninsula", "north bay / marin", "santa cruz co"];
const SF_HOODS = [
  "alamo square / nopa", "bayview", "bernal heights", "castro / upper market", "cole valley / ashbury hts", "downtown / civic / van ness",
  "excelsior / outer mission", "financial district", "glen park", "haight ashbury", "hayes valley", "ingleside / SFSU / CCSF", "inner richmond",
  "inner sunset / UCSF", "laurel hts / presidio", "lower haight", "lower nob hill", "lower pac hts", "marina / cow hollow", "mission district",
  "nob hill", "noe valley", "north beach / telegraph hill", "pacific heights", "portola district", "potrero hill", "richmond / seacliff",
  "russian hill", "SOMA / south beach", "sunset / parkside", "tenderloin", "treasure island", "twin peaks / diamond hts", "USF / panhandle",
  "visitacion valley",
];

const emptyMercari = {
  title: "", description: "", price: "", condition: "Good", brand: "", smartPricing: false, smartPricingMin: "",
  shippingMethod: "own", weightLb: "", weightOz: "0", fitsShoebox: false, lengthIn: "", widthIn: "", heightIn: "",
  carrier: "USPS Ground Advantage", freeShipping: false,
};
const emptyCraigslist = {
  title: "", description: "", price: "", condition: "good", make: "", model: "", size: "",
  subarea: "city of san francisco", neighborhood: "SOMA / south beach", zip: "94105", language: "english",
  cryptoOk: false, deliveryAvailable: false, moreAdsLink: false, showAddress: false, street: "", crossStreet: "", city: "San Francisco",
};
type M = typeof emptyMercari;
type C = typeof emptyCraigslist;

const num = (s: string) => Number(s);
function toMercari(m: M) {
  return {
    title: m.title, description: m.description, price: num(m.price), condition: m.condition, brand: m.brand.trim(),
    smartPricing: m.smartPricing, ...(m.smartPricing ? { smartPricingMin: num(m.smartPricingMin) } : {}),
    shipping: m.shippingMethod === "own" ? { method: "own" } : {
      method: "prepaid", weightLb: num(m.weightLb), weightOz: num(m.weightOz), fitsShoebox: m.fitsShoebox,
      ...(m.fitsShoebox ? {} : { lengthIn: num(m.lengthIn), widthIn: num(m.widthIn), heightIn: num(m.heightIn) }),
      carrier: m.carrier, freeShipping: m.freeShipping,
    },
  };
}
const toCraigslist = (c: C) => ({ ...c, price: num(c.price) });


type Product = {
  id: number; created_at: string; photo_keys: string[];
  listings: { id: number; platform: string; title: string; status: string; url: string | null; error: string | null }[];
};

export default function Products() {
  const list = usePolling<{ products: Product[]; syncing: boolean }>("/products", (d) => d.syncing || d.products.some((p) => p.listings.some((l) => l.status === "posting")));
  const [photos, setPhotos] = useState<File[]>([]);
  const [useM, setUseM] = useState(true);
  const [useC, setUseC] = useState(true);
  const [m, setM] = useState<M>(emptyMercari);
  const [c, setC] = useState<C>(emptyCraigslist);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setMf = (k: keyof M) => (v: any) => setM((s) => ({ ...s, [k]: v }));
  const setCf = (k: keyof C) => (v: any) => setC((s) => ({ ...s, [k]: v }));

  async function draft(site: "mercari" | "craigslist") {
    setBusy(`draft-${site}`);
    setErr(null);
    try {
      const d = await post("/draft-text", { site, notes });
      if (site === "mercari") setM((s) => ({ ...s, title: d.title, description: d.description }));
      else setC((s) => ({ ...s, title: d.title, description: d.description }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  function copyFromMercari() {
    setC((s) => ({
      ...s, title: m.title.slice(0, 70), description: m.description, price: m.price, make: m.brand,
      condition: ({ New: "new", "Like new": "like new", Good: "good", Fair: "fair", Poor: "salvage" } as Record<string, string>)[m.condition],
    }));
  }

  async function submit() {
    setErr(null);
    if (!photos.length) return setErr("Add at least one photo.");
    if (!useM && !useC) return setErr("Choose at least one marketplace.");
    const listing = { ...(useM ? { mercari: toMercari(m) } : {}), ...(useC ? { craigslist: toCraigslist(c) } : {}) };
    const sites = [useM && "Mercari", useC && "Craigslist"].filter(Boolean).join(" and ");
    if (!confirm(`Post this listing publicly on ${sites}?`)) return;
    setBusy("list");
    try {
      const fd = new FormData();
      photos.forEach((p) => fd.append("photos", p));
      fd.append("listing", JSON.stringify(listing));
      const { product } = await api("/products", { method: "POST", body: fd });
      await post(`/products/${product.id}/list`);
      await list.reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const draftBtn = (site: "mercari" | "craigslist") => (
    <button type="button" onClick={() => draft(site)} disabled={!notes.trim() || !!busy} className="btn-sm" title={notes.trim() ? "" : "Add notes above first"}>
      {busy === `draft-${site}` ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with AI
    </button>
  );

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Listings" subtitle="Fill in every field once per marketplace. Nothing is posted until you click List." />

      <section className="card grid gap-5 p-5 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="label mb-2">Photos · {photos.length}/12</div>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((f, i) => (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
                <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                <button onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block" aria-label="Remove photo">
                  <X size={12} />
                </button>
              </div>
            ))}
            {photos.length < 12 && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 text-stone-400 transition hover:border-brand-600 hover:text-brand-700">
                <ImagePlus size={22} />
                <span className="text-[11px] font-medium">Add photos</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setPhotos((p) => [...p, ...(e.target.files ?? [])].slice(0, 12))} />
              </label>
            )}
          </div>
        </div>
        <Field label="Notes for “Draft with AI” (optional)">
          <textarea className="input h-full min-h-28" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ThinkPad T14, 16GB RAM, charger included, small scratch on the lid" />
        </Field>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Site name="Mercari" platform="mercari" on={useM} setOn={setUseM} hint="Laptops category · ships from your Mercari default address" actions={draftBtn("mercari")}>
          <Field label="Title" count={`${m.title.length}/80`}><input className="input" maxLength={80} value={m.title} onChange={(e) => setMf("title")(e.target.value)} /></Field>
          <Field label="Description · 5+ words" count={`${m.description.length}/1000`}><textarea className="input" rows={4} maxLength={1000} value={m.description} onChange={(e) => setMf("description")(e.target.value)} /></Field>
          <Row cols={3}>
            <Field label="Price ($1–$2000)"><Money value={m.price} onChange={setMf("price")} /></Field>
            <Field label="Condition"><Select value={m.condition} options={MERCARI_CONDITIONS} onChange={setMf("condition")} /></Field>
            <Field label="Brand"><input className="input" value={m.brand} onChange={(e) => setMf("brand")(e.target.value)} placeholder="No brand" /></Field>
          </Row>
          <Field label="Shipping">
            <Segmented value={m.shippingMethod} onChange={setMf("shippingMethod")} options={[["own", "Ship on your own"], ["prepaid", "Prepaid label"]]} />
          </Field>
          {m.shippingMethod === "prepaid" && (
            <div className="space-y-3 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
              <Row cols={3}>
                <Field label="Weight (lb)"><input className="input" type="number" min={0} value={m.weightLb} onChange={(e) => setMf("weightLb")(e.target.value)} /></Field>
                <Field label="Weight (oz)"><input className="input" type="number" min={0} max={15} value={m.weightOz} onChange={(e) => setMf("weightOz")(e.target.value)} /></Field>
                <Field label="Fits in a shoebox?"><Segmented value={m.fitsShoebox ? "yes" : "no"} onChange={(v) => setMf("fitsShoebox")(v === "yes")} options={[["yes", "Yes"], ["no", "No"]]} /></Field>
              </Row>
              {!m.fitsShoebox && (
                <Row cols={3}>
                  <Field label="Length (in)"><input className="input" type="number" value={m.lengthIn} onChange={(e) => setMf("lengthIn")(e.target.value)} /></Field>
                  <Field label="Width (in)"><input className="input" type="number" value={m.widthIn} onChange={(e) => setMf("widthIn")(e.target.value)} /></Field>
                  <Field label="Height (in)"><input className="input" type="number" value={m.heightIn} onChange={(e) => setMf("heightIn")(e.target.value)} /></Field>
                </Row>
              )}
              <Field label="Carrier (only those Mercari offers for this package work)"><Select value={m.carrier} options={CARRIERS} onChange={setMf("carrier")} /></Field>
              <Row cols={2}>
                <Field label="Free shipping for buyer?"><Segmented value={m.freeShipping ? "yes" : "no"} onChange={(v) => setMf("freeShipping")(v === "yes")} options={[["yes", "Yes"], ["no", "No"]]} /></Field>
                <div />
              </Row>
            </div>
          )}
          <Row cols={2}>
            <Field label="Smart Pricing (auto price drops)"><Segmented value={m.smartPricing ? "on" : "off"} onChange={(v) => setMf("smartPricing")(v === "on")} options={[["off", "Off"], ["on", "On"]]} /></Field>
            {m.smartPricing ? <Field label="Minimum price"><Money value={m.smartPricingMin} onChange={setMf("smartPricingMin")} /></Field> : <div />}
          </Row>
        </Site>

        <Site name="Craigslist" platform="craigslist" on={useC} setOn={setUseC} hint="SF bay area · computers by owner · email contact only"
          actions={<>
            <button type="button" onClick={copyFromMercari} className="btn-sm"><Copy size={13} /> Copy from Mercari</button>
            {draftBtn("craigslist")}
          </>}>
          <Field label="Title" count={`${c.title.length}/70`}><input className="input" maxLength={70} value={c.title} onChange={(e) => setCf("title")(e.target.value)} /></Field>
          <Field label="Description"><textarea className="input" rows={4} value={c.description} onChange={(e) => setCf("description")(e.target.value)} /></Field>
          <Row cols={3}>
            <Field label="Price"><Money value={c.price} onChange={setCf("price")} /></Field>
            <Field label="Condition"><Select value={c.condition} options={CL_CONDITIONS} onChange={setCf("condition")} /></Field>
            <Field label="ZIP"><input className="input" value={c.zip} onChange={(e) => setCf("zip")(e.target.value)} /></Field>
          </Row>
          <Row cols={3}>
            <Field label="Make / manufacturer"><input className="input" value={c.make} onChange={(e) => setCf("make")(e.target.value)} /></Field>
            <Field label="Model"><input className="input" value={c.model} onChange={(e) => setCf("model")(e.target.value)} /></Field>
            <Field label="Size / dimensions"><input className="input" value={c.size} onChange={(e) => setCf("size")(e.target.value)} /></Field>
          </Row>
          <Row cols={2}>
            <Field label="Area"><Select value={c.subarea} options={SUBAREAS} onChange={(v: string) => setC((s) => ({ ...s, subarea: v, neighborhood: "" }))} /></Field>
            <Field label="Neighborhood">
              {c.subarea === "city of san francisco"
                ? <Select value={c.neighborhood} options={["", ...SF_HOODS]} labels={{ "": "Skip" }} onChange={setCf("neighborhood")} />
                : <input className="input" value={c.neighborhood} onChange={(e) => setCf("neighborhood")(e.target.value)} placeholder="Exactly as Craigslist lists it" />}
            </Field>
          </Row>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
            <Check label="Cryptocurrency OK" checked={c.cryptoOk} onChange={setCf("cryptoOk")} />
            <Check label="Delivery available" checked={c.deliveryAvailable} onChange={setCf("deliveryAvailable")} />
            <Check label="Link to my other ads" checked={c.moreAdsLink} onChange={setCf("moreAdsLink")} />
            <Check label="Show address" checked={c.showAddress} onChange={setCf("showAddress")} />
          </div>
          {c.showAddress && (
            <Row cols={3}>
              <Field label="Street"><input className="input" value={c.street} onChange={(e) => setCf("street")(e.target.value)} /></Field>
              <Field label="Cross street"><input className="input" value={c.crossStreet} onChange={(e) => setCf("crossStreet")(e.target.value)} /></Field>
              <Field label="City"><input className="input" value={c.city} onChange={(e) => setCf("city")(e.target.value)} /></Field>
            </Row>
          )}
        </Site>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 px-5 py-3 text-sm font-semibold">Your listings</div>
        <div className="divide-y divide-stone-100">
          {list.data?.products.map((p) =>
            p.listings.map((l) => (
              <div key={l.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-4 px-5 py-3 text-sm">
                <PlatformPill platform={l.platform} />
                <span className="truncate font-medium text-stone-800">{l.title}</span>
                <Status l={l} onRetry={() => post(`/products/${p.id}/list`).then(list.reload)} />
              </div>
            )),
          )}
          {list.data && !list.data.products.length && <p className="px-5 py-6 text-sm text-stone-400">Nothing listed from the app yet.</p>}
        </div>
      </section>
      <div className="sticky bottom-0 z-10 -mx-8 border-t border-stone-200 bg-white/90 backdrop-blur">
        <div className="flex max-w-6xl items-center gap-4 px-8 py-3">
          {err ? <span className="inline-flex items-center gap-1.5 text-sm text-red-600"><CircleAlert size={15} /> {err}</span>
            : <span className="text-sm text-stone-500">Posting to {[useM && "Mercari", useC && "Craigslist"].filter(Boolean).join(" + ") || "—"}</span>}
          <button onClick={submit} disabled={!!busy} className="btn-primary ml-auto px-6">
            {busy === "list" && <Loader2 size={16} className="animate-spin" />} List
          </button>
        </div>
      </div>

    </div>
  );
}

function Status({ l, onRetry }: { l: Product["listings"][number]; onRetry: () => void }) {
  if (l.status === "live" && l.url)
    return <a className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" href={l.url} target="_blank">Live <ExternalLink size={13} /></a>;
  if (l.status === "failed")
    return (
      <span className="inline-flex items-center gap-2 text-red-600" title={l.error ?? ""}>
        Failed <button onClick={onRetry} className="btn-sm">Retry</button>
      </span>
    );
  return <span className="inline-flex items-center gap-1.5 text-stone-500"><Loader2 size={13} className="animate-spin" /> {l.status === "draft" ? "Draft" : "Posting…"}</span>;
}

function Site({ name, platform, on, setOn, hint, actions, children }: { name: string; platform: string; on: boolean; setOn: (v: boolean) => void; hint: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={`card flex flex-col ${on ? "" : "opacity-60"}`}>
      <header className="flex items-center gap-3 border-b border-stone-200 px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span className="font-semibold">{name}</span>
        </label>
        <div className="ml-auto flex gap-2">{on && actions}</div>
      </header>
      <p className="truncate px-5 pt-3 text-xs text-stone-500" title={hint}>{hint}</p>
      {on ? <div className="space-y-4 p-5">{children}</div> : <p className="p-5 text-sm text-stone-400">Not posting to {name}.</p>}
    </section>
  );
}
const Row = ({ cols, children }: { cols: 2 | 3; children: ReactNode }) => <div className={`grid gap-3 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>{children}</div>;
const Field = ({ label, count, children }: { label: string; count?: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <span className="flex justify-between"><span className="label">{label}</span>{count && <span className="text-[11px] text-stone-400">{count}</span>}</span>
    {children}
  </div>
);
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);
const Money = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
    <input className="input pl-6" type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);
function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col rounded-lg bg-stone-100 p-1">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${value === v ? "bg-white text-brand-800 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
function Select({ value, options, labels, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
}
