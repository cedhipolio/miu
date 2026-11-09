"""Repack a Mark It Up artifact: template html + edited blob sources (+ optional RFDS build to embed)."""
import re,base64,gzip,sys,os,hashlib
tpl,srcdir,out=sys.argv[1],sys.argv[2],sys.argv[3]
rfds=sys.argv[4] if len(sys.argv)>4 else None
t=open(tpl,encoding='utf-8').read()
def blob(data:bytes): return base64.b64encode(gzip.compress(data,9,mtime=0)).decode()
def rep(m):
    id_=m.group(1)
    p=os.path.join(srcdir,id_+('.css' if id_=='pk-css' else '.js'))
    if id_=='pk-rfds' or not os.path.exists(p): return m.group(0)
    return '<script id="%s" type="text/plain">%s</script>'%(id_,blob(open(p,'rb').read()))
t=re.sub(r'<script id="(pk-[a-z]+)" type="text/plain">[^<]*</script>',rep,t)
if rfds:
    import embed_rfds
    t=embed_rfds.embed(t,open(rfds,encoding='utf-8').read())
open(out,'w',encoding='utf-8').write(t)
print(out,len(t))
