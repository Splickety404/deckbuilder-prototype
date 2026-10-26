/* =========================================================================
   HELLBREAK BOOSTER (private). The "Unwrap a Booster" button for HellBreak: rolls one pack
   and ADDS its cards to the deck being edited (Monster / Location / token land in their own
   boxes), the same way Echo's booster does (05a). Follows the pack generator's Blockly
   script slot for slot. Each of four rolls is a number from 1 to 10000:
     roll 1: ≤3400 → 7 Commons · else 6 Commons + 1 borderless Monster/Location
     roll 2: ≤8000 → 1 Rare · else 1 Legendary/Icon (L/I)
     roll 3 (borderless): ≤6225 C · ≤9225 U · else R/L/I
     roll 4 (borderless foil): ≤5500 C · ≤8500 U · else R/L/I
   Always 3 Uncommons. A Location also brings 1 borderless Minion Token. 13 cards (14 with a token).
   Each slot draws from its own fresh list, so a foil or borderless card can repeat a regular one
   (as in the script). Inside a slot no card repeats, and the cards spread across loyalties: once a
   card with a loyalty is picked, later picks in that slot come only from cards with a loyalty not
   picked yet ("Void" and "Void / Void" are the same loyalty), or from the whole slot if none are left.
   Foil uses Echo's foil look (05e). Borderless isn't tracked in the deck, only named in the toast.
   ========================================================================= */
const hbRarity = (c)=> String(c.rarity||'').trim().toUpperCase();
// The loyalty word ("Void / Void" → "void"), or '' for a card with none.
const hbLoyalty = (c)=> String(c['loyalty-cost']||'').split('/')[0].trim().toLowerCase();
const hbRoll = ()=> 1 + Math.floor(Math.random()*10000);

// Picks n different cards from pool, spreading them across loyalties (see above).
function hbPickSlot(pool, n){
  pool = pool.slice();
  const out = [], seen = new Set();
  for(let i=0; i<n && pool.length; i++){
    let cands = seen.size ? pool.filter(c=>{ const l = hbLoyalty(c); return l && !seen.has(l); }) : pool;
    if(!cands.length) cands = pool;
    const c = randomOf(cands);
    pool.splice(pool.indexOf(c), 1);
    out.push(c);
    if(hbLoyalty(c)) seen.add(hbLoyalty(c));
  }
  return out;
}

// Rolls one HellBreak booster from `cards` for the set named `setName`.
// Returns { pulled:[{card, label, foil?, borderless?}] } in pack order, or { error }.
function rollHellBreakBooster(cards, setName){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const inSet = cards.filter(bySet);
  const type = (c)=> String(c.type||'').trim();
  const tokenBank = inSet.filter(c=> type(c)==='Minion Token');
  const mainPool = inSet.filter(c=> !['Monster','Token','Location','Blank Test','Minion Token'].includes(type(c)));
  const monLocPool = inSet.filter(c=> type(c)==='Monster' || type(c)==='Location');
  if(!mainPool.length) return { error:'No cards found in that set.' };
  const ofRarity = (...rs)=> mainPool.filter(c=> rs.includes(hbRarity(c)));

  const r1 = hbRoll(), r2 = hbRoll(), r3 = hbRoll(), r4 = hbRoll();
  const tierOf = (r, a, b)=> r<=a ? ['C'] : r<=b ? ['U'] : ['R','L','I'];
  const pulled = [];
  const add = (list, label, extra)=> list.forEach(card=> pulled.push({card, label, ...extra}));

  add(hbPickSlot(ofRarity('C'), r1<=3400 ? 7 : 6), 'Common');
  if(r1>3400){
    // The Monster/Location (and a Location's bonus token) go in 4th from the end, among the commons.
    const insert = (card, label)=> pulled.splice(Math.max(0, pulled.length-3), 0, {card, label, borderless:true});
    const [ml] = hbPickSlot(monLocPool, 1);
    if(ml){
      insert(ml, 'Monster/Location');
      const [tk] = type(ml)==='Location' ? hbPickSlot(tokenBank, 1) : [];
      if(tk) insert(tk, 'Location bonus token');
    }
  }
  add(hbPickSlot(ofRarity('U'), 3), 'Uncommon');
  add(hbPickSlot(r2<=8000 ? ofRarity('R') : ofRarity('L','I'), 1), r2<=8000 ? 'Rare' : 'Legendary/Icon');
  add(hbPickSlot(ofRarity(...tierOf(r4, 5500, 8500)), 1), 'Foil', {foil:true, borderless:true});
  add(hbPickSlot(ofRarity(...tierOf(r3, 6225, 9225)), 1), 'Borderless', {borderless:true});
  return { pulled };
}

HellBreakGame.openBooster = function(setName){
  const roll = rollHellBreakBooster(state.cards, setName);
  if(roll.error){ toast(roll.error); return; }
  const deck = curDeck();
  const moves = [];
  FlyCards.begin();
  roll.pulled.forEach(({card, foil})=>{
    if(foil) deck.foilIds.add(card.id);
    deck.deckCards.set(card.id, (deck.deckCards.get(card.id)||0)+1);
    if(!deck.deckOrder.includes(card.id)) deck.deckOrder.push(card.id);
    moves.push({card, key:state.deckType, foil});
  });
  renderAll();
  FlyCards.run(document.getElementById('btnUnwrapBooster'), moves);
  const foilCard = roll.pulled.find(p=>p.foil);
  const borderless = roll.pulled.filter(p=>p.borderless && !p.foil).map(p=>p.card.name);
  toast(`Booster opened — ${roll.pulled.length} cards added.` +
        (foilCard ? ` ✦ Foil: ${foilCard.card.name}.` : '') +
        (borderless.length ? ` Borderless: ${borderless.join(', ')}.` : ''));
};
