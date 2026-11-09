import re,base64,gzip,sys,os
src,out=sys.argv[1],sys.argv[2]
os.makedirs(out,exist_ok=True)
t=open(src,encoding='utf-8').read()
for m in re.finditer(r'<script id="(pk-[a-z]+)" type="text/plain">([^<]*)</script>',t):
    d=gzip.decompress(base64.b64decode(m.group(2))).decode('utf-8')
    open(os.path.join(out,m.group(1)+('.css' if m.group(1)=='pk-css' else '.js')),'w',encoding='utf-8').write(d)
    print(m.group(1),len(d))
