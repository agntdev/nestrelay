# QA and smoke test checklist

- Open `/health`; it returns `200` with `{ "ok": true }`.
- Open the Mini App from Telegram. Verify the catalog shows an empty state or the first page of listings.
- Combine city, neighborhood, price, currency, type, bedrooms, area, tags, source, date, and text filters; confirm only matching listings remain and “Show more” advances a page.
- Save a filter, publish a matching listing through the bot, and confirm a matching Telegram notification is sent (up to 20 per user/day).
- Create and edit a listing as its owner. Confirm duplicate title/location/price returns a duplicate warning instead of a second record.
- Open the admin Mini App from a moderation group after administrator verification. Check reports, dedupe groups, ingestion status, and user list.
- Report a listing in the bot. Confirm it leaves the public catalog and appears in the moderation queue.

Deployment note: this repository is ready for the configured Cloudflare Worker deployment (`npm run build:worker`). Deployment and restart require the owner’s Cloudflare credentials and are intentionally not attempted by the build process.
