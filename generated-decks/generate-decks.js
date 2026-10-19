const fs=require('fs'),vm=require('vm'),path=require('path');
const {jsPDF}=require('jspdf/dist/jspdf.node.min.js');
const sharp=require('sharp');
const REPO='/Users/smcbride/deckbuilder-prototype';
const OUT=path.join(REPO,'generated-decks');fs.mkdirSync(OUT,{recursive:true});
// --- real rules file, loaded as-is
const ctx={console,Math};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(REPO+'/src/shared/js/sealed-rules-private.js','utf8')+'\nthis.buildSagaDeck=buildSagaDeck;',ctx);
// --- CSV parse
function parseCSV(t){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){r.push(f);f=''}else if(c=='\n'){r.push(f);rows.push(r);r=[];f=''}else if(c!='\r')f+=c}if(f||r.length){r.push(f);rows.push(r)}return rows}
const rows=parseCSV(fs.readFileSync(REPO+'/EOO Set 1 b9b4147d-f7f0-4b8f-a74c-a2af26207ce3 - Sheet1.csv','utf8'));
const hdr=rows[0];let cards=rows.slice(1).filter(r=>r.length>1).map(r=>Object.fromEntries(hdr.map((h,i)=>[h,r[i]||''])));
// Echo keepRow
cards=cards.filter(r=>{const t=(r.type||'').trim();if(!t||t.startsWith('Q - '))return false;if(t.startsWith('Z - '))return t==='Z - Custom'&&(r.name==='Resistance'||r.name==='Stronghold');return true});
cards.forEach(r=>{r.type=r.type.trim();r.aspect=r.aspect.trim();r.loyalty=r.loyalty.trim();r._front=r['front-image-url'].trim();r._back=r['back-image-url'].trim();r._doubleSided=String(r.is_double_sided).trim().toUpperCase()==='TRUE';r._setName='Set 1'});
const byId=new Map(cards.map(c=>[c.id,c]));
const decks=[];
for(const [side,n] of [['champion',6],['overlord',6]]) for(let i=0;i<n;i++){
  const res=ctx.buildSagaDeck(cards,side,c=>c._setName==='Set 1');
  if(res.error)throw new Error(res.error);
  const d=res.deck,leader=byId.get(d.leaderId);
  const lead=[leader,byId.get(d.bonusCardId),byId.get(d.extraCardId)];
  if(side==='overlord')d.schemeIds.forEach(id=>lead.push(byId.get(id)));
  const deckList=[];d.deckOrder.forEach(id=>{const k=d.deckCards.get(id);for(let j=0;j<k;j++)deckList.push(byId.get(id))});
  decks.push({side,leader,bonus:byId.get(d.bonusCardId),extra:byId.get(d.extraCardId),schemes:d.schemeIds.map(id=>byId.get(id)),main:d.deckOrder.map(id=>[byId.get(id),d.deckCards.get(id)]),lead,deckList,name:`${side==='champion'?'Champion':'Overlord'} ${i+1} - ${leader.name}`});
}
// --- CSV (same column-per-deck layout as the Office League decks sheet)
const cols=decks.map(d=>{const c=[d.name,d.leader.name,d.bonus?d.bonus.name:'',d.extra?d.extra.name:''];d.schemes.forEach(s=>c.push(s.name));d.main.slice().sort((a,b)=>a[0].name.localeCompare(b[0].name)).forEach(([card,k])=>c.push(card.name+(k>1?' x'+k:'')));return c});
const labels=['Deck','Leader','Domination / Quest','Stronghold / Resistance'];
const max=Math.max(...cols.map(c=>c.length));
const esc=s=>/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
const lines=[];
for(let r=0;r<max;r++){const lab=r<4?labels[r]:(r<4+Math.max(...decks.map(d=>d.schemes.length))?'Scheme':'Card');lines.push([lab,...cols.map(c=>c[r]||'')].map(esc).join(','));}
fs.writeFileSync(path.join(OUT,'generated-decks.csv'),lines.join('\n')+'\n');
// --- PDF, mirroring optExportPdf
const sizedUrl=u=>{const b=u.split('#')[0],q=b.indexOf('?');return q===-1?b+'=w900':b.slice(0,q)+'=w900'+b.slice(q)};
const cache=new Map();
async function toJpeg(url){ if(cache.has(url))return cache.get(url);
  let err;for(let a=1;a<=3;a++){try{const res=await fetch(url);if(!res.ok)throw new Error('HTTP '+res.status);const buf=Buffer.from(await res.arrayBuffer());const m=await sharp(buf).metadata();if(m.width<100||m.height<100){err=new Error('too small');break}
    const out='data:image/jpeg;base64,'+(await sharp(buf).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer()).toString('base64');cache.set(url,out);return out}catch(e){err=e;if(a<3)await new Promise(r=>setTimeout(r,800*a))}}throw err}
(async()=>{
 for(const d of decks){
  const list=[];const push=c=>{if(!c)return;list.push({card:c,side:'front'});if(c._doubleSided)list.push({card:c,side:'back'})};
  d.lead.forEach(push);d.deckList.forEach(push);
  const doc=new jsPDF({unit:'pt',format:'letter'});
  const PAGE_W=612,PAGE_H=792,S=0.97,CW=180*S,CH=252*S,COLS=3,ROWS=3,MX=(PAGE_W-CW*COLS)/2,MY=(PAGE_H-CH*ROWS)/2;
  let fails=[];
  for(let i=0;i<list.length;i++){
   const ci=i%9;if(ci===0&&i!==0)doc.addPage();
   const x=MX+(ci%3)*CW,y=MY+Math.floor(ci/3)*CH;const {card,side}=list[i];
   const raw=side==='front'?card._front:card._back;const url=raw?sizedUrl(raw):'';
   doc.setDrawColor(180,183,190);doc.rect(x,y,CW,CH);
   let data=null;if(url){try{data=await toJpeg(url)}catch(e){fails.push(card.name+(side==='back'?' (back)':''))}}
   if(data)doc.addImage(data,'JPEG',x,y,CW,CH);else{doc.setFontSize(10);doc.text(doc.splitTextToSize(card.name+(side==='back'?' (back)':''),CW-16),x+8,y+20)}
  }
  const f=d.name.replace(/[^a-z0-9-_]+/gi,'_')+'_print_and_play.pdf';
  fs.writeFileSync(path.join(OUT,f),Buffer.from(doc.output('arraybuffer')));
  console.log(f,list.length,'images',fails.length?'FAILED: '+fails.join(', '):'ok');
 }
})();
