# Card Vault

Gage's trading card collection: autographs, relics, serial-numbered cards and slabs, with sold-comp estimates and shareable display cases.

**Live site:** https://gzander7.github.io/gzander7-card-vault/

[![CI](https://github.com/gzander7/gzander7-card-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/gzander7/gzander7-card-vault/actions/workflows/ci.yml)

## What it does

- **Public gallery.** Anyone can browse, search, filter and sort the collection, open a card's details, and turn it over in a 3D viewer.
- **Owner tools.** After signing in, the owner can add cards from phone photos. The vault crops and straightens each photo and reads the printed details on the device. Batch scanning handles a stack of cards at once.
- **Vault Value.** Owner-only estimates from recent sold comps, each with a confidence level, sale range and the reasons listings were skipped. Also a daily value history, private purchase costs with estimated gain or loss, and a book value that falls back to cost for unpriced cards.
- **Display cases.** Shareable links to a chosen set of cards. Private notes and prices are never included.
- **Backups.** Download every card with its purchases, estimates and history as JSON or CSV.
- **Installable.** The vault can be added to a phone's home screen and opens offline.

The owner's guide is in [docs/using-the-vault.md](docs/using-the-vault.md).

## How it's built

Static HTML, CSS and JavaScript modules served by GitHub Pages, with no build step. [Supabase](https://supabase.com) provides sign-in, the Postgres database (protected by Row Level Security), photo storage, and a nightly Edge Function that refreshes estimates. See [docs/architecture.md](docs/architecture.md).

The publishable key in `config.js` is public on purpose. Visitors can read the vault; Row Level Security limits every write to the signed-in owner.

## Development

You need Node.js 22 or later.

```bash
npm ci
```

```bash
npm start
```

That serves the site at http://127.0.0.1:4173/ against the Supabase project in `config.js`.

| Command                           | What it runs                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                        | Unit tests (Node's built-in test runner)                                         |
| `npm run test:e2e`                | Browser tests in Playwright against an in-memory Supabase; desktop and phone     |
| `npm run test:db`                 | Applies every migration to a fresh database and runs the pgTAP access-rule tests |
| `npm run lint` / `npm run format` | ESLint and Prettier                                                              |
| `npm run typecheck`               | TypeScript checking of the JavaScript (`checkJs`)                                |
| `npm run check`                   | Lint, format check, type check and unit tests: what CI's first job runs          |

CI runs all of these on every pull request. More detail, including how to add a migration and how to upgrade vendored libraries, is in [docs/development.md](docs/development.md).

## Documentation

- [Setting up a Supabase project and GitHub Pages](docs/setup.md)
- [Using the vault](docs/using-the-vault.md)
- [Architecture](docs/architecture.md)
- [Database and migrations](docs/database.md)
- [Nightly valuations](docs/nightly-valuations.md)
- [Development](docs/development.md)
- [Changelog](CHANGELOG.md)
