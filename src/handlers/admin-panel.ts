import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { readDomain, writeDomain } from "../listing-data.js";

registerMainMenuItem({ label: "Админ-панель", data: "admin:access", order: 50 });
const composer = new Composer<Ctx>();

composer.callbackQuery("admin:access", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.chat || ctx.chat.type === "private" || !ctx.from) {
    await ctx.reply("Откройте этот пункт в группе модерации. Там бот подтвердит права администратора.");
    return;
  }
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      await ctx.reply("Админ-панель доступна только администраторам группы модерации.");
      return;
    }
    const data = await readDomain(ctx);
    data.adminUserIds ??= [];
    if (!data.adminUserIds.includes(String(ctx.from.id))) data.adminUserIds.push(String(ctx.from.id));
    await writeDomain(ctx, data);
    const username = ctx.me.username;
    await ctx.reply("Доступ подтверждён. Откройте админ-панель из этого сообщения.", {
      reply_markup: username ? inlineKeyboard([[urlButton("Открыть админ-панель", `https://t.me/${username}?startapp=admin`)]]) : undefined,
    });
  } catch {
    await ctx.reply("Не удалось подтвердить права в этой группе. Проверьте, что бот видит участников, и попробуйте ещё раз.");
  }
});

export default composer;
