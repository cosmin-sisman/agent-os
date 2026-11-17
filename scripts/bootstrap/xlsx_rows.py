import zipfile, sys, json, xml.etree.ElementTree as ET
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
z=zipfile.ZipFile(sys.argv[1]); ss=[]
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns):
        ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%ns['m'])))
wb=ET.fromstring(z.read('xl/workbook.xml')); rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
rmap={r.get('Id'):r.get('Target') for r in rels}; out={}
import re
for s in wb.find('m:sheets',ns):
    path='xl/'+rmap[s.get('{%s}id'%ns['r'])].lstrip('/').replace('xl/','')
    rows=[]
    for row in ET.fromstring(z.read(path)).find('m:sheetData',ns):
        d={}
        for c in row:
            t=c.get('t'); v=c.find('m:v',ns); col=re.match(r'[A-Z]+',c.get('r')).group()
            isv=c.find('m:is',ns)
            val=ss[int(v.text)] if t=='s' and v is not None else (''.join(x.text or '' for x in isv.iter('{%s}t'%ns['m'])) if isv is not None else (v.text if v is not None else None))
            if val not in (None,''): d[col]=val
        if d: rows.append(d)
    out[s.get('name')]=rows
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False)
