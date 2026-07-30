import { Composer } from "grammy";
import { createBot, type BotContext, type CreateBotOptions } from "./toolkit/index.js";
import type { StorageAdapter } from "grammy";

// The per-chat session shape (ephemeral conversation state only). Extend as the
// bot grows. Durable domain data must NOT live here — use the toolkit's
// persistent storage (see AGENTS.md).
export interface Session {
  step?: string;
  draft?: Record<string, unknown>;
  /** Harness-only fallback. Production records use the Durable Object store. */
  localDomain?: Record<string, unknown>;
}

export type Ctx = BotContext<Session>;

/**
 * BuildBotOptions lets a runtime-specific ENTRY POINT (never a feature handler)
 * override how the bot is assembled:
 *
 *  - `handlers`: a pre-loaded list of feature Composers. The Cloudflare Workers
 *    entry (src/worker.ts) passes these from a BUILD-TIME manifest, because the
 *    Workers runtime has no filesystem — `readdirSync` + dynamic `import()` only
 *    work under Node (dev, the test harness, and the Fly/long-poll entry). When
 *    omitted, buildBot falls back to the Node disk scan, so nothing on the Node
 *    path changes.
 *  - `storage`: an explicit grammY session StorageAdapter (Workers passes a
 *    Durable-Object-backed one; Node auto-selects Redis/in-memory).
 */
export interface BuildBotOptions {
  handlers?: Composer<Ctx>[];
  storage?: StorageAdapter<Session>;
  telemetryEnv?: CreateBotOptions<Session>["telemetryEnv"];
  telemetryReporterOptions?: CreateBotOptions<Session>["telemetryReporterOptions"];
}

/**
 * buildBot — assembles the bot, AUTO-LOADS every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 * Add a feature by creating src/handlers/<name>.ts that default-exports a grammY
 * Composer — NEVER edit this file (concurrent feature PRs would conflict).
 *
 * Runtime-agnostic: the Node entry (src/index.ts) and the test harness call
 * `buildBot(token)` and get the disk-scanned handlers; the Workers entry
 * (src/worker.ts) calls `buildBot(token, { handlers, storage })` with a
 * build-time manifest because Workers has no filesystem.
 */
export async function buildBot(token: string, opts: BuildBotOptions = {}) {
  const bot = createBot<Session>(token, {
    initial: () => ({ step: "idle" }),
    storage: opts.storage,
    telemetryEnv: opts.telemetryEnv,
    telemetryReporterOptions: opts.telemetryReporterOptions,
    // A thrown handler used to be logged only. In a webhook deployment that
    // looks exactly like a silent bot to the person who sent the update. Keep
    // the diagnostic server-side, but make one best-effort, safe reply here.
    onError: (err) => {
      console.error("[realestate] update failed", err);
      const failedCtx = (err as { ctx?: Ctx }).ctx;
      if (!failedCtx?.chat) return;
      void failedCtx
        .reply("We couldn’t complete that just now. Please try again in a moment.")
        .catch((replyErr) => console.error("[realestate] fallback reply failed", replyErr));
    },
  });

  const handlers = opts.handlers ?? (await loadHandlersFromDisk());
  for (const h of handlers) bot.use(h);

  bot.on("message", (ctx) =>
    ctx.reply("I didn’t understand that. Use the menu or tap /help for guidance."),
  );

  return bot;
}

/**
 * loadHandlersFromDisk — the Node/dev/harness path: scan src/handlers/ and
 * import each Composer. Never CALLED in the Workers bundle (worker.ts always
 * passes an explicit manifest) — and `node:fs` must be imported DYNAMICALLY
 * here, not at the top of the file: Cloudflare validates the bundle's static
 * import graph at upload and rejects any static node:* import, even one whose
 * code never runs.
 */
async function loadHandlersFromDisk(): Promise<Composer<Ctx>[] > {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = []; // no handlers/ dir yet → nothing to load
  }
  const out: Composer<Ctx>[] = [];
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    out.push(mod.default);
  }
  return out;
}
