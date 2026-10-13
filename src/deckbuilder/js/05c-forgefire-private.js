/* =========================================================================
   FORGE FIRE LINKS (private, admin only, Echo of Omens only). For the admin account, each
   card gets a button that opens its official Forge Fire page:
     <app>/games/<game id>/sets/<set id>/cards/<card id>
   The card id is the card's own `id` column. The set id is the UUID at the END of the set's
   card spreadsheet name (e.g. "EOO Set 2 dfa5d772-…"), so a new set only needs its id added to
   its sheet's name. The server returns that name as `sheetName` with each set's card data.
   ========================================================================= */
const FORGEFIRE_ADMIN_EMAIL = 'smcbride@ghostgalaxy.com';
const FORGEFIRE_BASE = 'https://app.forgefire.games/app/games/';
const FORGEFIRE_ECHO_GAME_ID = '9c9075dc-fa15-43ab-a5cd-2771aeca0811';
const FORGEFIRE_UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;
state.forgeSetIds = new Map(); // sheetId -> Forge Fire set id

// Notes each loaded set's Forge Fire id from its sheet name. Returns true if anything changed.
function registerForgeSets(rawSetResults){
  let changed = false;
  rawSetResults.forEach(s=>{
    const m = s.sheetName && FORGEFIRE_UUID_AT_END.exec(s.sheetName);
    if(m && state.forgeSetIds.get(s.sheetId)!==m[1].toLowerCase()){ state.forgeSetIds.set(s.sheetId, m[1].toLowerCase()); changed = true; }
  });
  return changed;
}
function forgeFireUrl(card){
  if(!card || (state.userEmail||'').toLowerCase()!==FORGEFIRE_ADMIN_EMAIL) return null;
  if(!state.game || state.game.id!=='echo') return null;
  const setId = state.forgeSetIds.get(card._sheetId);
  return setId ? `${FORGEFIRE_BASE}${FORGEFIRE_ECHO_GAME_ID}/sets/${setId}/cards/${card.id}` : null;
}
function openForgeFire(card){
  const url = forgeFireUrl(card);
  if(url) window.open(url, '_blank', 'noopener');
}
// Adds the button to a tile/row's action strip (a .tile-actions element), for the admin only.
function addForgeFireButton(actionsEl, card){
  if(!forgeFireUrl(card)) return;
  const b = mkBtn('FF', ()=>openForgeFire(card));
  b.title = 'Open this card on Forge Fire';
  b.classList.add('forgefire-btn');
  actionsEl.appendChild(b);
}
