# Changelog

Notable changes to the Card Vault. Dates are when the change reached `main`.

## Unreleased

### Added

- Nightly valuations: a scheduled Supabase Edge Function refreshes stale estimates and records every owner's daily Vault Value, so the history no longer has gaps on days the vault isn't opened.
- **Back up your vault**: download every owned card with purchases, estimates, sold comps and value history as JSON, or as a CSV for spreadsheets.
- Gallery thumbnails: the grid and shared display cases load a 640px copy instead of the full photo. Existing cards get one the next time their owner browses.
- Installable app with offline support: web app manifest, icons, and a service worker that also caches the text reader's download.
- Content-Security-Policy on the vault and display case pages.
- Database limits matching the card editor, and a `cards.updated_at` column.

### Fixed

- The pending-deletions area had an `aria-label` that screen readers ignore; it is now a labelled group.

### Changed

- The Supabase client and Tesseract's page-side scripts are served from the site instead of a CDN.
- The database is managed as Supabase migrations in `supabase/migrations`, replacing the four hand-run SQL files.
- The README is split into focused guides under `docs/`.

### Development

- ESLint, Prettier, EditorConfig and TypeScript checking of the JavaScript.
- Playwright browser tests (desktop and phone) against an in-memory Supabase, with axe accessibility checks.
- pgTAP tests for every Row Level Security rule.
- GitHub Actions CI and Renovate dependency updates.

## 2026-11-20

- Show the evidence behind card estimates: confidence, sale range, unusual prices left out, and why listings were skipped. Track book value ([#20](https://github.com/gzander7/gzander7-card-vault/pull/20)).

## 2026-11-19

- Redesign around a responsive collection and card detail sheets ([#19](https://github.com/gzander7/gzander7-card-vault/pull/19)).
- Keep gallery keyboard focus through live price sorting.

## 2026-11-18

- Fix adding a back photo to an existing card ([#18](https://github.com/gzander7/gzander7-card-vault/pull/18)).
- Make manual sold-comp corrections authoritative ([#17](https://github.com/gzander7/gzander7-card-vault/pull/17)).
- Flag similar cards and privately record pulled boxes ([#16](https://github.com/gzander7/gzander7-card-vault/pull/16)).
- Explain daily Vault Value changes by card ([#15](https://github.com/gzander7/gzander7-card-vault/pull/15)).
- Interactive Vault Value history chart ([#14](https://github.com/gzander7/gzander7-card-vault/pull/14)).
- Four-corner crop controls and shareable display cases ([#13](https://github.com/gzander7/gzander7-card-vault/pull/13)).
- Batch scanning for card fronts and backs ([#12](https://github.com/gzander7/gzander7-card-vault/pull/12)).

- Private purchase costs and estimated gains ([#11](https://github.com/gzander7/gzander7-card-vault/pull/11)).
- Owner-entered sold comps and reversible match flags ([#10](https://github.com/gzander7/gzander7-card-vault/pull/10)).
- Detect the printed card inside clear holders ([#9](https://github.com/gzander7/gzander7-card-vault/pull/9)).
- Auto-crop and straighten card photos ([#8](https://github.com/gzander7/gzander7-card-vault/pull/8)).
- Both card photos and a touch-friendly flip viewer ([#7](https://github.com/gzander7/gzander7-card-vault/pull/7)).
- Read card details from photos on the device ([#6](https://github.com/gzander7/gzander7-card-vault/pull/6)).
- Owner-only Vault Value from verified sales ([#5](https://github.com/gzander7/gzander7-card-vault/pull/5)).
- Vintage sports-card catalogue design ([#4](https://github.com/gzander7/gzander7-card-vault/pull/4)).
- Password sign-in and choosing existing photos ([#3](https://github.com/gzander7/gzander7-card-vault/pull/3)).
- The Card Vault page and Supabase schema ([#1](https://github.com/gzander7/gzander7-card-vault/pull/1)).
