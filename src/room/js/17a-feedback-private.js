/* =========================================================================
   ROOM FEEDBACK (private). A Feedback button in the top bar opens a small form;
   sending posts to the same backend action as the deckbuilder's per-card feedback
   (cardFeedback, source "room"), so it lands in the same inbox. The sender can
   optionally attach a snapshot of the shared board, zoomed to fit everything.
   Only the public board is captured — never anyone's hand.
   ========================================================================= */
const LS_FEEDBACK_DISCORD_KEY = 'eoo_feedback_discord'; // same key (and, on Pages, same origin) as the deckbuilder's, so the handle carries over
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const SNAPSHOT_MAX_WIDTH = 1400;

function lsGet(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

function loadHtml2Canvas(){
  if(window.html2canvas) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = HTML2CANVAS_URL;
    s.onload = ()=>resolve();
    s.onerror = ()=>reject(new Error('could not load the screenshot tool'));
    document.head.appendChild(s);
  });
}
const nextPaint = (ms)=>new Promise(r=>setTimeout(r, ms));

// A JPEG data URL of the whole shared board, zoomed to fit everything. The viewer's own
// pan/zoom is put back afterwards. Chat, tabs and the rotate button are hidden during capture.
async function captureBoardSnapshot(){
  await loadHtml2Canvas();
  const target = document.getElementById('boardViewport');
  const savedView = { ...state.view };
  const overlays = [...target.querySelectorAll('.board-overlay')];
  overlays.forEach(el=>{ el.dataset.fbVis = el.style.visibility; el.style.visibility = 'hidden'; });
  try{
    fitAll();
    await nextPaint(200); // let the fitted view and zone labels settle
    const bg = getComputedStyle(target).backgroundColor;
    const canvas = await html2canvas(target, {
      backgroundColor: (bg && bg!=='rgba(0, 0, 0, 0)') ? bg : '#1a1c22',
      useCORS: true, logging: false, scale: 1,
    });
    // Shrink to a sensible size, and tighter if it's still big, so it sends quickly.
    const ratio = Math.min(1, SNAPSHOT_MAX_WIDTH / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width*ratio); out.height = Math.round(canvas.height*ratio);
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    let url = out.toDataURL('image/jpeg', 0.72);
    if(url.length > 2500000) url = out.toDataURL('image/jpeg', 0.5);
    return url;
  } finally {
    overlays.forEach(el=>{ el.style.visibility = el.dataset.fbVis || ''; delete el.dataset.fbVis; });
    state.view = savedView;
    applyView();
  }
}

function openRoomFeedback(){
  document.getElementById('feedbackText').value = '';
  document.getElementById('feedbackDiscord').value = lsGet(LS_FEEDBACK_DISCORD_KEY);
  document.getElementById('feedbackReplyEmail').textContent = state.userEmail || '';
  document.getElementById('feedbackError').textContent = '';
  document.getElementById('feedbackModal').classList.remove('hidden');
  document.getElementById('feedbackText').focus();
}
document.getElementById('btnRoomFeedback').addEventListener('click', openRoomFeedback);

document.getElementById('btnSubmitFeedback').addEventListener('click', async ()=>{
  const errEl = document.getElementById('feedbackError');
  const text = document.getElementById('feedbackText').value.trim();
  const discord = document.getElementById('feedbackDiscord').value.trim();
  if(!text){ errEl.textContent = 'Please type your feedback first.'; return; }
  if(text.length>4000){ errEl.textContent = "That's a bit long — please keep it under 4000 characters."; return; }
  errEl.textContent = '';
  const btn = document.getElementById('btnSubmitFeedback');
  const originalText = btn.textContent;
  try{
    let snapshot = '', snapshotFailed = false;
    if(document.getElementById('feedbackSnapshot').checked){
      btn.textContent = 'Capturing board…';
      try{ snapshot = await captureBoardSnapshot(); }
      catch(e){ console.error('Board snapshot failed:', e); snapshotFailed = true; }
    }
    btn.textContent = 'Sending…';
    const res = await fetch(CARD_WEBAPP_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'cardFeedback', idToken: state.idToken, source:'room',
        cardId:'', cardName:'Game Room', cardType:'Room', cardSet: state.sessionCode ? ('Room '+state.sessionCode) : '',
        feedback: text, discord, snapshot }) });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if(!j.ok) throw new Error(j.error || 'Unknown error');
    if(discord) lsSet(LS_FEEDBACK_DISCORD_KEY, discord);
    document.getElementById('feedbackModal').classList.add('hidden');
    toast(snapshotFailed ? 'Feedback sent — the board snapshot could not be captured, so it was sent without one.' : 'Thanks — your feedback was sent.');
  }catch(err){
    errEl.textContent = 'Could not send that: ' + err.message;
  }finally{
    btn.textContent = originalText;
  }
});
