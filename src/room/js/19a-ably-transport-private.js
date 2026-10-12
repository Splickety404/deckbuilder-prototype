/* =========================================================================
   ABLY TRANSPORT (private) — the live-sync transport the private build uses,
   plugged in as roomServices.syncTransport. Moved here unchanged.
   ========================================================================= */
const ABLY_API_KEY = 'TTVNbQ.lz-fZA:mzHxpkBNnMo7qMtP3xs8uqEB4yye8np0lqtaS00fSM0';
// Paste your Ably app's API key here (Ably dashboard → your app → API Keys
// tab → copy a key's string, looks like "AbCdEf.GhIjKl:mnopqrstuvwxyz").
// A key scoped to just {subscribe, publish, presence} on channel "room:*"
// is the tidy choice; the default root key works fine too for a private
// game among friends.
function ablyConfigured(){ return !!ABLY_API_KEY; }

const AblyTransport = (()=>{
  let client = null;
  let channel = null;
  let handlers = null;
  function ensureClient(){
    if(!ablyConfigured()) return false;
    if(client) return true;
    try{
      if(!window.Ably) return false; // SDK <script> tag didn't load (offline, blocked, etc.)
      client = new Ably.Realtime({ key: ABLY_API_KEY, clientId: state.playerId });
      client.connection.on((stateChange)=>{
        const s = stateChange.current;
        if(handlers) handlers.onStatus(s==='connected', s==='connected' ? null : s);
      });
      return true;
    }catch(err){ console.warn('Live sync disabled — Ably init failed:', err); return false; }
  }
  // Presence events (enter/update/leave) only tell us SOMETHING changed, not
  // the full picture — re-fetching the whole member list each time is cheap
  // at card-game scale and keeps rendering dead simple.
  function refreshMembers(){
    if(!channel) return;
    // Ably's v2 SDK returns a promise here (the old (err, members) callback form is rejected).
    channel.presence.get().then(members=>{ if(handlers) handlers.onPresence(members); }).catch(()=>{});
  }
  function onMessage(msg){ if(handlers) handlers.onEvent(msg); }
  return {
    open(code, h){
      if(!ensureClient()) return false;
      handlers = h;
      channel = client.channels.get(`room:${code}`);
      channel.subscribe(onMessage);
      channel.presence.subscribe(refreshMembers);
      channel.presence.enter({ name: state.playerName, x:0, y:0, holding:false, heldLabel:null });
      return true;
    },
    send(type, envelope){ channel.publish(type, envelope); },
    updatePresence(data){ channel.presence.update(data); },
    leaveNow(){ if(channel) channel.presence.leave(); },
    close(){
      if(channel){
        channel.unsubscribe(onMessage);
        channel.presence.unsubscribe(refreshMembers);
        channel.presence.leave();
      }
      channel = null;
      handlers = null;
    },
  };
})();
roomServices.syncTransport = AblyTransport;
roomServices.syncUnavailableHint = 'Live sync isn\'t set up yet (missing Ably key) — see the setup notes near ABLY_API_KEY in room.html.';
