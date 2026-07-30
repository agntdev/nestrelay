import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { t } from "../i18n.js";
const composer = new Composer<Ctx>();
composer.command("help", async (ctx) => { await ctx.reply(await t(ctx, "help")); });
composer.callbackQuery("menu:help", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText(await t(ctx, "help"), { reply_markup: inlineKeyboard([[inlineButton(await t(ctx, "back"), "menu:main")]]) }); });
export default composer;
