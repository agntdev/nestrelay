import type { Ctx } from "./bot.js";
import { readDomain, writeDomain } from "./listing-data.js";

export type Locale = "ru" | "en";
type Params = Record<string, string | number>;

// Keep copy in one resource file: handlers never embed user-facing prose.
const ru = {
  welcome: "Найдите жильё, разместите объявление или сохраните поиск.",
  help: "Откройте меню, чтобы посмотреть объявления, разместить объект, сохранить поиск или пожаловаться.\n\nСохранённый поиск присылает не более 20 подходящих объявлений в день.",
  fallback: "Не удалось распознать сообщение. Откройте меню или нажмите /help.",
  error: "Сейчас не удалось выполнить действие. Попробуйте ещё раз.",
  language: "Выберите язык интерфейса.", languageSet: "Язык интерфейса: русский.",
  menuHelp: "Помощь", menuSubmit: "Разместить объявление", menuCatalog: "Каталог", menuSubs: "Мои подписки", menuReport: "Пожаловаться", menuWeb: "Открыть веб-приложение",
  back: "В меню", continue: "Продолжить", cancel: "Отмена", browse: "Открыть каталог", addSub: "Добавить подписку", manageSubs: "Мои подписки",
  sendPhotos: "Отправьте фотографии, если они есть, затем нажмите «Продолжить».", photoAdded: "Фото добавлено. Отправьте ещё или нажмите «Продолжить».",
  titleAsk: "Как назвать объявление?", titleHint: "Например: Светлая двухкомнатная квартира у парка", descriptionAsk: "Добавьте короткое описание.", descriptionHint: "Укажите состояние, условия или важные детали", priceAsk: "Укажите цену.", priceHint: "Только число, например 1800", locationAsk: "Где находится объект?", locationHint: "Город и район", priceInvalid: "Укажите положительную цену числом.",
  typeAsk: "Выберите тип объекта. Рекомендуем: {type}.", bedsAsk: "Сколько спален?", preview: "Проверьте объявление:\n{listing}", publish: "Опубликовать", incomplete: "Черновик заполнен не полностью. Начните новое объявление из меню.", duplicate: "Такое объявление уже есть в каталоге, поэтому мы не добавили его повторно.", live: "Объявление опубликовано.\n\n{listing}",
  emptyCatalog: "Подходящих объявлений пока нет — измените поиск или разместите своё.", chooseListing: "Выберите объявление.", searchAsk: "Введите город, район или тип объекта.", searchHint: "Например: квартира в центре", newest: "Сначала новые", lowest: "Сначала дешевле", searchAgain: "Изменить поиск", unavailable: "Это объявление больше недоступно.", contact: "Написать владельцу", report: "Пожаловаться", contactAsk: "Напишите сообщение. Мы передадим его, не раскрывая вашу личность.", contactHint: "Спросите о доступности или просмотре", relayed: "Сообщение передано владельцу.", ownerMessage: "Покупатель написал по вашему объявлению:\n{message}",
  noSubs: "Сохранённых фильтров пока нет — создайте подписку, чтобы получать подходящие объявления.", subsList: "Ваши подписки:\n{items}", active: "активна", paused: "приостановлена", pause: "Приостановить", resume: "Возобновить", subAskLocation: "Какой город или район отслеживать? Напишите «любой» для всех мест.", subLocationHint: "Например: Центр", subAskMax: "Какая максимальная цена? Напишите «любой», если лимита нет.", subMaxHint: "Например: 2000", subInvalid: "Укажите положительную цену или «любой».", subOn: "Подписка активна. Мы пришлём до 20 подходящих объявлений в день.", subPaused: "Подборки приостановлены.", subResumed: "Подборки снова включены.", subMissing: "Эта подписка больше недоступна.", match: "Новое объявление подходит под вашу подписку.\n\n{listing}", view: "Открыть объявление",
  noReports: "Пока нет объявлений для жалобы.", chooseReport: "Выберите объявление для проверки.", issue: "Что не так с объявлением?", duplicateReason: "Дубликат", misleading: "Недостоверно", scam: "Возможный обман", thanksReport: "Спасибо. Мы отправили объявление на модерацию и скрыли его из каталога до проверки.", moderationGroup: "Откройте этот раздел в группе модерации. Просматривать очередь могут администраторы группы.", moderationOnly: "Просматривать жалобы могут только администраторы группы.", moderationCheck: "Не удалось проверить права модератора. Повторите в группе модерации.", reportQueue: "Объявления на проверке:\n{titles}", reportQueueEmpty: "Очередь модерации пуста.", moderatorAlert: "Новое объявление ждёт проверки. Откройте «Жалобы».",
  webUnavailable: "Веб-приложение пока недоступно. Откройте его через кнопку в меню после настройки HTTPS-адреса.",
  apartment: "квартира", house: "дом", room: "комната", other: "другое", anyLocation: "Любое место",
} as const;
const en: Record<keyof typeof ru, string> = { ...ru, welcome: "Find a place, share a listing, or save a search.", help: "Use the menu to browse listings, submit a property, save a search, or report a concern.\n\nYour saved searches send up to 20 matching listings each day.", fallback: "I didn’t understand that. Use the menu or tap /help for guidance.", language: "Choose your interface language.", languageSet: "Interface language: English.", menuHelp: "Help", menuSubmit: "Submit listing", menuCatalog: "Browse catalog", menuSubs: "Manage subscriptions", menuReport: "Report listing", menuWeb: "Open web app", back: "Back to menu", continue: "Continue", cancel: "Cancel", browse: "Browse catalog", addSub: "Add subscription", manageSubs: "Manage subscriptions" };
export type MessageKey = keyof typeof ru;

export function format(template: string, params: Params = {}): string { return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? "")); }
export async function locale(ctx: Ctx): Promise<Locale> {
  const id = String(ctx.from?.id ?? "");
  const data = await readDomain(ctx);
  const saved = data.users?.[id]?.locale;
  return saved === "en" || saved === "ru" ? saved : ctx.from?.language_code?.toLowerCase().startsWith("ru") ? "ru" : "ru";
}
export async function t(ctx: Ctx, key: MessageKey, params?: Params): Promise<string> { const l = await locale(ctx); return format((l === "en" ? en : ru)[key] ?? ru[key], params); }
export function tr(l: Locale, key: MessageKey, params?: Params): string { return format((l === "en" ? en : ru)[key] ?? ru[key], params); }
export async function setLocale(ctx: Ctx, value: Locale): Promise<void> { const data = await readDomain(ctx); const id = String(ctx.from?.id ?? ""); data.users ??= {}; data.users[id] = { ...(data.users[id] ?? {}), locale: value }; await writeDomain(ctx, data); }
