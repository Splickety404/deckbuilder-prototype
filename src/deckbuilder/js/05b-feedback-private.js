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
