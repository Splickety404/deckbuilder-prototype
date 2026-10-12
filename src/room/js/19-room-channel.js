/* =========================================================================
   ROOM CHANNEL — one Ably realtime channel per session code that carries
   BOTH real game events (see the SYNC ENGINE section above — postRoomEvent
   publishes here, handleIncomingRoomEvent subscribes here) AND ephemeral
   cosmetic presence: where each connected player's cursor currently is,
   and whether they're holding/dragging something right now. Ably supports
   pub/sub messages and presence on the same channel, so one connection
   does both jobs.

   This is now a hard requirement for multiplayer, not an optional add-on —
   see the SYNC ENGINE comment above for why the old Sheets-polling design
   was replaced outright rather than kept as a fallback. If ABLY_API_KEY is
   left blank or the SDK fails to load, connectToRoom below shows a clear
   toast rather than silently limping along on a broken sync.
   ========================================================================= */
const ABLY_API_KEY = 'TTVNbQ.lz-fZA:mzHxpkBNnMo7qMtP3xs8uqEB4yye8np0lqtaS00fSM0';
// Paste your Ably app's API key here (Ably dashboard → your app → API Keys
// tab → copy a key's string, looks like "AbCdEf.GhIjKl:mnopqrstuvwxyz").
// A key scoped to just {subscribe, publish, presence} on channel "room:*"
// is the tidy choice; the default root key works fine too for a private
// game among friends.
function ablyConfigured(){ return !!ABLY_API_KEY; }

let ablyClient = null;
let roomChannel = null;
var presenceCursors = new Map(); // playerId -> DOM element in #boardWorld. `var` (hoisted) because renderBoard, defined earlier, reads it
let presenceLastSent = 0;
const PRESENCE_SEND_MS = 150; // ~6-7 updates/sec — smooth, and easier on the free tier's message quota now that this channel also carries every game action
let presenceHolding = false;
let presenceHeldLabel = null;

function ensureAbly(){
  if(!ablyConfigured()) return false;
  if(ablyClient) return true;
  try{
    if(!window.Ably) return false; // SDK <script> tag didn't load (offline, blocked, etc.)
    ablyClient = new Ably.Realtime({ key: ABLY_API_KEY, clientId: state.playerId });
    ablyClient.connection.on((stateChange)=>{
      const s = stateChange.current;
      setConnStatus(s==='connected', s==='connected' ? null : s);
    });
    return true;
  }catch(err){ console.warn('Live sync disabled — Ably init failed:', err); return false; }
}
// Deterministic per-player color, derived purely from the id — every viewer
// lands on the same color for the same player with nothing to sync.
function presenceColorFor(id){
  let hash = 0;
  for(let i=0;i<id.length;i++) hash = (hash*31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash)%360}, 80%, 64%)`;
}
function renderPresenceMembers(members){
  const world = document.getElementById('boardWorld');
  const seen = new Set();
  (members||[]).forEach(m=>{
    const pid = m.clientId, p = m.data || {};
    if(!pid || pid === state.playerId) return; // never render our own cursor back at ourselves
    seen.add(pid);
    let el = presenceCursors.get(pid);
    if(!el){
      el = document.createElement('div');
      el.className = 'presence-cursor';
      const color = presenceColorFor(pid);
      el.innerHTML = `<div class="dot" style="background:${color};border:2px solid rgba(255,255,255,.85);"></div>`+
        `<div class="tag" style="background:${color};">${escapeHtml(p.name||'Player')}</div>`+
        `<div class="chip" style="display:none;"></div>`;
      presenceCursors.set(pid, el);
    }
    // renderBoard empties #boardWorld on nearly every interaction — put the
    // cursor back if that happened since we last saw this player move.
    if(!el.isConnected) world.appendChild(el);
    el.style.left = (p.x||0)+'px';
    el.style.top = (p.y||0)+'px';
    el.classList.toggle('holding', !!p.holding);
    const chip = el.querySelector('.chip');
    if(p.holding && p.heldLabel){ chip.style.display=''; chip.textContent = '✋ '+p.heldLabel; }
    else chip.style.display = 'none';
  });
  // Anyone no longer in the member list (left, disconnected) loses their
  // cursor — Ably detects a dropped connection and clears their presence
  // automatically even if they close the tab without warning.
  presenceCursors.forEach((el, pid)=>{ if(!seen.has(pid)){ el.remove(); presenceCursors.delete(pid); } });
}
// Presence events (enter/update/leave) only tell us SOMETHING changed, not
// the full picture — re-fetching the whole member list each time is cheap
// at card-game scale and keeps rendering dead simple.
function refreshPresenceMembers(){
  if(!roomChannel) return;
  roomChannel.presence.get((err, members)=>{ if(!err) renderPresenceMembers(members); });
}
// Sets up the one Ably channel for this session — both the live game-event
// bus (handleIncomingRoomEvent, defined in the SYNC ENGINE section above)
// and presence (cursors) ride this same channel/connection.
function initRoomChannel(){
  if(!ensureAbly()) return false;
  roomChannel = ablyClient.channels.get(`room:${state.sessionCode}`);
  roomChannel.subscribe(handleIncomingRoomEvent);
  roomChannel.presence.subscribe(refreshPresenceMembers);
  roomChannel.presence.enter({ name: state.playerName, x:0, y:0, holding:false, heldLabel:null });
  return true;
}
function teardownRoomChannel(){
  if(roomChannel){
    roomChannel.unsubscribe(handleIncomingRoomEvent);
    roomChannel.presence.unsubscribe(refreshPresenceMembers);
    roomChannel.presence.leave();
  }
  roomChannel = null;
  presenceCursors.forEach(el=>el.remove());
  presenceCursors.clear();
}
function sendPresence(clientX, clientY, forceNow){
  if(!roomChannel) return;
  const now = Date.now();
  if(!forceNow && now - presenceLastSent < PRESENCE_SEND_MS) return;
  presenceLastSent = now;
  const w = clientToWorld(clientX, clientY);
  roomChannel.presence.update({ name: state.playerName, x: Math.round(w.x), y: Math.round(w.y), holding: presenceHolding, heldLabel: presenceHeldLabel });
}
window.addEventListener('mousemove', (e)=>{ sendPresence(e.clientX, e.clientY); });
// A generic "is this player currently holding/dragging something" signal —
// deliberately kept independent of the board's many individual drag handlers
// (pieces, splayed stacks, tokens) rather than threading a broadcast call
// into each one, so this can't regress any of them. It just watches, at the
// document level, whether the mouse went down on something draggable and
// hasn't come back up yet, and grabs a human-readable label for it (a
// piece's label/top-card name if it has one) along the way.
document.addEventListener('mousedown', (e)=>{
  const target = e.target.closest('.piece, .token');
  if(!target) return;
  presenceHolding = true;
  presenceHeldLabel = target.querySelector('.piece-label')?.textContent?.trim() || target.getAttribute('title') || 'a card';
  sendPresence(e.clientX, e.clientY, true);
}, true);
document.addEventListener('mouseup', (e)=>{
  if(!presenceHolding) return;
  presenceHolding = false;
  presenceHeldLabel = null;
  sendPresence(e.clientX, e.clientY, true);
}, true);
window.addEventListener('beforeunload', ()=>{ if(roomChannel) roomChannel.presence.leave(); });

