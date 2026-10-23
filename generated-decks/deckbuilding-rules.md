# Echo of Omens: Deckbuilding Rules (as implemented in the deckbuilder)

Extracted from `deckbuilder.html` / `src/shared/js/sealed-rules-private.js`. There are two rule sets: the **manual deckbuilder checks** (what you see while building by hand) and the **Saga / Sealed generator rules** ("Get Sealed Deck"). The deckbuilder is deliberately permissive: manual-build rules are informational warnings, not hard blocks, except where noted.

---

## 1. Deck structure

| Slot | Overlord deck | Champion deck |
|---|---|---|
| Leader | 1 `O - Overlord` | 1 `C - Champion` |
| Bonus card | 1 `O - Domination` | 1 `C - Quest` |
| Extra card | 1 `O - Stronghold` | 1 `C - Resistance` |
| Schemes | 5 `O - Scheme` | none |
| Main deck | `O - ` cards | `C - ` cards |

- The Stronghold/Resistance slot uses the `Z - Custom` placeholder cards named "Stronghold" / "Resistance" until real `O - Stronghold` / `C - Resistance` cards exist. Real ones are always preferred automatically.
- Main-deck eligible types exclude: the leader type, Scheme, Domination/Quest, Stronghold/Resistance, and `Z - Custom`. A Champion card can never go in an Overlord deck, or vice versa.
- Double-sided cards (leaders, Domination/Quest, Stronghold/Resistance) print front and back.

## 2. Aspect and loyalty legality

A card is legal if any of these hold:

1. It is **Neutral** (aspect contains "neutral", e.g. `OLNeutral` / `CHNeutral`).
2. It is **Loyal** and its aspect equals the **leader's aspect**. A Loyal card never matches the bonus card's aspect.
3. It is not Loyal and its aspect equals the **leader's aspect** or the **Domination/Quest aspect**.
4. Special cases:
   - **Hob** may also take any `C - Ally` that mentions "Shade".
   - **Commander Koross** may run a 3rd copy of cards mentioning "Undying Legion" (Sealed generator).

Before a leader is chosen, only card type is checked. Once a leader is picked, aspect legality applies. Illegal cards are grayed out and sorted last, and a "Remove N illegal cards" button appears.

## 3. Manual deckbuilding checks (deck rules checklist)

| Rule | Value |
|---|---|
| Main deck minimum | **50 cards** (shown as `n / 50`) |
| Max copies of a card | **3** (schemes: **1**) |
| Leader cards in the main list | max 1 (extras, e.g. from boosters, are flagged) |
| Overlord scheme deck | **exactly 5** schemes |
| Scheme quest total | at least **15** across the 5 schemes |
| Duplicate schemes | flagged (text import allows them with a warning) |

**Scheme quest value** comes from each scheme's `deckbuilding-requirement` column: `Empty` = 2, `Default` (or blank) = 3, `Full` = 4.

The scheme card *pool* is derived from the chosen Overlord + Domination card (same aspect rules as above).

## 4. Saga (Sealed) deck generation rules

Follows the EoO Set 1 Saga Deck Rules doc. Cards are drawn only from the chosen set.

### Composition
- Leader + Domination/Quest + Stronghold/Resistance + **30 main-deck cards**, plus **5 schemes** for Overlord.
- Total: Champion 33 cards, Overlord 38 cards.
- **Max copies: 2** per main-deck card (3 for "Undying Legion" cards under Commander Koross). Schemes: 1 copy each.

### Order of building
1. **Leader**: rarity roll, no loyalty modifier.
2. **Domination / Quest**: random, but **never one sharing the leader's aspect**.
3. **Stronghold / Resistance**: random from the real cards, or the placeholder.
4. **Schemes** (Overlord only): 5 different legal schemes totalling **at least 15 quest** (redraws up to 200 times, then swaps the lowest-quest scheme for a higher one).
5. **30 main-deck cards** from legal cards (leader aspect, bonus aspect, Neutral; Loyal only matches the leader).

### Rarity
- Base rarity weights: **Common 65, Uncommon 30, Rare 5**. A Rare roll becomes **Legendary 10%** of the time.
- Unspecified rarity counts as Common.
- Main deck is drawn from fixed slots:

| Slots | Rarity | Upgrade |
|---|---|---|
| 3 | Rare | each 10% to become Legendary |
| 6 | Uncommon | 2 of them 10% to become Rare |
| 11 | Common | none |
| 10 | Fill (Common/Uncommon by weight 65:30) | none |

- If a rarity has nothing left to draw, the nearest other rarity is used (fallback order, e.g. Rare → Legendary → Uncommon → Common).

### Per-card weighting (within a rarity, main deck only)
Within a rarity, each card is drawn with its own **calibrated weight** (`SAGA_CARD_WEIGHTS` in `src/shared/js/saga-weights-private.js`, written by `scripts/calibrate-saga-weights.js`). The script simulates many decks through the real generator and tunes the weights until every card of a rarity appears in generated decks at nearly the same rate (currently within roughly ±3–6% of that rarity's average; Legendary is noisier because it is so rare). Re-run it whenever the card set or these rules change. A card with no calibrated weight falls back to the old loyalty modifier (**Loyal = 5/3**, **Standard = 1**, **Neutral = 5/9**). Leaders use no weights.

### Packets (`traits-to-packet`, Saga decks only)
A card's `traits-to-packet` column lists traits, **one entry per copy wanted** (e.g. `Trap / Trap / Trap` = 3 Traps). The trait does not have to be one of the card's own traits. The column is not a filter in the deckbuilder.

- **The moment a card with a packet appears** in the deck (leader, Domination/Quest, Stronghold/Resistance, any scheme, or any main-deck card), main-deck cards of that trait are added until the deck holds that many cards with the trait, **not counting the card that asked** (one copy of it is excluded).
- "In the deck" counts every card: leader, bonus, extra, schemes and main-deck copies.
- **Rare and Legendary are never affected.** Packets only pull in Common or Uncommon cards, and only replace Common or Uncommon cards (a Common is replaced by a Common, or an Uncommon if no Common qualifies, and vice versa). A Rare/Legendary card is never added or removed by a packet, so those cards' appearance rates are unchanged (checked: 40,000 decks per side with packets on vs off gave the same average Rare and Legendary rates, per-card differences within sampling noise).
- The deck stays at 30 and the rarity mix does not change. A replaced card is never one with a packet of its own or one sharing a trait that was already asked for.
- Copy limits apply (2 per card, 3 for Commander Koross's Undying Legion cards). Added cards are picked by their calibrated weight.
- Added cards with packets of their own trigger the same rule.
- If the legal pool cannot supply enough, a Common/Uncommon main-deck card that asked is swapped for a plain Common/Uncommon card. A Rare/Legendary asker is never swapped out. A leader, bonus, extra or scheme that asked just gets as many as the pool allows.
- Calibration runs through this rule, so the extra pulls are offset in the per-card weights.

---

## 5. Booster packs ("Unwrap a Booster")

A booster is 13 cards, added to your decks (nothing is removed). Source: `src/shared/js/booster-rules-private.js`; the dealing into decks is in `05a-booster-private.js`. Full detail in `BOOSTER-GENERATION-GUIDE.md`.

| Slots | Pool | Rarity |
|---|---|---|
| 3 | Champion main-deck cards | Common |
| 4 | Overlord main-deck cards (not Schemes) | Common |
| 1 | Champion | Uncommon |
| 1 | Champion | Uncommon, 10% chance to be Rare |
| 1 | Overlord | Uncommon |
| 1 | Overlord | Uncommon, 10% chance to be Rare |
| 1 | Either side (not Schemes) | Rare, 10% chance to be Legendary |
| 1 | Schemes | normal pull rates (65/30/5, Rare may become Legendary) |

**Special packs (1 in 3):** 3 Overlord Commons instead of 4, plus **1 foil card**, which is any Overlord/Champion card in the whole game. Foil is cosmetic: a shimmering highlight in the deckbuilder and a faint texture on PDF export.

No card repeats inside one pack. If a slot's rarity has nothing left, its base rarity is used, then any unused card of that pool.

---

## Constants reference

```
Manual:  DECK_LIMIT 50 · MAX_COPIES 3 · SCHEME_DECK_SIZE 5 · schemes 1 copy
Booster: upgrade chance 0.10 · special pack chance 1/3 · 13 cards
Saga:    mainDeckSize 30 · schemeCount 5 · maxCopies 2 · minSchemeQuest 15
         rarityWeights {common 65, uncommon 30, rare 5} · legendaryUpgrade 0.10 · upgradeChance 0.10
         mainDeckPlan {rare 3, uncommon 6, uncommonUpgradable 2, common 11} · rest fill
         loyaltyModifier {loyal 5/3, standard 1, neutral 5/9} (fallback only; see per-card weighting)
         packets: traits-to-packet column (one entry per wanted copy), applied by sagaApplyPackets
         questValue {empty 2, default 3, full 4}
```

Note: the manual checks (50 cards, 3 copies) and the Saga generator (30 cards, 2 copies) are different rule sets in the code today. The code does not currently reconcile them.
