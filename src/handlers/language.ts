import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { setLocale, t } from "../i18n.js";
const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "Язык", data: "language:choose", order: 60 });
composer.callbackQuery("language:choose", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(await t(ctx, "language"), { reply_markup: inlineKeyboard([[inlineButton("Русский", "language:ru"), inlineButton("English", "language:en")]]) }); });
composer.callbackQuery(/^language:(ru|en)$/, async (ctx) => { await ctx.answerCallbackQuery(); await setLocale(ctx, ctx.match![1] as "ru" | "en"); await ctx.reply(await t(ctx, "languageSet"), { reply_markup: inlineKeyboard([[inlineButton(await t(ctx, "back"), "menu:main")]]) }); });
export default composer;
