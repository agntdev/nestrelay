import type { Ctx } from "./bot.js";

export interface Listing {
  id: string;
  owner: string;
  ownerChatId: number;
  title: string;
  description: string;
  photos: string[];
  price: number;
  location: string;
  propertyType: string;
  bedrooms: number;
  area?: number;
  latitude?: number;
  longitude?: number;
  currency?: string;
  tags?: string[];
  originalMessageUrl?: string;
  source: "submission" | "channel";
  postedAt: string;
  fingerprint: string;
  archived?: boolean;
}
export interface Subscription {
  id: string;
  owner: string;
  chatId: number;
  location?: string;
  priceMin?: number;
  priceMax?: number;
  propertyType?: string;
  bedrooms?: number;
  active: boolean;
  matchDays: string[];
}
export interface Report { id: string; reporter: string; listingId: string; reason: string; timestamp: string; }
export interface UserProfile { locale?: "ru" | "en"; role?: "buyer" | "agent" | "landlord"; favorites?: string[]; chatMaskId?: string; }
export interface AuditEvent { at: string; actor: string; action: string; listingId?: string; }
export interface Domain { next: number; listings: Listing[]; subscriptions: Subscription[]; reports: Report[]; chats: { listingId: string; from: string; text: string; at: string }[]; users: Record<string, UserProfile>; adminUserIds?: string[]; audit?: AuditEvent[]; ingestion?: { lastPostAt?: string; accepted: number; duplicates: number; failed: number }; }

const blank = (): Domain => ({ next: 1, listings: [], subscriptions: [], reports: [], chats: [], users: {} });

// All listing timestamps pass through this seam. Production uses the wall
// clock; a test can install a fixed clock without changing business code.
let clock: () => Date = () => new Date();
export const now = (): Date => clock();
export function setClockForTests(next?: () => Date): void {
  clock = next ?? (() => new Date());
}
export const day = () => now().toISOString().slice(0, 10);
export const fingerprint = (title: string, location: string, price: number) =>
  `${title} ${location} ${price}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type WorkerStore = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } } };
function workerStore(ctx: Ctx): WorkerStore | undefined { return (ctx as Ctx & { env?: WorkerStore }).env; }

export async function readDomain(ctx: Ctx): Promise<Domain> {
  const env = workerStore(ctx);
  if (env?.CHAT_DO) {
    const r = await env.CHAT_DO.get(env.CHAT_DO.idFromName("realestate:catalog")).fetch("https://do/domain", { method: "GET" });
    return r.status === 204 ? blank() : await r.json() as Domain;
  }
  return (ctx.session.localDomain as Domain | undefined) ?? blank();
}
export async function writeDomain(ctx: Ctx, value: Domain): Promise<void> {
  const env = workerStore(ctx);
  if (env?.CHAT_DO) {
    await env.CHAT_DO.get(env.CHAT_DO.idFromName("realestate:catalog")).fetch("https://do/domain", { method: "PUT", body: JSON.stringify(value) });
    return;
  }
  ctx.session.localDomain = value as unknown as Record<string, unknown>;
}
export function nextId(data: Domain, prefix: string): string { return `${prefix}${data.next++}`; }
export function matches(listing: Listing, sub: Subscription): boolean {
  return sub.active && !listing.archived &&
    (!sub.location || listing.location.toLowerCase().includes(sub.location.toLowerCase())) &&
    (sub.priceMin === undefined || listing.price >= sub.priceMin) &&
    (sub.priceMax === undefined || listing.price <= sub.priceMax) &&
    (!sub.propertyType || listing.propertyType === sub.propertyType) &&
    (sub.bedrooms === undefined || listing.bedrooms === sub.bedrooms);
}
export function listingText(l: Listing, locale = "ru"): string {
  return `${l.title}\n${l.location} · ${l.propertyType} · ${l.bedrooms} ${locale === "ru" ? "сп." : "bed"}\n${l.price.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}\n${l.description}`;
}
