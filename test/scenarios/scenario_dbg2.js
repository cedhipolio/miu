const pi=maLoadingPages()[0];
const lines=pageLines(pi);
let hi=-1; for(let i=0;i<lines.length;i++){ if(maLoadHeaderLine(lines[i])){ hi=i; break; } }
const fromHdr=lines.slice(hi).filter(l=>!/^page\d|page\d+of\d+/.test(l.norm));
const bands=groupLineRows(fromHdr);
const out={hi,bands:bands.length,
  band0:bands[0].map(l=>l.items.map(t=>t.str.trim()).join(" | ")),
  band1:(bands[1]||[]).map(l=>l.items.map(t=>t.str.trim()).join(" | ")),
  band2:(bands[2]||[]).map(l=>l.items.map(t=>t.str.trim()).join(" | "))};
const hdrItems=[].concat(...bands[0].map(l=>l.items));
const body=[].concat(...bands.slice(1));
const dataItems=[].concat(...body.map(l=>l.items));
const cols=tableColumns(dataItems,hdrItems);
out.defs=(cols.defs||[]).map(d=>({n:d.name,x:+d.x.toFixed(3),f:+d.from.toFixed(3),t:+d.to.toFixed(3)}));
return JSON.stringify(out);
