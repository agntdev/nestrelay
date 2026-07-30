import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { nextId, now, readDomain, writeDomain } from "../listing-data.js";

registerMainMenuItem({ label: "Report listing", data: "report:start", order: 40 });
registerMainMenuItem({ label: "Review reports", data: "moderation:reports", order: 50 });
const composer = new Composer<Ctx>();
async function choose(ctx: Ctx) {
  const listings = (await readDomain(ctx)).listings.filter((l) => !l.archived);
  if (!listings.length) { await ctx.reply("There are no listings to report yet.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); return; }
  await ctx.reply("Choose the listing you want us to review.", { reply_markup: inlineKeyboard([...listings.slice(0, 8).map((l) => [inlineButton(l.title, `report:listing:${l.id}`)]), [inlineButton("Back to menu", "menu:main")]]) });
}
composer.callbackQuery("report:start", async (ctx) => { await ctx.answerCallbackQuery(); await choose(ctx); });
composer.callbackQuery("moderation:reports", async (ctx) => {
  await ctx.answerCallbackQuery();
  const chat = ctx.chat;
  if (!chat || chat.type === "private" || !ctx.from) { await ctx.reply("Open this in your moderation group. Group admins can review the report queue there."); return; }
  try {
    const member = await ctx.api.getChatMember(chat.id, ctx.from.id);
    if (member.status !== "administrator") { await ctx.reply("Only group admins can review reports."); return; }
  } catch { await ctx.reply("Couldn’t verify your moderator access. Try again in the moderation group."); return; }
  const data = await readDomain(ctx);
  const titles = data.reports.slice(-10).map((r) => data.listings.find((l) => l.id === r.listingId)?.title).filter((x): x is string => Boolean(x));
  await ctx.reply(titles.length ? `Listings awaiting review:\n${titles.join("\n")}` : "No listings are awaiting review.");
});
composer.callbackQuery(/^report:listing:(l\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.draft = { listingId: ctx.match![1] }; await ctx.reply("What’s the issue?", { reply_markup: inlineKeyboard([[inlineButton("Duplicate", "report:reason:duplicate"), inlineButton("Misleading", "report:reason:misleading")], [inlineButton("Suspected scam", "report:reason:scam")], [inlineButton("Back to menu", "menu:main")]]) }); });
composer.callbackQuery(/^report:reason:(duplicate|misleading|scam)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const listingId = String(ctx.session.draft?.listingId ?? ""); const data = await readDomain(ctx); const listing = data.listings.find((x) => x.id === listingId);
  if (!listing) { await ctx.reply("That listing is no longer available."); return; }
  data.reports.push({ id: nextId(data, "r"), reporter: String(ctx.from?.id ?? ""), listingId, reason: ctx.match![1], timestamp: now().toISOString() }); listing.archived = true; await writeDomain(ctx, data); ctx.session.draft = undefined;
  const chat = ctx.chat;
  if (chat && chat.type !== "private") { try { await ctx.api.sendMessage(chat.id, "A listing needs moderation review. Open Review reports to see the queue."); } catch { /* The durable report remains available to moderators. */ } }
  await ctx.reply("Thanks. We’ve sent this listing to moderation and removed it from the catalog while it’s reviewed.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:search")], [inlineButton("Back to menu", "menu:main")]]) });
});
export default composer;
