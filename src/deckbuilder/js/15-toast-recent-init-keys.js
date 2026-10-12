/* =========================================================================
   TOAST
   ========================================================================= */
let _toastTimer=null;
function toast(msg, actionLabel, actionFn){
  const t=document.getElementById('toast');
  t.innerHTML = escapeHtml(msg) + (actionLabel ? ` <span class="btn btn-sm" id="toastAction" style="margin-left:8px;">${escapeHtml(actionLabel)}</span>` : '');
  t.style.display='block';
  clearTimeout(_toastTimer);
  if(actionLabel && actionFn){
    document.getElementById('toastAction').addEventListener('click', ()=>{
      actionFn();
      t.style.display='none';
      clearTimeout(_toastTimer);
    });
    _toastTimer=setTimeout(()=> t.style.display='none', 8000); // longer window when there's an action to actually click
  } else {
    _toastTimer=setTimeout(()=> t.style.display='none', 3200);
  }
}

/* =========================================================================
   "RECENTLY UPDATED" TRACKING — compares each card's last-updated stamp
   against when THIS browser last had the app open, not a fixed time window.
   ========================================================================= */
let priorVisitTimestamp = null; // ms epoch of the visit before this one; null on a brand-new browser
function initVisitTracking(){
  const stored = localStorage.getItem(LS_LAST_VISIT_KEY);
  priorVisitTimestamp = stored ? Number(stored) : null; // first-ever visit: nothing gets flagged as "new"
  localStorage.setItem(LS_LAST_VISIT_KEY, String(Date.now()));
}
function isRecentlyUpdated(card){
  if(priorVisitTimestamp===null) return false;
  const lu = card['last-updated'];
  if(!lu) return false;
  const d = new Date(lu);
  return !isNaN(d) && d.getTime() > priorVisitTimestamp;
}
function formatDateLabel(iso){
  if(!iso) return 'Unknown date';
  const d = new Date(iso);
  if(isNaN(d)) return String(iso);
  return d.toLocaleString(undefined, {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

/* =========================================================================
   INIT
   ========================================================================= */
/* =========================================================================
   SCROLL TO TOP
   ========================================================================= */
document.getElementById('library-wrap').addEventListener('scroll', (e)=>{
  document.getElementById('btnScrollTop').classList.toggle('visible', e.target.scrollTop > 400);
});
document.getElementById('btnScrollTop').addEventListener('click', ()=>{
  document.getElementById('library-wrap').scrollTo({top:0, behavior:'smooth'});
});

/* =========================================================================
   KEYBOARD SHORTCUTS
   ========================================================================= */
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    const openModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    if(openModals.length){ openModals.forEach(m=>m.classList.add('hidden')); return; }
  }
  if(e.key === '/'){
    const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    if(activeTag==='input' || activeTag==='textarea' || (document.activeElement && document.activeElement.isContentEditable)) return;
    e.preventDefault();
    document.getElementById('searchBox').focus();
  }
});

const rememberedDeckType = localStorage.getItem(LS_LAST_DECKTYPE_KEY);
if(rememberedDeckType==='overlord' || rememberedDeckType==='champion') state.deckType = rememberedDeckType;
initCardScale();
initVisitTracking();
document.documentElement.style.setProperty('--hover-preview-width', HOVER_PREVIEW_WIDTH+'px');
document.documentElement.style.setProperty('--hover-preview-scheme-width', HOVER_PREVIEW_SCHEME_WIDTH+'px');
// The app itself stays inert until sign-in succeeds — no card data, no sets, nothing
// is fetched until the server has verified an ID token and told us what that account
// may see. initGoogleSignIn() renders the button; onGoogleSignIn() is what calls loadData().
initGoogleSignIn();
// No early warm-up call here anymore: help content is per-game now, and which game
// this account will end up viewing isn't known until sign-in resolves — see the
// warm-up call in selectGame() instead, once state.currentGameFolderId is set.
