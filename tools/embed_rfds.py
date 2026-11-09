"""Swap the RFDS Redlining Tool build carried inside a Mark It Up build.

   python3 embed_rfds.py <mark-it-up.html> <rfds-artifact.html> [out.html]

The RFDS tool travels as ONE blob, <script id="pk-rfds" type="text/plain" data-...>, gzipped and
base64'd like the others but never run by the boot: Mark It Up inflates it only when RFDS mode is
first switched on, into its own frame. Nothing else in Mark It Up depends on what is inside it, so a
newer RFDS build drops in with no change to Mark It Up, and Mark It Up can change with no change to it.
"""
import re,base64,gzip,sys,hashlib,datetime,html
# v83 — small, named changes made to the RFDS build as it is embedded, so a newer RFDS drops in and still
# gets them. Each one is a regex over the RFDS app script (its pk-app blob); a pattern that no longer
# matches is reported and skipped rather than failing the embed.
PATCHES=[
  # Ced: "make the stamping the same … also apply the same color" — Mark It Up's stamp is the Redline
  # tool's default red (MA_RED, v61), so the RFDS stamp takes it too: on screen and in the exported PDF.
  ("stamp colour = Mark It Up red #fa3237", r'const STAMP_RED_HEX="#[0-9a-fA-F]{6}";', 'const STAMP_RED_HEX="#fa3237";'),
]
def _patch_app(rfds:str)->str:
    m=re.search(r'(<script id="pk-app" type="text/plain">)([^<]*)(</script>)',rfds)
    if not m:
        print("  ! no pk-app block in the RFDS build — no patches applied"); return rfds
    code=gzip.decompress(base64.b64decode(m.group(2))).decode('utf-8')
    for name,pat,rep in PATCHES:
        code2,n=re.subn(pat,rep,code)
        print(("  patched: " if n else "  ! not found, skipped: ")+name); code=code2
    blob=base64.b64encode(gzip.compress(code.encode('utf-8'),9,mtime=0)).decode()
    return rfds[:m.start(2)]+blob+rfds[m.end(2):]
def embed(miu:str,rfds:str)->str:
    if 'id="pk-app"' not in rfds or '<title>' not in rfds:
        raise SystemExit("that does not look like an RFDS Redlining Tool artifact build")
    if 'id="pk-rfds"' in rfds or 'MIU_VERSION' in rfds or '<title>Mark It Up' in rfds:
        raise SystemExit("that is a Mark It Up build, not the RFDS tool — check the argument order")
    rfds=_patch_app(rfds)
    raw=rfds.encode('utf-8')
    b=base64.b64encode(gzip.compress(raw,9,mtime=0)).decode()
    sha=hashlib.sha256(raw).hexdigest()[:12]
    title=html.escape(re.search(r'<title>([^<]*)</title>',rfds).group(1).strip(),quote=True)
    tag=('<script id="pk-rfds" type="text/plain" data-title="%s" data-sha="%s" data-bytes="%d" data-embedded="%s">%s</script>'
         %(title,sha,len(raw),datetime.date.today().isoformat(),b))
    pat=re.compile(r'<script id="pk-rfds" type="text/plain"[^>]*>[^<]*</script>')
    if pat.search(miu): return pat.sub(lambda m:tag,miu,count=1)
    # first embed: straight after the last packed blob, before the boot loader
    i=miu.rfind('<script id="pk-'); j=miu.index('</script>',i)+len('</script>')
    return miu[:j]+'\n'+tag+miu[j:]
if __name__=="__main__":
    a,r=sys.argv[1],sys.argv[2]; o=sys.argv[3] if len(sys.argv)>3 else a
    out=embed(open(a,encoding='utf-8').read(),open(r,encoding='utf-8').read())
    open(o,'w',encoding='utf-8').write(out)
    print("embedded",r,"->",o,len(out),"bytes")
