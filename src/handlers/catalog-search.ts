import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { listingText, now, readDomain, writeDomain } from "../listing-data.js";
registerMainMenuItem({ label: "Browse catalog", data: "catalog:search", order: 20 });
const composer = new Composer<Ctx>();
async function show(ctx: Ctx, query = "", sort = "new") {
  const data = await readDomain(ctx); let items = data.listings.filter((x) => !x.archived && `${x.title} ${x.description} ${x.location} ${x.propertyType}`.toLowerCase().includes(query.toLowerCase()));
  items = [...items].sort((a, b) => sort === "price" ? a.price - b.price : b.postedAt.localeCompare(a.postedAt));
  if (!items.length) { await ctx.reply("No listings match yet — try another search or submit one.", { reply_markup: inlineKeyboard([[inlineButton("Submit listing", "submit:start")], [inlineButton("Back to menu", "menu:main")]]) }); return; }
  await ctx.reply("Choose a listing.", { reply_markup: inlineKeyboard([...items.slice(0, 8).map((x) => [inlineButton(`${x.title} · ${x.price.toLocaleString()}`, `catalog:view:${x.id}`)]), [inlineButton("Newest first", "catalog:sort:new"), inlineButton("Lowest price", "catalog:sort:price")], [inlineButton("Search again", "catalog:query"), inlineButton("Back to menu", "menu:main")]]) });
}
composer.callbackQuery("catalog:search", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
composer.callbackQuery("catalog:query", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "catalog:query"; await ctx.reply("Type a city, neighborhood, or property type.", { reply_markup: { force_reply: true, input_field_placeholder: "e.g. Riverside apartment" } }); });
composer.callbackQuery(/^catalog:sort:(new|price)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, "", ctx.match![1]); });
composer.callbackQuery(/^catalog:view:(l\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const l = (await readDomain(ctx)).listings.find((x) => x.id === ctx.match![1] && !x.archived); if (!l) { await ctx.reply("That listing is no longer available."); return; } await ctx.reply(listingText(l), { reply_markup: inlineKeyboard([[inlineButton("Contact owner", `contact:init:${l.id}`), inlineButton("Report listing", `report:listing:${l.id}`)], [inlineButton("Browse catalog", "catalog:search")]]) }); });
composer.callbackQuery(/^contact:init:(l\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "contact:message"; ctx.session.draft = { listingId: ctx.match![1] }; await ctx.reply("Write your message. We’ll relay it without sharing your identity.", { reply_markup: { force_reply: true, input_field_placeholder: "Ask about availability or a viewing" } }); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.step === "catalog:query") { ctx.session.step = "idle"; await show(ctx, ctx.message.text.trim()); return; } if (ctx.session.step !== "contact:message") return next(); const listingId = String(ctx.session.draft?.listingId ?? ""); const data = await readDomain(ctx); const l = data.listings.find((x) => x.id === listingId); if (!l) { await ctx.reply("That listing is no longer available."); return; } data.chats.push({ listingId, from: String(ctx.from?.id ?? ""), text: ctx.message.text.trim(), at: now().toISOString() }); await writeDomain(ctx, data); ctx.session.step = "idle"; try { await ctx.api.sendMessage(l.ownerChatId, `A buyer sent a message about your listing:\n${ctx.message.text.trim()}`); } catch { /* Relay is archived even if the recipient cannot be reached. */ } await ctx.reply("Your message was relayed. The owner can reply through the listing."); });
export default composer;
