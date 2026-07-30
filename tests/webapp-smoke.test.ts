import { describe, expect, it } from "vitest";
import { issueSession, readSession, webPage } from "../src/webapp";

describe("web app smoke checks", () => {
  it("serves catalog controls and a signed session can be read", async () => {
    const session = await issueSession("42", "test-token");
    const claims = await readSession(session.token, "test-token");
    expect(claims?.userId).toBe("42");
    expect(webPage()).toContain("const base=requestedAdmin?'/admin':'/webapp'");
  });

  it("serves the admin panel and preserves the administrator claim", async () => {
    const session = await issueSession("42", "test-token", true);
    const claims = await readSession(session.token, "test-token");
    expect(claims?.admin).toBe(true);
    expect(webPage("admin")).toContain("requestedAdmin=true");
  });
});
