# Using the vault

This is the owner's guide. Visitors can browse, search, filter and open cards without signing in. Everything else needs the owner's account; see [setup.md](setup.md#4-set-your-vault-password) to set a password.

## Add a card

Sign in, then choose **Add card**. Use **Choose photo** for a picture already in your library or files, or **Take photo** to open the camera on a supported phone. The browser resizes the picture to at most 1400 pixels on the long edge, previews it, and uploads it when you save, along with a smaller copy that the gallery grid loads first. The same controls let you replace a photo in **Edit**. Saving other edits keeps the current photo. Open a card to edit it or add it to a display case. **More → Delete** gives you ten seconds to undo before the card and its photos are removed.

Fields: player, year, set, card number, parallel, serial (for example `82/100`), autograph, relic, grader, grade, notes, and Hall of Fame. Featured cards rotate in the spotlight. If none are featured, the spotlight shows the newest card.

Keep all four corners of the printed card in the frame. On phones and computers, the editor looks for the card edges, including inside a clear holder, and straightens the photo when it finds them. If it can’t find a clear outline, it keeps the full photo and tells you under the preview. Choose **Use full photo** to undo a crop before saving. The selected preview is used for scanning, the gallery, and the flip viewer.

Choose **Adjust corners** under either photo to fine-tune the crop. Drag each handle to a printed corner of the card, or select a handle and tap its destination. You can also focus a handle and move it with the arrow keys. Choose **Apply crop** to preview the straightened image, then save the card. When editing a saved photo, the available area is the image currently in the vault. Choose the original photo again if you need detail beyond its saved edges.

If the details you enter or scan match a card you own, **View card** opens the saved copy for comparison. Close the viewer to return to your draft. You can save another copy, including during batch review.

### Scan the front and back

In **Add card**, choose or take a photo under **Card front** and **Card back**. Once both are ready, the editor reads the printed text and fills the fields it recognizes. With one photo, choose **Read front** or **Read back** to start. When editing an existing card, adding its back can pair it with the saved front.

Review the highlighted fields and choose **Save card**. A clear photo of the full card, including the edges or slab label, helps the reader find small print. Check foil lettering, serial numbers and the exact parallel against the card. Autograph and relic suggestions rely on printed wording.

Text recognition runs on your device. The first scan downloads the English reader. Saving uploads the front and any selected back to the public collection. Scanning and two-sided viewing work with the existing photo bucket and table. [Tesseract.js](https://github.com/naptha/tesseract.js)

### Batch scan

Sign in and choose **Batch scan** on desktop or **Account → Batch scan** on your phone. For a stack of front photos, leave **Fronts only** selected. For two-sided cards, select **Alternating fronts and backs**, then choose the photos in front/back order. Each file selection starts with a front and an odd final photo becomes a front-only card. **Take a front photo** adds a camera shot to the queue. Expand a queued card to check its images, swap the sides, or take a missing back.

Choose **Review cards**. The vault crops and reads one card at a time, including front-only cards. Check the highlighted details, replace a photo or add its back, and optionally enter a private purchase. **Save & next** adds the card to your collection and starts the next scan. **Skip card** advances without saving. **Back to batch** keeps the current draft, including your corrections, while the tab stays open. Reopen it with **Resume batch**. Reloading the page or signing out clears unfinished drafts. Confirmed cards are already in the vault.

### Flip a card

Select a card in the gallery or Hall of Fame to open its details. The photo viewer has front and back controls for paired scans. For a card with both photos, drag left or right to turn it over, or use the flip button. The gallery always shows the front. Cards saved before back photos were supported open with their front only. To add a back, choose **Edit**, select its back photo, then choose **Save changes**.

## Share a display case

Sign in and open **Display cases**, then choose **New display case**. Name the case and select up to 60 cards in the order you want visitors to see them. Choose **Create case**, then **Copy link**. Visitors can open the link without signing in, inspect each card, and flip any card that has a saved back. The case page shows the selected photos and printed card details. Purchase amounts, sellers, valuations and notes are omitted.

You can edit the case name and selection on the same link. **Stop sharing** retires that link.

## Vault Value and sold comps

Sign in to see **Vault Value** in the navigation. Saving a new card or changing its identifying details starts a sold-comps lookup. Include the card number printed on the back, the parallel and print run when applicable, and the grading company and grade for a slab. Open the card to see its estimate, recent sales and source links, or why an estimate is unavailable.

In the card’s **Recent sales** section, **Find sold comps** opens eBay sold listings for that card in a new tab. A numbered card such as 22/25 searches for other copies in the /25 print run. Check the listing photos and the final sale price, then return to the vault and choose **Add a sale** to save the link, date, USD price and parallel. Select **Count as an exact match** after checking the version, autograph, print run and grade. Leave it unchecked to keep a reference. **Edit sale** lets you correct or remove an entry. **Flag wrong match** excludes a sale from the estimate and **Restore sale** reverses a flag.

The estimate uses the newest two to five distinct exact sales within 90 days, including owner-confirmed sales. When there are at least four, a price above 2.5 times the sample median or below the median divided by 2.5 stays in Recent sales as **Left out: unusual price**. The vault calculates the displayed median and sale range from the remaining receipts. A single sale stays visible. Older receipts stay in the list, and a sale found by both sources counts once.

**High confidence** requires at least four counted sales spanning 14 calendar days or more, with the highest price under twice the lowest. **Low confidence** means there are only two sales or the highest price is at least twice the lowest. Other estimates have **medium confidence**. For example, sales of $40 and $400 show a $220 median, low confidence and a $40–$400 sale range.

**Recent sales** shows how many listings CardPricer found and verified, the main reason each rejected listing was skipped, and how many were left unchecked. A catalogue or listing can omit Jr., Sr., II or III. When both sources supply a suffix, it must agree. Changing the card’s identity requires reconfirming a manual match. For supported vaulted physical cards, USD Coin (USDC) sales count at $1 per USDC. Opening the vault rechecks automatic estimates at least seven days old. **Check for updates** requests a fresh lookup. The vault records a daily snapshot on days you use it, and every night when [nightly valuations](nightly-valuations.md) are scheduled. [CardPricer public API](https://cardpricer.co/docs/api)

Choose **Value history** in the summary above the gallery or **Value** in the phone navigation to chart your saved daily estimates over 30 days, 90 days, one year or all time. Tap or hover over the chart, or focus it and use the arrow keys, to see a date’s estimate and how many cards were priced. A single priced date shows one point. The table below lists every recorded date.

**What changed?** compares the selected date with the preceding recorded date. Pick a point on the graph or choose a **Recorded date** to see which cards were added, removed, repriced, or gained or lost an estimate. Their contributions add up to the change in priced value. A signed-in visit starts card-level tracking, and the next recorded day supplies the first comparison. Earlier dates show the totals saved at the time.

Sold comps, exclusions, values and history are visible to the signed-in owner. They sync across the owner's signed-in devices. An installation without the valuation migration keeps them in the current browser instead; applying it later syncs the saved records on the next signed-in visit from that device. Clearing browser data before that sync removes its local copy.

## Private purchase tracking

In **Add card** or **Edit**, open **Purchase details**. For a purchase, enter the total paid in USD, including tax, shipping and fees. Date and source are optional. For a card you pulled, choose **Pulled** and optionally enter **From box**, such as “2024 Prizm blaster, box 2.” Leave the cost blank if you haven’t assigned one to that card. Entering $0 records a known zero cost. The box name is private. Any cost you enter applies only to this card. You can reopen that entry in the purchase section of the card details. Choose **Clear purchase details** and save to remove the private entry.

**Vault Value** shows total spent across cards with a recorded cost. Estimated gain or loss compares current sold-comp estimates with cost for the same cards. The percentage uses their combined cost, and is omitted when that cost is zero. Cards awaiting an estimate still count toward total spent. Purchase changes sync to the signed-in owner’s devices and are saved with the card in one transaction.

**Book value** uses each card’s market estimate when available and its recorded cost otherwise. The coverage shows how many cards have a market estimate, how many use cost, and how many still need either. A recorded $0 counts as a cost. The value history chart tracks market estimates.

Cards already in the gallery have no recorded cost until the owner enters one.

## Back up your vault

Open **Vault Value** (**Value** on a phone) and scroll to **Back up your vault**.

- **Download backup (JSON)** saves every card you own with its photo links, purchase details, current estimate with its confidence and sale range, the sold comps you entered or flagged, and your daily value history. Keep it somewhere safe; it is the complete record.
- **Download spreadsheet (CSV)** saves one row per card for Excel, Numbers or Google Sheets: the card details, cost, estimate, confidence, sale range and photo links.

If purchase details can't be loaded, the vault says so instead of downloading an incomplete backup. Photos stay in the vault's storage; the files link to them.

## Install the vault on a phone

On iPhone, open the vault in Safari and choose **Share → Add to Home Screen**. On Android, open it in Chrome and choose **Install app** (or **Add to Home screen**) from the menu. The installed vault opens full screen.

After one visit, the vault opens without a connection and shows the last version of the page; cards and values load once you're back online. The text reader downloads about 10 MB the first time you scan and reuses it afterwards.
