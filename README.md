# Card Vault

Gage's trading card collection. One static page reads and writes cards in Supabase and is hosted on GitHub Pages.

Live site, after Pages is enabled: https://gzander7.github.io/gzander7-card-vault/

The publishable key in `config.js` is public on purpose. Visitors can read the vault. Row Level Security is what limits writes to the signed-in owner.

## 1. Create the table and the photo bucket

1. Open the project [cyocszfzjngomhtvzone](https://supabase.com/dashboard/project/cyocszfzjngomhtvzone) and go to **SQL Editor → New query**.
2. Paste the entire file `supabase/schema.sql`.
3. Run it. Running it again is safe; it does not delete cards.

That creates `public.cards` and a public `card-images` bucket. Anonymous visitors can read. An authenticated user can insert, update, and delete only their own rows, and can upload, replace, or delete photos only inside a folder named with their user id (`card-images/<uid>/<uuid>.jpg`).

Until this step is done, the site shows **Database not set up yet** instead of a broken grid.

## 2. Allow the magic-link redirect

1. In the Supabase dashboard open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://gzander7.github.io/gzander7-card-vault/`.
3. Add these **Redirect URLs**:
   - `https://gzander7.github.io/gzander7-card-vault/`
   - `https://gzander7.github.io/gzander7-card-vault/**`
   - `http://localhost:4173/**`
   - `http://127.0.0.1:4173/**`
4. Save.

## 3. Turn on GitHub Pages from the branch

1. On GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch `main` and folder **`/ (root)`**. Save.
   After this pull request is merged, `main` has the site. To publish before that, choose this feature branch instead. The public URL stays the same.
4. Wait until Pages says the site is live, then open https://gzander7.github.io/gzander7-card-vault/.

There is no build step. Do not point Pages at a GitHub Actions workflow.

## 4. Sign in once, then turn off new signups

Do this only after the page loads. The first magic link creates your user. If signups are already off, that first sign-in is rejected.

1. Open the live site and choose **Sign in**.
2. Enter your email and send the magic link.
3. Open the link in the **same browser** you used to request it. You should see **Add card** and a **Sign out** link.
4. In Supabase, open **Authentication → Sign In / Providers → Email**.
5. Turn **off** **Allow new users to sign up**. Leave the Email provider itself **on**. If you turn the provider off, your own magic links stop working.
6. Save. On older dashboards the same switch is under **Project Settings → Authentication → User Signups**.
7. Sign out and sign back in with the same email to confirm you still can. A different email should fail with a signups-disabled error.

## Add a card

Sign in, then **Add card**. On a phone the photo field opens the camera (`capture="environment"`). The browser shrinks the photo to about 1400px on the long edge and uploads a JPEG (or WebP if JPEG encoding is unavailable) to `card-images/<your-user-id>/<uuid>.jpg`, then inserts the row. The new card shows up without a reload. **Edit** and **Delete** (with a confirm) are on cards you own.

Fields: player, year, set, card number, parallel, serial (for example `82/100`), autograph, relic, grader, grade, notes, and Hall of Fame. Featured cards rotate in the spotlight. If none are featured, the spotlight shows the newest card.

## Local preview

From the project folder:

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173/ . Do not open the HTML file directly; a `file://` address cannot load the ES modules. Add the localhost redirect URLs above before requesting a magic link locally.
