# Deck Generation Guide (for another Claude)

How to reproduce what was done in the "generate 6 Champion + 6 Overlord decks, one CSV, 12 print-and-play PDFs" task. Everything here was verified by running it. Companion files in this folder:

- `generate-decks.js`: the working Node script (the exact one that produced the output).
- `deckbuilding-rules.md`: human-readable rules summary (kept in sync and pushed to GitHub).
- `BOOSTER-GENERATION-GUIDE.md` / `generate-boosters.js`: the separate guide and script for booster packs.
- `../scripts/calibrate-saga-weights.js`: re-tunes the per-card drawing weights (see section 3a).
- `generated-decks.csv` and the PDFs: example output (local only, not committed).

Repo: `/Users/smcbride/deckbuilder-prototype` (public, GitHub Pages). See `CLAUDE.md` there. The user (Seth) is a game designer with light coding experience, so explain things conceptually.

---

## 1. Principle: use the real code, don't re-implement

The user asked for "the exact rules currently used in the deckbuilder" and "the exact pdf generation method". So:

- **Rules**: load `src/shared/js/saga-weights-private.js` **and then** `src/shared/js/sealed-rules-private.js` as-is (via Node `vm`, concatenated in that order, appending `this.buildSagaDeck=buildSagaDeck;`). They are pure rules/data code with no DOM or app state, the single source of truth, also inlined into the built `deckbuilder.html` and used by `room.html`. Never copy the rules into a new file. If the rules change, the script picks the change up automatically. **Do not skip the weights file**: without it the generator silently falls back to the old loyalty multipliers and the output no longer matches the app.
- **PDF**: mirror the click handler on `#optExportPdf` in `deckbuilder.html` (search `optExportPdf`). The handler needs a signed-in browser, so the script ports it to Node (jsPDF + sharp) with identical constants.
- The app's "Get Sealed Deck" button is `generateSagaDeck()` in `deckbuilder.html`, which calls `buildSagaDeck(state.cards, deckType, bySet)`. The script calls the same function.
- Cards must keep their raw CSV `traits` column on the card object, because the tribe-minimum rule reads it (`cardHasTrait`). The script's row objects already do.

## 2. Data source

- Local card database: `EOO Set 1 b9b4147d-f7f0-4b8f-a74c-a2af26207ce3 - Sheet1.csv` in the repo root. 276 rows. It is **untracked**, and the repo is public, so never commit it.
- The live app gets the same rows from a Google Sheet through an Apps Script Web App, behind Google Sign-In. Neither works headlessly, so the local CSV substitutes.
- Columns used: `id, type, name, is_double_sided, aspect, loyalty, rarity, traits, deckbuilding-requirement, front-image-url, back-image-url`.
- Card `type` values: `O - Overlord`, `C - Champion`, `O - Domination`, `C - Quest`, `O - Scheme`, `O - Encounter/Event/Lieutenant/Asset`, `C - Ally/Asset/Event`, `Z - Custom`.
- Image URLs are `https://lh3.googleusercontent.com/d/<fileId>?v=<n>#img-src`. They are **publicly fetchable without auth** and return CORS-open JPEGs.

### Row filtering (Echo `keepRow`)
Replicate exactly what the app does before generating:
- Drop rows with an empty `type`, and any `Q - ` type.
- Drop every `Z - ` row **except** `Z - Custom` named `Stronghold` or `Resistance` (the placeholders standing in for real Stronghold/Resistance cards).
- Per card: trim `type/aspect/loyalty`; `_front = front-image-url`, `_back = back-image-url`; `_doubleSided = (is_double_sided.toUpperCase()==='TRUE')`; `_setName = 'Set 1'`.
- The set filter passed to `buildSagaDeck` is `c => c._setName === 'Set 1'`. The placeholder is allowed through anyway because `buildSagaDeck` accepts `type==='Z - Custom'` for the extra slot.

CSV parsing: the file has quoted multi-line abilities, so use a real parser (the script has a small state-machine one). Don't split on commas.

## 3. Generation algorithm (what `buildSagaDeck` does)

Per deck (call it independently for each deck, since results are random and leaders can repeat):

1. **Leader**: `sagaDraw` over all leaders of that side: rarity roll first, no loyalty modifiers.
2. **Domination / Quest**: uniformly random among `O - Domination` / `C - Quest` cards whose aspect **differs from the leader's aspect**.
3. **Stronghold / Resistance**: `extraCardPoolFrom` returns real `O - Stronghold` / `C - Resistance` cards if any exist, else the `Z - Custom` placeholder named Stronghold/Resistance. Then a random pick.
4. **Legal filter**: `isSagaLegal(card, leader, bonusAspect)`:
   - Neutral aspect (regex `/neutral/i`) is always legal.
   - `loyalty==='Loyal'` is legal only if aspect equals the **leader's** aspect.
   - Otherwise legal if aspect equals the leader's aspect or the bonus card's aspect.
   - Hob additionally accepts any `C - Ally` mentioning the whole word "Shade" (checked across all text fields). This is only about legality; it is separate from the Shade tribe minimum in step 7.
5. **Schemes (Overlord only)**: `drawSagaSchemes` draws 5 different `O - Scheme` cards from the legal pool, needing a quest total of at least 15. Quest per scheme comes from `deckbuilding-requirement`: `empty`=2, `default` or blank=3, `full`=4. It redraws up to 200 times, then swaps the lowest-quest scheme for a higher-quest unused one.
6. **Main deck**, 30 cards, from the legal pool of main-deck-eligible types (same-side prefix, excluding leader, Scheme, Domination/Quest, Stronghold/Resistance, `Z - Custom`). Slots from `sagaMainDeckSlots()`, drawn **in this order**:
   - 3 × Rare (each 10% chance to become Legendary)
   - 6 × Uncommon (the first 2 each have a 10% chance to become Rare)
   - 11 × Common
   - 10 × Fill (Common or Uncommon, weighted 65:30)
   - Each draw picks within the chosen rarity weighted by the card's **calibrated weight** (`SAGA_CARD_WEIGHTS[card.id]`, see 3a). A card with no entry falls back to its loyalty modifier (Loyal 5/3, Standard 1, Neutral 5/9).
   - If a rarity is empty, it falls back through `SAGA_TIER_FALLBACK` (e.g. rare → legendary, uncommon, common).
   - Copy limit is 2 per card. Commander Koross gets 3 of cards mentioning "Undying Legion". Cards already at the limit are removed from that slot's eligible pool.
   - The drawn list is then passed to the tribe step (7) before `deckOrder` is built. `deckOrder` is the order each card was **first drawn** (so Rares first, fill last, with any tribe swaps in the slot of the card they replaced), and `deckCards` is a Map of id to copy count (entries that fall to 0 copies are removed).
7. **Tribe minimums** (`sagaEnforceTribes`, `SAGA.tribes`), counted in main-deck copies by the **Traits** column (exact trait match, case-insensitive; the leader never counts):
   - Shade (Champion decks): at least 2.
   - Nynock (Overlord decks): at least 3.
   - Undying Legion (Overlord decks): at least 3.
   - A deck with at least one card of the tribe but fewer than the minimum is topped up by swapping tribe cards in for non-tribe cards **of the same rarity** (nearest rarity if none), so the rarity mix never changes. Copy limits still apply. If the legal pool cannot reach the minimum, the tribe is swapped out entirely instead. A deck with none of the tribe is left alone.
8. Returns `{deck:{leaderId, bonusCardId, bonusAspect, extraCardId, schemeIds, deckCards, deckOrder, expectedSize}, leader, hasBonus}`. `expectedSize` is 32 for Champion (2 + 30) and 37 for Overlord (adds 5 schemes). This excludes the Stronghold/Resistance slot's own card, as the app's toast counts it.

Rarity weights: Common 65, Uncommon 30, Rare 5. Unspecified rarity counts as Common. See `deckbuilding-rules.md` for the constants.

### 3a. Calibrated card weights
Goal: within a rarity, every card appears in generated decks at nearly the same rate. `scripts/calibrate-saga-weights.js "<card CSV>"` simulates many decks through the real generator (tribe step included), nudges each card's weight toward its rarity's average appearance rate over about 18 rounds, and writes `src/shared/js/saga-weights-private.js` (card id to weight, no names). Current result: every rarity within roughly ±3–6% of its average (Legendary is noisier because it is so rare). It takes about 5 minutes (`--decks=8000 --rounds=18 --final=40000` was used).
- **Re-run it** whenever the card set (new cards, rarity/aspect/loyalty/trait changes) or the generator rules change, then rebuild (`node scripts/build.js`) and commit the weights file with the built files (`deckbuilder.html`, `room.html`).
- New cards with no entry fall back to the loyalty modifier until the next calibration.
- Side effect to know about: tribe cards' weights end up lower, so a tribe appears in fewer decks than it would uncalibrated (last run: Shade in about 76% of Champion decks, Nynock about 50% and Undying Legion about 45% of Overlord decks), but when present it meets its minimum.

## 4. Print-and-play PDF (mirrors `#optExportPdf`)

### Print list order (`buildPrintList`)
1. Leader, then Domination/Quest, then Stronghold/Resistance. For Overlord decks, then the 5 schemes in order.
2. Then the main deck: for each id in `deckOrder`, repeated `deckCards.get(id)` times (copies adjacent).
3. For any card with `_doubleSided`, push its **front then back** as consecutive entries. A non-double-sided card prints its front only. No generic back is added.

Image counts: Champion 36 (leader 2 + Quest 2 + Resistance 2 + 30), Overlord 41 (those 6 + 5 schemes). Pages are 4 and 5 respectively.

### Layout constants
```
jsPDF({unit:'pt', format:'letter'})   // 612 x 792
CARD_W_FULL=180, CARD_H_FULL=252      // 2.5in x 3.5in
IMG_SCALE=0.97                        // 3% smaller for sleeving
CARD_W=180*0.97, CARD_H=252*0.97      // cells are the shrunk size, edge to edge, no gaps
COLS=3, ROWS=3
MARGIN_X=(612-CARD_W*3)/2, MARGIN_Y=(792-CARD_H*3)/2
cell i: page break when i%9===0 && i!==0; col=i%3 (of cellIdx), row=floor(cellIdx/3)
cut line: doc.setDrawColor(180,183,190); doc.rect(x,y,CARD_W,CARD_H)   // drawn before the image
image: doc.addImage(dataUrl,'JPEG',x,y,CARD_W,CARD_H)
```

### Image fetching
- URL: `sizedUrl(url, 900, force=true)`. Strip the `#fragment`, then insert `=w900` **before the `?v=` query**, i.e. `.../d/<id>=w900?v=<n>`. It must come directly after the fileId. Appending it after the query does not work.
- Fetch, decode, **flatten onto white** (JPEG has no alpha), re-encode as **JPEG quality 0.8** (`PDF_JPEG_QUALITY`). In the browser this is canvas `toDataURL`. In Node it is `sharp(buf).flatten({background:'#ffffff'}).jpeg({quality:80})`.
- Reject images under 100 px on either side (`MIN_EMBEDDABLE_DIM`), since this signals a "can't preview" placeholder. This is a non-retried failure.
- Retry network/HTTP failures 3 times with 800 ms × attempt backoff.
- On failure the app draws the card name as text (10 pt, `splitTextToSize(name, CARD_W-16)` at x+8, y+20) instead of an image. The script does the same and reports failures. The last run had zero.
- Cache by URL, since a card used twice (or shared between decks) is fetched once.
- Filename: `<deck name with [^a-z0-9-_]+ → _>_print_and_play.pdf`.

## 5. CSV output

The layout copies the user's `Echo of Omens Office League (Responses) - Decks.csv` (one **column per deck**), with an added label column and deck-name header row.

- Row 1: `Deck, <deck name>...`. Names are `Champion N - <Leader>` / `Overlord N - <Leader>`, with Champions first (6), then Overlords (6).
- Row 2: Leader. Row 3: Domination/Quest. Row 4: Stronghold/Resistance.
- Rows 5 to 9: `Scheme` (5 rows). Champion columns are **blank** here, so the rows stay aligned with Overlords.
- Rows 10 onward: `Card`. Main deck sorted alphabetically with `Name x2` for two copies (30 cards counted by copies).
- Quote fields with commas/quotes/newlines. Some names contain a curly apostrophe (’), which is fine in UTF-8.
- Champion columns get 5 blank cells in the Scheme rows so the label column stays aligned (the script now pads them itself).

## 6. How to run

```bash
# one-time, in a scratch dir (NOT the repo; don't add node_modules to a public repo)
npm init -y && npm i jspdf@2.5.1 sharp
# copy generate-decks.js there, then:
node generate-decks.js
```
Notes:
- jspdf's Node entry is `require('jspdf/dist/jspdf.node.min.js')`. Pin 2.5.1, the version `deckbuilder.html` loads from cdnjs.
- The script reads the CSV from and writes to hard-coded paths (`REPO`, `OUT = <repo>/generated-decks`). Adjust if the paths move.
- Needs network for the image fetches (~5 MB/PDF, roughly a minute total). Node 18+ for global `fetch`.
- Output is random. Re-running gives different decks and overwrites same-named PDFs (names include the leader, so different leaders produce differently-named files, and old files can linger).
- To change counts, edit `[['champion',6],['overlord',6]]`.

## 7. Verification checklist
- Every PDF reports `ok` with no FAILED list.
- Image count is 36 (Champion) or 41 (Overlord).
- Each CSV deck column totals 30 main-deck cards (count `xN`), and Overlord columns have exactly 5 schemes.
- No card above 2 copies (3 for Koross's Undying Legion cards).
- Tribe minimums hold: any Champion deck with a Shade-trait card has 2 or more; any Overlord deck with a Nynock has 3 or more; any Overlord deck with an Undying Legion card has 3 or more (check the `traits` column, copies counted).
- Domination/Quest aspect differs from the leader's aspect. All cards are legal for the leader and bonus aspects.
- `pdftoppm` is not installed on this machine, so there was no visual render check. The Read tool can open a PDF with `pages` for a visual check.

## 8. Known issues and caveats
- **Not a browser export**: the PDF path is a faithful port, not the app itself. Image re-encoding differs only by encoder (canvas vs sharp). If exact byte-parity matters, run the real export in the app.
- **Manual vs sealed rules differ** (50 cards/3 copies vs 30 cards/2 copies). This task used the sealed (Saga) rules because "generate decks" maps to `buildSagaDeck`. See `deckbuilding-rules.md`.
- **Public repo hygiene**: the set CSV, generated decks and PDFs (~65 MB) are untracked on purpose. Do not commit them. `deckbuilding-rules.md`, this guide, the booster guide and the two generator scripts are published (the weights file holds card ids only). Per the user's standing instruction, `deckbuilding-rules.md` is updated and pushed whenever deckbuilding rules change. Ask before pushing anything else to `main` (it deploys to Pages).
- **Leader repeats** between decks are expected (independent draws).
