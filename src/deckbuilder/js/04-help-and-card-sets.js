/* =========================================================================
   HELP
   ========================================================================= */
// Help content is per-GAME now (a "Help" document that comes with the game
// — see cardSource.loadHelp), not one shared tab in Set 1's sheet, so
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
