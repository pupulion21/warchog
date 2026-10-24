"""Inspect actual posed joints and skin grounding across the full rigged roster."""
from pathlib import Path
import json,os
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))

def run():
 checks,errors,records=[],[],[]
 def check(name,ok,detail=None):
  checks.append({'name':name,'pass':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 def posture(page,skin=False):return page.evaluate('(skin)=>window.__arena.postureInfo(skin)[0]',skin)
 def stable(page):page.wait_for_function('Math.abs(window.__arena.postureInfo()[0].gazePitch)<2.5',timeout=15000)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   context=browser.new_context(viewport={'width':900,'height':900});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').click();page.locator('#start').click();page.evaluate('window.__arena.advance(.3)');entries=page.evaluate('window.__arena.rosterInfo().entries')
    # Keep Yot protected in the cache while every other body is instanced/disposed.
    page.evaluate('window.__arena.selectFighter(1,"yot")');original=posture(page)['pitchBefore']
    style=page.add_style_tag(content='.game-ui,.viewport-vignette{display:none!important}')
    for entry in entries:
     id=entry['id'];page.evaluate('(id)=>window.__arena.selectFighter(0,id)',id)
     page.evaluate('window.__arena.reset();window.__arena.teleport(0,0,0);window.__arena.teleport(1,8,-7);document.querySelector("#lock-toggle").checked=false;document.querySelector("#lock-toggle").dispatchEvent(new Event("change"));window.__arena.orbit(Math.PI,.05);window.__arena.advance(.35)');stable(page)
     samples=[]
     for seconds in [0,.75,1.0]:
      page.evaluate('(s)=>window.__arena.advance(s)',seconds);page.wait_for_timeout(120);samples.append(posture(page))
     skin=posture(page,True)
     check(f'{id}: idle looks forward with an upright torso',all(abs(v['gazePitch'])<3 and abs(v['gazeYaw'])<3 and v['torsoLean']<16 for v in samples),samples)
     check(f'{id}: feet remain grounded and the breathing pose stays animated',skin['floor'] is not None and abs(skin['floor'])<.07 and max(v['gazePitch'] for v in samples)-min(v['gazePitch'] for v in samples)>.15,{'floor':skin['floor'],'pitch':[v['gazePitch'] for v in samples]})
     page.locator('#arena').screenshot(path=str(OUT/f'upright-{id}.png'))
     strafes=[]
     for x in [-1,1]:
      page.evaluate('(x)=>{window.__arena.reset();document.querySelector("#lock-toggle").checked=true;document.querySelector("#lock-toggle").dispatchEvent(new Event("change"));window.__arena.advance(.35,{x,z:0})}',x);page.wait_for_timeout(120);stable(page);strafes.append(posture(page))
     check(f'{id}: both strafe directions keep the gaze level',all(abs(v['gazePitch'])<3 and abs(v['gazeYaw'])<3 for v in strafes),strafes)
     records.append({'id':id,'idle':samples,'floor':skin['floor'],'strafes':strafes})
    page.evaluate('window.__arena.selectFighter(0,"yot")');again=posture(page)['pitchBefore']
    check('reusing the cached body does not compound or mutate its source posture',max(abs(a-b) for a,b in zip(original,again))<.0001,{'original':original,'after':again})
    style.evaluate('(e)=>e.remove()');page.locator('#game-menu').click();page.locator('#pause-fighters').click();page.locator('[data-pick-seat="0"]').click()
    for entry in entries:
     id=entry['id'];page.locator(f'[data-fighter="{id}"]').click();page.wait_for_function('(id)=>window.__arena.rosterInfo().preview.id===id&&window.__arena.rosterInfo().preview.ready',arg=id,timeout=30000)
     page.wait_for_function('Math.abs(window.__arena.rosterInfo().preview.posture.gazePitch)<2.5',timeout=15000)
     actual=page.evaluate('window.__arena.rosterInfo().preview.posture');check(f'{id}: independent live picker uses the upright stance',abs(actual['gazePitch'])<3 and actual['torsoLean']<16,actual)
     page.locator('.roster-showcase').screenshot(path=str(OUT/f'showcase-{id}.png'))
    page.keyboard.press('Escape')
   finally:context.close()
  finally:browser.close()
 check('no JavaScript errors while swapping and previewing corrected rigs',not errors,errors)
 sheet=Image.new('RGB',(1200,4*360),'#eee6ee');draw=ImageDraw.Draw(sheet)
 for i,entry in enumerate(entries):
  with Image.open(OUT/f'showcase-{entry["id"]}.png') as im:
   im=im.convert('RGB');im.thumbnail((300,330));x=i%4*300;y=i//4*360;sheet.paste(im,(x,y));draw.text((x+12,y+340),entry['id'].upper(),fill='#644174')
 sheet.save(OUT/'upright-roster-contact-sheet.jpg',quality=92)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'forms':records,'scope':'Actual transformed joints, CPU skin bounds, live models and independent preview rigs in installed Chromium/SwiftShader. Original body files and action clips are preserved.'}
 (OUT/'posture-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)

if __name__=='__main__':run()
