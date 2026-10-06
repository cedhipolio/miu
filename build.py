#!/usr/bin/env python3
"""Pack the Mount Analysis Redlining Tool into one self-contained HTML file.

Mirrors the packer the RFDS tool used: each asset is gzipped + base64'd into a
<script type="text/plain"> block and inflated at load by the boot script.
"""
import base64, gzip, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "mount-analysis-redlining-tool.html")

# Each blob may be several source files, concatenated in order. The engine and the mount-analysis
# layer are separate files to work on and one script to run, which is what keeps them in one scope.
ASSETS = [
    ("pk-css", ["app.css", "ma.css", "toolpop.css", "selbar.css"]),
    ("pk-pdf", ["pdfjs.js"]),
    ("pk-wrk", ["pdfworker.js"]),
    ("pk-lib", ["pdflib.js"]),
    ("pk-app", ["fonts.js", "app.js", "ma.js", "toolpop.js", "selbar.js", "selectkit.js"]),
]


def check_js(path):
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr)
        raise SystemExit(f"syntax error in {path}")


def pack(names):
    raw = b"\n".join(open(os.path.join(SRC, n), "rb").read() for n in names)
    gz = gzip.compress(raw, 9, mtime=0)
    return base64.b64encode(gz).decode("ascii")


def main():
    for name in ("fonts.js", "app.js", "ma.js", "toolpop.js", "selbar.js", "selectkit.js"):
        check_js(os.path.join(SRC, name))
    parts = [open(os.path.join(SRC, "shell.html"), "rb").read().decode("utf-8")]
    for sid, names in ASSETS:
        parts.append(f'<script id="{sid}" type="text/plain">{pack(names)}</script>\n')
    parts.append(open(os.path.join(SRC, "boot.html"), "rb").read().decode("utf-8"))
    html = "".join(parts)
    open(OUT, "w", encoding="utf-8").write(html)
    print(f"{OUT}  {len(html)/1048576:.2f} MB")


if __name__ == "__main__":
    main()
