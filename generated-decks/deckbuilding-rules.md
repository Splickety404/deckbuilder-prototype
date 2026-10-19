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

### Loyalty weighting (within a rarity, main deck only)
Drawing weight by card loyalty class: **Loyal = 5/3**, **Standard = 1**, **Neutral = 5/9**. All card types weigh 1. Leaders use no modifiers.

---

## Constants reference

```
Manual:  DECK_LIMIT 50 · MAX_COPIES 3 · SCHEME_DECK_SIZE 5 · schemes 1 copy
Saga:    mainDeckSize 30 · schemeCount 5 · maxCopies 2 · minSchemeQuest 15
         rarityWeights {common 65, uncommon 30, rare 5} · legendaryUpgrade 0.10 · upgradeChance 0.10
         mainDeckPlan {rare 3, uncommon 6, uncommonUpgradable 2, common 11} · rest fill
         loyaltyModifier {loyal 5/3, standard 1, neutral 5/9}
         questValue {empty 2, default 3, full 4}
```

Note: the manual checks (50 cards, 3 copies) and the Saga generator (30 cards, 2 copies) are different rule sets in the code today. The code does not currently reconcile them.
