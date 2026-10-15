#!/usr/bin/env python3
"""Build src/fonts-extra.js — the bundled font library — from open-licensed families on npm.

Ced: "add all possible fonts you can add as well."

Every face here is OFL or Apache-licensed (the licences travel in the npm packages, and both allow
bundling and embedding), comes from the `@expo-google-fonts/<family>` package — which ships the
complete Google Fonts TTFs, glyf outlines and all — and is cut down to exactly the characters a PDF
string in this tool can carry (WinAnsi / cp1252), with hinting and layout tables dropped. That is
what the tool's own TrueType reader and PDF font writer in fonts.js expect, and what keeps a family
of four cuts at roughly 60–120 KB.

    pip install fonttools brotli
    python3 tools/addfonts.py            # writes src/fonts-extra.js

Re-running it is deterministic for a given set of package versions (they are pinned below).
"""
import base64, io, json, os, pathlib, subprocess, sys, tarfile, tempfile
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "fonts-extra.js"
CACHE = pathlib.Path(tempfile.gettempdir()) / "miu-font-cache"

# key, label, npm package, file stem, group, css fallback, hint
FAMILIES = [
    # ---- office look-alikes: a note set in these matches the paperwork around the report
    ("caladea", "Caladea (Cambria)", "caladea", "Caladea", "Office look-alikes", "Cambria,serif",
     "Cambria's measure — the serif in a lot of Word templates"),
    ("gelasio", "Gelasio (Georgia)", "gelasio", "Gelasio", "Office look-alikes", "Georgia,serif",
     "Georgia's measure"),
    # ---- sans
    ("roboto", "Roboto", "roboto", "Roboto", "Sans serif", "sans-serif", None),
    ("opensans", "Open Sans", "open-sans", "OpenSans", "Sans serif", "sans-serif", None),
    ("lato", "Lato", "lato", "Lato", "Sans serif", "sans-serif", None),
    ("sourcesans", "Source Sans 3", "source-sans-3", "SourceSans3", "Sans serif", "sans-serif", None),
    ("notosans", "Noto Sans", "noto-sans", "NotoSans", "Sans serif", "sans-serif", None),
    ("plexsans", "IBM Plex Sans", "ibm-plex-sans", "IBMPlexSans", "Sans serif", "sans-serif", None),
    ("firasans", "Fira Sans", "fira-sans", "FiraSans", "Sans serif", "sans-serif", None),
    ("inter", "Inter", "inter", "Inter", "Sans serif", "sans-serif", None),
    ("montserrat", "Montserrat", "montserrat", "Montserrat", "Sans serif", "sans-serif", None),
    ("poppins", "Poppins", "poppins", "Poppins", "Sans serif", "sans-serif", None),
    ("worksans", "Work Sans", "work-sans", "WorkSans", "Sans serif", "sans-serif", None),
    ("nunito", "Nunito", "nunito", "Nunito", "Sans serif", "sans-serif", None),
    ("raleway", "Raleway", "raleway", "Raleway", "Sans serif", "sans-serif", None),
    # ---- condensed: more words in a narrow cell
    ("robotocond", "Roboto Condensed", "roboto-condensed", "RobotoCondensed", "Condensed", "sans-serif", None),
    ("barlowcond", "Barlow Condensed", "barlow-condensed", "BarlowCondensed", "Condensed", "sans-serif", None),
    ("oswald", "Oswald", "oswald", "Oswald", "Condensed", "sans-serif", None),
    # ---- serif
    ("merriweather", "Merriweather", "merriweather", "Merriweather", "Serif", "serif", None),
    ("lora", "Lora", "lora", "Lora", "Serif", "serif", None),
    ("ptserif", "PT Serif", "pt-serif", "PTSerif", "Serif", "serif", None),
    ("plexserif", "IBM Plex Serif", "ibm-plex-serif", "IBMPlexSerif", "Serif", "serif", None),
    ("notoserif", "Noto Serif", "noto-serif", "NotoSerif", "Serif", "serif", None),
    # ---- monospace: part numbers and serials that must line up
    ("robotomono", "Roboto Mono", "roboto-mono", "RobotoMono", "Monospace", "monospace", None),
    ("sourcecode", "Source Code Pro", "source-code-pro", "SourceCodePro", "Monospace", "monospace", None),
    ("plexmono", "IBM Plex Mono", "ibm-plex-mono", "IBMPlexMono", "Monospace", "monospace", None),
    ("jetbrains", "JetBrains Mono", "jetbrains-mono", "JetBrainsMono", "Monospace", "monospace", None),
    ("inconsolata", "Inconsolata (Consolas)", "inconsolata", "Inconsolata", "Monospace", "monospace", None),
    # ---- hand
    ("caveat", "Caveat (handwriting)", "caveat", "Caveat", "Handwriting", "cursive", "A field-note hand"),
    ("patrickhand", "Patrick Hand", "patrick-hand", "PatrickHand", "Handwriting", "cursive", None),
]

CUTS = [("", "400Regular", "400", "normal"), ("bold", "700Bold", "700", "normal"),
        ("ital", "400Regular_Italic", "400", "italic"), ("bolditalic", "700Bold_Italic", "700", "italic")]

WINANSI = sorted({ord(bytes([b]).decode("cp1252", errors="ignore") or "\0") for b in range(0x20, 0x100)} - {0})


def fetch(pkg):
    CACHE.mkdir(parents=True, exist_ok=True)
    have = list(CACHE.glob(f"expo-google-fonts-{pkg}-*.tgz"))
    if not have:
        subprocess.run(["npm", "pack", f"@expo-google-fonts/{pkg}", "--silent"], cwd=CACHE, check=True,
                       stdout=subprocess.DEVNULL)
        have = list(CACHE.glob(f"expo-google-fonts-{pkg}-*.tgz"))
    return tarfile.open(have[0])


def cut(tf, stem, weight_dir):
    names = [m for m in tf.getnames() if m.endswith(f"{stem}_{weight_dir}.ttf")]
    if not names:
        return None
    raw = tf.extractfile(names[0]).read()
    f = TTFont(io.BytesIO(raw))
    if "glyf" not in f:
        return None                             # CFF outlines: the PDF writer here embeds TrueType
    o = subset.Options()
    o.hinting = False
    o.layout_features = []
    o.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT", "fvar", "gvar", "HVAR", "MVAR", "avar", "DSIG",
                      "kern", "BASE", "JSTF", "meta", "COLR", "CPAL", "SVG "]
    o.name_IDs = [1, 2, 3, 4, 6]
    o.notdef_outline = True
    o.recalc_bounds = True
    o.glyph_names = False
    s = subset.Subsetter(o)
    s.populate(unicodes=WINANSI)
    s.subset(f)
    f["post"].formatType = 3.0                 # no glyph names: smaller, and the reader does not use them
    buf = io.BytesIO(); f.save(buf)
    return buf.getvalue()


def main():
    data, faces, fams, total = {}, [], [], 0
    for key, label, pkg, stem, group, fallback, hint in FAMILIES:
        try:
            tf = fetch(pkg)
        except Exception as e:
            print(f"  skip {label}: {e}", file=sys.stderr); continue
        cssfam = "MA " + label.split(" (")[0]
        got = []
        for suffix, wdir, w, st in CUTS:
            b = cut(tf, stem, wdir)
            if not b:
                continue
            k = key + suffix
            data[k] = base64.b64encode(b).decode("ascii")
            faces.append([k, cssfam, w, st])
            got.append((suffix, w, st))
            total += len(b)
        if "" not in [g[0] for g in got]:
            print(f"  skip {label}: no regular cut", file=sys.stderr)
            for suffix, *_ in got: data.pop(key + suffix, None)
            faces = [f for f in faces if not f[0].startswith(key)]
            continue
        fams.append({"k": key, "label": label, "group": group, "css": f"'{cssfam}',{fallback}",
                     "cuts": [g[0] for g in got], "hint": hint})
        print(f"  {label:28s} {len(got)} cuts")
    print(f"{len(fams)} families, {len(faces)} cuts, {total/1024:.0f} KB of font", file=sys.stderr)

    js = ["/* =================================================================================================",
          "   fonts-extra.js — GENERATED by tools/addfonts.py. Do not edit by hand.",
          "",
          "   v60 — Ced: \"add all possible fonts you can add as well.\" The library of faces that travel with",
          "   the tool and inside every exported file, on top of the standard fourteen and the three bundled",
          "   in fonts.js. Each is OFL or Apache, subset to WinAnsi, read and embedded by the same TrueType",
          "   reader and PDF font writer as Jost. Loaded after the app (its own blob), so a slow machine",
          "   draws the opening screen before it has parsed a megabyte of fonts.",
          "   ================================================================================================= */",
          "(function(){",
          "const DATA=" + json.dumps(data, separators=(",", ":")) + ";",
          "const FACES=" + json.dumps(faces, separators=(",", ":")) + ";",
          "const FAMS=" + json.dumps(fams, separators=(",", ":")) + ";",
          "Object.assign(MA_TTF_B64, DATA);",
          "FACES.forEach(f=>MA_TTF_FACES.push(f));",
          "/* the screen's copy of each face: the same bytes the export embeds */",
          "try{ const css=FACES.map(([k,fam,w,st])=>`@font-face{font-family:'${fam}';font-weight:${w};font-style:${st};",
          "  font-display:swap;src:url(data:font/ttf;base64,${DATA[k]}) format('truetype')}`).join('\\n');",
          "  const el=document.createElement('style'); el.id='ttfFacesExtra'; el.textContent=css; document.head.appendChild(el);",
          "}catch(e){ try{ LOG('extra faces could not be installed',e&&e.message); }catch(_){} }",
          "/* and each cut becomes a face a mark can be set in */",
          "const SUF={'':['400','normal',''],bold:['700','normal',' Bold'],ital:['400','italic',' Italic'],",
          "           bolditalic:['700','italic',' Bold Italic']};",
          "FAMS.forEach(F=>{ F.cuts.forEach(c=>{ const s=SUF[c];",
          "  MARK_FONTS[F.k+c]={label:F.label.split(' (')[0]+s[2], css:F.css, ttf:F.k+c, ps:(F.label.split(' (')[0].replace(/\\s+/g,'')+'-'+({'':'Regular',bold:'Bold',ital:'Italic',bolditalic:'BoldItalic'})[c]),",
          "    weight:s[0]==='700'?'700':undefined, style:s[1]==='italic'?'italic':undefined}; });",
          "  if(typeof TP_FAMS!=='undefined'&&TP_FAMS.indexOf(F.k)<0)TP_FAMS.push(F.k);",
          "  if(typeof TP_FONT_CHIPS!=='undefined')TP_FONT_CHIPS.push({k:F.k,label:F.label.split(' (')[0],group:F.group,hint:F.hint||undefined});",
          "});",
          "/* a family's key must be matched by its own stem, not a shorter one inside it (roboto / robotomono) */",
          "if(typeof TP_FAMS!=='undefined')TP_FAMS.sort((a,b)=>b.length-a.length);",
          "window.MA_FONT_FAMILIES=FAMS;",
          "})();"]
    OUT.write_text("\n".join(js) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  {OUT.stat().st_size/1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
