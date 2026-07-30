import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { day, fingerprint, listingText, matches, nextId, now, readDomain, writeDomain, type Listing } from "../listing-data.js";

registerMainMenuItem({ label: "Submit listing", data: "submit:start", order: 10 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const ask = (ctx: Ctx, step: string, text: string, placeholder: string) => {
  ctx.session.step = step;
  return ctx.reply(text, { reply_markup: { force_reply: true, input_field_placeholder: placeholder } });
};
const types = inlineKeyboard([[inlineButton("Apartment", "submit:type:apartment"), inlineButton("House", "submit:type:house")], [inlineButton("Room", "submit:type:room"), inlineButton("Other", "submit:type:other")], [inlineButton("Back to menu", "menu:main")]]);

composer.callbackQuery("submit:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = { photos: [] };
  ctx.session.step = "submit:photos";
  await ctx.reply("Send photos if you have them, then tap Continue.", { reply_markup: inlineKeyboard([[inlineButton("Continue", "submit:photos:done")], [inlineButton("Back to menu", "menu:main")]]) });
});
composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "submit:photos") return next();
  const photos = (ctx.session.draft?.photos as string[] | undefined) ?? [];
  photos.push(ctx.message.photo[ctx.message.photo.length - 1].file_id);
  ctx.session.draft = { ...ctx.session.draft, photos };
  await ctx.reply("Photo added. Send another or tap Continue.");
});
composer.callbackQuery("submit:photos:done", async (ctx) => { await ctx.answerCallbackQuery(); await ask(ctx, "submit:title", "What should buyers see as the title?", "e.g. Bright two-bedroom near the park"); });
composer.callbackQuery(/^submit:type:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = { ...ctx.session.draft, propertyType: ctx.match![1] };
  await ctx.reply("How many bedrooms does it have?", { reply_markup: inlineKeyboard([[1, 2, 3, 4].map((n) => inlineButton(`${n} bed`, `submit:beds:${n}`)), [inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery(/^submit:beds:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = { ...ctx.session.draft, bedrooms: Number(ctx.match![1]) };
  const d = ctx.session.draft as Record<string, unknown>;
  ctx.session.step = "submit:confirm";
  await ctx.reply(`Check your listing:\n${String(d.title)}\n${String(d.location)} · ${String(d.propertyType)} · ${String(d.bedrooms)} bed\n${Number(d.price).toLocaleString()}\n${String(d.description)}`, { reply_markup: inlineKeyboard([[inlineButton("Publish listing", "submit:confirm")], [inlineButton("Cancel", "menu:main")]]) });
});
composer.callbackQuery("submit:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = ctx.session.draft as Record<string, unknown> | undefined;
  if (!d || !d.title || !d.description || !d.price || !d.location || !d.propertyType || !d.bedrooms) { await ctx.reply("That draft is incomplete. Start a new listing from the menu.", { reply_markup: back }); return; }
  const data = await readDomain(ctx); const price = Number(d.price); const fp = fingerprint(String(d.title), String(d.location), price);
  let listing = data.listings.find((l) => l.fingerprint === fp);
  if (listing) { ctx.session.step = "idle"; await ctx.reply("That listing is already in the catalog, so we didn’t add it twice.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:search")], [inlineButton("Back to menu", "menu:main")]]) }); return; }
  listing = { id: nextId(data, "l"), owner: String(ctx.from?.id ?? ""), ownerChatId: ctx.chat!.id, title: String(d.title), description: String(d.description), photos: (d.photos as string[]) ?? [], price, location: String(d.location), propertyType: String(d.propertyType), bedrooms: Number(d.bedrooms), source: "submission", postedAt: now().toISOString(), fingerprint: fp } satisfies Listing;
  data.listings.push(listing); await writeDomain(ctx, data); ctx.session.step = "idle"; ctx.session.draft = undefined;
  await ctx.reply(`Your listing is live.\n\n${listingText(listing)}`, { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:search")], [inlineButton("Back to menu", "menu:main")]]) });
  for (const sub of data.subscriptions.filter((s) => matches(listing!, s))) {
    const count = sub.matchDays.filter((x) => x === day()).length;
    if (count >= 20) continue;
    sub.matchDays.push(day());
    try { await ctx.api.sendMessage(sub.chatId, `A listing matches your subscription.\n\n${listingText(listing)}`, { reply_markup: inlineKeyboard([[inlineButton("View listing", `catalog:view:${listing.id}`), inlineButton("Pause matches", `subs:toggle:${sub.id}`)]]) }); } catch { /* A blocked user must not stop other deliveries. */ }
  }
  await writeDomain(ctx, data);
});
composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim(); const step = ctx.session.step;
  if (step === "submit:title") { ctx.session.draft = { ...ctx.session.draft, title: text }; await ask(ctx, "submit:description", "Add a short description.", "Mention condition, terms, or standout details"); return; }
  if (step === "submit:description") { ctx.session.draft = { ...ctx.session.draft, description: text }; await ask(ctx, "submit:price", "What’s the price?", "Numbers only, e.g. 1800"); return; }
  if (step === "submit:price") { const n = Number(text.replace(/[^0-9.]/g, "")); if (!Number.isFinite(n) || n <= 0) { await ctx.reply("Enter a positive price using numbers only."); return; } ctx.session.draft = { ...ctx.session.draft, price: n }; await ask(ctx, "submit:location", "Where is the property?", "City and neighborhood"); return; }
  if (step === "submit:location") { const description = String(ctx.session.draft?.description ?? "").toLowerCase(); const inferred = /house|garden|yard/.test(description) ? "house" : /room|shared/.test(description) ? "room" : "apartment"; ctx.session.draft = { ...ctx.session.draft, location: text, inferred }; ctx.session.step = "submit:type"; await ctx.reply(`Pick the property type. We suggest ${inferred}.`, { reply_markup: types }); return; }
  return next();
});
export default composer;
