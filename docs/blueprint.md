# RealEstate Listings Aggregator — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Aggregates real-estate listings from public Telegram channels and user submissions, deduplicates and classifies them, and enables agents/landlords to manage listings while letting buyers subscribe to filters and get matches via direct Telegram messages.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- real-estate agents
- landlords
- prospective renters/buyers

## Success criteria

- listings appear in catalog within 5 minutes of posting
- users receive subscription matches via direct messages
- moderation team reviews reports within 24 hours

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu with onboarding and primary actions
- **Submit Listing** (button, actor: user, callback: submit:start) — Initiates guided listing submission form
  - inputs: photos, title, description, price, location, property_type, bedrooms
  - outputs: confirmation message, listing preview
- **Browse Catalog** (button, actor: user, callback: catalog:search) — Opens search interface with sorting options
  - inputs: search query, sort preference
  - outputs: listing grid, filter options
- **Manage Subscriptions** (button, actor: user, callback: subs:list) — View and edit active filters
  - inputs: filter parameters, active flag
  - outputs: subscription dashboard, match history
- **Report Listing** (button, actor: user, callback: report:start) — Flag a listing for moderation
  - inputs: report reason
  - outputs: moderation confirmation, admin alert

## Flows

### Listing Submission
_Trigger:_ submit:start

1. capture photos
2. collect metadata
3. auto-classify property type
4. confirm submission

_Data touched:_ Listing

### Catalog Browsing
_Trigger:_ catalog:search

1. apply filters
2. display listings
3. show details on selection

_Data touched:_ Listing, User

### Contact Relay
_Trigger:_ contact:init

1. mask user identities
2. relay messages
3. archive chat history

_Data touched:_ Chat

### Subscription Matching
_Trigger:_ subs:match

1. evaluate new listing against filters
2. push matches to users
3. enforce rate limits

_Data touched:_ Subscription, Listing

### Moderation Workflow
_Trigger:_ report:submit

1. log report
2. notify moderation group
3. archive flagged listing

_Data touched:_ Report, Listing

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Listing** _(retention: persistent)_ — Real-estate listing with deduplication metadata
  - fields: title, description, photos, price, location, property_type, bedrooms, source, posted_at, fingerprints
- **User** _(retention: persistent)_ — User profile and preferences
  - fields: role, favorites, subscriptions, chat_mask_id
- **Subscription** _(retention: persistent)_ — Saved filters for listing matches
  - fields: owner, location, price_min, price_max, property_type, bedrooms, active
- **Report** _(retention: persistent)_ — Moderation flags and duplicates
  - fields: reporter, listing_id, reason, timestamp

## Integrations

- **Telegram** (required) — Bot API messaging and channel scraping
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- view reports in moderation group
- pause/resume subscriptions
- access masked chat archives for support

## Notifications

- new match delivery
- moderation alerts
- subscription status updates

## Permissions & privacy

- mask user identities in chats
- only store necessary contact history
- user data accessible only to admins for moderation

## Edge cases

- duplicate listings from multiple channels
- users changing roles mid-flow
- chat relay message loss
- overlapping subscription filters

## Required tests

- submit listing → appears in catalog
- create subscription → receives match notification
- report listing → appears in moderation group

## Assumptions

- auto-classification uses basic NLP without external APIs
- location normalization handles city/neighborhood pairs
- 20 matches/day rate limit is sufficient for free tier
