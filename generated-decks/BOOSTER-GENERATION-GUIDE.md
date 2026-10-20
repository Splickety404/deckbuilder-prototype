# Booster Pack Generation Guide (for another Claude)

How to generate Echo of Omens booster packs outside the app, using the exact rules the deckbuilder's "Unwrap a Booster" button uses. Verified by running it. Companion files in this folder:

- `generate-boosters.js`: the working Node script (no npm packages needed).
- `DECK-GENERATION-GUIDE.md`: the sibling guide for sealed (Saga) decks. Read its sections 2 (data source and row filtering) and 4 (PDF layout) if you need them.
- `deckbuilding-rules.md`: human-readable rules summary (section 5 covers boosters).

Repo: `/Users/smcbride/deckbuilder-prototype` (public, GitHub Pages). See `CLAUDE.md` there. The user (Seth) is a game designer with light coding experience, so explain things conceptually.

---

## 1. Principle: use the real code

The pack contents are decided by `rollBooster()` in `src/shared/js/booster-rules-private.js`, a pure rules file (no DOM, no app state). The app's `openBooster()` in `src/deckbuilder/js/05a-booster-private.js` calls it and then deals the cards into the decks. The script loads the same file via Node `vm`, after `sealed-rules-private.js` (the booster rules reuse its `rarityTier`, `sagaDraw`, `randomOf`, `isMainDeckEligibleType`). Never copy the rules into a new file; if they change the script follows automatically. Do not load `saga-weights-private.js`: boosters do not use the Saga weights.

## 2. Data source

Same as the deck guide: the untracked local CSV `EOO Set 1 b9b4147d-f7f0-4b8f-a74c-a2af26207ce3 - Sheet1.csv` in the repo root (never commit it; the repo is public). Apply the same row filtering the app does (drop empty and `Q - ` types; drop `Z - ` rows except the `Z - Custom` Stronghold/Resistance placeholders), trim `type/aspect/loyalty`, and set `_setName = 'Set 1'`. The script does all of this. Cards need `id, name, type, rarity` and, for the set filter, `_setName` (or `_setNames` for cards in several sets).

## 3. The pack (13 cards)

Slots are rolled in this order. "Champion" / "Overlord" pools are main-deck-eligible cards of that side: same-side type prefix, excluding the leader, Scheme, Domination/Quest, Stronghold/Resistance and `Z - Custom`.

**Regular pack**

| # | Pool | Rarity |
|---|---|---|
| 1 to 3 | Champion | Common |
| 4 to 7 | Overlord | Common |
| 8 | Champion | Uncommon |
| 9 | Champion | Uncommon, 10% chance to be Rare |
| 10 | Overlord | Uncommon |
| 11 | Overlord | Uncommon, 10% chance to be Rare |
| 12 | Champion and Overlord pools together | Rare, 10% chance to be Legendary |
| 13 | `O - Scheme` cards | normal pull rates (`sagaDraw`: Common 65, Uncommon 30, Rare 5; Rare becomes Legendary 10%) |

**Special pack** (1 in 3 packs, `BOOSTER_SPECIAL_CHANCE = 1/3`): slots 4 to 7 become only 3 Overlord Commons (so 4 to 6), and a **foil** slot is added before the Scheme:

| # | Pool | Rarity |
|---|---|---|
| 1 to 3 | Champion | Common |
| 4 to 6 | Overlord | Common |
| 7 | Champion | Uncommon |
| 8 | Champion | Uncommon, 10% Rare |
| 9 | Overlord | Uncommon |
| 10 | Overlord | Uncommon, 10% Rare |
| 11 | Either side | Rare, 10% Legendary |
| 12 | **Any `O - ` or `C - ` card in the whole game (any set, any type, including Schemes and leaders)** | any: it is foiled |
| 13 | Scheme | normal pull rates |

### Rules that apply to every slot (`boosterPick`)
- **No repeats inside a pack**: a `taken` set removes already-pulled cards (the foil can never be a card already in the pack; the scheme slot also excludes taken schemes).
- **10% upgrade**: slots marked "10% Rare/Legendary" roll once (`BOOSTER_UPGRADE_CHANCE = 0.10`) for the higher rarity.
- **Fallbacks**: if no unused card of the wanted rarity exists, the slot's base rarity is tried, then any unused card from the pool; a slot is skipped only if the whole pool is used up. Unspecified rarity counts as Common.
- Picks are uniform within the chosen rarity (no loyalty or aspect rules: boosters ignore decks and legality).

## 4. Foil

The foil card is a normal pull marked `foil:true`. It is **cosmetic only**:
- In the deckbuilder, the deck remembers it in `foilIds` (saved with the deck). It shows a gold/violet glow, a sparkle mark and a moving rainbow sheen on its library tile, deck row and setup chips (CSS `.foil` in `90-echo-and-signin-private.css`; `isFoil()` in `05e-foil-private.js`).
- In the PDF export, a foil card gets `drawFoilTexture()` (same file): thin rainbow diagonal lines at 16% opacity plus small white glints at 40%, clipped to the card. In jsPDF, line transparency needs **both** `opacity` and `'stroke-opacity'` in the `GState`; `opacity` alone only affects fills.
- If the same card id also sits in a deck as a non-foil copy, all copies of it show as foil (foil is per card per deck, not per copy).

## 5. Where cards go when unwrapped in the app (only if you need to reproduce a deck)

`openBooster()` deals each pulled card by type: `O - Scheme` goes into the Overlord scheme list; a leader goes into that side's empty leader slot, a Domination/Quest into the bonus slot, a Stronghold/Resistance into the extra slot, otherwise (or if the slot is already taken) into the main deck list; everything else into the Overlord or Champion main deck by its type prefix. The script does not deal into decks; it only reports the packs.

## 6. How to run

```bash
node generated-decks/generate-boosters.js "<path to the set CSV>" 10            # 10 packs, 1 in 3 special
node generated-decks/generate-boosters.js "<path to the set CSV>" 6 --special=yes   # all special
node generated-decks/generate-boosters.js "<path to the set CSV>" 6 --special=no    # none special
```
- If the CSV path is omitted it uses the Set 1 CSV in the repo root. Output goes to `generated-decks/generated-boosters.csv` (untracked, do not commit): one column per pack ("Pack 3 (special)"), one row per slot, each cell `Card name [slot label; rarity; type]`, with `FOIL` on the foil card. Slot rows are 1 to 13 in pull order.
- Random every run. No network or npm packages needed.
- For a print PDF of a pack, build a print list of the pack's cards and reuse section 4 of `DECK-GENERATION-GUIDE.md` (layout, image fetching); for a foil card, call `drawFoilTexture(doc, x, y, CARD_W, CARD_H)` from `05e-foil-private.js` right after `addImage`.

## 7. Verification checklist
- Every pack has 13 cards; regular packs have 3 Champion Commons and 4 Overlord Commons; special packs have 3 Champion Commons, 3 Overlord Commons, exactly one `FOIL`, and one Scheme.
- No card appears twice in a pack.
- Over many packs (e.g. 3,000), about one in three is special. Slots 9 and 11 (regular numbering) are Rare roughly 10% of the time, and the Rare slot is Legendary roughly 10% of the time.
- Overlord and Champion slots never contain a Scheme, leader, Domination/Quest or Stronghold/Resistance card.

## 8. Known caveats
- The slot layout lives only in `booster-rules-private.js`. If the user changes the booster design, change it there, rebuild (`node scripts/build.js`), update this guide and the booster section of `deckbuilding-rules.md`, and ask before pushing (`main` deploys live).
- The foil pool is the whole game (every loaded card of `O - ` or `C - `), not just the set the pack was opened from.
- Public repo hygiene: the set CSV and generated output are untracked on purpose. The public build leaves out `*-private.js` files, so none of this ships to the public build.
