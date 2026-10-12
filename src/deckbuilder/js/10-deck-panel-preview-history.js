/* =========================================================================
   DECK PANEL
   ========================================================================= */
function renderDeckPanel(){
  const zone = document.getElementById('deck-drop-zone');
  zone.innerHTML='';

  if(activeIsSchemeMode()){
    if(!curDeck().schemeIds.length){
      zone.innerHTML = `<div id="deck-empty-hint">Drag schemes here, or use the + button on a card. Choose exactly 5.</div>`;
    }
    const schemeCounts = {}, schemeOrder = [];
    curDeck().schemeIds.forEach(id=>{
      if(!(id in schemeCounts)){ schemeCounts[id]=0; schemeOrder.push(id); }
      schemeCounts[id]++;
    });
    schemeOrder.forEach(id=>{
      zone.appendChild(buildDeckRow(id, state.byId.get(id), {qty:schemeCounts[id], showStepper:true}));
    });
  } else {
    if(!curDeck().deckOrder.length){
      zone.innerHTML = `<div id="deck-empty-hint">Drag cards here, or use the + button on a card.</div>`;
    }
    curDeck().deckOrder.forEach(id=>{
      const n = curDeck().deckCards.get(id)||0;
      if(n<=0) return;
      zone.appendChild(buildDeckRow(id, state.byId.get(id), {qty:n, showStepper:true}));
    });
  }
  layoutAllSchemeFrames(zone);
}

function buildDeckRow(id, card, {qty, showStepper}){
  const row = document.createElement('div');
  row.className = 'deck-stack' + (card && card._isHorizontal ? ' scheme-row' : '');
  row.draggable = true;
  row.dataset.id = id;
  // Schemes: documented 1-copy max (Echo only). Generic mode restricts card counts for
  // no reason at all, so there's effectively no limit. Either way this only ever
  // flags visually — it has never actually blocked adding more copies.
  const copyLimit = (card && card._isScheme) ? 1 : (state.isEchoMode ? MAX_COPIES : Infinity);
  const overLimit = showStepper && qty>copyLimit;
  const illegal = !card || !isLegalForCurrentPool(card);
  if(overLimit || illegal) row.classList.add('over-limit');
  if(illegal) row.title = 'Not legal for this deck — wrong type, or wrong aspect for your leader/domination aspect.';

  const img = card && displayImageUrl(card) ? `<img src="${escapeHtml(sizedUrl(displayImageUrl(card),150))}">` : '';
  let name, removedBadgeHtml = '';
  if(card){
    name = escapeHtml(card.name);
  } else {
    const info = getRemovedCardInfo(id);
    if(info==='loading') name = 'Loading…';
    else if(info==='not-found') name = `(unknown card ${escapeHtml(id)})`;
    else name = escapeHtml(info.name || id);
    if(info!=='loading') removedBadgeHtml = '<div class="removed-badge" title="Removed from the game — click for details">&#9888; Removed</div>';
  }
  const changed = card && cardChangedSinceExport(card);
  row.innerHTML = `${img}<div class="dsname">${name}</div>${removedBadgeHtml}${changed?'<div class="changed-badge" title="Changed since this deck was exported — click to see what changed">&#9888;</div>':''}`;
  if(changed) row.querySelector('.changed-badge').addEventListener('click', (e)=>{ e.stopPropagation(); openHistoryModal(card); });
  if(removedBadgeHtml) row.querySelector('.removed-badge').addEventListener('click', (e)=>{
    e.stopPropagation();
    const info = removedCardCache.get(id);
    toast(info && info!=='not-found' ? `"${info.name}" was removed from the game (last known type: ${info.type||'unknown'}).` : 'This card was removed from the game — no further record found.');
  });

  const actions = document.createElement('div'); actions.className='tile-actions';
  if(showStepper){
    const stepper = document.createElement('div'); stepper.className='stepper';
    stepper.appendChild(mkBtn('−', ()=>removeOneCopy(id)));
    const countEl = document.createElement('span');
    countEl.className = 'dscount' + (overLimit?' over':'');
    countEl.textContent = '×'+qty;
    stepper.appendChild(countEl);
    stepper.appendChild(mkBtn('+', ()=>addCardsToDeck([id])));
    actions.appendChild(stepper);
  }
  if(card && card._doubleSided && card._back) actions.appendChild(mkBtn('⟲', ()=>{ toggleCardFlip(id); renderDeckPanel(); }));
  actions.appendChild(mkBtn('…', ()=> card && openPreview(card)));
  actions.appendChild(mkBtn('×', ()=> showStepper ? removeAllCopies(id) : removeScheme(id)));
  row.appendChild(actions);

  wireRowDrag(row, id);
  wireHoverPreview(row, card);
  return row;
}

/* Shared insertion-line indicator: shows the gap a reordered card will land in,
   rather than highlighting the row underneath it (which reads as "replace this card"
   instead of "insert between these cards"). Positioned with `top` (see the CSS
   comment on .reorder-indicator for why) rather than by where it sits in the DOM, so
   showing/moving it never shifts any row and can never cause the flicker that used to
   come from doing that. It stays permanently attached to the zone once created —
   toggling `display` is all showReorderIndicatorAt/hideReorderIndicator ever do — since
   there's nothing left to gain from detaching it, and it removes a DOM
   insert/remove cycle on every single dragover event on top of that. */
let reorderIndicatorEl = null;
function ensureReorderIndicator(zone){
  if(!reorderIndicatorEl){
    reorderIndicatorEl = document.createElement('div');
    reorderIndicatorEl.className = 'reorder-indicator';
  }
  if(reorderIndicatorEl.parentNode !== zone) zone.appendChild(reorderIndicatorEl);
  return reorderIndicatorEl;
}
function showReorderIndicatorAt(zone, beforeEl){
  const ind = ensureReorderIndicator(zone);
  const zoneRect = zone.getBoundingClientRect();
  let top;
  if(beforeEl){
    const r = beforeEl.getBoundingClientRect();
    top = (r.top - zoneRect.top) + zone.scrollTop - 4; // sit in the gap just above beforeEl
  } else {
    const rows = zone.querySelectorAll(':scope > .deck-stack');
    if(rows.length){
      const r = rows[rows.length - 1].getBoundingClientRect();
      top = (r.bottom - zoneRect.top) + zone.scrollTop + 1; // just below the last row
    } else {
      top = 0; // empty deck — nothing to be "below", land at the top
    }
  }
  ind.style.top = top + 'px';
  ind.style.display = 'block';
}
function hideReorderIndicator(){
  if(reorderIndicatorEl) reorderIndicatorEl.style.display = 'none';
}
document.addEventListener('dragend', hideReorderIndicator);

function wireRowDrag(row, id){
  row.addEventListener('dragstart', (e)=>{
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', JSON.stringify({reorder:true, id}));
    e.dataTransfer.effectAllowed='move';
  });
  row.addEventListener('dragover', (e)=>{
    e.preventDefault(); e.stopPropagation();
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height/2;
    showReorderIndicatorAt(row.parentNode, before ? row : row.nextElementSibling);
  });
  row.addEventListener('drop', (e)=>{
    e.preventDefault(); e.stopPropagation();
    hideReorderIndicator();
    let payload;
    try{ payload = JSON.parse(e.dataTransfer.getData('text/plain')); }catch(err){ return; }
    if(payload && payload.reorder){
      if(payload.id===id) return;
      const orderArr = activeIsSchemeMode() ? curDeck().schemeIds : curDeck().deckOrder;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height/2;
      const filtered = orderArr.filter(x=>x!==payload.id);
      const idx = filtered.indexOf(id);
      const insertAt = before ? idx : idx+1;
      filtered.splice(insertAt<0?filtered.length:insertAt, 0, payload.id);
      if(activeIsSchemeMode()) curDeck().schemeIds = filtered; else curDeck().deckOrder = filtered;
      renderAll();
    } else if(Array.isArray(payload)){
      addCardsToDeck(payload);
    }
  });
}

function removeOneCopy(id){
  if(activeIsSchemeMode()){ removeScheme(id); return; }
  const cur = curDeck().deckCards.get(id)||0;
  const nn = cur-1;
  if(nn<=0){ curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id); }
  else curDeck().deckCards.set(id,nn);
  renderAll();
}
function removeAllCopies(id){
  if(activeIsSchemeMode()){
    curDeck().schemeIds = curDeck().schemeIds.filter(x=>x!==id);
    renderAll();
    return;
  }
  curDeck().deckCards.delete(id);
  curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id);
  renderAll();
}
function removeScheme(id){
  // Removes only ONE occurrence — schemeIds can now contain duplicates (sealed-deck
  // generation may add a scheme that's already present), so removing every matching
  // entry via a plain filter would silently delete all of them from one click.
  const idx = curDeck().schemeIds.indexOf(id);
  if(idx!==-1) curDeck().schemeIds.splice(idx,1);
  renderAll();
}

function addCardsToDeck(ids){
  if(activeIsSchemeMode()){
    let added=0, skipped=0;
    ids.forEach(id=>{
      const c = state.byId.get(id);
      if(!c || !isTypeEligible(c)) { skipped++; return; } // aspect-illegal cards ARE addable now — only wrong type is a hard block
      curDeck().schemeIds.push(id); added++; // duplicates now allowed freely, same as main-deck cards — the rules checklist flags >1 copy, it never blocks it
    });
    toast(`Added ${added} scheme${added!==1?'s':''}${skipped?`, skipped ${skipped}`:''}.`);
  } else {
    let added=0, skipped=0;
    ids.forEach(id=>{
      const c = state.byId.get(id);
      if(!c || !isTypeEligible(c)) { skipped++; return; } // aspect-illegal cards ARE addable now — only wrong type is a hard block
      const cur = curDeck().deckCards.get(id)||0;
      curDeck().deckCards.set(id, cur+1);
      if(!curDeck().deckOrder.includes(id)) curDeck().deckOrder.push(id);
      added++;
    });
    toast(`Added ${added} card${added!==1?'s':''}${skipped?`, skipped ${skipped} (wrong card type for this deck)`:''}.`);
  }
  renderAll();
}

/* =========================================================================
   PREVIEW MODAL (schema-driven, respects 0-as-absent)
   ========================================================================= */
function openPreview(c){
  const imgEl = document.getElementById('preview-img');
  const frameEl = document.getElementById('preview-img-frame');
  const url = displayImageUrl(c);
  imgEl.removeAttribute('src'); // clear immediately so the previous card's bitmap never lingers mid-load
  const is270 = c._isHorizontal && c._rotate===270;
  frameEl.classList.toggle('scheme', !!c._isHorizontal && !is270);
  frameEl.classList.toggle('scheme270', is270);
  imgEl.classList.toggle('rotate-180-fill', !c._isHorizontal && c._rotate===180);
  if(!c._isHorizontal){ imgEl.style.width=''; imgEl.style.height=''; }
  frameEl.style.display = url ? 'block':'none';
  if(url) imgEl.src = sizedUrl(url, 560); // trimmed from 660 for faster loading — still comfortably crisp at this modal's display size
  const dl = document.getElementById('preview-text');
  const rows = [['Name',c.name],['Type',c.type]];
  if(c.aspect) rows.push(['Aspect',c.aspect]);
  if(c.loyalty) rows.push(['Loyalty',c.loyalty]);
  if(c.ability) rows.push(['Ability',c.ability]);
  state.fieldDefs.forEach(f=>{
    if(['type','aspect','loyalty'].includes(f.key)) return;
    if(!isStatPresent(c,f.key)) return;
    rows.push([f.label, getFieldValues(c,f).join(' / ')]);
  });
  dl.innerHTML = rows.map(([k,v])=>`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  const flipBtn = document.getElementById('btnFlipCard');
  if(c._doubleSided && c._back){
    flipBtn.style.display = 'inline-flex';
    flipBtn.textContent = isShowingBack(c) ? 'Show Front' : 'Show Back';
    flipBtn.onclick = () => { toggleCardFlip(c.id); openPreview(c); };
  } else {
    flipBtn.style.display = 'none';
  }

  const lu = c['last-updated'];
  document.getElementById('previewLastUpdated').textContent = lu ? ('Last updated: ' + formatDateLabel(lu)) : '';
  const histBtn = document.getElementById('btnViewHistory');
  histBtn.style.display = lu ? 'inline-flex' : 'none'; // only cards that have ever been through an update have history
  histBtn.onclick = () => openHistoryModal(c);

  document.getElementById('preview-modal').classList.remove('hidden');
  if(c._isHorizontal) layoutSchemeFrame(frameEl); // must run after the modal is visible, or clientWidth reads 0
}

/* =========================================================================
   VERSION HISTORY + DIFF
   ========================================================================= */
async function fetchCardHistory(cardId){
  // The card's own set sheet: each set keeps its own change history. A card
  // that's no longer in any set (removed) could be from any of them, so
  // every loaded set is asked.
  const card = state.byId.get(cardId);
  const sheetIds = card ? [card._sheetId] : [...new Set(state.cards.map(c=> c._sheetId))];
  const list = sheetIds.filter(Boolean).join(',');
  const sheetParam = list ? `&sheetId=${encodeURIComponent(list)}` : '';
  const url = `${WEBAPP_URL}?cardHistory=${encodeURIComponent(cardId)}&idToken=${encodeURIComponent(state.idToken)}${sheetParam}`;
  try{
    const res = await fetch(url + '&_=' + Date.now());
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(fetchErr){
    // Same fetch-then-JSONP fallback as the main card feed — this endpoint is
    // subject to the same occasional cross-origin quirks.
    return await new Promise((resolve,reject)=>{
      const cbName = '__eooHistCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('JSONP timed out')); }, 15000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
}

async function openHistoryModal(card){
  const body = document.getElementById('historyModalBody');
  body.innerHTML = '<p style="color:var(--text-soft);">Loading…</p>';
  document.getElementById('historyModal').classList.remove('hidden');
  try{
    const rows = await fetchCardHistory(card.id);
    if(!rows.length){ body.innerHTML = '<p style="color:var(--text-soft);">No past versions for this card yet.</p>'; return; }
    rows.sort((a,b)=> new Date(b['archived-at']) - new Date(a['archived-at']));
    body.innerHTML = '';
    rows.forEach(row=>{
      const div = document.createElement('div');
      div.className='row-item';
      div.innerHTML = `<span>${escapeHtml(formatDateLabel(row['archived-at']))}</span><span class="btn btn-sm">View changes</span>`;
      div.querySelector('.btn').addEventListener('click', ()=> openDiffModal(row, card));
      body.appendChild(div);
    });
  }catch(e){
    body.innerHTML = `<p style="color:var(--danger);">Could not load version history: ${escapeHtml(e.message)}</p>`;
  }
}

// Compares a past snapshot (raw sheet row) against today's live card, field by
// field, ignoring structural/meta columns. Art is compared separately since it's
// shown as images, not text.
function computeCardDiff(oldRow, currentCard){
  const skip = new Set(['id','is_double_sided','front-image-url','back-image-url','last-updated','archived-at','archive-reason','changed-fields','rotate', ...CARD_UPDATER_COLUMNS]);
  const keys = new Set([...Object.keys(oldRow), ...Object.keys(currentCard)]);
  const diffs = [];
  keys.forEach(k=>{
    if(skip.has(k) || isRawNameKey(k) || k.startsWith('_')) return;
    const oldVal = (oldRow[k]??'').toString().trim();
    const curVal = (currentCard[k]??'').toString().trim();
    if(oldVal !== curVal) diffs.push({ label: prettifyLabel(k), oldVal, curVal });
  });
  const oldFront = (oldRow['front-image-url']||'').trim();
  const oldBack = (oldRow['back-image-url']||'').trim();
  // Card Updater cards carry fingerprints of their art. Their old images aren't
  // kept (new art replaces the file in place), so the art change is told from the
  // fingerprints, and there's no "then" picture to show.
  const fingerprinted = !!(oldRow['image-hash'] || currentCard['image-hash']);
  const artChanged = fingerprinted
    ? ['image-hash','back-image-hash'].some(k=> (oldRow[k]||'') !== (currentCard[k]||''))
    : oldFront !== (currentCard._front||'') || oldBack !== (currentCard._back||'');
  return { diffs, artChanged, oldFront: fingerprinted ? '' : oldFront, fingerprinted };
}

function openDiffModal(oldRow, currentCard){
  document.getElementById('diffModalTitle').textContent = `Changes since ${formatDateLabel(oldRow['archived-at'])}`;
  const { diffs, artChanged, oldFront, fingerprinted } = computeCardDiff(oldRow, currentCard);
  let html = '';
  if(artChanged && fingerprinted){
    html += `<div class="diff-art-row">
      <div><div class="diff-art-label">Now (art updated)</div>${currentCard._front?`<img src="${escapeHtml(sizedUrl(currentCard._front,300))}">`:'<div class="diff-art-empty">No image</div>'}</div>
    </div>`;
  } else if(artChanged){
    html += `<div class="diff-art-row">
      <div><div class="diff-art-label">Then</div>${oldFront?`<img src="${escapeHtml(sizedUrl(oldFront,300))}">`:'<div class="diff-art-empty">No image</div>'}</div>
      <div><div class="diff-art-label">Now</div>${currentCard._front?`<img src="${escapeHtml(sizedUrl(currentCard._front,300))}">`:'<div class="diff-art-empty">No image</div>'}</div>
    </div>`;
  }
  if(diffs.length){
    html += '<table class="diff-table"><thead><tr><th>Field</th><th>Then</th><th>Now</th></tr></thead><tbody>' +
      diffs.map(d=>`<tr><td>${escapeHtml(d.label)}</td><td class="diff-old">${escapeHtml(d.oldVal||'—')}</td><td class="diff-new">${escapeHtml(d.curVal||'—')}</td></tr>`).join('') +
      '</tbody></table>';
  } else if(artChanged){
    html += '<p style="color:var(--text-soft);margin-top:10px;">Art updated — no other fields changed.</p>';
  } else {
    html += '<p style="color:var(--text-soft);">No changes detected in this version compared to today.</p>';
  }
  document.getElementById('diffModalBody').innerHTML = html;
  document.getElementById('historyModal').classList.add('hidden');
  document.getElementById('diffModal').classList.remove('hidden');
}

