"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, CircleAlert, ExternalLink, ImagePlus, Loader2, Sparkles, SplitSquareHorizontal, X } from "lucide-react";
import { api, post, usePolling } from "../lib";
import { PageHeader, PlatformPill, useConfirm } from "../ui";

// Mirrors src/listing.ts (the backend validates with that schema). Every field is set by
// the seller; the browser agent copies these values onto each site — nothing is guessed.
// Fields both sites share are entered once in "Item details"; title, description and
// price can be split per marketplace. Site cards hold only site-specific fields.

type Site = "mercari" | "craigslist";
const SITES: Site[] = ["mercari", "craigslist"];
const NAME: Record<Site, string> = { mercari: "Mercari", craigslist: "Craigslist" };
const TITLE_MAX: Record<Site, number> = { mercari: 80, craigslist: 70 };
const DESC_MAX: Record<Site, number> = { mercari: 1000, craigslist: 4000 };

// One condition scale (Mercari's), mapped onto Craigslist's.
const CONDITIONS = ["New", "Like new", "Good", "Fair", "Poor"] as const;
const CL_CONDITION: Record<string, string> = { New: "new", "Like new": "like new", Good: "good", Fair: "fair", Poor: "salvage" };
const CONDITION_HINT: Record<string, string> = {
  New: "Unused, in original packaging", "Like new": "Unused, no signs of wear", Good: "Gently used, minor flaws",
  Fair: "Used, several flaws", Poor: "Major flaws or for parts",
};
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

type Splittable = "title" | "description" | "price";
type Texts = Record<Splittable, string>;
const emptyTexts: Texts = { title: "", description: "", price: "" };

const emptyMercari = {
  shippingMethod: "own", weightLb: "", weightOz: "0", fitsShoebox: false, lengthIn: "", widthIn: "", heightIn: "",
  carrier: "USPS Ground Advantage", freeShipping: false, smartPricing: false, smartPricingMin: "",
};
const emptyCraigslist = {
  model: "", size: "", subarea: "city of san francisco", neighborhood: "SOMA / south beach", zip: "94105", language: "english",
  cryptoOk: false, deliveryAvailable: false, moreAdsLink: false, showAddress: false, street: "", crossStreet: "", city: "San Francisco",
};
type M = typeof emptyMercari;
type C = typeof emptyCraigslist;

type Product = {
  id: number; created_at: string; photo_keys: string[];
  listings: { id: number; platform: string; title: string; status: string; url: string | null; error: string | null }[];
};

export default function Products() {
  const list = usePolling<{ products: Product[]; syncing: boolean }>("/products", (d) => d.syncing || d.products.some((p) => p.listings.some((l) => l.status === "posting" || l.status === "delisting")));
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [on, setOn] = useState<Record<Site, boolean>>({ mercari: true, craigslist: true });
  const [shared, setShared] = useState({ ...emptyTexts, condition: "Good", brand: "" });
  const [split, setSplit] = useState<Record<Splittable, boolean>>({ title: false, description: false, price: false });
  const [per, setPer] = useState<Record<Site, Texts>>({ mercari: { ...emptyTexts }, craigslist: { ...emptyTexts } });
  const [m, setM] = useState<M>(emptyMercari);
  const [c, setC] = useState<C>(emptyCraigslist);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, ask] = useConfirm();

  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const listingsRef = useRef<HTMLElement>(null);

  const sites = SITES.filter((s) => on[s]);
  const both = sites.length === 2;
  // a shared title has to fit every marketplace it goes to
  const sharedTitleMax = Math.min(...sites.map((s) => TITLE_MAX[s]), 80);
  const sharedDescMax = Math.min(...sites.map((s) => DESC_MAX[s]), 4000);
  const value = (s: Site, f: Splittable) => (split[f] && both ? per[s][f] : shared[f]);

  const setMf = (k: keyof M) => (v: any) => setM((x) => ({ ...x, [k]: v }));
  const setCf = (k: keyof C) => (v: any) => setC((x) => ({ ...x, [k]: v }));

  function toggleSplit(f: Splittable, next: boolean) {
    if (next) {
      // start each marketplace from the shared value
      setPer((p) => ({
        mercari: { ...p.mercari, [f]: shared[f] },
        craigslist: { ...p.craigslist, [f]: f === "title" ? shared.title.slice(0, TITLE_MAX.craigslist) : shared[f] },
      }));
    } else {
      setShared((x) => ({ ...x, [f]: per.mercari[f] || per.craigslist[f] }));
    }
    setSplit((x) => ({ ...x, [f]: next }));
  }

  function toggleSite(s: Site, next: boolean) {
    if (!next) {
      // with one marketplace left there is nothing to split: keep that marketplace's values
      const keep: Site = s === "mercari" ? "craigslist" : "mercari";
      setShared((x) => ({ ...x, ...Object.fromEntries((Object.keys(split) as Splittable[]).filter((f) => split[f]).map((f) => [f, per[keep][f]])) }));
      setSplit({ title: false, description: false, price: false });
    }
    setOn((x) => ({ ...x, [s]: next }));
  }

  // What each site will receive — also drives validation and the summary bar.
  const payload = useMemo(() => ({
    ...(on.mercari ? { mercari: {
      title: value("mercari", "title"), description: value("mercari", "description"), price: Number(value("mercari", "price")),
      condition: shared.condition, brand: shared.brand.trim(),
      smartPricing: m.smartPricing, ...(m.smartPricing ? { smartPricingMin: Number(m.smartPricingMin) } : {}),
      shipping: m.shippingMethod === "own" ? { method: "own" } : {
        method: "prepaid", weightLb: Number(m.weightLb), weightOz: Number(m.weightOz), fitsShoebox: m.fitsShoebox,
        ...(m.fitsShoebox ? {} : { lengthIn: Number(m.lengthIn), widthIn: Number(m.widthIn), heightIn: Number(m.heightIn) }),
        carrier: m.carrier, freeShipping: m.freeShipping,
      },
    } } : {}),
    ...(on.craigslist ? { craigslist: {
      ...c, title: value("craigslist", "title"), description: value("craigslist", "description"), price: Number(value("craigslist", "price")),
      condition: CL_CONDITION[shared.condition], make: shared.brand.trim(),
    } } : {}),
  }), [on, shared, split, per, m, c]); // eslint-disable-line react-hooks/exhaustive-deps

  function problems(): string[] {
    const out: string[] = [];
    if (!photos.length) out.push("Add at least one photo");
    if (!sites.length) out.push("Choose at least one marketplace");
    for (const s of sites) {
      const t = value(s, "title"), d = value(s, "description"), p = Number(value(s, "price"));
      if (!t.trim()) out.push(`${NAME[s]} title is empty`);
      else if (t.length > TITLE_MAX[s]) out.push(`${NAME[s]} title is over ${TITLE_MAX[s]} characters`);
      if (!d.trim()) out.push(`${NAME[s]} description is empty`);
      if (s === "mercari" && d.trim() && d.trim().split(/\s+/).length < 5) out.push("Mercari description needs 5+ words");
      if (!value(s, "price") || !(p >= (s === "mercari" ? 1 : 0)) || (s === "mercari" && p > 2000)) out.push(`${NAME[s]} price ${s === "mercari" ? "must be $1–$2000" : "is missing"}`);
    }
    if (on.mercari && m.shippingMethod === "prepaid" && !m.weightLb && m.weightOz === "0") out.push("Add the package weight");
    if (on.mercari && m.smartPricing && !m.smartPricingMin) out.push("Add a Smart Pricing minimum price");
    return out;
  }

  async function draftWithAI() {
    setBusy("draft");
    setErr(null);
    try {
      const d = await post("/draft-text", { site: on.craigslist ? "craigslist" : "mercari", notes }); // Craigslist's title limit is the tighter one
      setShared((x) => ({ ...x, title: d.title, description: d.description }));
      setSplit((x) => ({ ...x, title: false, description: false }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const p = problems();
    if (p.length) return setErr(p.join(" · "));
    setErr(null);
    const ok = await ask({
      title: `List on ${sites.map((s) => NAME[s]).join(" and ")}?`,
      body: (
        <div className="space-y-2">
          <p>This posts publicly. A cloud browser fills in each marketplace's form with exactly these values:</p>
          <ul className="space-y-1">
            {sites.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <PlatformPill platform={s} />
                <span className="min-w-0 truncate text-stone-800">{value(s, "title")}</span>
                <span className="ml-auto font-medium text-stone-900">${value(s, "price")}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
      confirm: `List on ${sites.length === 2 ? "both" : NAME[sites[0]]}`,
    });
    if (!ok) return;
    setBusy("list");
    try {
      const fd = new FormData();
      photos.forEach((f) => fd.append("photos", f));
      fd.append("listing", JSON.stringify(payload));
      const { product } = await api("/products", { method: "POST", body: fd });
      await post(`/products/${product.id}/list`);
      setPhotos([]);
      setNotes("");
      setShared({ ...emptyTexts, condition: "Good", brand: "" });
      setSplit({ title: false, description: false, price: false });
      setPer({ mercari: { ...emptyTexts }, craigslist: { ...emptyTexts } });
      setM(emptyMercari);
      setC(emptyCraigslist);
      await list.reload();
      listingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Listings" subtitle="Describe the item once, then add what each marketplace needs. Nothing is posted until you click List." />

      {/* 1 · where + photos */}
      <section className="card">
        <header className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-5 py-3">
        <span className="label mr-2">Post to</span>
        {SITES.map((s) => (
          <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${on[s] ? "border-brand-600 bg-brand-50 text-brand-900" : "border-stone-300 text-stone-500"}`}>
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={on[s]} onChange={(e) => toggleSite(s, e.target.checked)} />
            {NAME[s]}
          </label>
        ))}
        <span className="ml-auto text-xs text-stone-500">Category: Laptops</span>
        </header>
        <div className="p-5">
        <div className="label mb-2">Photos · {photos.length}/12 · used on every marketplace</div>
        <div className="grid grid-cols-6 gap-2 xl:grid-cols-8">
          {photos.map((f, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
              <img src={previews[i]} alt="" className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">Cover</span>}
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
      </section>

      {/* 3 · item details (shared) */}
      <section className="card">
        <header className="flex items-center gap-3 border-b border-stone-200 px-5 py-3">
          <div>
            <h2 className="font-semibold">Item details</h2>
            <p className="text-xs text-stone-500">Entered once and used on {sites.length ? sites.map((s) => NAME[s]).join(" and ") : "each marketplace"}. Split a field to make it different per marketplace.</p>
          </div>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-end gap-2 rounded-lg bg-brand-50/60 p-3 ring-1 ring-brand-100">
            <div className="flex-1">
              <div className="label mb-1.5">Quick notes for AI (optional)</div>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ThinkPad T14, 16GB RAM, charger included, small scratch on the lid" />
            </div>
            <button onClick={draftWithAI} disabled={!notes.trim() || !!busy} className="btn-secondary">
              {busy === "draft" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} className="text-amber-600" />} Draft title &amp; description
            </button>
          </div>

          <SplitField label="Title" split={split.title && both} canSplit={both} onSplit={(v) => toggleSplit("title", v)}
            shared={<CountedInput value={shared.title} max={sharedTitleMax} onChange={(v) => setShared((x) => ({ ...x, title: v }))} hint={both ? "Fits both marketplaces" : undefined} />}
            perSite={(s) => <CountedInput value={per[s].title} max={TITLE_MAX[s]} onChange={(v) => setPer((p) => ({ ...p, [s]: { ...p[s], title: v } }))} />} />

          <SplitField label="Description" split={split.description && both} canSplit={both} onSplit={(v) => toggleSplit("description", v)}
            shared={<CountedArea value={shared.description} max={sharedDescMax} onChange={(v) => setShared((x) => ({ ...x, description: v }))} />}
            perSite={(s) => <CountedArea value={per[s].description} max={DESC_MAX[s]} onChange={(v) => setPer((p) => ({ ...p, [s]: { ...p[s], description: v } }))} />} />

          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-4">
            <SplitField label="Price" split={split.price && both} canSplit={both} onSplit={(v) => toggleSplit("price", v)} compact
              hint={on.mercari ? "Mercari keeps a 10% selling fee" : undefined}
              shared={<Money value={shared.price} onChange={(v) => setShared((x) => ({ ...x, price: v }))} />}
              perSite={(s) => <Money prefix={NAME[s]} value={per[s].price} onChange={(v) => setPer((p) => ({ ...p, [s]: { ...p[s], price: v } }))} />} />
            <Field label="Condition" hint={CONDITION_HINT[shared.condition]}>
              <Select value={shared.condition} options={[...CONDITIONS]} onChange={(v) => setShared((x) => ({ ...x, condition: v }))} />
            </Field>
            <Field label="Brand" hint={on.craigslist ? "Also Craigslist's make / manufacturer" : undefined}>
              <input className="input" value={shared.brand} onChange={(e) => setShared((x) => ({ ...x, brand: e.target.value }))} placeholder="Leave blank for no brand" />
            </Field>
          </div>
        </div>
      </section>

      {/* 4 · marketplace-specific */}
      {sites.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {on.mercari && (
            <SiteCard site="mercari" hint="Ships from your Mercari default address">
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
                  <Field label="Carrier" hint="Only carriers Mercari offers for this package size will work"><Select value={m.carrier} options={CARRIERS} onChange={setMf("carrier")} /></Field>
                  <Row cols={2}>
                    <Field label="Free shipping for buyer?"><Segmented value={m.freeShipping ? "yes" : "no"} onChange={(v) => setMf("freeShipping")(v === "yes")} options={[["yes", "Yes"], ["no", "No"]]} /></Field>
                    <div />
                  </Row>
                </div>
              )}
              <Row cols={2}>
                <Field label="Smart Pricing" hint="Mercari lowers the price over time"><Segmented value={m.smartPricing ? "on" : "off"} onChange={(v) => setMf("smartPricing")(v === "on")} options={[["off", "Off"], ["on", "On"]]} /></Field>
                {m.smartPricing ? <Field label="Minimum price"><Money value={m.smartPricingMin} onChange={setMf("smartPricingMin")} /></Field> : <div />}
              </Row>
            </SiteCard>
          )}
          {on.craigslist && (
            <SiteCard site="craigslist" hint="SF bay area · computers by owner · buyers contact you by email">
              <Row cols={2}>
                <Field label="Area"><Select value={c.subarea} options={SUBAREAS} onChange={(v: string) => setC((x) => ({ ...x, subarea: v, neighborhood: "" }))} /></Field>
                <Field label="Neighborhood">
                  {c.subarea === "city of san francisco"
                    ? <Select value={c.neighborhood} options={["", ...SF_HOODS]} labels={{ "": "Skip" }} onChange={setCf("neighborhood")} />
                    : <input className="input" value={c.neighborhood} onChange={(e) => setCf("neighborhood")(e.target.value)} placeholder="As Craigslist lists it" />}
                </Field>
              </Row>
              <Row cols={3}>
                <Field label="ZIP"><input className="input" value={c.zip} onChange={(e) => setCf("zip")(e.target.value)} /></Field>
                <Field label="Model"><input className="input" value={c.model} onChange={(e) => setCf("model")(e.target.value)} placeholder="e.g. ThinkPad T14" /></Field>
                <Field label="Size / dimensions"><input className="input" value={c.size} onChange={(e) => setCf("size")(e.target.value)} placeholder="e.g. 14 inch" /></Field>
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
            </SiteCard>
          )}
        </div>
      )}

      <section ref={listingsRef} className="card scroll-mt-6 overflow-hidden">
        <div className="border-b border-stone-200 px-5 py-3 text-sm font-semibold">Your listings</div>
        <div className="divide-y divide-stone-200">
          {list.data?.products.map((p) => {
            const live = p.listings.filter((l) => l.status === "live");
            const sold = p.listings.every((l) => l.status === "removed");
            return (
              <div key={p.id} className="px-5 py-3">
                <div className="mb-1.5 flex items-center gap-3">
                  <span className="truncate text-sm font-semibold text-stone-900">{p.listings[0]?.title}</span>
                  {sold && <span className="pill bg-stone-100 text-stone-600"><BadgeCheck size={12} /> Sold</span>}
                  {live.length > 0 && (
                    <button
                      className="btn-sm ml-auto"
                      onClick={async () => {
                        const where = live.map((l) => (l.platform === "mercari" ? "Mercari" : "Craigslist")).join(" and ");
                        const ok = await ask({
                          title: "Mark as sold?",
                          body: <p>This removes “{p.listings[0]?.title}” from {where}. The listing{live.length > 1 ? "s are" : " is"} deleted on the marketplace and can't be undone.</p>,
                          confirm: `Remove from ${live.length > 1 ? "both" : where}`,
                          danger: true,
                        });
                        if (ok) post(`/products/${p.id}/sold`).then(list.reload);
                      }}
                    >
                      <BadgeCheck size={13} /> Mark sold
                    </button>
                  )}
                </div>
                {p.listings.map((l) => (
                  <div key={l.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-4 py-1.5 text-sm">
                    <PlatformPill platform={l.platform} />
                    <span className="truncate text-stone-600">{l.title}</span>
                    <Status l={l} onRetry={() => post(`/products/${p.id}/list`).then(list.reload)} />
                  </div>
                ))}
              </div>
            );
          })}
          {list.data && !list.data.products.length && <p className="px-5 py-6 text-sm text-stone-400">Nothing listed from the app yet.</p>}
        </div>
      </section>

      {dialog}
      <div className="sticky bottom-0 z-10 -mx-8 border-t border-stone-200 bg-white/90 backdrop-blur">
        <div className="flex max-w-6xl items-center gap-4 px-8 py-3">
          {err ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-red-600"><CircleAlert size={15} className="shrink-0" /> <span className="truncate">{err}</span></span>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm text-stone-500">
              {!sites.length ? "Choose a marketplace" : !sites.some((s) => value(s, "title").trim()) ? "Fill in the item details to see what each marketplace gets" : sites.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <PlatformPill platform={s} />
                  <span className="max-w-56 truncate text-stone-700">{value(s, "title") || "Untitled"}</span>
                  <span className="font-medium text-stone-900">{value(s, "price") ? `$${value(s, "price")}` : "—"}</span>
                </span>
              ))}
            </span>
          )}
          <button onClick={submit} disabled={!!busy || !sites.length} className="btn-primary ml-auto px-6">
            {busy === "list" && <Loader2 size={16} className="animate-spin" />} List on {sites.length === 2 ? "both" : sites.map((s) => NAME[s]).join("") || "—"}
          </button>
        </div>
      </div>
    </div>
  );
}

// A field that is shared by default and can be split into one input per marketplace.
function SplitField({ label, split, canSplit, onSplit, shared, perSite, compact, hint }: {
  label: string; split: boolean; canSplit: boolean; onSplit: (v: boolean) => void;
  shared: ReactNode; perSite: (s: Site) => ReactNode; compact?: boolean; hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {canSplit && (
          <button type="button" onClick={() => onSplit(!split)}
            className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${split ? "text-brand-700" : "text-stone-400 hover:text-stone-600"}`}>
            <SplitSquareHorizontal size={12} /> {split ? "Use one for both" : "Different per marketplace"}
          </button>
        )}
      </div>
      {split ? (
        compact ? (
          <div className="grid grid-cols-2 gap-2">{SITES.map((s) => <div key={s} className="min-w-0">{perSite(s)}</div>)}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {SITES.map((s) => (
              <div key={s} className="flex min-w-0 flex-col gap-1">
                <div className="self-start"><PlatformPill platform={s} /></div>
                {perSite(s)}
              </div>
            ))}
          </div>
        )
      ) : shared}
      {hint && <span className="text-[11px] text-stone-400">{hint}</span>}
    </div>
  );
}

function CountedInput({ value, max, onChange, hint }: { value: string; max: number; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <input className="input" maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
      <Meta left={hint} right={`${value.length}/${max}`} over={value.length > max} />
    </div>
  );
}
function CountedArea({ value, max, onChange }: { value: string; max: number; onChange: (v: string) => void }) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div>
      <textarea className="input" rows={4} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
      <Meta left={`${words} words`} right={`${value.length}/${max}`} over={value.length > max} />
    </div>
  );
}
const Meta = ({ left, right, over }: { left?: string; right: string; over?: boolean }) => (
  <div className="mt-1 flex justify-between text-[11px] text-stone-400">
    <span>{left}</span>
    <span className={over ? "font-semibold text-red-600" : ""}>{right}</span>
  </div>
);

function Status({ l, onRetry }: { l: Product["listings"][number]; onRetry: () => void }) {
  if (l.status === "removed") return <span className="text-stone-400">Removed</span>;
  if (l.status === "delisting") return <span className="inline-flex items-center gap-1.5 text-stone-500"><Loader2 size={13} className="animate-spin" /> Removing…</span>;
  if (l.status === "live" && l.url)
    return (
      <span className="inline-flex items-center gap-2">
        {l.error && <span className="max-w-64 truncate text-xs text-red-600" title={l.error}>{l.error}</span>}
        <a className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" href={l.url} target="_blank">Live <ExternalLink size={13} /></a>
      </span>
    );
  if (l.status === "failed")
    return (
      <span className="inline-flex items-center gap-2 text-red-600" title={l.error ?? ""}>
        Failed <button onClick={onRetry} className="btn-sm">Retry</button>
      </span>
    );
  return <span className="inline-flex items-center gap-1.5 text-stone-500"><Loader2 size={13} className="animate-spin" /> {l.status === "draft" ? "Draft" : "Posting…"}</span>;
}

function SiteCard({ site, hint, children }: { site: Site; hint: string; children: ReactNode }) {
  return (
    <section className="card flex flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 px-5 py-3">
        <h2 className="shrink-0 whitespace-nowrap font-semibold">{NAME[site]} only</h2>
        <span className="truncate text-xs text-stone-500" title={hint}>{hint}</span>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}
const Row = ({ cols, children }: { cols: 2 | 3; children: ReactNode }) => <div className={`grid gap-3 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>{children}</div>;
const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-stone-400">{hint}</span>}
  </div>
);
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);
const Money = ({ value, onChange, prefix }: { value: string; onChange: (v: string) => void; prefix?: string }) => (
  <div className="flex items-center rounded-lg border border-stone-300 bg-white shadow-xs focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
    {prefix && <span className="shrink-0 border-r border-stone-200 px-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{prefix}</span>}
    <span className="pl-2.5 text-sm text-stone-400">$</span>
    <input className="w-full min-w-0 bg-transparent px-1.5 py-2 text-sm outline-none" type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
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
