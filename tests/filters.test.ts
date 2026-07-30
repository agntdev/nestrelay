import { describe, expect, it } from "vitest";
import { matchesFilters, normalizeLocation } from "../src/filters";
import type { Listing } from "../src/listing-data";

const listing: Listing = {
  id: "l1", owner: "1", ownerChatId: 1, title: "Furnished central flat", description: "Parking included",
  photos: [], price: 1200, currency: "USD", location: "Moscow, Centre", propertyType: "apartment", bedrooms: 2,
  area: 64, tags: ["furnished", "parking"], source: "submission", postedAt: "2026-07-30T10:00:00.000Z", fingerprint: "flat",
};

describe("listing filters", () => {
  it("normalizes city and neighborhood pairs", () => {
    expect(normalizeLocation("Moscow, Centre")).toEqual({ city: "Moscow", neighborhood: "Centre" });
  });

  it("applies every supplied criterion as one combined query", () => {
    expect(matchesFilters(listing, { q: "parking", city: "moscow", neighborhood: "centre", minPrice: 1000, maxPrice: 1300, currency: "usd", propertyType: "apartment", bedrooms: 2, minArea: 60, maxArea: 70, tags: ["furnished", "parking"], source: "submission", from: "2026-07-01", to: "2026-07-31" })).toBe(true);
    expect(matchesFilters(listing, { tags: ["balcony"] })).toBe(false);
    expect(matchesFilters(listing, { maxArea: 60 })).toBe(false);
  });
});
