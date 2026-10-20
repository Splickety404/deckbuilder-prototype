// Generates booster packs with the REAL booster rules (src/shared/js/booster-rules-private.js) and
// writes them to generated-boosters.csv, one column per pack. See BOOSTER-GENERATION-GUIDE.md.
//
//   node generated-decks/generate-boosters.js "<card set CSV>" [packs=10] [--special=yes|no]
//
// Run it from anywhere; paths are relative to this file. No npm packages needed.
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.join(__dirname, '..');
const args = process.argv.slice(2);
const csvPath = args.find(a=>!a.startsWith('--') && isNaN(+a)) || path.join(repo, 'EOO Set 1 b9b4147d-f7f0-4b8f-a74c-a2af26207ce3 - Sheet1.csv');
const nPacks = +(args.find(a=>!a.startsWith('--') && !isNaN(+a)) || 10);
const sp = (args.find(a=>a.startsWith('--special=')) || '').split('=')[1];
const forceSpecial = sp==='yes' ? true : sp==='no' ? false : undefined;

// the real rules, loaded as-is (Saga rules first: the booster rules reuse their rarity helpers)
const ctx = { console, Math }; vm.createContext(ctx);
const load = f => fs.readFileSync(path.join(repo, 'src/shared/js', f), 'utf8');
vm.runInContext(load('sealed-rules-private.js') + '\n' + load('booster-rules-private.js') + '\nthis.rollBooster=rollBooster; this.rarityTier=rarityTier;', ctx);

function parseCSV(t){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){r.push(f);f=''}else if(c=='\n'){r.push(f);rows.push(r);r=[];f=''}else if(c!='\r')f+=c}if(f||r.length){r.push(f);rows.push(r)}return rows}
const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
const hdr = rows[0];
let cards = rows.slice(1).filter(r=>r.length>1).map(r=>Object.fromEntries(hdr.map((h,i)=>[h, r[i]||''])));
// the app's keepRow for Echo
cards = cards.filter(r=>{const t=(r.type||'').trim();if(!t||t.startsWith('Q - '))return false;if(t.startsWith('Z - '))return t==='Z - Custom'&&(r.name==='Resistance'||r.name==='Stronghold');return true});
cards.forEach(r=>{ r.type=r.type.trim(); r.aspect=r.aspect.trim(); r.loyalty=r.loyalty.trim(); r._setName='Set 1'; });

const packs = [];
for(let i=0;i<nPacks;i++){
  const res = ctx.rollBooster(cards, 'Set 1', forceSpecial);
  if(res.error) throw new Error(res.error);
  packs.push(res);
}
const esc = s=>/[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
const lines = [['Pack', ...packs.map((p,i)=>`Pack ${i+1}${p.special?' (special)':''}`)]];
for(let r=0;r<13;r++){
  lines.push([`Slot ${r+1}`, ...packs.map(p=>{
    const e = p.pulled[r]; if(!e) return '';
    return `${e.card.name} [${e.label}${e.foil?' / FOIL':''}; ${ctx.rarityTier(e.card)}; ${e.card.type}]`;
  })]);
}
fs.writeFileSync(path.join(__dirname, 'generated-boosters.csv'), lines.map(l=>l.map(esc).join(',')).join('\n')+'\n');
console.log(`wrote ${nPacks} pack(s) to generated-decks/generated-boosters.csv (${packs.filter(p=>p.special).length} special)`);
