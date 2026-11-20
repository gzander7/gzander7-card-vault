# Development

## Getting started

Install Node.js 22 or later, then:

```bash
npm ci
```

```bash
npm start
```

The site runs at http://127.0.0.1:4173/ against the Supabase project in `config.js`. Don't open `index.html` directly: a `file://` address cannot load ES modules. To use email sign-in links locally, add the localhost redirect URLs from [setup.md](setup.md#2-allow-sign-in-and-password-reset-links-to-return-to-the-vault).

## Checks

| Command            | Notes                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm run check`    | Lint, format check, type check and unit tests. Run it before pushing.                                         |
| `npm test`         | Unit tests: every `*.test.mjs` file, using Node's built-in runner                                             |
| `npm run test:e2e` | Playwright on desktop and phone viewports. Needs the Playwright Chromium (`npx playwright install chromium`). |
| `npm run test:db`  | Migrations and pgTAP tests (see [database.md](database.md#running-the-tests))                                 |
| `npm run format`   | Rewrites files with Prettier                                                                                  |

### Browser tests

The browser tests in [`e2e/`](../e2e) never reach the real project. [`e2e/support/fake-supabase.js`](../e2e/support/fake-supabase.js) intercepts the project's URL and answers sign-in, table, RPC and storage requests from memory. Each test seeds its own cards:

```js
test.use({ seed: { cards: [seedCard({ player: 'Mike Trout', grader: 'PSA', grade: '10' })] } });
```

A test fails on any uncaught page error or Content-Security-Policy violation. The gallery is checked with axe for serious accessibility issues. Tesseract's WASM core and English model are served from `node_modules`, so text recognition runs offline too.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on pushes to `main`:

1. **Lint, types and unit tests**, plus checks that `vendor/` and `supabase/functions/_shared/` match their sources, and a Deno type check of the Edge Function.
2. **Browser tests** in Chromium. A failure uploads the Playwright report.
3. **Database:** the Supabase CLI applies every migration (twice) and runs the pgTAP tests.

GitHub Pages deploys from the branch, independently of CI. Keep `main` green by merging through pull requests.

## Vendored libraries

The Supabase client and Tesseract's page-side scripts are committed in [`vendor/`](../vendor), built from the exact versions in `package.json`. To upgrade:

```bash
npm install --save-exact --save-dev @supabase/supabase-js@<version>
```

```bash
npm run vendor
```

`versions.test.mjs` checks that the CDN URLs in `scanning/ocr.mjs` and the Edge Function's `npm:` import use the same versions as `package.json`.

[Renovate](../renovate.json) groups each library's npm pin and URLs into one pull request. It can't regenerate `vendor/` or `supabase/functions/_shared/`, so CI fails on those pull requests until you check out the branch, run `npm ci && npm run vendor && npm run sync:functions`, and push the result.

## Shared code in the Edge Function

`supabase/functions/_shared/vault/` contains generated copies of the site's pricing modules. After changing anything they import (`pricing-client.js`, `pricing/`, `display/cards.mjs`, `photos/storage.mjs`, `card-catalogue.mjs`, `config.js`), run:

```bash
npm run sync:functions
```

## App icons

The PNG icons in `icons/` are rendered from `favicon.svg`. After changing the logo:

```bash
node scripts/make-icons.mjs
```

## Conventions

- Plain ES modules, no framework and no build step. Keep pure logic in DOM-free modules with a `*.test.mjs` beside them.
- User-facing text is plain and specific. Error messages say what happened and what to do next.
- One feature or fix per pull request, with the pull request template filled in.
- Formatting-only commits go in `.git-blame-ignore-revs`.
