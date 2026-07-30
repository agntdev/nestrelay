import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { day, fingerprint, matches, nextId, now, readDomain, writeDomain, type Listing } from "../listing-data.js";
import { t } from "../i18n.js";

// Telegram delivers posts only from channels where the bot is present. This is
// the supported Bot API route for source ingestion; it never pretends to scrape
// channels the bot cannot access.
const composer = new Composer<Ctx>();
composer.on("channel_post:text", async (ctx) => {
  const text = ctx.channelPost.text.trim();
  if (!text) return;
  const lines = text.split("\n").filter(Boolean);
  const title = lines[0].slice(0, 120);
  const price = Number((text.match(/(?:\$|€|£)?\s*([0-9][0-9,]{2,})/)?.[1] ?? "0").replace(/,/g, ""));
  const location = text.match(/(?:location|area|neighborhood)\s*[:\-]\s*([^\n]+)/i)?.[1]?.trim() ?? "Location not provided";
  if (!Number.isFinite(price) || price <= 0) return;
  const data = await readDomain(ctx); const fp = fingerprint(title, location, price);
  if (data.listings.some((l) => l.fingerprint === fp)) return;
  const propertyType = /house|villa|townhome/i.test(text) ? "house" : /room|shared/i.test(text) ? "room" : "apartment";
  const bedrooms = Number(text.match(/(\d+)\s*(?:bed|br)/i)?.[1] ?? "0");
  const listing: Listing = { id: nextId(data, "l"), owner: "channel", ownerChatId: ctx.chat.id, title, description: text, photos: [], price, location, propertyType, bedrooms, source: "channel", postedAt: now().toISOString(), fingerprint: fp };
  data.listings.push(listing);
  for (const sub of data.subscriptions.filter((s) => matches(listing, s))) {
    if (sub.matchDays.filter((d) => d === day()).length >= 20) continue;
    sub.matchDays.push(day());
    try { await ctx.api.sendMessage(sub.chatId, await t(ctx, "match", { listing: `${listing.title}\n${listing.location} · ${listing.price.toLocaleString("ru-RU")}` })); } catch { /* Continue delivering to other subscribers. */ }
  }
  await writeDomain(ctx, data);
});
export default composer;
