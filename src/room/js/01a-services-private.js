/* =========================================================================
   ROOM SERVICES (private build) — every call this page makes to a backend
   goes through `roomServices`, never straight to a URL, so another build can
   supply its own object with the same four methods and nothing else changes:
     logEvent(type, envelope)   keep a permanent record of one game event
                                (fire-and-forget; gameplay never waits on it)
     fetchHistory()             -> [{ts, type, payload, playerName}] for this room
     cardAttempts(sheetId)      -> [async () => {ok, cards…}, …] tried in order
                                until one works (see fetchSheetCards)
     fetchGameBoards(gameId)    -> {ok, boards:[…]} saved boards / precons
   This is the Google Apps Script implementation — unchanged behavior, moved. */
const roomServices = {
  logEvent(type, envelope){
    fetch(ROOM_WEBAPP_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'}, // avoids a CORS preflight Apps Script can't answer
      body: JSON.stringify({ sheetId: ROOM_SHEET_ID, sessionCode: state.sessionCode, playerId: state.playerId, playerName: state.playerName, type, payload: envelope }),
    }).catch(e=> console.warn('Durable history log failed (gameplay unaffected):', e));
  },
  async fetchHistory(){
    const url = `${ROOM_WEBAPP_URL}?pollRoom=${encodeURIComponent(state.sessionCode)}&sheetId=${encodeURIComponent(ROOM_SHEET_ID)}&since=0&_=${Date.now()}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const events = await res.json();
    if(events && events.error) throw new Error(events.error);
    return events || [];
  },
  cardAttempts(sheetId){
    return [
      async () => {
        const res = await fetch(`${CARD_WEBAPP_URL}?cardsForSheet=${encodeURIComponent(sheetId)}&idToken=${encodeURIComponent(state.idToken)}&_=${Date.now()}`);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const json = await res.json();
        if(!json.ok) throw new Error(json.error || 'unknown error');
        return json;
      },
      () => new Promise((resolve,reject)=>{
        const cbName = '__eooCardsCb_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const timer = setTimeout(()=>{ cleanup(); reject(new Error('JSONP timed out')); }, 15000);
        function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
        window[cbName] = (data)=>{ cleanup(); if(!data.ok){ reject(new Error(data.error||'unknown error')); return; } resolve(data); };
        script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
        script.src = `${CARD_WEBAPP_URL}?cardsForSheet=${encodeURIComponent(sheetId)}&idToken=${encodeURIComponent(state.idToken)}&callback=${cbName}&_=${Date.now()}`;
        document.head.appendChild(script);
      }),
    ];
  },
  async fetchGameBoards(gameId){
    const url = `${CARD_WEBAPP_URL}?precons=${encodeURIComponent(gameId)}&idToken=${encodeURIComponent(state.idToken)}`;
    try{
      const res = await fetch(url + '&_=' + Date.now());
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    }catch(fetchErr){
      return await new Promise((resolve, reject)=>{ // same JSONP fallback as the card fetches
        const cbName = '__roomBoardsCb_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to answer.')); }, 30000);
        function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
        window[cbName] = (data)=>{ cleanup(); resolve(data); };
        script.onerror = ()=>{ cleanup(); reject(new Error('Could not reach the server.')); };
        script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
        document.head.appendChild(script);
      });
    }
  },
};
