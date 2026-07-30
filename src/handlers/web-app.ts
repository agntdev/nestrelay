import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { t } from "../i18n.js";

// Telegram requires an absolute HTTPS URL for `web_app` buttons. The Worker
// serves the application at /webapp; deployment attaches its public origin.
// Until BotFather has that HTTPS URL configured as the Main Mini App, this
// button gives a clear, safe fallback instead of emitting a broken URL.
registerMainMenuItem({ label: "Открыть веб-приложение", labelKey: "menuWeb", data: "webapp:open", order: 45 });
const composer = new Composer<Ctx>();
composer.callbackQuery("webapp:open", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(await t(ctx, "webUnavailable")); });
export default composer;
