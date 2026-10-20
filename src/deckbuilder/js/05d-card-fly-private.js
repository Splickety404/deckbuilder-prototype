/* =========================================================================
   CARD FLY-IN (private). When a booster is unwrapped or a sealed deck is built,
   each card spawns at the button you clicked, spins once and flies in an arc to
   where it now lives: its row in the open deck, the leader / Domination /
   Stronghold chip, or — if that deck is hidden behind a tab — the tab itself,
   which ripples as it absorbs the card. The counts on the Overlord / Champion /
   Scheme Deck tabs tick up as each card lands. The whole thing is capped at
   under one second however many cards there are.

   Usage (the state change itself happens first, exactly as before):
     FlyCards.begin(keysToRestartAtZero?);   // freeze the tab counts at their old values
     …change the decks…  renderAll();
     FlyCards.run(buttonEl, moves, onDone?); // moves: {card, key:'overlord'|'champion'|'scheme'}
                                             //      or {card, side, slot:'deck-leader-slot'…}
   ========================================================================= */
const FlyCards = (()=>{
  let shown = null; // while animating: the counts currently displayed on the tabs

  function realCounts(){
    const o = state.decks && state.decks.overlord, c = state.decks && state.decks.champion;
    if(!o || !c) return null;
    return { overlord: deckCountOf(o), champion: deckCountOf(c), scheme: o.schemeIds.length };
  }
  function paintCounts(){
    const counts = shown || realCounts();
    if(!counts) return;
    document.querySelectorAll('#deckTypeTabs .tab-count').forEach(el=>{
      const v = String(counts[el.dataset.count]);
      if(el.textContent!==v) el.textContent = v;
    });
  }
  function bump(el){
    el.animate([{transform:'scale(1)'},{transform:'scale(1.5)'},{transform:'scale(1)'}], {duration:180, easing:'ease-out'});
  }
  function begin(restartKeys){
    shown = realCounts();
    if(shown) (restartKeys||[]).forEach(k=>{ shown[k] = 0; });
    paintCounts();
  }

  // Works out where a move ends up: an open-deck row, a setup chip, or a tab.
  function resolve(m){
    const tabFor = (key)=>document.querySelector(`#deckTypeTabs .tab[data-type="${key}"]`);
    if(m.slot){
      const chip = document.getElementById(m.slot);
      if(m.side===state.deckType && chip && chip.offsetParent) return { kind:'chip', el:chip };
      return { kind:'tab', el:tabFor(m.side) };
    }
    const open = m.key==='scheme' ? activeIsSchemeMode()
               : (state.deckType===m.key && !activeIsSchemeMode());
    if(open){
      const zone = document.getElementById('deck-drop-zone');
      const row = zone.querySelector(`.deck-stack[data-id="${CSS.escape(m.card.id)}"]`);
      return row ? { kind:'row', el:row, zone } : { kind:'chip', el:zone };
    }
    return { kind:'tab', el:tabFor(m.key) };
  }

  function run(origin, moves, onDone){
    const finishAll = ()=>{ shown = null; paintCounts(); if(onDone) onDone(); };
    if(!moves.length || !Element.prototype.animate || matchMedia('(prefers-reduced-motion: reduce)').matches){ finishAll(); return; }

    const o = origin ? origin.getBoundingClientRect() : { left:innerWidth/2, top:innerHeight/2, width:0, height:0 };
    const sx = o.left + o.width/2, sy = o.top + o.height/2;
    const n = moves.length, DUR = 480;
    const step = n>1 ? Math.min(60, (940-DUR)/(n-1)) : 0; // last card lands before ~0.95s

    const hiddenRows = new Map(); // row → copies still on the way (the row stays invisible until they land)
    const targets = moves.map(resolve);
    targets.forEach(t=>{ if(t.kind==='row'){ hiddenRows.set(t.el, (hiddenRows.get(t.el)||0)+1); t.el.style.visibility='hidden'; } });

    let left = n, finished = false;
    const done = ()=>{
      if(finished) return; finished = true;
      hiddenRows.forEach((_,row)=>{ row.style.visibility=''; });
      finishAll();
    };
    setTimeout(done, 1300); // safety net

    moves.forEach((m, i)=>{
      const t = targets[i];
      if(!t.el){ left--; return; }
      const r = t.el.getBoundingClientRect();
      let ex = r.left + r.width/2, ey = r.top + r.height/2;
      if(t.kind==='row'){ // keep the landing spot inside the visible part of the list
        const z = t.zone.getBoundingClientRect();
        ey = Math.min(Math.max(ey, z.top+16), z.bottom-16);
        ex = r.left + Math.min(r.width/2, 40);
      }
      const endScale = t.kind==='tab' ? 0.22 : Math.min(0.5, Math.max(0.25, r.height/98));
      const x0 = sx + (Math.random()-0.5)*16, y0 = sy + (Math.random()-0.5)*10;
      let lift = (60 + Math.hypot(ex-x0, ey-y0)*0.2) * (0.8 + Math.random()*0.4);
      if(Math.min(y0, ey) < lift + 30) lift = -lift; // near the top edge: bulge downward instead so the card never leaves the screen

      const fly = document.createElement('div');
      fly.className = 'fly-card' + (m.foil ? ' foil' : '');
      const url = displayImageUrl(m.card);
      if(url) fly.innerHTML = `<img src="${escapeHtml(sizedUrl(url,150))}" class="${m.card._rotate?'sideways':''}" alt="">`;
      document.body.appendChild(fly);

      const frames = [];
      for(let k=0;k<=16;k++){
        const p = k/16, e = p<.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
        const x = x0 + (ex-x0)*e, y = y0 + (ey-y0)*e - lift*Math.sin(Math.PI*p);
        const grow = Math.min(1, p/0.25);
        const s = (0.15 + 0.85*grow) + (endScale-1)*Math.max(0,(p-0.25)/0.75)*Math.max(0,(p-0.25)/0.75);
        frames.push({ transform:`translate(${x-35}px,${y-49}px) rotate(${360*e}deg) scale(${Math.max(.05,s)})`,
                      opacity: k===0 ? 0 : (t.kind==='tab' && p>0.85 ? 0.35 : 1) });
      }
      const anim = fly.animate(frames, { duration:DUR, delay:i*step, fill:'both', easing:'linear' });
      anim.onfinish = ()=>{
        fly.remove();
        if(t.kind==='row'){
          const c = (hiddenRows.get(t.el)||1)-1; hiddenRows.set(t.el, c);
          if(c<=0) t.el.style.visibility='';
        }
        if(m.key && shown){
          shown[m.key]++; paintCounts();
          const badge = document.querySelector(`#deckTypeTabs .tab-count[data-count="${m.key}"]`);
          if(badge) bump(badge);
        }
        if(t.kind==='tab') absorb(t.el);
        if(--left<=0) done();
      };
    });
    if(left<=0) done();
  }

  // The tab pulses and a ripple spreads from its centre, as if it swallowed the card.
  function absorb(tab){
    tab.animate([{transform:'scale(1)'},{transform:'scale(1.1)'},{transform:'scale(1)'}], {duration:240, easing:'ease-out'});
    const ripple = document.createElement('span');
    ripple.className = 'absorb-ripple';
    tab.appendChild(ripple);
    const a = ripple.animate([{transform:'scale(1)',opacity:0.65},{transform:'scale(11)',opacity:0}], {duration:420, easing:'ease-out'});
    a.onfinish = ()=>ripple.remove();
  }

  return { begin, run, paintCounts };
})();
