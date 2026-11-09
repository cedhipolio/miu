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
        code, n = re.subn(pat, rep, code)
        print(("  patched: " if n else "  ! not found, skipped: ") + name)
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
