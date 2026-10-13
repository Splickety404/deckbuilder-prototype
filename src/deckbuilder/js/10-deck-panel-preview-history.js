/* =========================================================================
   DECK PANEL
   ========================================================================= */
function renderDeckPanel(){
  const zone = document.getElementById('deck-drop-zone');
  zone.innerHTML='';

  const side = state.game.activeSideList();
  if(side){
    side.render(zone);
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
  layoutAllLandscapeFrames(zone);
}

function buildDeckRow(id, card, {qty, showStepper}){
  const row = document.createElement('div');
  row.className = 'deck-stack' + (card && card._isHorizontal ? ' landscape-row' : '');
  row.draggable = true;
  row.dataset.id = id;
  // The game decides how many copies are legal (none are ever blocked — this only flags visually).
  const copyLimit = state.game.copyLimit(card);
  const overLimit = showStepper && qty>copyLimit;
  const illegal = !card || !isLegalForCurrentPool(card);
  if(overLimit || illegal) row.classList.add('over-limit');
  if(illegal) row.title = state.game.illegalRowHint;

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
  row.innerHTML = `${img}<div class="dstop"><div class="dsname">${name}</div>${removedBadgeHtml}${changed?'<div class="changed-badge" title="Changed since this deck was exported — click to see what changed">&#9888;</div>':''}</div>`;
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
  if(typeof addForgeFireButton==='function') addForgeFireButton(actions, card);
  if(typeof addCardFeedbackButton==='function') addCardFeedbackButton(actions, card);
  actions.appendChild(mkBtn('×', ()=> removeAllCopies(id)));
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
      const side = state.game.activeSideList();
      const orderArr = side ? side.order() : curDeck().deckOrder;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height/2;
      const filtered = orderArr.filter(x=>x!==payload.id);
      const idx = filtered.indexOf(id);
      const insertAt = before ? idx : idx+1;
      filtered.splice(insertAt<0?filtered.length:insertAt, 0, payload.id);
      if(side) side.setOrder(filtered); else curDeck().deckOrder = filtered;
      renderAll();
    } else if(Array.isArray(payload)){
      addCardsToDeck(payload);
    }
  });
}

function removeOneCopy(id){
  const side = state.game.activeSideList();
  if(side){ side.removeOne(id); return; }
  const cur = curDeck().deckCards.get(id)||0;
  const nn = cur-1;
  if(nn<=0){ curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id); }
  else curDeck().deckCards.set(id,nn);
  renderAll();
}
function removeAllCopies(id){
  const side = state.game.activeSideList();
  if(side){
    side.removeAll(id);
    renderAll();
    return;
  }
  curDeck().deckCards.delete(id);
  curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id);
  renderAll();
}
function addCardsToDeck(ids){
  const side = state.game.activeSideList();
  if(side){
    side.add(ids);
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
  frameEl.classList.toggle('landscape', !!c._isHorizontal && !is270);
  frameEl.classList.toggle('landscape270', is270);
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

  const ffBtn = document.getElementById('btnForgeFire');
  if(ffBtn){
    const url = typeof forgeFireUrl==='function' ? forgeFireUrl(c) : null;
    ffBtn.style.display = url ? 'inline-flex' : 'none';
    ffBtn.onclick = () => openForgeFire(c);
  }
  const fbBtn = document.getElementById('btnCardFeedback');
  if(fbBtn) fbBtn.onclick = () => openCardFeedback(c);

  document.getElementById('preview-modal').classList.remove('hidden');
  if(c._isHorizontal) layoutLandscapeFrame(frameEl); // must run after the modal is visible, or clientWidth reads 0
}

/* =========================================================================
   VERSION HISTORY + DIFF
   ========================================================================= */

async function openHistoryModal(card){
  const body = document.getElementById('historyModalBody');
  body.innerHTML = '<p style="color:var(--text-soft);">Loading…</p>';
  document.getElementById('historyModal').classList.remove('hidden');
  try{
    const rows = await cardSource.cardHistory(card.id);
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

