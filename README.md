# Card Vault

Gage's trading card collection. One static page reads and writes cards in Supabase and is hosted on GitHub Pages.

Live site, after Pages is enabled: https://gzander7.github.io/gzander7-card-vault/

The publishable key in `config.js` is public on purpose. Visitors can read the vault. Row Level Security is what limits writes to the signed-in owner.

## 1. Create the table and the photo bucket

1. Open the project [cyocszfzjngomhtvzone](https://supabase.com/dashboard/project/cyocszfzjngomhtvzone) and go to **SQL Editor → New query**.
2. Paste the entire file `supabase/schema.sql`.
3. Run it. Running it again is safe; it does not delete cards.

That creates `public.cards` and a public `card-images` bucket. Anonymous visitors can read. Signed-in users can add, edit, and delete their own rows and write photos inside their own `card-images/<uid>/` folder. A two-sided card stores both photos together in a versioned subfolder.

Until this step is done, the site shows **Database not set up yet** instead of a broken grid.

## 2. Allow sign-in and password reset links to return to the vault

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

## 4. Set your vault password

Use the same account that owns your cards.

1. If you're signed in, choose **Set password** beside **Add card**. If you're signed out, choose **Sign in**, enter your existing email, and select **Forgot password?**. Open the reset link to reach **Set password**.
2. Enter and confirm the new password and select **Save password**.
3. For future visits, choose **Sign in** and enter your email and password. **Email me a sign-in link** remains available as a backup.

For a fresh installation, create the owner account in **Supabase → Authentication → Users** first. Keep the Email provider enabled and public signups disabled. The vault's sign-in form works with existing accounts.

## Add a card

Sign in, then choose **Add card**. Use **Choose photo** for a picture already in your library or files, or **Take photo** to open the camera on a supported phone. The browser resizes the picture to at most 1400 pixels on the long edge, previews it, and uploads it when you save. The same controls let you replace a photo in **Edit**. Saving other edits keeps the current photo. **Edit** and **Delete** are on cards you own.

Fields: player, year, set, card number, parallel, serial (for example `82/100`), autograph, relic, grader, grade, notes, and Hall of Fame. Featured cards rotate in the spotlight. If none are featured, the spotlight shows the newest card.

### Scan the front and back

In **Add card**, choose or take a photo under **Card front** and **Card back**. Once both are ready, the editor reads the printed text and fills the fields it recognizes. With one photo, choose **Read front** or **Read back** to start. When editing an existing card, adding its back can pair it with the saved front.

Review the highlighted fields and choose **Save card**. A clear photo of the full card, including the edges or slab label, helps the reader find small print. Check foil lettering, serial numbers and the exact parallel against the card. Autograph and relic suggestions rely on printed wording.

Text recognition runs on your device. The first scan downloads the English reader. Saving uploads the front and any selected back to the public collection. Scanning and two-sided viewing work with the existing photo bucket and table. [Tesseract.js](https://github.com/naptha/tesseract.js)

### Flip a card

Select a card photo in the gallery or Hall of Fame to open the viewer. For a card with both photos, drag left or right to turn it over, or use the flip button. The gallery always shows the front. Cards saved before back photos were supported open with their front only. To add a back, choose **Edit**, select its back photo, then choose **Save changes**.

## Vault Value and sold comps

Sign in to see **Vault Value** in the navigation. Saving a new card or changing its identifying details starts a sold-comps lookup. Include the card number printed on the back, the parallel and print run when applicable, and the grading company and grade for a slab. Open **Sold comps** beneath a card to see individual sale dates, prices and links, or why an estimate is unavailable.

The estimate is the median of the latest two to five verified matching sales available within the past 90 days. Prices are displayed in USD. For supported vaulted physical cards, USD Coin (USDC) sales count at $1 per USDC. Source coverage varies. Cards without two matches stay unpriced, and the total shows how many owned cards contributed. Opening the vault rechecks estimates at least seven days old. **Check for updates** requests a fresh lookup. A provider outage keeps the last saved estimate and its original date. The vault takes a daily snapshot on days you use it. [CardPricer public API](https://cardpricer.co/docs/api)

Values and history are visible to the signed-in owner. History is stored in the current browser by default. To sync between devices, run [supabase/valuations.sql](supabase/valuations.sql) once in this project's SQL Editor. The next signed-in visit syncs the existing local history. Clearing site data before enabling sync removes this browser's copy.

Run the pricing checks with `node --test pricing/*.test.mjs`.

## Local preview

From the project folder:

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173/ . Do not open the HTML file directly; a `file://` address cannot load the ES modules. Add the localhost redirect URLs above before requesting a magic link locally.
