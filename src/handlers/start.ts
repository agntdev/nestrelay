import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, urlButton } from "../toolkit/index.js";
import { locale, t, tr } from "../i18n.js";

const composer = new Composer<Ctx>();
async function menu(ctx: Ctx) {
  const l = await locale(ctx);
  const keys = ["menuHelp", "menuSubmit", "menuCatalog", "menuSubs", "menuReport", "menuWeb"] as const;
  const labels = Object.fromEntries(keys.map((key) => [key, tr(l, key)]));
  const keyboard = mainMenuKeyboard(2, labels);
  // `startapp` opens the Main Mini App registered for this bot in BotFather;
  // its HTTPS endpoint is the Worker route /webapp.
  if (ctx.me.username) keyboard.inline_keyboard.splice(-1, 0, [urlButton(labels.menuWeb, `https://t.me/${ctx.me.username}?startapp=realestate`)]);
  await ctx.reply(await t(ctx, "welcome"), { reply_markup: keyboard });
}
composer.command("start", menu);
composer.callbackQuery("menu:main", async (ctx) => { await ctx.answerCallbackQuery(); await menu(ctx); });
export default composer;
