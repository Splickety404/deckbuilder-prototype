/* =========================================================================
   GET SEALED DECK (board right-click menu) — builds a random Saga deck with the
   deckbuilder's own rules (src/shared/js/sealed-rules-private.js, so a rule
   change there shows up here too) and puts it on the table as a face-down pile,
   exactly like an imported deck. Pick a side, then (if there's more than one) a
   set: the sets are the game's sets you can open (when this table knows its game),
   plus any set whose cards are already on the table.
   ========================================================================= */
let sealedWhoAmI = null; // the signed-in account's games/sets, fetched once per visit
async function sealedServerCall(params){
  const url = `${CARD_WEBAPP_URL}?${params}&idToken=${encodeURIComponent(state.idToken)}`;
  try{
    const res = await fetch(url + '&_=' + Date.now());
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }catch(fetchErr){
    return await new Promise((resolve, reject)=>{ // same JSONP fallback as the other server calls
      const cbName = '__roomSealedCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to answer.')); }, 30000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('Could not reach the server.')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
}
// [{label, folderId?, sheetId?}] — a set's sheet id is only known for sets already
// loaded on the table; the rest are looked up from their folder when picked.
async function sealedSetChoices(){
  const sets = [];
  if(state.gameFolderId){
    try{
      if(!sealedWhoAmI || !sealedWhoAmI.ok) sealedWhoAmI = await sealedServerCall('whoami=1');
      const game = ((sealedWhoAmI && sealedWhoAmI.games)||[]).find(g=>g.folderId===state.gameFolderId);
      ((game && game.sets)||[]).forEach(s=> sets.push({label:s.label, folderId:s.folderId}));
    }catch(e){ /* fall back to whatever is already on the table */ }
  }
  sheetNamesById.forEach((setName, sheetId)=>{
    const have = sets.find(s=> s.label===setName);
    if(have) have.sheetId = sheetId; else sets.push({label:setName, sheetId});
  });
  return sets;
}
function openSealedDeckMenuAt(clientX, clientY){
  const menu = document.getElementById('tokenMenu');
  const drop = clientToWorld(clientX, clientY);
  tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null;
  menu.innerHTML = `<div class="token-swap-title">Get Sealed Deck</div>` +
    [['champion','Champion'],['overlord','Overlord']].map(([k,l])=> `<div class="token-type-item" data-side="${k}">🎲 ${l}</div>`).join('');
  menu.classList.remove('hidden');
  positionMenuNear(menu, tokenMenuAnchorEl());
  menu.querySelectorAll('[data-side]').forEach(el=> el.addEventListener('click', async (e)=>{
    e.stopPropagation(); // the menu is re-drawn below, which would otherwise count as a click outside it
    const side = el.dataset.side;
    menu.innerHTML = `<div class="token-swap-title">Get Sealed Deck</div><div class="token-type-item" style="cursor:default;color:var(--text-soft);">Finding sets…</div>`;
    positionMenuNear(menu, tokenMenuAnchorEl());
    const sets = await sealedSetChoices();
    if(menu.classList.contains('hidden')) return; // closed while loading
    if(!sets.length){
      menu.classList.add('hidden');
      toast('No sets found to build from — open a board from a game, or import a deck first.');
      return;
    }
    if(sets.length===1){ menu.classList.add('hidden'); buildSealedDeckOnTable(side, sets[0], drop); return; }
    menu.innerHTML = `<div class="token-swap-title">Choose a set</div>` +
      sets.map((s,i)=> `<div class="token-type-item" data-set="${i}">${escapeHtml(s.label)}</div>`).join('');
    positionMenuNear(menu, tokenMenuAnchorEl());
    menu.querySelectorAll('[data-set]').forEach(item=> item.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      menu.classList.add('hidden');
      buildSealedDeckOnTable(side, sets[Number(item.dataset.set)], drop);
    }));
  }));
}
async function buildSealedDeckOnTable(side, set, drop){
  const sideName = side==='overlord' ? 'Overlord' : 'Champion';
  toast(`Building a sealed ${sideName} deck from "${set.label}"…`);
  try{
    let sheetId = set.sheetId;
    if(!sheetId){
      const res = await sealedServerCall(`scanSet=${encodeURIComponent(set.folderId)}&fast=1`);
      if(!res || !res.ok) throw new Error((res && res.error) || 'could not open that set');
      sheetId = res.sheetId;
    }
    await ensureSheetsLoaded([{sheetId, setName:set.label}]);
    const inSheet = ()=> [...cardsById.values()].filter(c=> c._sheetId===sheetId);
    for(let i=0; i<60 && !inSheet().length; i++) await new Promise(r=> setTimeout(r, 250)); // the set may still be arriving (another load already under way)
    const all = inSheet();
    const pool = all.filter(c=> !c._classified && !c._pending && typeof c.type==='string');
    if(!pool.length) throw new Error(all.length ? 'you do not have access to that set' : 'that set could not be loaded');
    const res = buildSagaDeck(pool, side, ()=>true);
    if(res.error) throw new Error(res.error);
    const d = res.deck;
    const deckJson = {
      name: `Sealed ${sideName} (${set.label})`, deckType: side,
      leaderId: d.leaderId, bonusCardId: d.bonusCardId, extraCardId: d.extraCardId, schemeIds: d.schemeIds,
      deckOrder: d.deckOrder, deckCards: Object.fromEntries(d.deckCards),
      sourceSheets: [{sheetId, setName:set.label}],
    };
    const at = snapPos(drop.x - PIECE_W/2, drop.y - PIECE_H/2, PIECE_W, PIECE_H); // centered on the click
    await importDeckJson(deckJson, at.x, at.y);
    const total = 1 + (res.hasBonus?1:0) + [...d.deckCards.values()].reduce((a,b)=>a+b,0) + d.schemeIds.length;
    if(total < d.expectedSize) toast(`Sealed deck is ${total} cards — short of ${d.expectedSize} (the allowed pool ran out).`);
  }catch(err){
    toast(`Could not build a sealed deck: ${err.message}`);
  }
}
