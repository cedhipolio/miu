#!/usr/bin/env python3
"""Embed the RFDS Redlining Tool build (pk-rfds).

   python3 tools/embed_rfds.py [path/to/rfds-artifact.html]

With a path, that file is first copied to assets/rfds/rfds-artifact.html (the RFDS build the repo keeps).
Then the kept build is patched (PATCHES below) and written to src/rfds.html — GENERATED — and the
pk-rfds entry in src/manifest.json gets the build's title, sha and embed date (Help shows them).
Rebuild afterwards. Nothing else in Mark It Up depends on what is inside the RFDS build: the workspace
(pk-ws) inflates it into a frame per RFDS tab and drives it from outside.

Also works on an already BUILT file, for a quick swap without the repo:
   python3 tools/embed_rfds.py --into dist/mark-it-up.artifact.html new-rfds.html
"""
import base64, datetime, gzip, hashlib, html, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
KEPT = os.path.join(ROOT, "assets", "rfds", "rfds-artifact.html")
OUT = os.path.join(ROOT, "src", "rfds.html")
MANIFEST = os.path.join(ROOT, "src", "manifest.json")

# Small, named changes made to the RFDS app script (its pk-app blob) as it is embedded, so a newer RFDS
# build still gets them. A pattern that no longer matches is reported and skipped, never fatal.
PATCHES = [
    # v83 — Ced: "make the stamping the same … also apply the same color". Mark It Up's stamp is the
    # Redline tool's default red (MA_RED #fa3237, v61): on screen and in the exported PDF.
    ("stamp colour = Mark It Up red #fa3237", r'const STAMP_RED_HEX="#[0-9a-fA-F]{6}";', 'const STAMP_RED_HEX="#fa3237";'),
    # v88 — Ced: "make the summary for rfds tool not too specific. for sectors with same redline, just make
    # it per sector." The report's two place helpers are replaced (rfds-patches/report-per-sector.js,
    # appended below) and the value lists are told which positions their line covers.
    ("report values know the antenna positions", r'_rlPairsWithPlace\(g\.items\)(\),\s*where:RL_TAB\.antennaPosition)',
     r'_rlPairsWithPlace(g.items,uPos)\1'),
    ("report values know the port positions", r'const pair=_rlPairList\(_rlPairsWithPlace\(g\.items\)\);',
     'const pair=_rlPairList(_rlPairsWithPlace(g.items,uPort));'),
    # v89 — Ced: "add the total changes on Actual equipment count … only the total value of the changed
    # item". The count line carries what was corrected (rfds-patches/report-count-totals.js).
    # v89 — Ced: "the centering of texts of asbuilt redlined texts of first column in rfds has an offset
    # compared to second row". A centred cell redline whose cover did not sit centred on the printed value
    # pushed its TEXT sideways inside the cover (textDx), so the figure sat off-centre in its own mark and
    # differently from row to row. The cover now moves onto the printed value instead (kept inside the
    # column and still covering the whole printed run); the text only takes whatever is left.
    ("cell redline: move the cover, not the text", r'if\(d>room\)d=room; if\(d<-room\)d=-room;',
     'if(Math.abs(d)>0.0002){ let nx2=a.nx+d;'
     ' if(box.colR!=null&&nx2+a.nw>box.colR)nx2=box.colR-a.nw; if(box.colL!=null&&nx2<box.colL)nx2=box.colL;'
     ' const pL=box.nx, pR=(box.x2!=null?box.x2:box.nx+(box.nw||0));'
     ' if(nx2>=0&&nx2<=pL+1e-6&&nx2+a.nw>=pR-1e-6){ d-=(nx2-a.nx); a.nx=nx2; } }'
     ' if(d>room)d=room; if(d<-room)d=-room;'),
    # v90 — Ced (clip): first-column as-built figures sat left of the design figures above them. A centred
    # cell redline aims at its column's shared centre line when the column has one
    # (rfds-patches/column-centre.js), not at its own cell's printed run.
    ("cell redline aims at the column", r'const cc=printedC!=null\?printedC:\(box\.colL\+box\.colR\)/2;',
     'const cc=(typeof _miuColCentre==="function"?_miuColCentre(pi,box,printedC):printedC)??((box.colL+box.colR)/2);'),
    # v91 — Ced: "also add the added equipment on design summary and rf inventory. ie (Added FB-L98B-235 in
    # Beta)". The general "Equipment added" line is built by rfds-patches/report-added.js instead.
    ("added rows named by their equipment",
     r'if\(addedT\.length\)add\(_rlLine\("Equipment added to the design",\s*\{sector:_rlJoin\(addedS\),where:_rlJoin\(addedT,2\)\}\),"designSummary"\);',
     'if(typeof _miuAddedLines==="function")_miuAddedLines(A,rf,add,uDs,uRf); else if(addedT.length)add(_rlLine("Equipment added to the design",{sector:_rlJoin(addedS),where:_rlJoin(addedT,2)}),"designSummary");'),
    # v92 — Ced: "If a redline was changed on analyze rfds, regardless if there is a redline on that space
    # already, please replace the overlaid redline. only apply the rule of not changing redline if the
    # redline was unchanged." Apply's two "your redline is here, leave it" branches ask _miuHandKeep
    # (rfds-patches/apply-replaces.js): same value → left alone; different → removed and restamped.
    ("apply replaces a changed redline (whole cell)",
     r'const dup=markCoveringCell\(pi,box\);\s*if\(dup&&!dup\.fromAnalyze\)\{.*?return dup\.id;\s*\}',
     'let dup=markCoveringCell(pi,box);\n    if(dup&&!dup.fromAnalyze){ if(typeof _miuHandKeep!=="function"||_miuHandKeep(dup,value))return dup.id; dup=null; }'),
    ("apply replaces a changed redline (cell)",
     r'const dup=markCoveringCell\(page,(\{nx:key\.nx.*?\}\);)\s*if\(dup&&!dup\.fromAnalyze\)\{.*?return dup\.id;\s*\}',
     'let dup=markCoveringCell(page,\\1\n    if(dup&&!dup.fromAnalyze){ if(typeof _miuHandKeep!=="function"||_miuHandKeep(dup,orig))return dup.id; dup=null; }'),
    ("count line carries the corrected totals", r'\{sector:\(dsCounts&&!ecQty\)\?_rlSecPhrase\(dsSec,uDs\):"",',
     '{sector:(dsCounts&&!ecQty)?_rlSecPhrase(dsSec,uDs):"",pair:(dsCounts&&typeof _miuDsCountPair==="function"?_miuDsCountPair(A,uDs):""),'),
]
# Whole files appended to the RFDS app script after the patches, when its report helpers are there to replace.
APPENDS = [
    ("report per sector", "rfds-patches/report-per-sector.js", "function _rlPairsWithPlace("),
    ("equipment count totals", "rfds-patches/report-count-totals.js", "function rowCounts("),
    ("column centre", "rfds-patches/column-centre.js", "function columnFrame("),
    ("added equipment", "rfds-patches/report-added.js", "function rfModelCol("),
    ("apply replaces", "rfds-patches/apply-replaces.js", "let _azHandHeld="),
]

def check(rfds):
    if 'id="pk-app"' not in rfds or "<title>" not in rfds:
        raise SystemExit("that does not look like an RFDS Redlining Tool artifact build")
    if 'id="pk-rfds"' in rfds or "<title>Mark It Up" in rfds:
        raise SystemExit("that is a Mark It Up build, not the RFDS tool — check the argument")

def patch(rfds):
    m = re.search(r'(<script id="pk-app" type="text/plain">)([^<]*)(</script>)', rfds)
    if not m:
        print("  ! no pk-app block in the RFDS build — no patches applied"); return rfds
    code = gzip.decompress(base64.b64decode(m.group(2))).decode("utf-8")
    for name, pat, rep in PATCHES:
        code, n = re.subn(pat, rep, code, flags=re.S)
        print(("  patched: " if n else "  ! not found, skipped: ") + name)
    for name, f, needs in APPENDS:
        if needs in code and ("/* MIU-APPEND " + f + " */") not in code:
            code += "\n/* MIU-APPEND " + f + " */\n" + open(os.path.join(HERE, f), encoding="utf-8").read()
            print("  appended: " + name)
        else:
            print("  ! not appended: " + name)
    blob = base64.b64encode(gzip.compress(code.encode("utf-8"), 9, mtime=0)).decode()
    return rfds[:m.start(2)] + blob + rfds[m.end(2):]

def attrs(raw, rfds):
    return {"data-title": re.search(r"<title>([^<]*)</title>", rfds).group(1).strip(),
            "data-sha": hashlib.sha256(raw).hexdigest()[:12], "data-bytes": str(len(raw)),
            "data-embedded": datetime.date.today().isoformat()}

def into_built(built, src):
    rfds = open(src, encoding="utf-8").read(); check(rfds); rfds = patch(rfds)
    raw = rfds.encode("utf-8"); a = attrs(raw, rfds)
    tag = '<script id="pk-rfds" type="text/plain"%s>%s</script>' % (
        "".join(' %s="%s"' % (k, html.escape(v, quote=True)) for k, v in a.items()),
        base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode())
    t = open(built, encoding="utf-8").read()
    pat = re.compile(r'<script id="pk-rfds" type="text/plain"[^>]*>[^<]*</script>')
    if not pat.search(t): raise SystemExit(f"{built} has no pk-rfds block")
    open(built, "w", encoding="utf-8").write(pat.sub(lambda _: tag, t, count=1))
    print(f"swapped the RFDS build inside {built}")

def main(argv):
    if argv[:1] == ["--into"]:
        return into_built(argv[1], argv[2])
    if argv:
        check(open(argv[0], encoding="utf-8").read())
        os.makedirs(os.path.dirname(KEPT), exist_ok=True); shutil.copyfile(argv[0], KEPT)
        print(f"kept {argv[0]} as assets/rfds/rfds-artifact.html")
    rfds = open(KEPT, encoding="utf-8").read(); check(rfds); rfds = patch(rfds)
    open(OUT, "w", encoding="utf-8").write(rfds)
    M = json.load(open(MANIFEST, encoding="utf-8"))
    a = attrs(rfds.encode("utf-8"), rfds)
    for b in M["blobs"]:
        if b[0] == "pk-rfds":
            if len(b) > 2: b[2] = a
            else: b.append(a)
    open(MANIFEST, "w", encoding="utf-8").write(json.dumps(M, indent=2, ensure_ascii=False) + "\n")
    print(f"src/rfds.html  {len(rfds)/1048576:.2f} MB  sha {a['data-sha']}  — rebuild now")

if __name__ == "__main__":
    main(sys.argv[1:])
