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
import type { Domain } from "./listing-data.js";

export { ChatDO } from "./toolkit/session/durable.js";

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
    if (url.pathname === "/webapp" && request.method === "GET") {
      if (url.protocol !== "https:") return new Response("HTTPS required", { status: 400 });
      return new Response(webPage(), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self' https://telegram.org; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://telegram.org; connect-src 'self'" } });
    }
    if (url.pathname === "/webapp/auth" && request.method === "POST") {
      if (url.protocol !== "https:") return webResponse({ error: "HTTPS required" }, 400);
      const body = await request.json().catch(() => null) as { initData?: string } | null;
      const user = await verifyInitData(body?.initData ?? "", env.BOT_TOKEN);
      if (!user) return webResponse({ error: "Unauthorized" }, 401);
      return webResponse(await issueSession(user.id, env.BOT_TOKEN));
    }
    if (url.pathname.startsWith("/webapp/")) {
      const claims = await readSession(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, env.BOT_TOKEN);
      if (!claims || request.headers.get("x-csrf-token") !== claims.csrf) return webResponse({ error: "Unauthorized" }, 401);
      const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("realestate:catalog"));
      const read = async (): Promise<Domain> => { const r = await stub.fetch("https://do/domain", { method: "GET" }); return r.status === 204 ? { next: 1, listings: [], subscriptions: [], reports: [], chats: [], users: {} } : await r.json() as Domain; };
      const write = (value: Domain) => stub.fetch("https://do/domain", { method: "PUT", body: JSON.stringify(value) });
      if (url.pathname === "/webapp/listings" && request.method === "GET") { const domain = await read(); return webResponse({ listings: domain.listings.filter((l) => !l.archived).map(publicListing) }); }
      if (url.pathname === "/webapp/subscriptions" && request.method === "GET") { const domain = await read(); return webResponse({ subscriptions: domain.subscriptions.filter((s) => s.owner === claims.userId) }); }
      if (url.pathname === "/webapp/subscriptions" && request.method === "POST") { const body = await request.json() as { location?: string; priceMax?: number }; const domain = await read(); domain.subscriptions.push({ id: `s${domain.next++}`, owner: claims.userId, chatId: Number(claims.userId), location: body.location, priceMax: body.priceMax, active: true, matchDays: [] }); await write(domain); return webResponse({ ok: true }, 201); }
      if (/^\/webapp\/subscriptions\/s\d+$/.test(url.pathname) && request.method === "DELETE") { const id = url.pathname.split("/").at(-1)!; const domain = await read(); domain.subscriptions = domain.subscriptions.filter((s) => !(s.id === id && s.owner === claims.userId)); await write(domain); return webResponse({ ok: true }); }
      if (/^\/webapp\/listings\/l\d+$/.test(url.pathname) && request.method === "PATCH") { const id = url.pathname.split("/").at(-1)!; const body = await request.json() as Partial<Domain["listings"][number]>; const domain = await read(); const listing = domain.listings.find((l) => l.id === id && l.owner === claims.userId); if (!listing) return webResponse({ error: "Not found" }, 404); Object.assign(listing, { title: body.title ?? listing.title, description: body.description ?? listing.description, price: body.price ?? listing.price, location: body.location ?? listing.location, archived: body.archived ?? listing.archived }); await write(domain); return webResponse({ listing: publicListing(listing) }); }
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
