# Vendored browser libraries

These files are generated. Do not edit them by hand.

| File | Source | License |
| --- | --- | --- |
| `supabase-js.mjs` | [`@supabase/supabase-js`](https://github.com/supabase/supabase-js), version pinned in `package.json` | MIT |

The vault loads Supabase from its own origin instead of a CDN. That library holds the signed-in owner's session, so a compromised or hijacked CDN response must not be able to run code next to it.

To upgrade:

```bash
npm install --save-exact --save-dev @supabase/supabase-js@<version>
npm run vendor
```

Commit the regenerated file with the `package.json` and `package-lock.json` change.

Tesseract (on-device text recognition) still loads from jsDelivr at pinned versions. It runs inside a Web Worker, which cannot read the page's session storage, and its ~10 MB language model is a poor fit for the repository. The service worker caches it after the first scan.
