/* =========================================================================
   SAVE / LOAD DECKS (localStorage)
   ========================================================================= */
// Scoped per game (folder id), now that one account can see more than one game —
// otherwise two unrelated games' saved decks would collide by name and mix together
// in the Load list. Falls back to the old flat (pre-games) key ONLY when reading and
// only if the scoped key has nothing yet, so decks saved before this existed are
// still visible instead of orphaned; the very next save moves them onto the scoped key.
function savedDecksKey(){ return LS_DECKS_KEY + '::' + (state.currentGameFolderId || 'default'); }
function getSavedDecks(){
  try{
    const scoped = JSON.parse(localStorage.getItem(savedDecksKey())||'{}');
    if(Object.keys(scoped).length) return scoped;
    return JSON.parse(localStorage.getItem(LS_DECKS_KEY)||'{}');
  }catch(e){ return {}; }
}
function setSavedDecks(obj){ localStorage.setItem(savedDecksKey(), JSON.stringify(obj)); }

document.getElementById('btnSaveDeck').addEventListener('click', ()=>{
  const name = document.getElementById('deckNameInput').value.trim();
  if(!name){ toast('Give your deck a name first.'); return; }
  const decks = getSavedDecks();
  decks[name] = {
    deckType: activeDeckKey(), ...deckCodec().saveExtras(curDeck()),
    sourceExportedAt: curDeck().sourceExportedAt,
    deckCards: [...curDeck().deckCards.entries()], deckOrder: curDeck().deckOrder,
  };
  setSavedDecks(decks);
  toast(`Saved "${name}".`);
});

function refreshLoadModal(){
  renderPreconList(); // also sets up the two tabs and their counts
  const decks = getSavedDecks();
  const body = document.getElementById('loadModalBody');
  const names = Object.keys(decks);
  body.innerHTML = names.length ? names.map(n=>`
      <div class="row-item">
        <span>${escapeHtml(n)} <span style="font-size:12px;color:var(--text-soft);">(${escapeHtml(decks[n].deckType)})</span></span>
        <span>
          <span class="btn btn-sm" data-load="${escapeHtml(n)}">Load</span>
          <span class="btn btn-sm" data-dup="${escapeHtml(n)}">Duplicate</span>
          <span class="btn btn-sm" data-rename="${escapeHtml(n)}">Rename</span>
          <span class="btn btn-sm" data-del="${escapeHtml(n)}">Delete</span>
        </span>
      </div>`).join('') : '<p style="color:var(--text-soft);font-size:13px;">No saved decks yet.</p>';

  body.querySelectorAll('[data-load]').forEach(b=>b.onclick=()=>{
    const d = decks[b.dataset.load];
    state.deckType = d.deckType; deckCodec().applySaved(d, curDeck());
    curDeck().sourceExportedAt = d.sourceExportedAt||null;
    curDeck().deckCards = new Map(d.deckCards||[]);
    curDeck().deckOrder = d.deckOrder || [...curDeck().deckCards.keys()];
    curDeck().name = b.dataset.load;
    curDeck().preconFileId = null;
    document.getElementById('loadModal').classList.add('hidden');
    renderAll();
  });
  body.querySelectorAll('[data-dup]').forEach(b=>b.onclick=()=>{
    const src = b.dataset.dup;
    let newName = src + ' (copy)', i=2;
    while(decks[newName]) newName = `${src} (copy ${i++})`;
    const decks2 = getSavedDecks();
    decks2[newName] = JSON.parse(JSON.stringify(decks2[src]));
    setSavedDecks(decks2);
    refreshLoadModal();
    toast(`Duplicated as "${newName}".`);
  });
  body.querySelectorAll('[data-rename]').forEach(b=>b.onclick=()=>{
    const oldName = b.dataset.rename;
    const newName = prompt('Rename deck:', oldName);
    if(!newName || newName===oldName) return;
    const decks2 = getSavedDecks();
    if(decks2[newName]){ toast('A deck with that name already exists.'); return; }
    decks2[newName] = decks2[oldName];
    delete decks2[oldName];
    setSavedDecks(decks2);
    if(curDeck().name===oldName) curDeck().name = newName; // keep the currently-open deck's displayed name in sync, if it's the one being renamed
    refreshLoadModal();
    renderAll();
  });
  body.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    const decks2 = getSavedDecks(); delete decks2[b.dataset.del]; setSavedDecks(decks2);
    refreshLoadModal();
  });
}
document.getElementById('btnLoadDeck').addEventListener('click', ()=>{
  loadPrecons(false); // pick up decks added since the game loaded
  refreshLoadModal();
  document.getElementById('loadModal').classList.remove('hidden');
});

/* ---- Import from file (.json exact, .txt best-effort by name) ----
   Shared by the "Choose a file…" button (via the hidden file input's change event)
   and dragging a file onto #importDropZone below — both funnel into this one function
   so there's a single place that decides .json vs .txt parsing and closes the modal. */
function handleImportFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      if(file.name.toLowerCase().endsWith('.json')) importDeckFromJson(JSON.parse(reader.result));
      else importDeckFromText(String(reader.result));
      document.getElementById('loadModal').classList.add('hidden');
    }catch(err){ toast('Import failed: '+err.message); }
  };
  reader.readAsText(file);
}
document.getElementById('btnImportFile').addEventListener('click', ()=> document.getElementById('importFileInput').click());
document.getElementById('importFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  handleImportFile(file);
  e.target.value='';
});

// Drag-and-drop onto the import drop zone — mirrors the deck-row drag styling
// convention (#deck-drop-zone.dragover) elsewhere in the app. dragenter/dragover must
// both call preventDefault() or the browser refuses to fire 'drop' at all.
(()=>{
  const zone = document.getElementById('importDropZone');
  let dragDepth = 0; // tracks nested enter/leave pairs so a dragover on a child (the
                      // "Choose a file…" button) doesn't prematurely clear the highlight
  zone.addEventListener('dragenter', (e)=>{
    e.preventDefault();
    dragDepth++;
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragover', (e)=> e.preventDefault());
  zone.addEventListener('dragleave', (e)=>{
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth-1);
    if(dragDepth===0) zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', (e)=>{
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(!file){ toast('No file detected in drop.'); return; }
    const name = file.name.toLowerCase();
    if(!name.endsWith('.txt') && !name.endsWith('.json')){ toast('Please drop a .txt or .json deck file.'); return; }
    handleImportFile(file);
  });
})();

function importDeckFromJson(d){
  if(!d || !d.deckType) throw new Error('not a recognized deck file');
  state.deckType = d.deckType; deckCodec().applyJson(d, curDeck());
  curDeck().deckCards = new Map(Object.entries(d.deckCards||{}));
  curDeck().deckOrder = d.deckOrder || [...curDeck().deckCards.keys()];
  curDeck().name = d.name || '';
  curDeck().sourceExportedAt = d.exportedAt || null;
  curDeck().preconFileId = null; // set again by loadPreconDeck when this came from one
  renderAll();
  toast('Deck imported.');
}

// Smart plain-text import. Works on a bare pasted list of cards (no header needed) as well
// as our own exported format. Recognises "3x Name", "3 Name", "Name x3", "Name" (= 1 copy),
// matches names ignoring case/punctuation/extra spaces, and picks up an export date from a
// line like "# Exported: …" / "Export date: …" if one is present (used for "changed since").
function importDeckFromText(text){
  const norm = s=> String(s).toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/'/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const byName = new Map(), byNorm = new Map();
  state.cards.forEach(c=>{
    if(!byName.has(c.name)) byName.set(c.name, c);
    const k = norm(c.name); if(!byNorm.has(k)) byNorm.set(k, c);
  });
  const findCard = name=> byName.get(name) || byNorm.get(norm(name.replace(/\s*[\[(][^\])]*[\])]\s*$/, ''))) || byNorm.get(norm(name));

  const ctx = { section: null, exportedAtVal: null, deckLines: [] };
  let deckName = '', sawCountLine = false;
  text.split(/\r?\n/).map(l=>l.trim()).forEach(line=>{
    if(!line) return;
    const dm = line.match(/^#?\s*(?:exported(?:\s*(?:at|on|date))?|export\s*(?:date|time|at|on)?)\s*[:\-]\s*(.+)$/i);
    if(dm){
      const t = Date.parse(dm[1].trim());
      ctx.exportedAtVal = isNaN(t) ? dm[1].trim() : new Date(t).toISOString();
      return;
    }
    if(line.startsWith('#')){
      const t = line.replace(/^#+\s*/, '').trim();
      if(t && !deckName && !/^deck type:/i.test(t) && t!=='Untitled Deck') deckName = t;
      return;
    }
    if(deckCodec().parseTextLine(line, ctx)) return;
    if(/^deck:?$/i.test(line)){ ctx.section='deck'; return; }
    let m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if(!m){ const r = line.match(/^(.+?)\s+x\s*(\d+)$/i); if(r) m = [line, r[2], r[1]]; }
    if(!m){
      // a bare line only counts if it is exactly a card we know (so stray prose is ignored)
      if(findCard(line) && !/:$/.test(line)) m = [line, '1', line]; else return;
    }
    if(deckCodec().parseTextItem(ctx, m)) return;
    sawCountLine = true;
    ctx.deckLines.push({name:m[2].trim(), count:Number(m[1])});
  });
  if(!ctx.deckLines.length && !sawCountLine && !ctx.leaderName) throw new Error('no cards recognized in that text');

  const unmatched=[];
  deckCodec().finishTextImport(ctx, { get:findCard }, unmatched);

  curDeck().deckCards = new Map(); curDeck().deckOrder = [];
  ctx.deckLines.forEach(({name,count})=>{
    const c = findCard(name);
    if(!c){ unmatched.push(name); return; }
    curDeck().deckCards.set(c.id, (curDeck().deckCards.get(c.id)||0) + count);
    if(!curDeck().deckOrder.includes(c.id)) curDeck().deckOrder.push(c.id);
  });

  curDeck().name = deckName;
  curDeck().sourceExportedAt = ctx.exportedAtVal;
  curDeck().preconFileId = null;
  renderAll();
  const when = ctx.exportedAtVal && !isNaN(new Date(ctx.exportedAtVal)) ? ` (exported ${new Date(ctx.exportedAtVal).toLocaleString()})` : '';
  toast(unmatched.length ? `Imported with ${unmatched.length} unmatched line(s): ${unmatched.slice(0,3).join(', ')}${unmatched.length>3?'…':''}` : 'Deck imported'+when+'.');
}


// Paste-text import: any pasted decklist, with or without our header lines.
document.getElementById('btnImportPaste').addEventListener('click', ()=>{
  const box = document.getElementById('importPasteText');
  if(!box.value.trim()){ toast('Paste a decklist first.'); return; }
  try{
    importDeckFromText(box.value);
    box.value = '';
    document.getElementById('loadModal').classList.add('hidden');
  }catch(err){ toast('Import failed: '+err.message); }
});
