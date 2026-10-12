/* =========================================================================
   CARD SETS LIST AND ACCESS REQUESTS (private) — the read-only "Sets" window and
   the request-access form for the Google/Drive-shared sets. Moved here unchanged.
   ========================================================================= */
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


