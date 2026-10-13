/* =========================================================================
   UPLOAD CARD UPDATES (private). The Card Updater (card-updater.html) built into the
   deckbuilder: turns an exported card PDF into card data + card images and publishes the
   differences to a set. Same method and same server actions (cuState / cuUpload /
   cuWrite in Code.gs); only the set picker is new — "Upload updates" appears for people
   with EDIT access to at least one set (cuMySets), and the server re-checks that on every
   call. pdf.js is only downloaded the first time the panel is opened.

   Each PDF page is one card face. A card's front page carries a small "record" text frame
   (id=…|name=…|type=…) that holds all of its data; a page with no record is the BACK of the
   card before it. (A second page with the same id is also treated as that card's back; any
   further copies are ignored, and the front's data always wins.) Sideways (landscape) cards
   are detected from which way their own text runs, and each face is rendered cropped to the
   trim line — with the record itself left out of the image. Then every card is compared with
   what the set already has (New / Updated / Art updated / Fields added / Unchanged).
   Everything below lives inside one function so none of its names can collide with the
   deckbuilder's own; its page elements and styles are all prefixed "cu-".
   ========================================================================= */
(function(){
'use strict';
const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfjsLib = null; // set by ensureReady()
let readyPromise = null;
function ensureReady(){
  if(readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject)=>{
    const done = ()=>{ pdfjsLib = window.pdfjsLib; pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; installRecordFilter(); resolve(); };
    if(window.pdfjsLib){ done(); return; }
    const s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = done;
    s.onerror = ()=>{ readyPromise = null; reject(new Error('Could not download the PDF reader (pdf.js). Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return readyPromise;
}


const BLEED_PT = 0.125 * 72;                      // cropped off every side
const SIZES = { print:{w:750, h:1050}, screen:{w:375, h:525} }; // 2.5×3.5in at 300 and 150 dpi
// Saved as high-quality JPEG: about 1/6 the size of PNG for card art, with no visible difference.
const IMAGE_TYPE = 'image/jpeg', IMAGE_QUALITY = 0.9, IMAGE_EXT = 'jpg';
// The export currently writes the four ability field NAMES run together with a
// single "=" (e.g. "abilityability-overlord…=Guard."), so their values can't be
// told apart. Until the export template is fixed, that combined value is kept
// under "ability" so nothing is lost.
const ABILITY_KEYS = ['ability','ability-overlord','ability-stage-2','ability-overlord-stage-2'];

let doc = null;
let pages = [];   // one per PDF page: {n, fields, rawRecord, recordFont, recordGlyphs, textAngle, issues}
let cards = [];   // {id, fields, front, back, rotate, issues, img:{front, back}}
let notices = [];
let filter = 'all';

const $ = id => document.getElementById('cu-' + id);
const ROOT = () => document.getElementById('cu-overlay');
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function setStatus(text, frac){
  $('status').innerHTML = esc(text) + (frac!=null ? `<div class="cu-bar"><i style="width:${Math.round(frac*100)}%"></i></div>` : '');
}

// ---------- Loading ----------
const drop = $('drop');
['dragenter','dragover'].forEach(t=> drop.addEventListener(t, e=>{ e.preventDefault(); drop.classList.add('cu-over'); }));
['dragleave','drop'].forEach(t=> drop.addEventListener(t, e=>{ e.preventDefault(); drop.classList.remove('cu-over'); }));
drop.addEventListener('drop', e=>{ const f = e.dataTransfer.files[0]; if(f) loadFile(f); });
$('file').addEventListener('change', e=>{ const f = e.target.files[0]; if(f) loadFile(f); e.target.value=''; });

async function loadFile(file){
  try{ await ensureReady(); }catch(err){ setStatus(err.message); return; }
  if(!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)){ setStatus('That doesn\'t look like a PDF.'); return; }
  pages = []; cards = []; notices = [];
  $('grid').innerHTML = ''; $('notices').innerHTML = ''; $('toolbar').classList.add('cu-hidden');
  setStatus(`Opening ${file.name}…`, 0);
  try{
    doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    await loadDoc();
  }catch(err){
    console.error(err);
    setStatus('Could not read that PDF: ' + err.message);
  }
}
async function loadDoc(){
  $('chkComprehensive').checked = false;
  recordTextFromOperators.autoHyphens = 0;
  for(let n=1; n<=doc.numPages; n++){
    pages.push(await readPage(n));
    if(n%5===0 || n===doc.numPages) setStatus(`Reading page ${n} of ${doc.numPages}…`, n/doc.numPages);
  }
  pairPages();
  renderNotices();
  renderToolbar();
  renderGrid();
  await renderThumbnails();
}

// ---------- Reading one page: its record, and which way its own text runs ----------
async function readPage(n){
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  const items = tc.items.filter(it=> typeof it.str==='string');
  const sizeOf = it=> Math.hypot(it.transform[0], it.transform[1]);
  const out = { n, fields:null, rawRecord:'', recordFont:null, recordGlyphs:0, textAngle:0, issues:[], view: page.view };
  const idItem = items.find(it=> /^\s*id=/.test(it.str));
  let recItems = [];
  if(idItem){
    // The record is one text frame: the "id=" line plus the lines below it, in
    // the same font and size, horizontal, starting in the same column. Lines
    // wrap mid-word, so they're joined back together with nothing in between.
    const size = sizeOf(idItem), x0 = idItem.transform[4];
    const same = items.filter(it=> it.fontName===idItem.fontName && Math.abs(sizeOf(it)-size)<0.01 && Math.abs(it.transform[1])<1e-6 && it.transform[4] >= x0-0.5);
    const lines = new Map();
    same.forEach(it=>{ const y = Math.round(it.transform[5]*10)/10; if(!lines.has(y)) lines.set(y, []); lines.get(y).push(it); });
    const ys = [...lines.keys()].sort((a,b)=> b-a);
    let prevY = null;
    for(const y of ys){
      if(y > idItem.transform[5] + 0.5) continue;              // above the record
      if(prevY!=null && prevY - y > size*2.2) break;            // a gap: the record frame has ended
      const line = lines.get(y);
      if(!line.some(it=> Math.abs(it.transform[4]-x0) < 0.5) && prevY!=null) break; // a line that doesn't start in the record's column
      recItems.push(...line.sort((a,b)=> a.transform[4]-b.transform[4]));
      prevY = y;
    }
    out.recordFont = idItem.fontName;
    // The text above trims the space off the end of each line, which makes a
    // line that wrapped at a space ("Overlord Reference" / "Card") look the
    // same as one that broke mid-word ("is_double_si" / "ded"). The page's
    // drawing instructions still have every character, spaces included, so
    // the record's actual text is read from those, line by line.
    const recordYs = new Set(recItems.map(it=> Math.round(it.transform[5]*10)/10));
    const fromOps = await recordTextFromOperators(page, idItem.fontName, recordYs);
    out.rawRecord = fromOps.text || recItems.map(it=> it.str).join('');
    out.recordGlyphs = fromOps.glyphs; // how many characters drawing the record takes — see renderFace
    out.fields = parseRecord(out.rawRecord, out.issues);
  }
  // Which way the card's OWN text runs (everything but the record) — sideways
  // art in a portrait image means its rules text runs 90° or 270°. Each piece
  // of text votes by its length divided by its font size squared, so small
  // rules text outweighs big titles: portrait cards here have a sideways title
  // bar, which would otherwise outvote a short upright rules text. (Checked
  // against all 277 cards of the sample export: no misses.)
  const votes = {};
  const recSet = new Set(recItems);
  items.forEach(it=>{
    if(recSet.has(it)) return;
    const len = it.str.trim().length; if(!len) return;
    const size = sizeOf(it); if(!size) return;
    const deg = ((Math.round(Math.atan2(it.transform[1], it.transform[0]) * 180/Math.PI / 90) * 90) % 360 + 360) % 360;
    votes[deg] = (votes[deg]||0) + len/(size*size);
  });
  const best = Object.keys(votes).sort((a,b)=> votes[b]-votes[a])[0];
  out.textAngle = best!=null ? Number(best) : 0;
  out.hasOwnText = best!=null; // a back with no text of its own follows its front (see pairPages)
  return out;
}
// Every character drawn in the record's font on the record's lines, in drawing
// order (lines are drawn top to bottom), glued together with nothing added.
async function recordTextFromOperators(page, fontName, lineYs){
  const ops = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  let font = null, tm = [1,0,0,1,0,0], text = '', lastY = null, autoHyphens = 0, glyphs = 0;
  for(let i=0; i<ops.fnArray.length; i++){
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if(fn===O.setFont) font = a[0];
    else if(fn===O.beginText) tm = [1,0,0,1,0,0];
    else if(fn===O.setTextMatrix) tm = a.length===6 ? a : a[0];
    else if((fn===O.showText || fn===O.showSpacedText) && font===fontName){
      const y = Math.round(tm[5]*10)/10;
      if(!lineYs.has(y)) continue;
      const drawn = a[0].filter(g=> g && typeof g==='object');
      glyphs += drawn.length; // every one of these is a separate drawing call, spaces and auto-hyphens included
      const piece = drawn.map(g=> g.unicode).join('');
      // A lone "-" drawn after the rest of its line is a hyphen the layout
      // program added to split a word across lines ("le-" / "adership") — not
      // part of the text. Real hyphens ("ability-" / "overlord") are drawn as
      // part of their line.
      if(piece==='-' && y===lastY){ autoHyphens++; continue; }
      text += piece;
      lastY = y;
    }
  }
  page.cleanup(); // don't keep this page's decoded images around
  recordTextFromOperators.autoHyphens = (recordTextFromOperators.autoHyphens||0) + autoHyphens;
  return { text, glyphs };
}
// "name=Almighty Trax|subtitle=…|cost=5" → {name:'Almighty Trax', subtitle:'…', cost:'5'}
function parseRecord(raw, issues){
  const fields = {};
  raw.split('|').forEach(part=>{
    if(!part.trim()) return;
    const eq = part.indexOf('=');
    if(eq<0){ issues.push(`A piece of the record has no "=": ${part.slice(0,60)}`); return; }
    let key = part.slice(0, eq).trim();
    const value = part.slice(eq+1).trim();
    if(key!=='ability' && key===ABILITY_KEYS.join('')) key = 'ability'; // see ABILITY_KEYS
    if(key in fields) issues.push(`"${key}" appears twice in the record — keeping the first`);
    else fields[key] = value;
  });
  if(!fields.id) issues.push('The record has no id');
  return fields;
}

// ---------- Pairing pages into cards ----------
// A page with a record starts a card (or, if its id was already seen, is that
// card's back). A page without a record is the back of the card just before it.
function pairPages(){
  const byId = new Map();
  let openForBack = null;
  let mergedAbilities = false;
  pages.forEach(pg=>{
    if(pg.fields && pg.fields.id){
      if(pg.rawRecord.includes(ABILITY_KEYS.join('')+'=')) mergedAbilities = true;
      const id = pg.fields.id;
      const existing = byId.get(id);
      if(!existing){
        const card = { id, fields:pg.fields, front:pg, back:null, rotate:pg.textAngle, issues:[...pg.issues], img:{} };
        byId.set(id, card); cards.push(card); openForBack = card;
      } else if(!existing.back){
        existing.back = pg;
        existing.backRotate = pg.hasOwnText ? pg.textAngle : existing.rotate;
        const diffs = Object.keys({...existing.fields, ...pg.fields}).filter(k=> (existing.fields[k]||'') !== (pg.fields[k]||''));
        if(diffs.length) existing.issues.push(`Page ${pg.n} (its back) has a different record for: ${diffs.join(', ')} — using the front's data`);
        openForBack = null;
      } else {
        existing.issues.push(`Page ${pg.n} is a third copy of this card — ignored`);
      }
    } else if(openForBack){
      openForBack.back = pg;
      openForBack.backRotate = pg.hasOwnText ? pg.textAngle : openForBack.rotate;
      openForBack = null;
    } else {
      notices.push({kind:'bad', html:`Page ${pg.n} has no record, and the page before it isn't a card front waiting for a back — ignored.`});
    }
  });
  cards.forEach(c=>{
    const ds = String(c.fields.is_double_sided||'').toLowerCase();
    if(ds==='true' && !c.back) c.issues.push('Marked is_double_sided=true but has no back page in this PDF');
    if(ds==='false' && c.back) c.issues.push('Marked is_double_sided=false but has a back page');
    if(c.rotate===180) c.issues.push('Its text runs upside down — check this card');
  });
  if(recordTextFromOperators.autoHyphens) notices.push({kind:'info', html:`The record text has automatic hyphenation turned on in ${recordTextFromOperators.autoHyphens} place${recordTextFromOperators.autoHyphens===1?'':'s'} (a word split across lines with an added "-"). Those hyphens were removed. Turning hyphenation off for the record's text frame in the export template avoids this entirely.`});
  if(mergedAbilities) notices.push({kind:'warn', html:`The ability fields are run together in this export (<code>${ABILITY_KEYS.join('')}=…</code>), so there's no telling which ability text belongs to which field. It's kept under <b>ability</b> for now. Fixing the export template to write <code>ability=…|ability-overlord=…|ability-stage-2=…|ability-overlord-stage-2=…</code> will split them properly.`});
}

// ---------- Rendering a face to an image ----------
// Crops the bleed and leaves the record out. The record is always the first
// text drawn on its page, and pdf.js draws text one character per drawing call
// — so while a page renders, the first N characters drawn in the record's font
// (N = recordGlyphs, counted when the page was read) are simply skipped. This is
// done on the canvas prototype rather than one canvas, because some pages (foil
// cards, anything with transparency) are drawn onto a scratch canvas first and
// merged in afterwards. The same font appears elsewhere on some cards (e.g. a
// copyright line); those come after the record, so they're drawn normally.
let recordFilter = null; // {fontRe, remaining, skipped} while a page is rendering
// Installed once, the first time the panel is opened (see ensureReady) — nothing else in the
// deckbuilder draws text while recordFilter is null, so it is inert outside a page render here.
function installRecordFilter(){
  ['fillText','strokeText'].forEach(name=>{
    const orig = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function(...args){
      const f = recordFilter;
      if(f && f.remaining>0 && f.fontRe.test(this.font)){ f.remaining--; f.skipped++; return; }
      return orig.apply(this, args);
    };
  });
}
// One render at a time (the filter above is shared), in the order requested.
let renderChain = Promise.resolve();
function renderFace(pg, size){
  const job = renderChain.then(()=> renderFaceNow(pg, size));
  renderChain = job.catch(()=>{});
  return job;
}
async function renderFaceNow(pg, size){
  const page = await doc.getPage(pg.n);
  const [vx0, vy0, vx1] = pg.view;
  const scale = size.w / ((vx1 - vx0) - 2*BLEED_PT);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.w, size.h);
  ctx.translate(-BLEED_PT*scale, -BLEED_PT*scale);
  const filter = pg.recordGlyphs ? {
    // pdf.js sets ctx.font like '16px g_d0_f1, sans-serif' (font name unquoted)
    fontRe: new RegExp('(^|[\\s,"])' + pg.recordFont.replace(/[^\w-]/g,'') + '($|[\\s,"])'),
    remaining: pg.recordGlyphs, skipped: 0,
  } : null;
  recordFilter = filter;
  try{ await page.render({ canvasContext: ctx, viewport }).promise; }
  finally{ recordFilter = null; page.cleanup(); }
  const blob = await new Promise(res=> canvas.toBlob(res, IMAGE_TYPE, IMAGE_QUALITY));
  return { blob, url: URL.createObjectURL(blob), skipped: filter ? filter.skipped : 0, expected: pg.recordGlyphs||0 };
}

async function renderThumbnails(){
  const jobs = [];
  cards.forEach(c=>{ jobs.push([c,'front']); if(c.back) jobs.push([c,'back']); });
  for(let i=0; i<jobs.length; i++){
    const [c, side] = jobs[i];
    const pg = side==='front' ? c.front : c.back;
    try{
      const r = await renderFace(pg, SIZES.screen);
      r.hash = await sha256Hex(r.blob); // fingerprint of the art — tells an art change apart from a data change
      c.img[side] = r;
      if(side==='front' && r.expected && r.skipped!==r.expected) c.issues.push(`Only ${r.skipped} of the record's ${r.expected} characters were left out of the image — check it`);
      updateTile(c);
    }catch(err){
      console.error(err);
      c.issues.push(`Couldn't render the ${side}: ${err.message}`);
      updateTile(c);
    }
    if(i%4===0 || i===jobs.length-1) setStatus(`Rendering images ${i+1} of ${jobs.length}…`, (i+1)/jobs.length);
  }
  renderToolbar();
  setStatus(`Done — ${cards.length} cards from ${doc.numPages} pages.`);
  compareWithSet();
}
async function sha256Hex(blob){
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map(b=> b.toString(16).padStart(2,'0')).join('').slice(0, 32);
}

// ---------- UI ----------
function renderNotices(){
  $('notices').innerHTML = notices.map(n=> `<div class="cu-notice cu-${n.kind}">${n.html}</div>`).join('');
}
function renderToolbar(){
  $('toolbar').classList.remove('cu-hidden');
  $('nCards').textContent = cards.length;
  $('nBacks').textContent = cards.filter(c=>c.back).length;
  $('nLand').textContent = cards.filter(c=> c.rotate===90 || c.rotate===270).length;
  $('nIssues').textContent = cards.filter(c=> c.issues.length).length;
}
ROOT().querySelectorAll('#cu-toolbar [data-filter]').forEach(b=> b.addEventListener('click', ()=>{
  filter = b.dataset.filter;
  ROOT().querySelectorAll('#cu-toolbar [data-filter]').forEach(x=> x.classList.toggle('cu-on', x===b));
  renderGrid();
}));
$('search').addEventListener('input', renderGrid);
function visibleCards(){
  const q = $('search').value.trim().toLowerCase();
  return cards.filter(c=>{
    if(filter==='issues' && !c.issues.length) return false;
    if(filter==='changes' && !(c.diff && c.diff.status!=='unchanged')) return false;
    if(filter==='land' && !(c.rotate===90 || c.rotate===270)) return false;
    if(filter==='backs' && !c.back) return false;
    if(q && ![c.id, c.fields.name, c.fields.type, c.fields.subtitle].some(v=> String(v||'').toLowerCase().includes(q))) return false;
    return true;
  });
}
function tileHtml(c){
  const land = c.rotate===90 || c.rotate===270;
  const st = c.diff ? STATUS_LABEL[c.diff.status] : null;
  const tags = [
    st ? `<span class="cu-tag cu-st-${st.cls}">${st.text}</span>` : '',
    land ? `<span class="cu-tag cu-land">Landscape</span>` : '',
    c.back ? `<span class="cu-tag">Has back</span>` : '',
    c.issues.length ? `<span class="cu-tag cu-issue">${c.issues.length} issue${c.issues.length>1?'s':''}</span>` : '',
  ].join('');
  // Landscape fronts are shown turned upright (the saved image stays as printed).
  const frontStyle = land ? `style="transform:translate(-50%,-50%) rotate(${c.rotate}deg)"` : '';
  const backLand = c.backRotate===90 || c.backRotate===270;
  const backStyle = backLand ? `style="transform:translate(-50%,-50%) rotate(${c.backRotate}deg)"` : '';
  return `<div class="cu-faces${land?' cu-land':''}">
      <div class="cu-face cu-front${land?' cu-land':''}">${c.img.front ? `<img src="${c.img.front.url}" ${frontStyle}>` : ''}</div>
      ${c.back ? `<div class="cu-face cu-back${backLand?' cu-land':''}">${c.img.back ? `<img src="${c.img.back.url}" ${backStyle}>` : ''}</div>` : ''}
    </div>
    <div class="cu-name" title="${esc(c.fields.name)}">${esc(c.fields.name||'(no name)')}</div>
    <div class="cu-meta">${esc(c.fields.type||'')}</div>
    <div class="cu-tags">${tags}</div>`;
}
// A card on file that a comprehensive publish would remove — shown with its
// current art from the set.
function removedTileHtml(row){
  const link = String(row['front-image-sm-url'] || row['front-image-url'] || '');
  let src = link.split('#')[0];
  if(src && link.includes('#pdf-src')){ const q = src.indexOf('?'); src = q===-1 ? src+'=w300' : src.slice(0,q)+'=w300'+src.slice(q); }
  const rot = parseInt(row.rotate,10) || 0, land = rot===90 || rot===270;
  const style = land ? `style="transform:translate(-50%,-50%) rotate(${rot}deg)"` : '';
  return `<div class="cu-faces${land?' cu-land':''}"><div class="cu-face cu-front${land?' cu-land':''}">${src ? `<img src="${esc(src)}" ${style} referrerpolicy="no-referrer">` : ''}</div></div>
    <div class="cu-name" title="${esc(row.name)}">${esc(row.name||'(no name)')}</div>
    <div class="cu-meta">${esc(row.type||'')}</div>
    <div class="cu-tags"><span class="cu-tag cu-st-removed">Will be removed</span></div>`;
}
function visibleRemoved(){
  if(!['all','changes','removed'].includes(filter)) return [];
  const q = $('search').value.trim().toLowerCase();
  return removedRows.filter(r=> !q || [r.id, r.name, r.type, r.subtitle].some(v=> String(v||'').toLowerCase().includes(q)));
}
function renderGrid(){
  const grid = $('grid');
  grid.innerHTML = (filter==='removed' ? [] : visibleCards()).map(c=> `<div class="cu-tile" data-id="${esc(c.id)}">${tileHtml(c)}</div>`).join('')
    + visibleRemoved().map(r=> `<div class="cu-tile cu-removed" title="On file in the set but not in this PDF">${removedTileHtml(r)}</div>`).join('');
  grid.querySelectorAll('.cu-tile:not(.cu-removed)').forEach(t=> t.addEventListener('click', ()=> openDetail(cards.find(c=> c.id===t.dataset.id))));
}
function updateTile(c){
  const el = ROOT().querySelector(`.cu-tile[data-id="${CSS.escape(c.id)}"]`);
  if(el) el.innerHTML = tileHtml(c);
}

// Detail: both faces at print size, the parsed record, and any issues.
async function openDetail(c){
  const panel = $('detailPanel');
  const land = c.rotate===90 || c.rotate===270;
  panel.innerHTML = `
    <div class="cu-btn cu-close" id="cu-btnCloseDetail">Close</div>
    <h2>${esc(c.fields.name||'(no name)')}</h2>
    <div style="color:var(--text-soft);font-size:12.5px;">${esc(c.fields.type||'')} · page ${c.front.n}${c.back?` + back on page ${c.back.n}`:''}</div>
    ${c.issues.map(i=> `<div class="cu-notice cu-bad">${esc(i)}</div>`).join('')}
    <div class="cu-row" id="cu-detailFaces"><div style="color:var(--text-soft);">Rendering at print size…</div></div>
    <table>
      <tr><td>Image names</td><td><code>${esc(c.id)}.${IMAGE_EXT}</code>${c.back?` <code>${esc(c.id)}-back.${IMAGE_EXT}</code>`:''} · screen size <code>…@sm.${IMAGE_EXT}</code></td></tr>
      <tr><td>Orientation</td><td>${land ? `Landscape — shown turned ${c.rotate===90?'clockwise':'counter-clockwise'} (detected from its text)` : c.rotate===180 ? 'Upside down?' : 'Portrait'}</td></tr>
      ${c.diff ? `<tr><td>Compared with set</td><td>${esc(STATUS_LABEL[c.diff.status].long)}</td></tr>` : ''}
      ${Object.entries(c.fields).map(([k,v])=>{
        const old = c.diff && c.diff.row ? (c.diff.row[k]==null ? '' : c.diff.row[k]) : null;
        const changed = c.diff && (c.diff.changed.includes(k) || c.diff.added.includes(k));
        const val = v==='' ? '(empty)' : esc(v);
        return `<tr class="${v===''?'cu-empty':''}"><td>${esc(k)}</td><td>${changed && old!=null ? `<span class="cu-diff-old">${old===''?'(empty)':esc(old)}</span> → <span class="cu-diff-new">${val}</span>` : val}</td></tr>`;
      }).join('')}
    </table>`;
  $('detail').classList.remove('cu-hidden');
  $('btnCloseDetail').addEventListener('click', closeDetail);
  const faces = [];
  const front = await renderFace(c.front, SIZES.print);
  faces.push({label:`Front · ${SIZES.print.w}×${SIZES.print.h}`, r:front, rot: land ? c.rotate : 0});
  if(c.back) faces.push({label:`Back · ${SIZES.print.w}×${SIZES.print.h}`, r: await renderFace(c.back, SIZES.print), rot:c.backRotate||0});
  const w = 300, h = w*1.4;
  $('detailFaces').innerHTML = faces.map(f=>{
    const sideways = f.rot===90 || f.rot===270;
    const bw = sideways ? h : w, bh = sideways ? w : h;
    return `<div><div class="cu-big" style="width:${bw}px;height:${bh}px;position:relative;">
        <img src="${f.r.url}" style="position:absolute;left:50%;top:50%;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${f.rot}deg);">
      </div><div class="cu-cap">${esc(f.label)}</div></div>`;
  }).join('');
}
function closeDetail(){ $('detail').classList.add('cu-hidden'); }
$('detail').addEventListener('click', e=>{ if(e.target.id==='cu-detail') closeDetail(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !$('detail').classList.contains('cu-hidden')) closeDetail(); });

// ---------- Connecting to a set, comparing, publishing ----------
// Uses the deckbuilder's own sign-in (state.idToken) and web app (WEBAPP_URL).
let dest = null; // {cardsFolderId, game, set, headers, rows, rowById, images, sheetUrl}
const STATUS_LABEL = {
  'new':          {text:'New',          cls:'new',     long:'New — not in this set yet'},
  'updated':      {text:'Updated',      cls:'updated', long:'Updated — some of its data changed (the old version goes into its change history)'},
  'art':          {text:'Art updated',  cls:'art',     long:'Art updated — same data, new image (noted in its change history)'},
  'fields added': {text:'Fields added', cls:'added',   long:'Fields added — only new fields filled in (not a new version)'},
  'unchanged':    {text:'Unchanged',    cls:'same',    long:'Unchanged — nothing to publish'},
};

async function api(action, extra){
  if(!state.idToken) throw new Error('Sign in first.');
  const res = await fetch(WEBAPP_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({ action, idToken: state.idToken, cardsFolderId: dest ? dest.cardsFolderId : '', ...extra }) });
  if(!res.ok) throw new Error('The server answered HTTP ' + res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error || 'Unknown error');
  return j;
}
async function connectSet(cardsFolderId){
  const note = $('destNote');
  dest = null;
  $('chkComprehensive').checked = false;
  if(!cardsFolderId){ note.textContent = 'Pick the set to update.'; note.className = 'cu-note'; compareWithSet(); return; }
  note.textContent = 'Connecting…'; note.className = 'cu-note';
  try{
    const st = await api('cuState', { cardsFolderId });
    dest = { cardsFolderId, ...st, rowById: new Map(st.rows.map(r=> [r.id, r])) };
    note.innerHTML = `Connected: <b>${esc(st.game)} › ${esc(st.set)} › Cards</b> — ${st.rows.length} card${st.rows.length===1?'':'s'} on file, ${st.images.length} image${st.images.length===1?'':'s'} in the folder.${st.sheetUrl ? '' : ' (No card sheet yet — publishing creates one.)'}`;
    note.className = 'cu-note cu-ok';
  }catch(err){
    note.textContent = err.message; note.className = 'cu-note cu-bad';
  }
  compareWithSet();
}

// What would be written for a card: its record, plus the detected
// orientation and fingerprints of its art (see sha256Hex).
function recordFor(c){
  const r = { ...c.fields, rotate: String(c.rotate||0) };
  if(c.img.front && c.img.front.hash) r['image-hash'] = c.img.front.hash;
  if(c.back && c.img.back && c.img.back.hash) r['back-image-hash'] = c.img.back.hash;
  return r;
}
// Same rules as cuDiff in Code.gs — see there.
const CU_MANAGED = ['record-fields','last-updated','front-image-url','back-image-url'];
function cuDiff(record, row, preHeaders){
  if(!row) return { status:'new', changed:[], added:[] };
  const known = row['record-fields'] ? row['record-fields'].split('|') : preHeaders;
  const changed = [], added = [];
  Object.keys(record).forEach(k=>{
    if(k==='image-hash' || k==='back-image-hash' || CU_MANAGED.includes(k)) return;
    const oldV = row[k]==null ? '' : row[k];
    if(known.includes(k)){ if(oldV!==record[k]) changed.push(k); }
    else if(oldV!==record[k]) added.push(k);
  });
  const artChanged = ['image-hash','back-image-hash'].some(k=> row[k] && record[k]!==undefined && row[k]!==record[k]);
  const hashesMissing = ['image-hash','back-image-hash'].some(k=> record[k] && !row[k]);
  const status = changed.length ? 'updated' : artChanged ? 'art' : (added.length || hashesMissing) ? 'fields added' : 'unchanged';
  return { status, changed, added };
}
// Comprehensive publish: cards on file in the set that aren't in this PDF.
// The box is ticked deliberately for each PDF and set: it starts unticked and
// unticks itself whenever a new PDF is loaded or a set is connected.
let removedRows = [];
$('chkComprehensive').checked = false;
$('chkComprehensive').addEventListener('change', compareWithSet);
function compareWithSet(){
  const ready = dest && cards.length && cards.every(c=> c.img.front && (!c.back || c.img.back));
  ROOT().querySelectorAll('.cu-cmp').forEach(el=> el.classList.toggle('cu-hidden', !ready));
  $('compLabel').classList.toggle('cu-hidden', !ready);
  const comprehensive = !!(ready && $('chkComprehensive').checked);
  const inPdf = new Set(cards.map(c=> c.id));
  removedRows = comprehensive ? dest.rows.filter(r=> !inPdf.has(r.id)) : [];
  ROOT().querySelectorAll('.cu-rm').forEach(el=> el.classList.toggle('cu-hidden', !comprehensive));
  $('nRemoved').textContent = removedRows.length;
  if(!comprehensive && filter==='removed') ROOT().querySelector('#cu-toolbar [data-filter="all"]').click();
  if(!ready){
    cards.forEach(c=> delete c.diff);
    // Cards are loaded but no set yet: say what's missing instead of showing nothing.
    const waiting = cards.length && !dest;
    $('publishBar').classList.toggle('cu-hidden', !waiting);
    if(waiting){
      $('publishText').textContent = 'Connect a set (step 2) to see which cards are new or changed, and to publish them.';
      $('btnPublish').classList.add('cu-disabled');
    }
    return;
  }
  const count = {'new':0,'updated':0,'art':0,'fields added':0,'unchanged':0};
  cards.forEach(c=>{
    const row = dest.rowById.get(c.id) || null;
    c.diff = { ...cuDiff(recordFor(c), row, dest.headers), row };
    count[c.diff.status]++;
  });
  $('nNew').textContent = count['new']; $('nUpdated').textContent = count['updated']; $('nArt').textContent = count['art'];
  $('nAdded').textContent = count['fields added']; $('nSame').textContent = count['unchanged'];
  renderGrid();
  const todo = cards.length - count['unchanged'];
  const nRm = removedRows.length;
  $('publishBar').classList.remove('cu-hidden');
  const parts = [['new','new'],['updated','updated'],['art','art updated'],['fields added','with fields added']].filter(([k])=>count[k]).map(([k,t])=>`${count[k]} ${t}`);
  if(nRm) parts.push(`<b style="color:var(--danger)">${nRm} removed</b>`);
  $('publishText').innerHTML = (todo || nRm)
    ? `Publish to <b>${esc(dest.game)} › ${esc(dest.set)}</b>: ${parts.join(', ')}. ${count['unchanged']} unchanged card${count['unchanged']===1?'':'s'} will be left alone.`
    : `Everything in this PDF already matches <b>${esc(dest.game)} › ${esc(dest.set)}</b>${comprehensive ? ', and nothing on file is missing from it' : ''}. Nothing to publish.`;
  $('btnPublish').classList.toggle('cu-disabled', !(todo || nRm));
}

const blobToBase64 = blob=> new Promise((res, rej)=>{
  const fr = new FileReader();
  fr.onload = ()=> res(String(fr.result).split(',')[1]);
  fr.onerror = ()=> rej(fr.error);
  fr.readAsDataURL(blob);
});
$('btnPublish').addEventListener('click', publish);
let publishing = false;
let publishedAny = false;
async function publish(){
  if(publishing || !dest) return;
  const todo = cards.filter(c=> c.diff && c.diff.status!=='unchanged');
  const removing = removedRows.slice();
  if(!todo.length && !removing.length) return;
  let msg = `Publish to ${dest.game} › ${dest.set}?\n\n`;
  if(todo.length) msg += `${todo.length} card${todo.length===1?'':'s'} added or changed. Images go into its Cards folder (older images of the same cards go to the Drive trash), and card data into its sheet.\n\n`;
  if(removing.length){
    const names = removing.slice(0,10).map(r=> '  • ' + (r.name || r.id)).join('\n') + (removing.length>10 ? `\n  …and ${removing.length-10} more` : '');
    msg += `${removing.length} card${removing.length===1?'':'s'} REMOVED from the set (not in this PDF). Their last version is kept in the change history; their images go to the Drive trash:\n${names}\n\n`;
  }
  if(!confirm(msg.trim())) return;
  // A big removal is more likely a half-finished export than real deletions.
  if(removing.length > dest.rows.length/4){
    const typed = prompt(`This removes ${removing.length} of the ${dest.rows.length} cards in ${dest.set}. If that's really right, type the set's name to confirm:`);
    if(typed==null) return;
    if(typed.trim().toLowerCase() !== String(dest.set).trim().toLowerCase()){ alert('That doesn\'t match the set name — nothing was published.'); return; }
  }
  publishing = true;
  $('btnPublish').classList.add('cu-disabled');
  try{
    // 1) Images, for any card whose art is new or different: print size
    //    (id.jpg) and screen size (id@sm.jpg), front and back. Sent a few at
    //    a time to stay well inside what one server request can carry.
    const needImages = todo.filter(c=> !c.diff.row
      || c.diff.row['image-hash']!==c.img.front.hash
      || (c.back && c.diff.row['back-image-hash']!==c.img.back.hash));
    let batch = [], batchSize = 0, sent = 0, notShared = 0;
    const total = needImages.reduce((n,c)=> n + (c.back ? 4 : 2), 0);
    const flush = async ()=>{
      if(!batch.length) return;
      const up = await api('cuUpload', { files: batch });
      notShared += (up.notShared || []).length; // images Drive wouldn't set to anyone-with-the-link
      sent += batch.length; batch = []; batchSize = 0;
      setStatus(`Uploading images: ${sent} of ${total}…`, sent/total);
    };
    const add = async (name, blob)=>{
      const data = await blobToBase64(blob);
      batch.push({ name, data }); batchSize += data.length;
      if(batchSize > 6e6) await flush();
    };
    setStatus(`Uploading images: 0 of ${total}…`, 0);
    for(const c of needImages){
      await add(`${c.id}.${IMAGE_EXT}`, (await renderFace(c.front, SIZES.print)).blob);
      await add(`${c.id}@sm.${IMAGE_EXT}`, c.img.front.blob);
      if(c.back){
        await add(`${c.id}-back.${IMAGE_EXT}`, (await renderFace(c.back, SIZES.print)).blob);
        await add(`${c.id}-back@sm.${IMAGE_EXT}`, c.img.back.blob);
      }
    }
    await flush();
    // 2) Records, in one go — the server re-checks every card itself.
    setStatus('Saving card data…');
    const res = await api('cuWrite', {
      records: todo.map(c=> ({ fields: recordFor(c) })),
      comprehensive: $('chkComprehensive').checked ? { pdfIds: cards.map(c=> c.id), expectRemove: removing.map(r=> r.id) } : null,
    });
    const k = res.counts;
    setStatus(`Published to ${dest.game} › ${dest.set}: ${k['new']} new, ${k['updated']} updated, ${k['art']} art updated, ${k['fields added']} with fields added, ${k['unchanged']} unchanged${res.removed ? `, ${res.removed} removed` : ''}. ${res.archived} older version${res.archived===1?'':'s'} saved to the change history.${notShared ? ` Note: ${notShared} image${notShared===1?'':'s'} couldn't be set to "anyone with the link" — players without access to this set's folder won't see ${notShared===1?'it':'them'}.` : ''}`);
    publishedAny = true; // the deckbuilder re-reads its cards when this panel is closed
    await connectSet(dest.cardsFolderId); // re-read the set: everything should now show as Unchanged
  }catch(err){
    console.error(err);
    setStatus('Publishing stopped: ' + err.message + ' — nothing after that point was saved; you can publish again to finish.');
  }finally{
    publishing = false;
    $('btnPublish').classList.remove('cu-disabled');
  }
}

// For testing: load a PDF by URL instead of dropping one.
async function loadPdfUrl(u){
  await ensureReady();
  setStatus('Opening…', 0);
  try{ doc = await pdfjsLib.getDocument(u).promise; await loadDoc(); }
  catch(err){ setStatus('Could not read that PDF: ' + err.message); }
}

// ---------- The panel: opening, the set picker, closing ----------
let mySets = null; // [{game, set, cardsFolderId}] — sets this person may publish to; null = not asked yet

// Called after sign-in (and with true on sign-out): asks which sets this person can edit and
// shows the "Upload updates" button only if there's at least one.
async function initCardUpload(signingOut){
  const btn = document.getElementById('btnUploadUpdates');
  if(!btn) return;
  if(signingOut){ mySets = null; btn.style.display = 'none'; return; }
  try{
    const res = await api('cuMySets');
    mySets = res.sets || [];
  }catch(err){ console.warn('Could not check which sets can be updated:', err); mySets = []; }
  btn.style.display = mySets.length ? 'inline-flex' : 'none';
}
function openCardUpload(){
  if(!mySets || !mySets.length) return;
  const sel = $('setSelect');
  const keep = sel.value;
  sel.innerHTML = '<option value="">— choose a set —</option>' + mySets.map(s=> `<option value="${esc(s.cardsFolderId)}">${esc(s.game)} › ${esc(s.set)}</option>`).join('');
  const want = keep && mySets.some(s=> s.cardsFolderId===keep) ? keep : (mySets.length===1 ? mySets[0].cardsFolderId : '');
  sel.value = want;
  document.getElementById('cu-overlay').classList.remove('cu-hidden');
  if(want && !(dest && dest.cardsFolderId===want)) connectSet(want);
  else if(!want){ dest = null; $('destNote').textContent = 'Pick the set to update — only sets you have edit access to are listed.'; $('destNote').className = 'cu-note'; compareWithSet(); }
}
function closeCardUpload(){
  if(publishing && !confirm('A publish is still running. Close anyway? (It keeps going in the background, but you won\'t see its result.)')) return;
  document.getElementById('cu-overlay').classList.add('cu-hidden');
  if(publishedAny){ publishedAny = false; loadData(true); } // pick up what was just published
}
$('setSelect').addEventListener('change', e=> connectSet(e.target.value));
$('btnClose').addEventListener('click', closeCardUpload);
document.getElementById('btnUploadUpdates').addEventListener('click', openCardUpload);

window.initCardUpload = initCardUpload;
window.loadCardUploadPdfUrl = loadPdfUrl; // testing helper
})();
