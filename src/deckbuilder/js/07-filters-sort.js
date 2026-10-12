/* =========================================================================
   FILTERS
   ========================================================================= */
// A card that exists under more than one set (see mergeCardSets' _setNames) only
// counts as hidden here if EVERY set it belongs to is currently unchecked — checking
// any one of its sets is enough to keep it visible, matching how set membership
// actually works rather than just whichever set's copy happens to be displayed.
// Factored out of cardMatchesFilters so any single-card picker a game adds (a leader pick,
// say — none of which go through cardMatchesFilters or poolForCurrentMode at all, since
// they build their own one-card-only pools) can apply the exact same set-checkbox
// rule the main card grid does, instead of silently ignoring it.
function cardVisibleBySet(c){
  if(!(curFilters().hiddenSets && curFilters().hiddenSets.size)) return true;
  const names = (c._setNames && c._setNames.length) ? c._setNames : [c._setName];
  return !names.every(n=>curFilters().hiddenSets.has(n));
}

function cardMatchesFilters(c, exceptKey){
  if(curFilters().deckViewOnly){
    const side = state.game.activeSideList();
    const inDeck = side ? side.has(c.id) : curDeck().deckCards.has(c.id);
    if(!inDeck) return false;
  }
  if(!cardVisibleBySet(c)) return false;
  const s = curFilters().search.trim().toLowerCase();
  if(s && !( (c.name||'').toLowerCase().includes(s) || (c.ability||'').toLowerCase().includes(s) )) return false;
  for(const [key,set] of Object.entries(curFilters().multi)){
    if(key===exceptKey || !set.size) continue;
    const fd = state.fieldDefs.find(f=>f.key===key);
    const vals = fd ? getFieldValues(c,fd) : [];
    if(!vals.some(v=>set.has(v))) return false;
  }
  for(const [key,r] of Object.entries(curFilters().range)){
    if(key===exceptKey) continue;
    if(!isStatPresent(c,key)) return false;
    const val = Number(c[key]);
    if(r.min!==null && r.min!==undefined && val<r.min) return false;
    if(r.max!==null && r.max!==undefined && val>r.max) return false;
  }
  return true;
}

function renderFilters(){
  const wrap = document.getElementById('filterGroups');
  wrap.innerHTML='';
  const visiblePool = poolForCurrentMode();

  // Keep the search box in sync with the active tab's own filter state — it's a plain
  // input, not re-rendered from scratch like the chip groups below, so this needs to
  // happen explicitly on every render (including right after switching between deck tabs).
  const searchBox = document.getElementById('searchBox');
  if(document.activeElement !== searchBox) searchBox.value = curFilters().search; // don't fight the user's cursor while they're actively typing
  document.getElementById('deckViewCheckbox').checked = curFilters().deckViewOnly;
  renderSetFilterGroup();

  state.fieldDefs.forEach(f=>{
    // Faceted pruning: a field's group (and each of its chip values) only appears if
    // at least one card would still match given every OTHER currently-active filter.
    const candidates = visiblePool.filter(c=>cardMatchesFilters(c, f.key));
    if(!candidates.length) return;

    const det = document.createElement('details');
    det.className='filter-group';
    det.open = state.openFilterGroups.has(f.key);
    det.addEventListener('toggle', ()=>{ det.open ? state.openFilterGroups.add(f.key) : state.openFilterGroups.delete(f.key); });
    const sum = document.createElement('summary');
    sum.textContent = f.label;
    det.appendChild(sum);

    if(f.kind==='multi' || f.kind==='multi-split'){
      const valueSet = new Set();
      candidates.forEach(c=> getFieldValues(c,f).forEach(v=>valueSet.add(v)));
      const values = [...valueSet].sort();
      if(!values.length) return;
      const row = document.createElement('div');
      row.className='filter-chip-row';
      values.forEach(v=>{
        const chip=document.createElement('div');
        chip.className='filter-chip';
        chip.textContent=v;
        chip.classList.toggle('on', (curFilters().multi[f.key]||new Set()).has(v));
        chip.onclick=()=>{
          if(!curFilters().multi[f.key]) curFilters().multi[f.key]=new Set();
          const s = curFilters().multi[f.key];
          s.has(v) ? s.delete(v) : s.add(v);
          renderFilters(); renderLibrary();
        };
        row.appendChild(chip);
      });
      det.appendChild(row);
      wrap.appendChild(det);
    } else if(f.kind==='range'){
      if(!candidates.some(c=>isStatPresent(c,f.key))) return;
      const row=document.createElement('div');
      row.className='range-row';
      const cur = curFilters().range[f.key]||{};
      row.innerHTML = `<input type="number" placeholder="min" value="${cur.min??''}">
                        <span>–</span>
                        <input type="number" placeholder="max" value="${cur.max??''}">`;
      const [minI,maxI] = row.querySelectorAll('input');
      const applyLive=()=>{
        const min = minI.value===''?null:Number(minI.value);
        const max = maxI.value===''?null:Number(maxI.value);
        if(min===null && max===null) delete curFilters().range[f.key];
        else curFilters().range[f.key] = {min,max};
      };
      minI.oninput=()=>{ applyLive(); renderLibrary(); };
      maxI.oninput=()=>{ applyLive(); renderLibrary(); };
      minI.onchange=()=>{ applyLive(); renderFilters(); renderLibrary(); };
      maxI.onchange=()=>{ applyLive(); renderFilters(); renderLibrary(); };
      det.appendChild(row);
      wrap.appendChild(det);
    }
  });
}

/* =========================================================================
   SORT
   ========================================================================= */
function renderSortOptions(){
  const sel = document.getElementById('sortSelect');
  const prev = state.sortField;
  const opts = [{key:'name',label:'Name'}, ...state.fieldDefs.map(f=>({key:f.key,label:f.label}))];
  sel.innerHTML = opts.map(o=>`<option value="${o.key}" ${o.key===prev?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
}
function sortPool(pool){
  const field = state.sortField || 'name';
  const fd = state.fieldDefs.find(f=>f.key===field);
  const numeric = fd && fd.kind==='range';
  const cmp = (a,b) => {
    let av = field==='name' ? (a.name||'') : a[field];
    let bv = field==='name' ? (b.name||'') : b[field];
    if(numeric){
      av = (av===''||av===undefined||av===null) ? -Infinity : Number(av);
      bv = (bv===''||bv===undefined||bv===null) ? -Infinity : Number(bv);
      return av-bv;
    }
    return String(av||'').localeCompare(String(bv||''));
  };
  return [...pool].sort((a,b)=>{
    const aLegal = isLegalForCurrentPool(a), bLegal = isLegalForCurrentPool(b);
    if(aLegal !== bLegal) return aLegal ? -1 : 1; // illegal cards always sort after legal ones, regardless of sort field
    return cmp(a,b);
  });
}

