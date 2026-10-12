/* =========================================================================
   RENDER: TOP CONTROLS / DECK CONTROLS
   ========================================================================= */
function renderTabs(){
  document.querySelectorAll('#deckTypeTabs .tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.type===state.deckType);
  });
}

function renderDeckControls(){
  document.getElementById('deckNameInput').value = curDeck().name || '';
  document.getElementById('overlordModeToggle').style.display = state.deckType==='overlord' ? 'flex' : 'none';
  document.querySelectorAll('#overlordModeToggle .tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.mode===curDeck().overlordMode);
  });

  const leader = getLeader();
  renderPickChip('deck-leader-slot', leader, 'Click to choose a leader', curDeck().leaderId, ()=>{
    curDeck().leaderId = null;
    renderAll();
  });

  const isOverlord = state.deckType==='overlord';
  const bonusCard = getBonusCard();
  renderPickChip('deck-bonus-slot', bonusCard, isOverlord ? 'Click to choose a Domination card' : 'Click to choose a Quest card', curDeck().bonusCardId, ()=>{
    curDeck().bonusCardId = null;
    curDeck().bonusAspect = ''; // derived — clears along with the card that determined it
    renderAll();
  });

  const extraCard = getExtraCard();
  renderPickChip('deck-extra-slot', extraCard, isOverlord ? 'Click to choose a Stronghold' : 'Click to choose a Resistance', curDeck().extraCardId, ()=>{
    curDeck().extraCardId = null;
    renderAll();
  });

  document.getElementById('aspectLabel').textContent = isOverlord ? 'Domination Aspect' : 'Quest Aspect';
  document.getElementById('aspectValue').textContent = curDeck().bonusAspect || '— choose a ' + (isOverlord?'Domination':'Quest') + ' card —';

  const isScheme = activeIsSchemeMode();
  document.getElementById('deckPanelTitle').textContent = isScheme ? 'Scheme Deck' : 'Your Deck';
  const count = isScheme ? curDeck().schemeIds.length : deckTotalCount();
  const cl = document.getElementById('deckCountLabel');
  if(state.isEchoMode){
    const limit = isScheme ? SCHEME_DECK_SIZE : DECK_LIMIT;
    cl.textContent = `${count} / ${limit}`;
    cl.className = count>limit ? 'bad' : '';
  } else {
    // Generic mode doesn't restrict card counts for any reason — just show the total.
    cl.textContent = `${count} card${count!==1?'s':''}`;
    cl.className = '';
  }

  let illegalCount=0;
  if(isScheme){
    curDeck().schemeIds.forEach(id=>{ const c=state.byId.get(id); if(!c || !isLegalForCurrentPool(c)) illegalCount++; });
  } else {
    for(const id of curDeck().deckCards.keys()){ const c=state.byId.get(id); if(!c || !isLegalForCurrentPool(c)) illegalCount++; }
  }
  const btn = document.getElementById('btnClearIllegal');
  btn.style.display = illegalCount>0 ? 'inline-flex' : 'none';
  if(illegalCount>0) btn.textContent = `Remove ${illegalCount} illegal card${illegalCount>1?'s':''}`;

  renderDeckRulesChecklist();
  renderDeckStats();
}

// Non-blocking status against the documented deckbuilding rules (50+ main-deck cards,
// max 3 copies of any one card, exactly 5 schemes, max 1 copy of any one scheme) —
// informational only, same permissive philosophy as everything else in this app.
function renderDeckRulesChecklist(){
  const el = document.getElementById('deckRulesChecklist');
  const isOverlord = state.deckType==='overlord';
  const rules = [];

  const mainCount = deckTotalCount();
  rules.push([mainCount>=DECK_LIMIT, mainCount>=DECK_LIMIT ? `${mainCount} cards (meets the ${DECK_LIMIT}-card minimum)` : `${mainCount} / ${DECK_LIMIT} cards — under the minimum`]);

  const overCopyIds = [...curDeck().deckCards.entries()].filter(([,n])=>n>3).map(([id])=>id);
  rules.push([overCopyIds.length===0, overCopyIds.length===0 ? 'No card exceeds 3 copies' : `${overCopyIds.length} card(s) have more than 3 copies`]);

  if(isOverlord){
    const schemeCount = curDeck().schemeIds.length;
    rules.push([schemeCount===SCHEME_DECK_SIZE, `${schemeCount} / ${SCHEME_DECK_SIZE} schemes` + (schemeCount===SCHEME_DECK_SIZE?' — exact':'')]);

    const schemeCounts = {};
    curDeck().schemeIds.forEach(id=> schemeCounts[id]=(schemeCounts[id]||0)+1);
    const dupSchemes = Object.values(schemeCounts).filter(n=>n>1).length;
    rules.push([dupSchemes===0, dupSchemes===0 ? 'No duplicate schemes' : `${dupSchemes} scheme(s) appear more than once`]);
  }

  el.innerHTML = rules.map(([ok,label])=> `<div class="${ok?'rule-ok':'rule-warn'}">${ok?'✓':'⚠'} ${escapeHtml(label)}</div>`).join('');
}

// Shared by both stats panels (deck contents vs. currently-filtered view) — takes
// [id, count] pairs so either caller can decide how "count" is determined.
// Echo of Omens' three skill-check types — shared with the skill-check-type
// column's own values, so a card's difficulty sums into the matching bucket.
const SKILL_CHECK_TYPES = ['Arcane','Diplomacy','Stealth'];

function computeCardStats(idCountPairs){
  const aspectCounts = {}, typeCounts = {}, iconCounts = {};
  const skillTotals = { 'inherent-arcane':0, 'inherent-diplomacy':0, 'inherent-stealth':0, 'attack':0, 'block':0 };
  // Echo of Omens only: a skill-check card carries a Skill Check Type (Arcane/
  // Diplomacy/Stealth) plus a separate Difficulty column — summed per type so a
  // deck's checks can be compared at a glance (e.g. "this deck leans Stealth-heavy").
  const skillCheckDifficulty = { 'Arcane':0, 'Diplomacy':0, 'Stealth':0 };
  let totalCost = 0, costedCount = 0, totalCards = 0;
  idCountPairs.forEach(([id,n])=>{
    if(n<=0) return;
    const c = state.byId.get(id); if(!c) return;
    totalCards += n;
    const aspect = c.aspect || 'Neutral';
    aspectCounts[aspect] = (aspectCounts[aspect]||0) + n;
    typeCounts[c.type] = (typeCounts[c.type]||0) + n;
    const cost = Number(c['card-cost']);
    if(!isNaN(cost)){ totalCost += cost*n; costedCount += n; }
    // Sums aren't affected by the app's usual "0 means not present" convention for
    // these columns (unlike an average, a sum of zeros just contributes nothing).
    Object.keys(skillTotals).forEach(key=>{
      const v = Number(c[key]);
      if(!isNaN(v)) skillTotals[key] += v*n;
    });
    // Matched case-insensitively and by substring rather than requiring an exact
    // string — the sheet has used "Arcane type", "Arcane", and presumably other
    // phrasings interchangeably, so any cell that MENTIONS one of the three skill
    // names is enough (deliberately loose since this is free-text data entry, not a
    // fixed dropdown). Also split on "/" the same way bonus-icons-scripted is below,
    // so a card testing more than one skill (e.g. "Arcane / Stealth") counts its
    // difficulty toward each type it lists.
    const checkTypeRaw = String(c['skill-check-type']||'').trim();
    if(checkTypeRaw){
      const diff = Number(c['difficulty']);
      if(!isNaN(diff)){
        checkTypeRaw.split('/').map(s=>s.trim().toLowerCase()).forEach(token=>{
          const matchedType = SKILL_CHECK_TYPES.find(t=> token.includes(t.toLowerCase()));
          if(matchedType) skillCheckDifficulty[matchedType] += diff*n;
        });
      }
    }
    // bonus-icons-scripted is "/"-delimited and can repeat (e.g. "Arcane / Arcane" is
    // 2 icons on one card) — each token counts once per copy in the weighted set.
    const iconsRaw = String(c['bonus-icons-scripted']||'').trim();
    if(iconsRaw){
      iconsRaw.split('/').map(s=>s.trim()).filter(Boolean).forEach(icon=>{
        iconCounts[icon] = (iconCounts[icon]||0) + n;
      });
    }
  });
  const avgCost = costedCount ? (totalCost/costedCount).toFixed(2) : null;
  return { aspectCounts, typeCounts, iconCounts, skillTotals, skillCheckDifficulty, avgCost, totalCards };
}

function statBarGroupHtml(title, counts){
  // A bar with value 0 (e.g. a deck with no Attack cards at all, under the fixed
  // 'Stats'/'Skill Check Difficulty' keys below) is dropped entirely rather than
  // shown as an empty/zero-width bar.
  const entries = Object.entries(counts).filter(([,val])=>val!==0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length) return `<div class="stat-group"><div class="stat-group-title">${escapeHtml(title)}</div><div class="stat-empty">—</div></div>`;
  const max = Math.max(1, ...entries.map(e=>e[1]));
  const rows = entries.map(([label,val])=>`
    <div class="stat-bar-row">
      <div class="stat-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(val/max*100).toFixed(1)}%;"></div></div>
      <div class="stat-bar-value">${val}</div>
    </div>`).join('');
  return `<div class="stat-group"><div class="stat-group-title">${escapeHtml(title)}</div>${rows}</div>`;
}

function renderStatsPanelHtml(stats){
  if(!stats.totalCards) return '<div class="stat-empty-msg">Nothing here yet.</div>';
  const skillCounts = {
    'Arcane': stats.skillTotals['inherent-arcane'],
    'Diplomacy': stats.skillTotals['inherent-diplomacy'],
    'Stealth': stats.skillTotals['inherent-stealth'],
    'Attack': stats.skillTotals['attack'],
    'Block': stats.skillTotals['block'],
  };
  return `
    <div class="stat-summary">${stats.totalCards} card${stats.totalCards!==1?'s':''}${stats.avgCost!==null?` · avg cost <b>${stats.avgCost}</b>`:''}</div>
    ${statBarGroupHtml('Aspects', stats.aspectCounts)}
    ${statBarGroupHtml('Types', stats.typeCounts)}
    ${statBarGroupHtml('Stats', skillCounts)}
    ${statBarGroupHtml('Skill Check Difficulty', stats.skillCheckDifficulty)}
    ${statBarGroupHtml('Bonus Icons', stats.iconCounts)}
  `;
}

function renderDeckStats(){
  const body = document.getElementById('deckStatsBody');
  const ids = activeIsSchemeMode() ? curDeck().schemeIds : [...curDeck().deckCards.keys()];
  const countOf = (id) => activeIsSchemeMode() ? curDeck().schemeIds.filter(x=>x===id).length : (curDeck().deckCards.get(id)||0);
  const uniqueIds = [...new Set(ids)];
  body.innerHTML = renderStatsPanelHtml(computeCardStats(uniqueIds.map(id=>[id, countOf(id)])));
}

// Stats for whatever's CURRENTLY VISIBLE in the library after filters. When Deck
// View is on, the visible pool is already restricted to deck contents, so counts
// are weighted by actual deck quantity (matching Deck Stats' own convention).
// When Deck View is off, each visible card counts once — this is describing the
// browsable library subset, not deck composition.
function renderCurrentViewStats(){
  const body = document.getElementById('viewStatsBody');
  if(!body) return;
  const visibleCards = poolForCurrentMode().filter(c=>cardMatchesFilters(c));
  const weightOf = (c) => {
    if(!curFilters().deckViewOnly) return 1;
    return activeIsSchemeMode() ? curDeck().schemeIds.filter(x=>x===c.id).length : (curDeck().deckCards.get(c.id)||0);
  };
  body.innerHTML = renderStatsPanelHtml(computeCardStats(visibleCards.map(c=>[c.id, weightOf(c)])));
}

function renderPickChip(elId, card, placeholderText, selectedId, onRemove){
  const el = document.getElementById(elId);
  if(!card && selectedId){
    // A card WAS chosen, but no longer exists in the live feed — distinct from
    // "nothing chosen" (which would show the plain placeholder instead).
    const info = getRemovedCardInfo(selectedId);
    const label = info==='loading' ? 'Loading…' : (info==='not-found' ? `(unknown card ${selectedId})` : (info.name || selectedId));
    el.innerHTML = `<span class="removed-badge" data-act="removedinfo" title="Removed from the game — click for details">&#9888;</span><span>${escapeHtml(label)}</span><span class="chip-remove" data-act="remove" title="Remove">✕</span>`;
    el.querySelector('[data-act=removedinfo]').addEventListener('click', (e)=>{
      e.stopPropagation();
      toast(info && info!=='loading' && info!=='not-found' ? `"${info.name}" was removed from the game (last known type: ${info.type||'unknown'}).` : 'This card was removed from the game — no further record found.');
    });
    if(onRemove) el.querySelector('[data-act=remove]').addEventListener('click', (e)=>{ e.stopPropagation(); onRemove(); });
    return;
  }
  const imgHtml = card ? cardImageHtml(card, '', 150) : '';
  const changed = card && cardChangedSinceExport(card);
  el.innerHTML = card
    ? `${imgHtml}<span>${escapeHtml(card.name)}</span>${changed?'<span class="changed-badge" data-act="changed" title="Changed since this deck was exported — click to see what changed">&#9888;</span>':''}<span class="chip-remove" data-act="remove" title="Remove">✕</span>`
    : `<span class="placeholder">${escapeHtml(placeholderText)}</span>`;
  if(card && card._isHorizontal) layoutSchemeFrame(el.querySelector('.landscape-frame'));
  if(card) wireHoverPreview(el, card);
  if(changed) el.querySelector('[data-act=changed]').addEventListener('click', (e)=>{ e.stopPropagation(); openHistoryModal(card); });
  if(card && onRemove){
    el.querySelector('[data-act=remove]').addEventListener('click', (e)=>{
      e.stopPropagation(); // don't also trigger the chip's own click-to-open-picker handler
      onRemove();
    });
  }
}

/* =========================================================================
   RENDER: LIBRARY GRID
   ========================================================================= */
function renderLibrary(){
  const grid = document.getElementById('library-grid');
  let pool = poolForCurrentMode().filter(c=>cardMatchesFilters(c));
  pool = sortPool(pool);
  state.visibleCardsOrder = pool.map(c=>c.id);
  document.getElementById('library-count').textContent = `${pool.length} card${pool.length!==1?'s':''}`;

  grid.innerHTML='';
  if(!state.cards.length){
    grid.innerHTML = `<div style="grid-column:1/-1;padding:40px 20px;text-align:center;color:var(--text-soft);">
      No card sets are loaded yet. Click <b>Sets</b> in the top bar to enable Set 1 or import another set.
    </div>`;
    renderCurrentViewStats();
    return;
  }
  const frag = document.createDocumentFragment();
  pool.forEach((c)=>{
    const tile = document.createElement('div');
    const legal = isLegalForCurrentPool(c);
    tile.className = 'card-tile' + (c._isHorizontal?' scheme-card':'') + (!legal?' illegal':'');
    if(!legal) tile.title = 'Not legal for this deck — wrong aspect for your leader/domination aspect.';
    tile.draggable = true;
    tile.dataset.id = c.id;
    if(state.selection.has(c.id)) tile.classList.add('selected');

    if(displayImageUrl(c)){
      tile.innerHTML = `${cardImageHtml(c, `loading="lazy" alt="${escapeHtml(c.name)}"`, gridImageFetchWidth())}
                         <div class="name-bar">${escapeHtml(c.name)}</div>`;
    } else {
      tile.innerHTML = `<div class="fallback-face" style="background:${colorForAspect(c.aspect)}22;">
                           <div class="fname">${escapeHtml(c.name)}</div>
                           <div class="ftype">${escapeHtml(c.type)} ${c.aspect?'· '+escapeHtml(c.aspect):''}</div>
                           <div class="fability">${escapeHtml((c.ability||'').slice(0,160))}</div>
                         </div>
                         <div class="name-bar">${escapeHtml(c.name)}</div>`;
    }

    const countIn = activeIsSchemeMode() ? curDeck().schemeIds.filter(x=>x===c.id).length : (curDeck().deckCards.get(c.id)||0);
    if(countIn>0){
      const badge=document.createElement('div');
      badge.className='count-badge';
      badge.textContent = '×'+countIn; // numeric for both modes now — schemes are no longer capped at one
      tile.appendChild(badge);
    }
    if(isRecentlyUpdated(c)){
      const dot=document.createElement('div');
      dot.className='updated-dot';
      dot.textContent='Updated';
      tile.appendChild(dot);
    }

    const actions = document.createElement('div'); actions.className='tile-actions';
    actions.appendChild(mkBtn('+', ()=>addCardsToDeck([c.id])));
    if(countIn>0) actions.appendChild(mkBtn('−', ()=>{ activeIsSchemeMode() ? removeScheme(c.id) : removeOneCopy(c.id); }));
    if(c._doubleSided && c._back) actions.appendChild(mkBtn('⟲', ()=>{ toggleCardFlip(c.id); renderLibrary(); }));
    actions.appendChild(mkBtn('…', ()=>openPreview(c)));
    tile.appendChild(actions);

    tile.addEventListener('click', (e)=>onTileClick(e, c.id));
    tile.addEventListener('dragstart', (e)=>onTileDragStart(e, c.id));
    wireHoverPreview(tile, c);
    frag.appendChild(tile);
  });
  grid.appendChild(frag);
  layoutAllSchemeFrames(grid);
  renderCurrentViewStats();
}

function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Google's image CDN accepts a =w{pixels} size suffix on lh3.googleusercontent.com
// links, so we can request an appropriately-sized render instead of always pulling the
// full source resolution — dramatically cuts load time (and, for the PDF export, file
// size) for a card sourced from a PDF, where that "render" is the only way to get a
// viewable image out of it at all in the first place. But for a card whose art is
// already a standalone PNG/JPEG, asking for one more exact pixel width forces Google's
// CDN to dynamically resize it on request instead of just serving the file as-is —
// real, easy-to-notice latency (especially on hover, where the preview needs a
// different width than whatever the grid thumbnail already asked for) bought for very
// little, since these aren't a page pulled out of some huge multi-card PDF. Code.gs's
// artUrl() tags every URL it hands back with a "#img-src" or "#pdf-src" fragment
// (inert — never sent to the browser's actual request, just text this function reads
// off the string) saying which case it is, so only a URL NOT tagged as a plain image
// (a PDF, or anything untagged/legacy from before this existed) gets sized down; an
// image URL is returned as-is, fragment stripped, requesting the file at its own
// native size.
//
// The PDF export is the one caller that always wants the `force` override: it
// deliberately downsizes to a fixed print resolution (900px wide) no matter the
// source format, both to cap file size and because a native-resolution PNG can be
// print-production scale — large enough that fetching/decoding it client-side is
// what was actually failing PDF export for PNG-sourced cards. `force` skips the
// "leave images alone" branch above and always appends the width, same as a PDF.
// Cards published by the Card Updater also have a small copy of their art
// (375 px wide, a third of the download). Known small copies, by full-size link:
// whenever a picture is wanted at small-copy size or less, the small one is used.
// Cards without one (every older card) are unaffected.
const smallImageFor = new Map();
const SMALL_IMAGE_MAX_WIDTH = 400;
function noteSmallImage(url, smallUrl){
  const sm = String(smallUrl||'').trim();
  if(url && sm) smallImageFor.set(url, sm);
}
function sizedUrl(url, w, force){
  if(!url) return '';
  if(!force && w <= SMALL_IMAGE_MAX_WIDTH && smallImageFor.has(url)) url = smallImageFor.get(url);
  const isImage = !force && url.includes('#img-src');
  const base = url.split('#')[0]; // e.g. ".../d/<fileId>" or ".../d/<fileId>?v=<token>" (see Code.gs artUrl())
  if(isImage) return base;
  // The "=wNNN" size directive has to sit directly after the fileId, BEFORE any
  // "?v=..." cache-busting query string Code.gs's artUrl() may have added — Google's
  // CDN only recognizes it as a path suffix, not as part of a query string. So it's
  // inserted right before the "?", not just appended to the end of the string.
  const qIdx = base.indexOf('?');
  return qIdx === -1 ? (base + '=w' + w) : (base.slice(0, qIdx) + '=w' + w + base.slice(qIdx));
}

