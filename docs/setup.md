# Setting up the vault

The live vault uses the Supabase project [cyocszfzjngomhtvzone](https://supabase.com/dashboard/project/cyocszfzjngomhtvzone) and GitHub Pages. These steps also work for a fresh installation; replace the project URL and publishable key in `config.js` and in the Content-Security-Policy in `index.html` and `case.html` (a unit test checks they agree).

## 1. Create the database

Everything the database needs is in [`supabase/migrations`](../supabase/migrations), applied in filename order. None deletes cards.

**With the Supabase CLI (recommended):**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref cyocszfzjngomhtvzone
```

```bash
npx supabase db push
```

`db push` records which migrations it has applied.

**The existing live project** was partly set up by pasting SQL, so its history doesn't record the first two files. Its schema already matches them (see [database.md](database.md#production-migration-history)). Before the first push, record them as applied. This writes only to the migration history table and runs no schema SQL:

```bash
npx supabase migration repair --status applied 20261118003255 20261118090616
```

Then `npx supabase db push --dry-run` should list only migrations newer than `20261118204804`. Never push with `--include-all`: it would re-run the old Vault Value file and roll its functions back.

**Without the CLI (new projects only):** open **SQL Editor → New query**, paste each migration file in filename order, and run it.

That creates the `cards` table, the public `card-images` bucket, purchase records, valuation sync and display cases. Visitors can read cards and photos. Signed-in users can only change their own cards and only write photos inside their own `card-images/<user id>/` folder.

Until the first migration is applied, the site shows **Database not set up yet** instead of a broken grid.

## 2. Allow sign-in and password reset links to return to the vault

1. In the Supabase dashboard open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://gzander7.github.io/gzander7-card-vault/`.
3. Add these **Redirect URLs**:
   - `https://gzander7.github.io/gzander7-card-vault/`
   - `https://gzander7.github.io/gzander7-card-vault/**`
   - `http://localhost:4173/**`
   - `http://127.0.0.1:4173/**`
4. Save.

The same values are in [`supabase/config.toml`](../supabase/config.toml) for local development.

## 3. Turn on GitHub Pages from the branch

1. On GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch `main` and folder **`/ (root)`**. Save.
4. Wait until Pages says the site is live, then open https://gzander7.github.io/gzander7-card-vault/.

There is no build step. Pages serves the repository as it is. The GitHub Actions workflow only runs checks; it does not deploy.

## 4. Set your vault password

Use the same account that owns your cards.

1. If you're signed in, choose **Account → Set password**. If you're signed out, choose **Sign in**, enter your existing email, and select **Forgot password?**. Open the reset link to reach **Set password**.
2. Enter and confirm the new password and select **Save password**.
3. For future visits, choose **Sign in** and enter your email and password. **Email me a sign-in link** remains available as a backup.

For a fresh installation, create the owner account in **Supabase → Authentication → Users** first. Keep the Email provider enabled and public signups disabled. The vault's sign-in form works with existing accounts.

## 5. Schedule nightly valuations (optional)

Without this, Vault Value still works: estimates refresh when the owner opens the vault, and the history gains a point on those days. To record a value every day, deploy the Edge Function and schedule it as described in [nightly-valuations.md](nightly-valuations.md).

## 6. Turn on dependency updates (optional)

[`renovate.json`](../renovate.json) configures [Renovate](https://github.com/apps/renovate) to open pull requests for npm packages, GitHub Actions, and the library versions pinned in URLs. Install the Renovate GitHub app on the repository to enable it.
