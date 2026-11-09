"""Assemble build/ (the blob sources pack.py packs) from src/.

   build/pk-ws.js  = src/workspace/ws_head.js + align_part.js + ws_main.js + ws_tail.js, with the icon
                     masks, the shared switch CSS and the RFDS stamp card filled in
   build/pk-app.js = src/app/pk-app.base.js with MIU_VERSION set + src/app/pk-app.tail.js
   the other blobs are copied as they are
"""
import json, re, shutil, sys

v = sys.argv[1]
I = 'src/workspace/icons/'
W = 'src/workspace/'

def fill(s):
    return (s.replace('@@MIU_ICO@@', open(I + 'miu-mask.b64').read())
             .replace('@@RFDS_ICO@@', open(I + 'rfds-mask.b64').read())
             .replace('@@SWAP_ICO@@', open(I + 'swap-mask.b64').read())
             .replace('@@RFDS_STAMP_JS@@', json.dumps(open(W + 'rfds_stamp.js').read())))

head = open(W + 'ws_head.js').read().replace('@@CSS_PART@@',
        open(W + 'css_part.txt').read().replace('${MODE_ICO.', '${ICO.'))
ws = fill(head + open(W + 'align_part.js').read() + open(W + 'ws_main.js').read() + open(W + 'ws_tail.js').read())
assert '@@' not in ws, 'an unfilled placeholder is left in pk-ws'
open('build/pk-ws.js', 'w').write(ws)

a = open('src/app/pk-app.base.js').read()
a = re.sub(r'var MIU_VERSION = "[^"]*";', 'var MIU_VERSION = "%s";' % v, a, count=1)
a += open('src/app/pk-app.tail.js').read()
open('build/pk-app.js', 'w').write(a)

for f in ['pk-css.css', 'pk-pdf.js', 'pk-wrk.js', 'pk-lib.js', 'pk-ast.js']:
    shutil.copy('src/app/' + f, 'build/' + f)
