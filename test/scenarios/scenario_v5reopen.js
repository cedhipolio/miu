const out={};
out.annos=S.annos.length; out.lines=S.lines.length;
out.marks=S.annos.map(a=>({k:a.maKind,dash:a.dash||null,pat:a.pat||null,patCol:a.patCol||null,
                           colOp:a.colOp!=null?a.colOp:1,hl:!!a.hl,uline:!!a.uline,font:a.font}));
out.strokes=S.lines.map(l=>({le:endsOf(l),lpat:l.lpat||"straight",dash:l.dash||"solid"}));
return JSON.stringify(out);
