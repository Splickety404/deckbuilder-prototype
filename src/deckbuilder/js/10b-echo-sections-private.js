/* =========================================================================
   ECHO — DECK SECTIONS (private). The deck panel shows the deck being edited as
   stacked sections — Overlord / Domination / Stronghold / Schemes / Deck, or
   Champion / Quest / Resistance / Deck. Clicking a section opens it: the card
   pool then shows only the cards that can go in it, with that section's own
   filters (see filterKey / inActiveView in the game definition). Each header
   counts its cards, in gray, turning red only once a section goes over its limit.
   ========================================================================= */
const ECHO_SECTIONS = [
  { key:'leader',  title:{ overlord:'Overlord',   champion:'Champion'   }, limit:1 },
  { key:'bonus',   title:{ overlord:'Domination', champion:'Quest'      }, limit:1 },
  { key:'extra',   title:{ overlord:'Stronghold', champion:'Resistance' }, limit:1 },
  { key:'schemes', title:{ overlord:'Schemes' },                           limit:SCHEME_DECK_SIZE },
  { key:'deck',    title:{ overlord:'Deck',       champion:'Deck'       }, limit:DECK_LIMIT },
];

// Main-deck rows: every deck-list card that isn't a setup card. A card that can't go in this deck
// at all, or is no longer in the live feed, shows here too (flagged), so it can be removed.
function echoDeckSectionIds(){
  return curDeck().deckOrder.filter(id=>{
    if(!((curDeck().deckCards.get(id)||0)>0)) return false;
    const c = state.byId.get(id);
    const sec = c ? echoHomeSection(c) : null;
    return sec==='deck' || sec===null;
  });
}
function echoSectionCount(key){
  if(key==='schemes') return curDeck().schemeIds.length;
  if(key==='deck') return echoDeckSectionIds().reduce((n,id)=> n + curDeck().deckCards.get(id), 0);
  return ECHO_SLOT_LISTS[key].total();
}

EchoGame.renderDeckList = function(zone){
  const deckType = state.deckType;
  ECHO_SECTIONS.filter(sec=> sec.title[deckType]).forEach(sec=>{
    const title = sec.title[deckType];
    const n = echoSectionCount(sec.key);
    const box = document.createElement('div');
    box.className = 'deck-section' + (sec.key===echoActiveSection() ? ' active' : '');
    box.dataset.section = sec.key;
    box.title = `Click to show only the cards that can go in ${title==='Deck' ? 'the deck' : 'this section'}`;
    const aspect = sec.key==='bonus' && curDeck().bonusAspect ? ` · ${curDeck().bonusAspect}` : '';
    box.innerHTML = `<div class="deck-section-head"><span>${escapeHtml(title + aspect)}</span><span class="${n>sec.limit ? 'bad' : ''}">${n} / ${sec.limit}</span></div>`;
    box.addEventListener('click', (e)=>{
      if(e.target.closest('.tile-actions, .changed-badge, .removed-badge')) return; // a row's own buttons
      if(echoActiveSection()===sec.key) return;
      echoOpenSection[deckType] = sec.key;
      state.selection = new Set();
      renderAll();
    });

    let rows; // [id, qty]
    if(sec.key==='schemes'){
      const counts = new Map();
      curDeck().schemeIds.forEach(id=> counts.set(id, (counts.get(id)||0)+1));
      rows = [...counts];
    } else if(sec.key==='deck'){
      rows = echoDeckSectionIds().map(id=> [id, curDeck().deckCards.get(id)]);
    } else {
      const list = ECHO_SLOT_LISTS[sec.key];
      rows = list.ids().map(id=> [id, list.count(id)]);
    }
    if(!rows.length){
      const what = sec.key==='schemes' ? 'schemes, then add exactly 5'
                 : sec.key==='deck' ? 'deck cards, then drag them here or use +'
                 : `${title} cards, then drag one here or use +`;
      box.insertAdjacentHTML('beforeend', `<div class="deck-section-empty">Click to browse ${escapeHtml(what)}.</div>`);
    }
    rows.forEach(([id, qty])=> box.appendChild(buildDeckRow(id, state.byId.get(id), {qty, showStepper:true})));
    zone.appendChild(box);
  });
};
