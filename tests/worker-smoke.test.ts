import { describe, expect, it } from "vitest";
import worker from "../src/worker";
import { issueSession } from "../src/webapp";
import type { Domain } from "../src/listing-data";

function environment() {
  let domain: Domain | undefined;
  const stub = {
    async fetch(_input: string, init?: { method?: string; body?: string }) {
      if (init?.method === "GET") return domain === undefined ? new Response(null, { status: 204 }) : Response.json(domain);
      if (init?.method === "PUT") { domain = JSON.parse(init.body ?? "{}") as Domain; return new Response(null, { status: 204 }); }
      return new Response("not found", { status: 404 });
    },
  };
  return { BOT_TOKEN: "test-token", CHAT_DO: { idFromName: (name: string) => name, get: () => stub } };
}

describe("worker smoke checks", () => {
  it("returns health and serves the catalog page", async () => {
    const env = environment();
    expect((await worker.fetch(new Request("https://unit.test/health"), env)).status).toBe(200);
    const catalog = await worker.fetch(new Request("https://unit.test/webapp"), env);
    expect(catalog.status).toBe(200);
    expect(await catalog.text()).toContain('id="list"');
  });

  it("allows an authorized administrator to create, list, edit and archive a listing", async () => {
    const env = environment();
    const session = await issueSession("7", env.BOT_TOKEN, true);
    const headers = { authorization: `Bearer ${session.token}`, "x-csrf-token": session.csrf, "content-type": "application/json" };
    const created = await worker.fetch(new Request("https://unit.test/admin/listings", { method: "POST", headers, body: JSON.stringify({ title: "Central flat", description: "Quiet", location: "Central", price: 1200 }) }), env);
    expect(created.status).toBe(201);
    const listed = await worker.fetch(new Request("https://unit.test/admin/listings?maxPrice=1300", { headers }), env);
    expect((await listed.json() as { listings: { title: string }[] }).listings[0]?.title).toBe("Central flat");
    expect((await worker.fetch(new Request("https://unit.test/admin/listings/l1", { method: "PATCH", headers, body: JSON.stringify({ price: 1250 }) }), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://unit.test/admin/listings/l1", { method: "DELETE", headers }), env)).status).toBe(200);
  });
});
