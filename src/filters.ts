import type { Listing, Subscription } from "./listing-data.js";

/** Filter contract shared by the bot, Mini App and Worker API. */
export interface ListingFilters {
  /** Compatibility field used by bot subscriptions (city or neighborhood). */
  location?: string;
  q?: string;
  city?: string;
  neighborhood?: string;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  propertyType?: string;
  bedrooms?: number;
  minArea?: number;
  maxArea?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  tags?: string[];
  source?: "submission" | "channel";
  from?: string;
  to?: string;
}

const includes = (value: string, term?: string) => !term || value.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase());

export function normalizeLocation(value: string): { city: string; neighborhood?: string } {
  const [city, ...rest] = value.split(/[,/·]/).map((part) => part.trim()).filter(Boolean);
  return { city: city ?? "", neighborhood: rest.join(", ") || undefined };
}

export function matchesFilters(listing: Listing, filter: ListingFilters): boolean {
  const location = normalizeLocation(listing.location);
  const searchable = `${listing.title} ${listing.description} ${listing.location} ${listing.propertyType} ${(listing.tags ?? []).join(" ")}`;
  return !listing.archived &&
    includes(searchable, filter.q) &&
    includes(listing.location, filter.location) &&
    includes(location.city, filter.city) &&
    includes(location.neighborhood ?? listing.location, filter.neighborhood) &&
    (filter.minPrice === undefined || listing.price >= filter.minPrice) &&
    (filter.maxPrice === undefined || listing.price <= filter.maxPrice) &&
    (!filter.currency || (listing.currency ?? "").toUpperCase() === filter.currency.toUpperCase()) &&
    (!filter.propertyType || listing.propertyType === filter.propertyType) &&
    (filter.bedrooms === undefined || listing.bedrooms === filter.bedrooms) &&
    (filter.minArea === undefined || (listing.area ?? 0) >= filter.minArea) &&
    (filter.maxArea === undefined || (listing.area ?? 0) <= filter.maxArea) &&
    (!filter.tags?.length || filter.tags.every((tag) => listing.tags?.some((item) => item.toLowerCase() === tag.toLowerCase()))) &&
    (!filter.source || listing.source === filter.source) &&
    (!filter.from || listing.postedAt >= filter.from) &&
    (!filter.to || listing.postedAt <= `${filter.to}T23:59:59.999Z`) &&
    (filter.latitude === undefined || filter.longitude === undefined || filter.radiusKm === undefined || listing.latitude === undefined || listing.longitude === undefined || distanceKm(filter.latitude, filter.longitude, listing.latitude, listing.longitude) <= filter.radiusKm);
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (value: number) => value * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function subscriptionFilters(subscription: Subscription): ListingFilters {
  return { location: subscription.location, minPrice: subscription.priceMin, maxPrice: subscription.priceMax, propertyType: subscription.propertyType, bedrooms: subscription.bedrooms };
}
