/* =========================================================================
   HELLBREAK GAME DEFINITION (private) — a deck is 1 Monster, 2 different
   Locations and 50 or more other cards. The deck panel shows these as three
   boxes; clicking a box switches the card pool (and its own filters) to that
   box's cards, the same way Echo's Overlord / Champion / Scheme views each
   have their own pool and filters. Tokens never count toward the deck: a token
   that a card in the deck can create shows as a faded "ghost" row, which the
   player can count up to put that many copies in the export.
   Built on the free-form definition as the private build sets it up (see the
   end of 12a), so saved decks and deck files keep the shape they already had. */
const HB_DECK_MIN = 50;
const HB_SECTIONS = [
  { key:'monster',   title:'Monster',   target:1,           exact:true  },
  { key:'locations', title:'Locations', target:2,           exact:true  },
  { key:'deck',      title:'Deck',      target:HB_DECK_MIN, exact:false },
];
let hbActiveSection = 'deck'; // which box the card pool is showing

// Which box a card belongs in, by its type.
function hbSectionOf(card){
  const t = String(card.type||'').trim();
  if(t==='Monster') return 'monster';
  if(t==='Location') return 'locations';
  if(/token/i.test(t)) return 'tokens';
  return 'deck';
}
function hbSectionCount(key){
  let n = 0;
  for(const [id,q] of curDeck().deckCards){ const c = state.byId.get(id); if(c && hbSectionOf(c)===key) n += q; }
  return n;
}
function hbSectionOk(sec, n){ return sec.exact ? n===sec.target : n>=sec.target; }

// Tokens some card in the deck can create — found by the token's name in that card's
// ability text ("play 1 Bat token", "play 2 Shark tokens"), plus any token already counted up.
function hbTokensForDeck(){
  const texts = [...curDeck().deckCards.keys()].map(id=>state.byId.get(id))
    .filter(c=> c && hbSectionOf(c)!=='tokens')
    .map(c=> String(c.ability||'') + ' ' + String(c['ability-lurking']||''));
  return state.cards.filter(c=> hbSectionOf(c)==='tokens').filter(tk=>{
    if(curDeck().deckCards.get(tk.id)) return true;
    const name = String(tk.name||'').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if(!name) return false;
    const re = new RegExp('(?<![a-z])' + name + '\\s+tokens?(?![a-z])', 'i');
    return texts.some(t=> re.test(t));
  });
}

function hbSectionBox(cls, headHtml, onClick){
  const box = document.createElement('div');
  box.className = 'deck-section ' + cls;
  box.innerHTML = `<div class="deck-section-head">${headHtml}</div>`;
  if(onClick) box.addEventListener('click', (e)=>{
    if(e.target.closest('.tile-actions, .changed-badge, .removed-badge')) return; // a row's own buttons
    onClick();
  });
  return box;
}

const HellBreakGame = {
  ...GenericGame,
  id: 'hellbreak',
  filterKeys: ['monster', 'locations', 'deck'], // one set of filters per box
  filterKey(){ return hbActiveSection; },
  matches(rawSetResults){
    const has = (type)=> rawSetResults.some(s => s.rows.some(r => String(r.type||'').trim() === type));
    return has('Monster') && has('Location');
  },
  isTypeEligible(card){ return true; }, // every card has a box (tokens get theirs from the ghost rows)
  isLegal(card){ return true; },
  inActiveView(card){ return hbSectionOf(card)===hbActiveSection; },
  copyLimit(card){
    if(!card) return MAX_COPIES;
    const sec = hbSectionOf(card);
    if(sec==='monster' || sec==='locations') return 1; // the 2 Locations must be different
    if(sec==='tokens') return Infinity;
    return MAX_COPIES;
  },
  deckSummary(){
    const counts = HB_SECTIONS.map(sec=> hbSectionCount(sec.key));
    const bad = HB_SECTIONS.some((sec,i)=> !hbSectionOk(sec, counts[i]));
    const total = counts.reduce((a,b)=>a+b, 0); // each box shows its own count; this is the whole deck, tokens aside
    return { title: 'Your Deck', text: `${total} card${total!==1?'s':''}`, bad };
  },
  renderDeckList(zone){
    HB_SECTIONS.forEach(sec=>{
      const n = hbSectionCount(sec.key);
      const box = hbSectionBox(sec.key===hbActiveSection ? 'active' : '',
        `<span>${sec.title}</span><span class="${hbSectionOk(sec, n) ? '' : 'bad'}">${n} / ${sec.target}${sec.exact ? '' : '+'}</span>`,
        ()=>{ if(hbActiveSection===sec.key) return; hbActiveSection = sec.key; renderAll(); });
      box.title = `Click to show only ${sec.title} cards in the card pool`;
      // A card no longer in the live feed has no type — it shows in the Deck box so it can still be removed.
      const ids = curDeck().deckOrder.filter(id=>{
        if(!(curDeck().deckCards.get(id) > 0)) return false;
        const c = state.byId.get(id);
        return (c ? hbSectionOf(c) : 'deck') === sec.key;
      });
      if(!ids.length) box.insertAdjacentHTML('beforeend', `<div class="deck-section-empty">Click to browse ${sec.title} cards, then drag them here or use +.</div>`);
      ids.forEach(id=> box.appendChild(buildDeckRow(id, state.byId.get(id), {qty:curDeck().deckCards.get(id), showStepper:true})));
      zone.appendChild(box);
    });

    const tokens = hbTokensForDeck();
    if(!tokens.length) return;
    const box = hbSectionBox('tokens', `<span>Tokens</span><span>not part of the deck</span>`, null);
    box.title = 'Tokens your cards can create — set how many of each to include in the export';
    tokens.forEach(tk=>{
      const qty = curDeck().deckCards.get(tk.id) || 0;
      const row = buildDeckRow(tk.id, tk, {qty, showStepper:true});
      if(!qty){ row.classList.add('ghost'); row.draggable = false; }
      box.appendChild(row);
    });
    zone.appendChild(box);
  },
};
gameDefinitions.push(HellBreakGame);
