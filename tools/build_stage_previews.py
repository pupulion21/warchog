"""Capture the five actual 3D reconstructions with one finite installed-browser session."""
from pathlib import Path
import hashlib,json,os
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
ids=['rayj-house','cwo-alley','house-cup','neon-street','cwo-rally'];records=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
 try:
  page=browser.new_page(viewport={'width':1440,'height':1000});page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
  style=page.add_style_tag(content='.stage-tour,.setup-nameplates,.showcase-controls{visibility:hidden!important}')
  for id in ids:
   assert page.evaluate('(id)=>window.__arena.selectStage(id)',id)
   page.wait_for_function('window.__arena.showcaseInfo().exploring');page.wait_for_timeout(700)
   source=OUT/f'world-{id}-tour.png';page.locator('#arena').screenshot(path=str(source))
   with Image.open(source) as im:
    im=im.convert('RGB');im.thumbnail((512,320));im.save(ROOT/f'public/assets/stages/{id}/preview.webp',quality=90)
   records.append({'id':id,'render':str(source.relative_to(ROOT)),'renderSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'geometry':page.evaluate('window.__arena.stageInfo().geometry')})
   print('Captured real 3D arena:',id,flush=True)
  (ROOT/'public/assets/stages/preview-provenance.json').write_text(json.dumps({'method':'Browser renders of the actual authored Babylon geometry. No remote generation.','files':records},indent=2)+'\n')
 finally:browser.close()
contact=Image.new('RGB',(1200,2*300),'#eee6ee');draw=ImageDraw.Draw(contact)
for i,rec in enumerate(records):
 with Image.open(ROOT/rec['render']) as im:
  im=im.convert('RGB');im.thumbnail((400,260));x=(i%3)*400;y=(i//3)*300;contact.paste(im,(x,y));draw.text((x+14,y+280),rec['id'].upper(),fill='#644174')
contact.save(OUT/'world-contact-sheet.jpg',quality=92)

# A separate review sheet pairs each district with its actual ceiling/sky view.
if all((OUT/f'environment-{id}-{label}.png').exists() for id in ids for label in ['outside','up']):
 sheet=Image.new('RGB',(1200,5*400),'#eee6ee');draw=ImageDraw.Draw(sheet)
 for row,id in enumerate(ids):
  for col,label in enumerate(['outside','up']):
   with Image.open(OUT/f'environment-{id}-{label}.png') as im:
    im=im.convert('RGB');im.thumbnail((600,365));sheet.paste(im,(col*600,row*400))
   draw.text((col*600+14,row*400+377),id.upper()+' / '+label.upper(),fill='#644174')
 sheet.save(OUT/'environment-contact-sheet.jpg',quality=92)
