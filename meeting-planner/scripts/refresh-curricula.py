"""Import public NewUU curriculum tables; retain source URLs and explicit coverage gaps."""
import requests, json, re, concurrent.futures
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime, timezone
base='https://newuu.uz/en/'
links=set()
for kind in ['undergraduate-program','graduate-program']:
 s=BeautifulSoup(requests.get(base+kind,timeout=40).text,'html.parser')
 links.update(a['href'] for a in s.select('a[href]') if base+kind+'/' in a['href'])
def read(url):
 try:
  r=requests.get(url,timeout=40);r.raise_for_status();s=BeautifulSoup(r.text,'html.parser')
  title=s.find(['h1','h2']);name=title.get_text(' ',strip=True) if title else url.rsplit('/',1)[1]
  rows=[]
  for table in s.find_all('table'):
   semester=None
   for tr in table.find_all('tr'):
    cells=[c.get_text(' ',strip=True) for c in tr.find_all(['td','th'])]
    if not cells:continue
    if re.fullmatch(r'Semester\s*\d+',cells[0],re.I):semester=int(re.search(r'\d+',cells.pop(0))[0])
    if semester and len(cells)>=2 and re.fullmatch(r'[A-Z]{2,}\s*\d{3}[A-Z]?',cells[0]):
     rows.append(dict(semester=semester,code=cells[0].replace(' ',''),name=cells[1],type=cells[2] if len(cells)>2 else ''))
  return dict(name=name,url=url,courses=rows,status='parsed' if rows else 'No structured semester/course-code table found')
 except Exception as e:return dict(name=url.rsplit('/',1)[-1],url=url,courses=[],status=str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: programs=list(pool.map(read,sorted(links)))
out={'retrievedAt':datetime.now(timezone.utc).isoformat(),'programs':programs}
Path(__file__).resolve().parents[1].joinpath('curricula.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print([(p['name'],len(p['courses'])) for p in programs])
