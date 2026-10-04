import { z } from "zod";

// Every field the seller fills in the web app. The browser scripts set each one
// explicitly on the site — nothing is left to the site's autofill or defaults.
// Category is fixed: Mercari "Electronics > Computers & Laptops > Laptops",
// Craigslist "for sale by owner > computers".

export const MERCARI_CONDITIONS = ["New", "Like new", "Good", "Fair", "Poor"] as const;
export const CRAIGSLIST_CONDITIONS = ["new", "like new", "excellent", "good", "fair", "salvage"] as const;
export const MERCARI_CARRIERS = [
  "USPS Ground Advantage",
  "UPS Ground",
  "FedEx Ground Economy",
  "FedEx Home",
  "USPS Priority Mail",
] as const;
export const CRAIGSLIST_SUBAREAS = [
  "city of san francisco",
  "south bay area",
  "east bay area",
  "peninsula",
  "north bay / marin",
  "santa cruz co",
] as const;

const mercari = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(1000), // Mercari also requires 5+ words
  price: z.number().min(1).max(2000), // dollars
  condition: z.enum(MERCARI_CONDITIONS),
  brand: z.string().max(100), // "" = "No brand / Not sure"
  smartPricing: z.boolean(),
  smartPricingMin: z.number().min(1).optional(), // required when smartPricing
  shipping: z.discriminatedUnion("method", [
    z.object({ method: z.literal("own") }),
    z.object({
      method: z.literal("prepaid"),
      weightLb: z.number().int().min(0),
      weightOz: z.number().int().min(0).max(15),
      fitsShoebox: z.boolean(),
      lengthIn: z.number().positive().optional(), // asked when it doesn't fit a shoebox
      widthIn: z.number().positive().optional(),
      heightIn: z.number().positive().optional(),
      carrier: z.enum(MERCARI_CARRIERS),
      freeShipping: z.boolean(), // "Offer buyers free shipping?"
    }),
  ]),
});

const craigslist = z.object({
  title: z.string().min(1).max(70),
  description: z.string().min(1),
  price: z.number().min(0),
  condition: z.enum(CRAIGSLIST_CONDITIONS),
  make: z.string(),
  model: z.string(),
  size: z.string(),
  subarea: z.enum(CRAIGSLIST_SUBAREAS),
  neighborhood: z.string(), // must match a neighborhood shown for the subarea; "" = bypass
  zip: z.string().min(5).max(15),
  language: z.string().default("english"),
  cryptoOk: z.boolean(),
  deliveryAvailable: z.boolean(),
  moreAdsLink: z.boolean(),
  showAddress: z.boolean(),
  street: z.string().max(80),
  crossStreet: z.string().max(80),
  city: z.string().max(80),
  // Contact is forced to email only (CL chat, phone and text OFF) so every buyer
  // message arrives by email and reaches the unified inbox.
});

export const listingSchema = z.object({ mercari: mercari.optional(), craigslist: craigslist.optional() });
export type MercariListing = z.infer<typeof mercari>;
export type CraigslistListing = z.infer<typeof craigslist>;
export type ListingInput = z.infer<typeof listingSchema>;
