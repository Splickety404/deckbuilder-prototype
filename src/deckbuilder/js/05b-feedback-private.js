/* =========================================================================
   CARD FEEDBACK (private). A 💬 button on every card (library tile, deck row,
   leader/Domination/Stronghold chips and pickers, card detail) opens a small
   form; sending emails the notes — plus the signed-in user's email, and an
   optional Discord handle — via the Apps Script backend (cardFeedback action
   in Code.gs). The Discord handle is remembered in this browser and pre-filled.
   ========================================================================= */
const LS_FEEDBACK_DISCORD_KEY = 'eoo_feedback_discord';
const FEEDBACK_MAX_LENGTH = 4000;
let feedbackCard = null;

function lsGet(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

function openCardFeedback(card){
  if(!card) return;
  feedbackCard = card;
  document.getElementById('feedbackCardName').textContent = card.name;
  document.getElementById('feedbackText').value = '';
  document.getElementById('feedbackDiscord').value = lsGet(LS_FEEDBACK_DISCORD_KEY);
  document.getElementById('feedbackReplyEmail').textContent = state.userEmail || '';
  document.getElementById('feedbackError').textContent = '';
  document.getElementById('feedbackModal').classList.remove('hidden');
  document.getElementById('feedbackText').focus();
}

// Adds the 💬 button to a tile/row's action strip (a .tile-actions element).
function addCardFeedbackButton(actionsEl, card){
  if(!card) return;
  const b = mkBtn('💬', ()=>openCardFeedback(card));
  b.title = 'Send feedback on this card';
  b.classList.add('feedback-btn');
  actionsEl.appendChild(b);
}

async function sendCardFeedbackToServer(payload){
  const res = await fetch(WEBAPP_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({ action:'cardFeedback', idToken: state.idToken, ...payload }) });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error || 'Unknown error');
  return j;
}

document.getElementById('btnSubmitFeedback').addEventListener('click', async ()=>{
  const errEl = document.getElementById('feedbackError');
  const text = document.getElementById('feedbackText').value.trim();
  const discord = document.getElementById('feedbackDiscord').value.trim();
  if(!text){ errEl.textContent = 'Please type your feedback first.'; return; }
  if(text.length>FEEDBACK_MAX_LENGTH){ errEl.textContent = `That's a bit long — please keep it under ${FEEDBACK_MAX_LENGTH} characters.`; return; }
  errEl.textContent = '';
  const btn = document.getElementById('btnSubmitFeedback');
  const originalText = btn.textContent;
  btn.textContent = 'Sending…';
  try{
    const c = feedbackCard;
    await sendCardFeedbackToServer({
      cardId: c.id, cardName: c.name, cardType: c.type||'', cardSet: c._setName||'',
      feedback: text, discord,
    });
    if(discord) lsSet(LS_FEEDBACK_DISCORD_KEY, discord);
    document.getElementById('feedbackModal').classList.add('hidden');
    toast('Thanks — your feedback on "' + c.name + '" was sent.');
  }catch(err){
    errEl.textContent = 'Could not send that: ' + err.message;
  }finally{
    btn.textContent = originalText;
  }
});

/* ---- Feedback inbox (owner only — the server enforces this; hiding the button is cosmetic) ---- */
const FEEDBACK_ADMIN_EMAIL = 'smcbride@ghostgalaxy.com';
let feedbackItems = [];

function initFeedbackAdmin(signingOut){
  const isAdmin = !signingOut && (state.userEmail||'').toLowerCase()===FEEDBACK_ADMIN_EMAIL;
  const btn = document.getElementById('btnFeedbackInbox');
  btn.style.display = isAdmin ? 'inline-flex' : 'none';
  if(isAdmin) refreshFeedbackInbox().catch(()=>{});
}
async function feedbackAdminCall(action, extra){
  const res = await fetch(WEBAPP_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({ action, idToken: state.idToken, ...(extra||{}) }) });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error || 'Unknown error');
  return j;
}
function applyFeedbackResult(j){
  feedbackItems = j.items;
  document.getElementById('btnFeedbackInbox').textContent = j.unread ? `Feedback (${j.unread})` : 'Feedback';
  renderFeedbackInbox();
}
async function refreshFeedbackInbox(){ applyFeedbackResult(await feedbackAdminCall('feedbackList')); }

function renderFeedbackInbox(){
  const unreadOnly = document.getElementById('feedbackUnreadOnly').checked;
  const unread = feedbackItems.filter(x=>!x.read).length;
  document.getElementById('feedbackInboxSummary').textContent = `${feedbackItems.length} note${feedbackItems.length===1?'':'s'}, ${unread} unread`;
  const shown = feedbackItems.filter(x=>!unreadOnly || !x.read);
  document.getElementById('feedbackInboxList').innerHTML = shown.length ? shown.map(x=>{
    const when = new Date(x.time); const whenTxt = isNaN(when) ? x.time : when.toLocaleString();
    return `<div class="fb-item${x.read?'':' unread'}">
      <div class="fb-meta">${x.source==='room'?'<span class="fb-tag">Game room</span> ':''}<strong>${escapeHtml(x.card)}</strong> · ${escapeHtml(x.type)}${x.set?' · '+escapeHtml(x.set):''} · ${escapeHtml(whenTxt)}</div>
      <div class="fb-meta">From ${escapeHtml(x.from)}${x.discord?' · Discord: '+escapeHtml(x.discord):''}</div>
      <div class="fb-text">${escapeHtml(x.feedback)}</div>
      ${x.snapshot ? `<div class="btn btn-sm" data-snap="${escapeHtml(x.snapshot)}">View board snapshot</div><div class="fb-snap" data-snapbox="${escapeHtml(x.snapshot)}"></div>` : ''}
      ${x.read ? '' : `<div class="btn btn-sm" data-row="${x.row}">Mark read</div>`}
    </div>`;
  }).join('') : '<p style="color:var(--text-soft);">Nothing here.</p>';
}
document.getElementById('btnFeedbackInbox').addEventListener('click', async ()=>{
  document.getElementById('feedbackInboxError').textContent = '';
  document.getElementById('feedbackInboxModal').classList.remove('hidden');
  renderFeedbackInbox();
  try{ await refreshFeedbackInbox(); }
  catch(e){ document.getElementById('feedbackInboxError').textContent = 'Could not load feedback: ' + e.message; }
});
document.getElementById('feedbackUnreadOnly').addEventListener('change', renderFeedbackInbox);
async function markFeedbackRead(rows){
  try{ applyFeedbackResult(await feedbackAdminCall('feedbackMarkRead', {rows})); }
  catch(e){ document.getElementById('feedbackInboxError').textContent = 'Could not mark read: ' + e.message; }
}
document.getElementById('btnFeedbackMarkAll').addEventListener('click', ()=>markFeedbackRead('all'));
document.getElementById('feedbackInboxList').addEventListener('click', (e)=>{
  const snap = e.target.closest('[data-snap]');
  if(snap){ toggleFeedbackSnapshot(snap); return; }
  const b = e.target.closest('[data-row]'); if(b) markFeedbackRead([Number(b.dataset.row)]);
});

// Loads (once) and shows/hides a game-room board snapshot under its note.
async function toggleFeedbackSnapshot(btn){
  const id = btn.dataset.snap;
  const box = [...document.querySelectorAll('[data-snapbox]')].find(el=>el.dataset.snapbox===id);
  if(!box) return;
  if(box.dataset.loaded){ box.style.display = box.style.display==='none' ? 'block' : 'none'; return; }
  btn.textContent = 'Loading snapshot…';
  try{
    const j = await feedbackAdminCall('feedbackSnapshot', {fileId:id});
    box.innerHTML = `<a href="${j.dataUrl}" target="_blank" rel="noopener"><img src="${j.dataUrl}" alt="Board snapshot" style="max-width:100%;border:1px solid var(--border);border-radius:6px;margin-top:8px;"></a>`;
    box.dataset.loaded = '1';
    btn.textContent = 'Hide board snapshot';
  }catch(e){
    btn.textContent = 'View board snapshot';
    document.getElementById('feedbackInboxError').textContent = 'Could not load the snapshot: ' + e.message;
  }
}
