/* =========================================================================
   ECHO — DECK CONTROLS, RULES CHECKLIST AND STATS (private). Everything the
   deck panel shows that only exists for Echo's structured decks: the Overlord/
   Champion tabs, leader / Domination / Stronghold pickers, the rules checklist
   and the deck + view statistics. Hooked into the shared renderers through the
   EchoGame definition (see 01b/01c); moved here unchanged.
   ========================================================================= */
EchoGame.renderTabs = function(){
  document.querySelectorAll('#deckTypeTabs .tab').forEach(t=>{
    const schemeOpen = state.deckType==='overlord' && curDeck().overlordMode==='scheme';
    t.classList.toggle('active', t.dataset.type==='scheme' ? schemeOpen : t.dataset.type===state.deckType && !schemeOpen);
  });
  FlyCards.paintCounts();
};

EchoGame.renderDeckControlsExtras = function(){
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
};

// informational only, same permissive philosophy as everything else in this app.
function renderDeckRulesChecklist(){
  const el = document.getElementById('deckRulesChecklist');
  const isOverlord = state.deckType==='overlord';
  const rules = [];

  const mainCount = deckTotalCount();
  rules.push([mainCount>=DECK_LIMIT, mainCount>=DECK_LIMIT ? `${mainCount} cards (meets the ${DECK_LIMIT}-card minimum)` : `${mainCount} / ${DECK_LIMIT} cards — under the minimum`]);

  const overCopyIds = [...curDeck().deckCards.entries()].filter(([,n])=>n>3).map(([id])=>id);
  rules.push([overCopyIds.length===0, overCopyIds.length===0 ? 'No card exceeds 3 copies' : `${overCopyIds.length} card(s) have more than 3 copies`]);

  const extraLeaders = [...curDeck().deckCards.entries()].filter(([id])=>{ const c=state.byId.get(id); return c && c.type===leaderTypeName(state.deckType); }).reduce((n,[,q])=>n+q, 0);
  if(extraLeaders>0) rules.push([false, `${extraLeaders} extra ${isOverlord?'Overlord':'Champion'} card${extraLeaders>1?'s':''} in the deck list (from boosters) — over the limit of 1; remove any time`]);

  if(isOverlord){
    const schemeCount = curDeck().schemeIds.length;
    rules.push([schemeCount===SCHEME_DECK_SIZE, `${schemeCount} / ${SCHEME_DECK_SIZE} schemes` + (schemeCount===SCHEME_DECK_SIZE?' — exact':'')]);

    const schemeCards = curDeck().schemeIds.map(id=>state.byId.get(id)).filter(Boolean);
    const quest = schemesQuestTotal(schemeCards);
    const questShort = schemeCount>=SAGA.schemeCount && quest<SAGA.minSchemeQuest;
    rules.push([!questShort, questShort ? `${quest} quest in the scheme deck — needs at least ${SAGA.minSchemeQuest}` : `${quest} quest in the scheme deck` + (schemeCount<SAGA.schemeCount ? ` so far (5 schemes need at least ${SAGA.minSchemeQuest})` : ` (at least ${SAGA.minSchemeQuest})`)]);

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
  el.classList.toggle('foil', !!card && isFoil(card.id));
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
    ? `${imgHtml}<span>${escapeHtml(card.name)}</span>${changed?'<span class="changed-badge" data-act="changed" title="Changed since this deck was exported — click to see what changed">&#9888;</span>':''}<span class="chip-feedback feedback-btn" data-act="feedback" title="Send feedback on this card">💬</span><span class="chip-remove" data-act="remove" title="Remove">✕</span>`
    : `<span class="placeholder">${escapeHtml(placeholderText)}</span>`;
  if(card && card._isHorizontal) layoutLandscapeFrame(el.querySelector('.landscape-frame'));
  if(card) wireHoverPreview(el, card);
  if(changed) el.querySelector('[data-act=changed]').addEventListener('click', (e)=>{ e.stopPropagation(); openHistoryModal(card); });
  if(card) el.querySelector('[data-act=feedback]').addEventListener('click', (e)=>{ e.stopPropagation(); openCardFeedback(card); });
  if(card && onRemove){
    el.querySelector('[data-act=remove]').addEventListener('click', (e)=>{
      e.stopPropagation(); // don't also trigger the chip's own click-to-open-picker handler
      onRemove();
    });
  }
}

