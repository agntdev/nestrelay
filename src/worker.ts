/**
 * Cloudflare Workers entry point (docs/cloudflare/new-projects-on-cf.md §1, §3).
 *
 * Telegram delivers each update as a webhook POST to /tg; the Worker builds the
 * grammY bot (once per isolate) with the build-time handler manifest and a
 * Durable-Object session store, then hands the request to grammY's Workers
 * adapter. Reminders run on Durable Object alarms (see toolkit/session/durable).
 *
 * The Node/long-poll entry (src/index.ts) is untouched — a bot deployed to Fly
 * still runs there. Only a bot whose agnt engine is `cloudflare` is served here.
 */

import { webhookCallback, Composer, type Bot } from "grammy";
import { buildBot, type Ctx } from "./bot.js";
import { handlers } from "./handlers.generated.js";
import { createDurableSessionStorage, type WorkerEnv } from "./toolkit/session/durable.js";
import { issueSession, publicListing, readSession, verifyInitData, webPage, webResponse } from "./webapp.js";
import { fingerprint, now, type Domain } from "./listing-data.js";
import { matchesFilters, type ListingFilters } from "./filters.js";

export { ChatDO } from "./toolkit/session/durable.js";

function emptyDomain(): Domain {
  return { next: 1, listings: [], subscriptions: [], reports: [], chats: [], users: {}, adminUserIds: [] };
}

function domainListings(domain: Domain, includeArchived: boolean): Domain["listings"] {
  return domain.listings.filter((listing) => includeArchived || !listing.archived);
}

function numberParam(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function queryFilters(url: URL): ListingFilters {
  return {
    q: url.searchParams.get("q") ?? undefined, city: url.searchParams.get("city") ?? undefined,
    neighborhood: url.searchParams.get("neighborhood") ?? undefined, minPrice: numberParam(url, "minPrice"),
    maxPrice: numberParam(url, "maxPrice") ?? numberParam(url, "max"), currency: url.searchParams.get("currency") ?? undefined,
    propertyType: url.searchParams.get("propertyType") ?? undefined, bedrooms: numberParam(url, "bedrooms"),
    minArea: numberParam(url, "minArea"), maxArea: numberParam(url, "maxArea"),
    latitude: numberParam(url, "lat"), longitude: numberParam(url, "lng"), radiusKm: numberParam(url, "radiusKm"),
    tags: url.searchParams.get("tags")?.split(",").map((x) => x.trim()).filter(Boolean),
    source: (url.searchParams.get("source") as ListingFilters["source"]) ?? undefined,
    from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined,
  };
}

// A grammY context under Workers additionally carries the runtime `env`, so a
// handler can reach bindings + helpers (e.g. remindAt(ctx.env, …), ctx.env.DB).
export type WorkerCtx = Ctx & { env: WorkerEnv };

// Build the bot ONCE per isolate. The token is stable for the isolate's
// lifetime; grammY requires init() before handling updates. A FAILED build is
// NOT cached: isolates live for many requests, so caching a rejected promise
// (e.g. one transient getMe timeout during a cold start) would brick every
// subsequent update until Cloudflare happens to recycle the isolate.
let botPromise: Promise<Bot<Ctx>> | null = null;
function getBot(env: WorkerEnv): Promise<Bot<Ctx>> {
  if (!botPromise) {
    botPromise = (async () => {
      // Expose the runtime env to handlers (Workers-only; the harness never sets
      // it) BEFORE they run — a handler reaches bindings + helpers through it
      // (remindAt(ctx.env, …), ctx.env.DB). buildBot installs `handlers` in array
      // order, so this must be the FIRST entry, not a trailing bot.use() (which
      // would run AFTER the feature handlers and leave ctx.env undefined).
      const attachEnv = new Composer<Ctx>();
      attachEnv.use((ctx, next) => {
        (ctx as WorkerCtx).env = env;
        return next();
      });
      const bot = await buildBot(env.BOT_TOKEN, {
        handlers: [attachEnv, ...handlers],
        storage: createDurableSessionStorage(env),
        // Worker isolates are request-scoped: they do not expose secrets through
        // process.env and cannot reliably keep a five-minute interval alive.
        telemetryEnv: env,
        telemetryReporterOptions: { flushOnRecord: true, startTimer: false },
      });
      // init() is the only startup call that reaches Telegram. Bound it so a
      // transient Telegram outage cannot leave a webhook request waiting
      // forever. A rejected initialization clears botPromise below, allowing
      // the next update to recover on a fresh attempt.
      await withTimeout(bot.init(), 8_000, "Telegram initialization timed out");
      return bot;
    })();
    botPromise.catch(() => {
      botPromise = null;
    });
  }
  return botPromise;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare-workers" });
    }

    // The Mini App is served only over HTTPS by Cloudflare. Its API authenticates
    // Telegram's signed initData and uses a 15-minute, CSRF-bound bearer token.
    if ((url.pathname === "/webapp" || url.pathname === "/admin") && request.method === "GET") {
      if (url.protocol !== "https:") return new Response("HTTPS required", { status: 400 });
      return new Response(webPage(url.pathname === "/admin" ? "admin" : "catalog"), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self' https://telegram.org; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://telegram.org; connect-src 'self'" } });
    }
    if ((url.pathname === "/webapp/auth" || url.pathname === "/admin/auth") && request.method === "POST") {
      if (url.protocol !== "https:") return webResponse({ error: "HTTPS required" }, 400);
      const body = await request.json().catch(() => null) as { initData?: string } | null;
      const user = await verifyInitData(body?.initData ?? "", env.BOT_TOKEN);
      if (!user) return webResponse({ error: "Unauthorized" }, 401);
      const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("realestate:catalog"));
      const r = await stub.fetch("https://do/domain", { method: "GET" });
      const domain = r.status === 204 ? emptyDomain() : await r.json() as Domain;
      const admin = (domain.adminUserIds ?? []).includes(user.id);
      if (url.pathname === "/admin/auth" && !admin) return webResponse({ error: "Forbidden" }, 403);
      return webResponse(await issueSession(user.id, env.BOT_TOKEN, admin));
    }
    if (url.pathname.startsWith("/webapp/") || url.pathname.startsWith("/admin/")) {
      const claims = await readSession(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, env.BOT_TOKEN);
      if (!claims || request.headers.get("x-csrf-token") !== claims.csrf) return webResponse({ error: "Unauthorized" }, 401);
      const adminRoute = url.pathname.startsWith("/admin/");
      if (adminRoute && !claims.admin) return webResponse({ error: "Forbidden" }, 403);
      const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("realestate:catalog"));
      const read = async (): Promise<Domain> => { const r = await stub.fetch("https://do/domain", { method: "GET" }); return r.status === 204 ? emptyDomain() : await r.json() as Domain; };
      const write = (value: Domain) => stub.fetch("https://do/domain", { method: "PUT", body: JSON.stringify(value) });
      if ((url.pathname === "/webapp/listings" || url.pathname === "/admin/listings") && request.method === "GET") {
        const sort = url.searchParams.get("sort");
        const page = Math.max(1, Math.floor(numberParam(url, "page") ?? 1));
        const perPage = Math.min(50, Math.max(1, Math.floor(numberParam(url, "perPage") ?? 20)));
        const listings = domainListings(await read(), adminRoute).filter((l) => adminRoute ? matchesFilters({ ...l, archived: false }, queryFilters(url)) || l.archived : matchesFilters(l, queryFilters(url))).sort((a, b) => sort === "price" ? a.price - b.price : b.postedAt.localeCompare(a.postedAt));
        return webResponse({ listings: listings.slice((page - 1) * perPage, page * perPage).map(publicListing), page, perPage, total: listings.length, hasMore: page * perPage < listings.length });
      }
      if (/^\/webapp\/listings\/l\d+$/.test(url.pathname) && request.method === "GET") {
        const listing = (await read()).listings.find((item) => item.id === url.pathname.split("/").at(-1) && !item.archived);
        return listing ? webResponse({ listing: publicListing(listing) }) : webResponse({ error: "Not found" }, 404);
      }
      if (url.pathname === "/webapp/subscriptions" && request.method === "GET") { const domain = await read(); return webResponse({ subscriptions: domain.subscriptions.filter((s) => s.owner === claims.userId) }); }
      if (url.pathname === "/webapp/subscriptions" && request.method === "POST") { const body = await request.json() as Partial<Domain["subscriptions"][number]>; const domain = await read(); const subscription = { id: `s${domain.next++}`, owner: claims.userId, chatId: Number(claims.userId), location: body.location?.slice(0, 160), priceMin: Number.isFinite(Number(body.priceMin)) ? Number(body.priceMin) : undefined, priceMax: Number.isFinite(Number(body.priceMax)) ? Number(body.priceMax) : undefined, propertyType: body.propertyType?.slice(0, 40), bedrooms: Number.isFinite(Number(body.bedrooms)) ? Number(body.bedrooms) : undefined, active: body.active !== false, matchDays: [] }; if (subscription.priceMin !== undefined && subscription.priceMax !== undefined && subscription.priceMin > subscription.priceMax) return webResponse({ error: "Invalid price range" }, 400); domain.subscriptions.push(subscription); await write(domain); return webResponse({ subscription }, 201); }
      if (/^\/webapp\/subscriptions\/s\d+$/.test(url.pathname) && request.method === "DELETE") { const id = url.pathname.split("/").at(-1)!; const domain = await read(); domain.subscriptions = domain.subscriptions.filter((s) => !(s.id === id && s.owner === claims.userId)); await write(domain); return webResponse({ ok: true }); }
      if (/^\/(webapp|admin)\/listings\/l\d+$/.test(url.pathname) && request.method === "PATCH") { const id = url.pathname.split("/").at(-1)!; const body = await request.json().catch(() => null) as Partial<Domain["listings"][number]> | null; const domain = await read(); const listing = domain.listings.find((l) => l.id === id && (adminRoute || l.owner === claims.userId)); if (!listing || !body) return webResponse({ error: "Not found" }, 404); if (body.price !== undefined && (!Number.isFinite(Number(body.price)) || Number(body.price) <= 0)) return webResponse({ error: "Invalid price" }, 400); Object.assign(listing, { title: typeof body.title === "string" ? body.title.slice(0, 120) : listing.title, description: typeof body.description === "string" ? body.description.slice(0, 4000) : listing.description, price: body.price === undefined ? listing.price : Number(body.price), location: typeof body.location === "string" ? body.location.slice(0, 160) : listing.location, archived: typeof body.archived === "boolean" ? body.archived : listing.archived }); listing.fingerprint = fingerprint(listing.title, listing.location, listing.price); await write(domain); return webResponse({ listing: publicListing(listing) }); }
      if ((url.pathname === "/admin/listings" || url.pathname === "/webapp/listings") && request.method === "POST") { const body = await request.json().catch(() => null) as Partial<Domain["listings"][number]> | null; if (!body || typeof body.title !== "string" || typeof body.description !== "string" || typeof body.location !== "string" || !Number.isFinite(Number(body.price)) || Number(body.price) <= 0) return webResponse({ error: "Title, description, location and a positive price are required" }, 400); const domain = await read(); const fp = fingerprint(body.title, body.location, Number(body.price)); const duplicate = domain.listings.find((item) => item.fingerprint === fp); if (duplicate) return webResponse({ error: "Duplicate listing", listing: publicListing(duplicate) }, 409); const listing = { id: `l${domain.next++}`, owner: claims.userId, ownerChatId: Number(claims.userId), title: body.title.slice(0, 120), description: body.description.slice(0, 4000), photos: Array.isArray(body.photos) ? body.photos.filter((x): x is string => typeof x === "string").slice(0, 10) : [], price: Number(body.price), currency: typeof body.currency === "string" ? body.currency.slice(0, 8).toUpperCase() : "USD", location: body.location.slice(0, 160), propertyType: typeof body.propertyType === "string" ? body.propertyType.slice(0, 40) : "apartment", bedrooms: Number.isFinite(Number(body.bedrooms)) ? Number(body.bedrooms) : 0, area: Number.isFinite(Number(body.area)) ? Number(body.area) : undefined, tags: Array.isArray(body.tags) ? body.tags.filter((x): x is string => typeof x === "string").slice(0, 12) : [], source: "submission" as const, postedAt: now().toISOString(), fingerprint: fp }; domain.listings.push(listing); domain.audit ??= []; domain.audit.push({ at: now().toISOString(), actor: claims.userId, action: "created", listingId: listing.id }); await write(domain); return webResponse({ listing: publicListing(listing) }, 201); }
      if (/^\/admin\/listings\/l\d+$/.test(url.pathname) && request.method === "DELETE") { const id = url.pathname.split("/").at(-1)!; const domain = await read(); const listing = domain.listings.find((l) => l.id === id); if (!listing) return webResponse({ error: "Not found" }, 404); listing.archived = true; await write(domain); return webResponse({ ok: true }); }
      if (url.pathname === "/admin/listings/bulk" && request.method === "POST") { const body = await request.json().catch(() => null) as { ids?: string[]; action?: "archive" | "restore" } | null; if (!body?.ids?.length || (body.action !== "archive" && body.action !== "restore")) return webResponse({ error: "Listing ids and action are required" }, 400); const domain = await read(); const wanted = new Set(body.ids.slice(0, 50)); let changed = 0; for (const listing of domain.listings) if (wanted.has(listing.id)) { listing.archived = body.action === "archive"; changed++; } domain.audit ??= []; domain.audit.push({ at: now().toISOString(), actor: claims.userId, action: `bulk-${body.action}` }); await write(domain); return webResponse({ changed }); }
      if (url.pathname === "/admin/reports" && request.method === "GET") { const domain = await read(); return webResponse({ reports: domain.reports, audit: domain.audit ?? [] }); }
      if (url.pathname === "/admin/dedup" && request.method === "GET") { const domain = await read(); const groups = Object.values(domain.listings.reduce<Record<string, string[]>>((out, item) => { (out[item.fingerprint] ??= []).push(item.id); return out; }, {})).filter((ids) => ids.length > 1); return webResponse({ groups }); }
      if (url.pathname === "/admin/status" && request.method === "GET") { const domain = await read(); return webResponse({ ingestion: domain.ingestion ?? { accepted: 0, duplicates: 0, failed: 0 }, matching: { subscriptions: domain.subscriptions.filter((s) => s.active).length } }); }
      if (url.pathname === "/admin/users" && request.method === "GET") { const domain = await read(); return webResponse({ users: Object.entries(domain.users).map(([id, profile]) => ({ id, role: profile.role, locale: profile.locale })) }); }
      return webResponse({ error: "Not found" }, 404);
    }

    if (request.method === "POST" && url.pathname === "/tg") {
      // Telegram echoes the secret we registered with setWebhook; reject anything
      // that doesn't match so only Telegram can drive the bot.
      if (
        env.WEBHOOK_SECRET &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
      ) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const bot = await getBot(env);
        return await webhookCallback(bot, "cloudflare-mod")(request);
      } catch (error) {
        // Telegram will retry a 5xx response. Logging only the error object
        // avoids exposing tokens or update bodies while making outages visible
        // in Worker logs.
        console.error("[realestate] webhook processing failed", error);
        return new Response("temporary webhook failure", { status: 503 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};
