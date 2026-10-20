/* =========================================================================
   FOIL (private). A special booster's foil card is remembered per deck (deck.foilIds, saved with
   the deck). It's purely cosmetic: a shimmering highlight in the deckbuilder (CSS .foil) and a
   subtle texture overlay on the PDF export (drawFoilTexture, used by 13-export.js).
   ========================================================================= */
// Is this card a foil in the deck being edited? (Only while it's actually in that deck.)
function isFoil(id){
  const d = curDeck();
  if(!d || !d.foilIds || !d.foilIds.has(id)) return false;
  return (d.deckCards.get(id)||0)>0 || d.schemeIds.includes(id) ||
         d.leaderId===id || d.bonusCardId===id || d.extraCardId===id;
}

// Subtle holographic texture for a printed card: thin rainbow diagonal lines at ~16% opacity plus a
// few small white glints, clipped to the card's rectangle. Transparent enough to leave text readable.
function drawFoilTexture(doc, x, y, w, h){
  const hsl = (hue)=>{ // hue 0-360 → soft pastel rgb
    const f = (n)=>{ const k=(n+hue/30)%12; return Math.round(255*(0.78 - 0.22*Math.max(-1, Math.min(k-3, 9-k, 1)))); };
    return [f(0), f(8), f(4)];
  };
  const GState = doc.GState;
  if(!GState) return;
  doc.saveGraphicsState();
  doc.setGState(new GState({opacity:0.16, 'stroke-opacity':0.16}) /* jsPDF needs stroke-opacity for lines; opacity alone only affects fills */);
  doc.setLineWidth(1.2);
  const gap = 5;
  for(let c=0, i=0; c < w+h; c+=gap, i++){
    // line x + y = c (relative to the card's top-left), clipped to the card
    const x1 = Math.min(c, w), y1 = c - x1;
    const y2 = Math.min(c, h), x2 = c - y2;
    if(y1>h || x2>w) continue;
    const [r,g,b] = hsl((i*14)%360);
    doc.setDrawColor(r,g,b);
    doc.line(x+x1, y+y1, x+x2, y+y2);
  }
  doc.setGState(new GState({opacity:0.4, 'stroke-opacity':0.4}));
  doc.setDrawColor(255,255,255); doc.setLineWidth(0.7);
  let seed = 7;
  const rnd = ()=>{ seed = (seed*9301+49297)%233280; return seed/233280; };
  for(let i=0;i<26;i++){ // little four-point glints
    const gx = x + 8 + rnd()*(w-16), gy = y + 8 + rnd()*(h-16), s = 1.5 + rnd()*2.5;
    doc.line(gx-s, gy, gx+s, gy); doc.line(gx, gy-s, gx, gy+s);
  }
  doc.restoreGraphicsState();
}
