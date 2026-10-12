/* =========================================================================
   HELP
   ========================================================================= */
// Help content is per-GAME now (a "Help" Google Sheet living in the game's own main
// folder — see findHelpSheetFile in Code.gs), not one shared tab in Set 1's sheet, so
// the cached promise is keyed to whichever game folder it was fetched for; switching
// games (resetGameSpecificState) clears it so the next Help open re-fetches for the
// newly-selected game instead of showing the previous game's stale articles.
let helpArticlesPromise = null;
let helpArticlesPromiseGameFolderId = null;
function fetchHelpArticles(){
  if(helpArticlesPromise && helpArticlesPromiseGameFolderId !== state.currentGameFolderId){
    helpArticlesPromise = null;
  }
  if(!helpArticlesPromise){
    helpArticlesPromiseGameFolderId = state.currentGameFolderId;
    const folderId = state.currentGameFolderId;
    helpArticlesPromise = cardSource.loadHelp(folderId);
    helpArticlesPromise.catch(()=>{ helpArticlesPromise = null; }); // let a later call retry instead of staying stuck on a failed fetch
  }
  return helpArticlesPromise;
}

async function openHelpModal(preferredTitle){
  document.getElementById('helpModal').classList.remove('hidden');
  const listEl = document.getElementById('helpArticleList');
  const contentEl = document.getElementById('helpArticleContent');
  listEl.innerHTML = '<p style="padding:10px 14px;color:var(--text-soft);font-size:12.5px;">Loading…</p>';
  contentEl.innerHTML = '';
  try{
    const articles = await fetchHelpArticles();
    if(!articles.length){
      listEl.innerHTML = '<p style="padding:10px 14px;color:var(--text-soft);font-size:12.5px;">No help articles found yet.</p>';
      return;
    }
    listEl.innerHTML = articles.map((a,i)=>`<div class="help-article-title" data-idx="${i}">${escapeHtml(a.title)}</div>`).join('');
    listEl.querySelectorAll('.help-article-title').forEach(el=>{
      el.addEventListener('click', ()=> showHelpArticle(articles, Number(el.dataset.idx)));
    });
    let idx = 0;
    if(preferredTitle){
      const found = articles.findIndex(a=>a.title.trim().toLowerCase()===preferredTitle.trim().toLowerCase());
      if(found!==-1) idx = found;
    }
    showHelpArticle(articles, idx);
  }catch(e){
    listEl.innerHTML = `<p style="padding:10px 14px;color:var(--danger);font-size:12.5px;">Could not load help articles: ${escapeHtml(e.message)}</p>`;
  }
}
function showHelpArticle(articles, idx){
  document.querySelectorAll('.help-article-title').forEach((el,i)=> el.classList.toggle('active', i===idx));
  const a = articles[idx];
  document.getElementById('helpArticleContent').innerHTML =
    `<h3>${escapeHtml(a.title)}</h3><div>${escapeHtml(a.content).replace(/\n/g,'<br>')}</div>`;
}
document.getElementById('btnHelp').addEventListener('click', ()=>openHelpModal()); // must NOT pass openHelpModal directly — that would pass the click Event itself as preferredTitle

/* =========================================================================
   CARD SETS — import/remove additional sets by folder id
   ========================================================================= */
function allSetNames(){
  // The filter UI needs the names actually attached to loaded cards (the server's
  // own setName for each folder), not just the authorized labels, so derive it from
  // whatever _setName(s) values are currently loaded — the full _setNames list per
  // card (see mergeCardSets), not just each card's single displayed/primary set.
  const names = new Set();
  state.cards.forEach(c=>{
    ((c._setNames && c._setNames.length) ? c._setNames : [c._setName]).forEach(n=>names.add(n));
  });
  return [...names];
}
function renderSetFilterGroup(){
  const el = document.getElementById('setFilterGroup');
  const names = allSetNames();
  if(names.length<=1){ el.style.display='none'; el.innerHTML=''; return; } // nothing to filter with just the built-in set
  el.style.display='block';
  el.innerHTML = names.map(n=>`
    <label class="toggle-row" style="margin-bottom:4px;">
      <input type="checkbox" data-set="${escapeHtml(n)}" ${curFilters().hiddenSets.has(n)?'':'checked'}>
      <span>${escapeHtml(n)}</span>
    </label>`).join('');
  el.querySelectorAll('input[data-set]').forEach(cb=>{
    cb.addEventListener('change', (e)=>{
      const n = e.target.dataset.set;
      if(e.target.checked) curFilters().hiddenSets.delete(n);
      else curFilters().hiddenSets.add(n);
      renderAll();
    });
  });
}
// Read-only: which sets you can see is decided entirely by the server, from live
// Drive folder-sharing permissions on your signed-in Google account. There is
// nothing to import, connect, or forget here anymore — ask whoever administers
// the sets to share (or unshare) a set's Drive folder with your account.
function renderSetsList(){
  const el = document.getElementById('setsList');
  if(!state.authorizedSets.length){
    el.innerHTML = `<div class="row-item" style="color:var(--text-soft);">You don't have access to any card sets yet. Ask whoever administers the sets to share a set's Drive folder with ${escapeHtml(state.userEmail||'your Google account')}.</div>`;
    return;
  }
  el.innerHTML = state.authorizedSets.map(s=>
    `<div class="row-item"><span>${escapeHtml(s.label)}</span></div>`
  ).join('');
}
function openSetsModal(){
  renderSetsList();
  const gameName = state.currentGameLabel || 'this game';
  document.querySelector('#setsModal .modal-body p').textContent =
    `The sets below are the ones your signed-in Google account currently has access to within ${gameName}. This list is entirely server-controlled — to get access to another set, ask whoever administers the sets to share its Drive folder with your account.`;
  document.getElementById('setsModal').classList.remove('hidden');
}
document.getElementById('btnManageSets').addEventListener('click', openSetsModal);

/* ---- Request access to a set (emails smcbride@ghostgalaxy.com — see Code.gs's
   requestAccess endpoint). Game/Set are free text the requester types themselves,
   never picked from a list, so this form can't be used to fish for which games/sets
   actually exist. ---- */
function openRequestAccessModal(prefillEmail){
  document.getElementById('requestAccessGame').value = '';
  document.getElementById('requestAccessSet').value = '';
  document.getElementById('requestAccessEmail').value = prefillEmail || state.userEmail || '';
  document.getElementById('requestAccessNote').value = '';
  document.getElementById('requestAccessError').textContent = '';
  document.getElementById('requestAccessModal').classList.remove('hidden');
}
document.getElementById('btnRequestAccess').addEventListener('click', ()=>openRequestAccessModal());

// Someone who signs in but has access to no sets at all never gets past the sign-in
// gate (so never sees the Sets button) — offer the same request form right there.
// Their email isn't stored in state.userEmail since they aren't really signed in.
let noAccessEmail = '';
function showSigninRequestAccess(show){
  document.getElementById('btnSigninRequestAccess').style.display = show ? 'inline-flex' : 'none';
}
document.getElementById('btnSigninRequestAccess').addEventListener('click', ()=>openRequestAccessModal(noAccessEmail));

document.getElementById('btnSubmitRequestAccess').addEventListener('click', async ()=>{
  const game = document.getElementById('requestAccessGame').value.trim();
  const setName = document.getElementById('requestAccessSet').value.trim();
  const email = document.getElementById('requestAccessEmail').value.trim();
  const note = document.getElementById('requestAccessNote').value.trim();
  const errEl = document.getElementById('requestAccessError');
  if(!game || !setName || !email){
    errEl.textContent = 'Game, Set, and your Gmail address are all required.';
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    errEl.textContent = 'That doesn\'t look like a valid email address.';
    return;
  }
  errEl.textContent = '';
  const btn = document.getElementById('btnSubmitRequestAccess');
  const originalText = btn.textContent;
  btn.textContent = 'Sending…';
  try{
    await cardSource.submitAccessRequest(game, setName, email, note);
    document.getElementById('requestAccessModal').classList.add('hidden');
    toast('Access request sent — you\'ll hear back once your account has been granted access.');
  }catch(err){
    errEl.textContent = 'Could not send that request: ' + err.message;
  }finally{
    btn.textContent = originalText;
  }
});

/* Neutral cards are identified by their aspect value itself (e.g. "OLNeutral"/"CHNeutral"
   in the live data) rather than by process-of-elimination against leader cards. */
function isNeutral(card){ return /neutral/i.test(card.aspect||''); }

let _realAspects = {overlord:new Set(), champion:new Set()};
function computeAndCacheAspects(){
  _realAspects.overlord = new Set(state.cards.filter(c=>c.type.startsWith('O - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
  _realAspects.champion = new Set(state.cards.filter(c=>c.type.startsWith('C - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
}
function leaderTypeName(deckType){ return deckType==='overlord' ? 'O - Overlord' : 'C - Champion'; }
function prefixFor(deckType){ return deckType==='overlord' ? 'O - ' : 'C - '; }
function bonusCardTypeName(deckType){ return deckType==='overlord' ? 'O - Domination' : 'C - Quest'; }
function extraCardTypeName(deckType){ return deckType==='overlord' ? 'O - Stronghold' : 'C - Resistance'; }
const EXTRA_CARD_PLACEHOLDER_NAME = { overlord:'Stronghold', champion:'Resistance' };
const HORIZONTAL_TYPES = new Set(['O - Domination','C - Quest','O - Stronghold','C - Resistance']);

// Real O - Stronghold / C - Resistance cards, once any exist, are always preferred over
// the Z - Custom placeholder standing in for them today — checked fresh each load, no
// manual switch-over needed.
function extraCardPool(deckType){
  const real = state.cards.filter(c=>c.type===extraCardTypeName(deckType));
  if(real.length) return real;
  const placeholderName = EXTRA_CARD_PLACEHOLDER_NAME[deckType];
  return state.cards.filter(c=>c.type==='Z - Custom' && c.name===placeholderName);
}

