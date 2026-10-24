"""Finite acceptance for all five 3D arenas, shared collision and stage switching."""
from pathlib import Path
import json,math,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
IDS=['rayj-house','cwo-alley','house-cup','neon-street','cwo-rally']

def run():
 checks,errors=[],[]
 def check(name,ok,detail=None):
  checks.append({'name':name,'pass':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 def stage(page):return page.evaluate('window.__arena.stageInfo()')
 def select(page,id):
  page.evaluate('(id)=>window.__arena.selectStage(id)',id)
  page.wait_for_function('(id)=>window.__arena.stageInfo().id===id&&!window.__arena.stageInfo().busy&&!document.querySelector("#start").disabled',arg=id,timeout=30000)
 def setup(page):page.locator('#game-menu').click();page.locator('#pause-fighters').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
 def open_page(browser,**kwargs):
  context=browser.new_context(**kwargs);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"');return context,page
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   context,page=open_page(browser,viewport={'width':1440,'height':1000})
   try:
    check('setup offers all five named Metropolis places',page.locator('button[data-stage]').count()==5)
    original=page.evaluate('window.__arena.rosterInfo().selected');signatures=[]
    for id in IDS:
     page.locator(f'button[data-stage="{id}"]').click();page.wait_for_function('(id)=>window.__arena.stageInfo().id===id&&!document.querySelector("#start").disabled',arg=id,timeout=30000)
     info=stage(page);signatures.append((info['geometry']['triangles'],info['geometry']['meshes']))
     check(f'{id}: distinct batched 3D geometry, loaded textures and named source',info['geometry']['triangles']>10000 and info['staticBatches']<128 and info['texturesReady'] and info['reference'].startswith('Metropolis'),info['geometry'])
     check(f'{id}: renderer, physics, ticket and selected button agree',page.evaluate('window.__arena.snapshot().stageId')==id and page.locator(f'button[data-stage="{id}"]').get_attribute('aria-pressed')=='true' and page.locator('#stage-name').inner_text()==info['name'].upper())
     check(f'{id}: choosing the map opens a live 3D orbit preview',page.evaluate('window.__arena.showcaseInfo().exploring'))
     before=stage(page)['camera'];page.locator('.setup-fighters [data-showcase-turn="1"]').click()
     page.wait_for_function('(before)=>Math.hypot(...window.__arena.stageInfo().camera.map((n,i)=>n-before[i]))>1',arg=before,timeout=15000);after=stage(page)['camera']
     check(f'{id}: tour controls move the actual camera',math.dist(before,after)>1)
     page.screenshot(path=str(OUT/f'world-{id}-setup.png'))
     page.locator('#start').click();page.evaluate('window.__arena.advance(.3)');page.wait_for_timeout(300)
     check(f'{id}: entering restores both fighters in the chosen world',page.evaluate('window.__arena.showcaseInfo().parent==="app"&&window.__arena.snapshot().assets.every(a=>a.ready&&a.bones===24)') and page.evaluate('window.__arena.rosterInfo().selected')==original)
     page.screenshot(path=str(OUT/f'world-{id}-game.png'))
     page.wait_for_function('window.__arena.ambienceInfo().ready>=2',timeout=15000)
     check(f'{id}: the matching ambience starts after entering',page.evaluate('(id)=>{const a=window.__arena.ambienceInfo();return a.id===id&&a.active&&!a.paused}',id))
     page.evaluate('window.__arena.reset();window.__arena.teleport(0,0,.5);window.__arena.advance(.7,{x:0,z:0,attack:true})')
     check(f'{id}: combat and hit confirmation work in the central lane',page.evaluate('window.__arena.snapshot().actors[1].hp===191'))
     framed=[]
     for yaw in [0,math.pi/2,math.pi,math.pi*1.5]:
      page.evaluate('(yaw)=>{window.__arena.reset();window.__arena.orbit(yaw,.32);window.__arena.advance(0)}',yaw)
      framed.append(all(.03<a['x']<.97 and 0<a['depth']<1 for a in stage(page)['fighters']))
     check(f'{id}: full camera orbit keeps both fighters framed',all(framed))
     # Perimeter cutaways are exercised away from each arena's solid furniture.
     right_z=-3.4 if id=='rayj-house' else 0;back_x=-5.4 if id=='rayj-house' else 5.2 if id in ['house-cup','cwo-rally'] else 0
     all_clear=True
     for side,player,rival,yaw in [('back',[back_x,7.2],[back_x,5],math.pi),('left',[8.6,0],[6.1,0],-math.pi/2),('front',[0,-7.1],[0,-5],0),('right',[-8.6,right_z],[-6.1,right_z],math.pi/2)]:
      page.evaluate('([a,b,yaw])=>{window.__arena.reset();window.__arena.teleport(0,...a);window.__arena.teleport(1,...b);window.__arena.orbit(yaw,.32);window.__arena.advance(0)}',[player,rival,yaw])
      page.wait_for_function('(side)=>window.__arena.stageInfo().cutaway[side]<.025',arg=side,timeout=15000)
      all_clear=all_clear and stage(page)['cutaway'][side]<.025
     check(f'{id}: all four camera-facing edges cut away near the perimeter',all_clear)
     setup(page)
     page.wait_for_function('window.__arena.ambienceInfo().paused')
    check('the five arenas have different actual geometry signatures',len(set(signatures))==5,signatures)
    select(page,'neon-street');baseline=stage(page)['resources']
    for _ in range(2):
     for id in IDS:select(page,id)
    select(page,'neon-street');after=stage(page)['resources']
    check('full stage tours release replaced meshes, materials and textures',baseline==after,{'before':baseline,'after':after})
    check('stage changes preserve the two fighter choices and one canvas',page.evaluate('window.__arena.rosterInfo().selected')==original and page.locator('canvas').count()==1)
    # Abort a required texture: the current stage must survive and be playable.
    page.route('**/stages/rayj-house/poster.webp',lambda route:route.abort())
    result=page.evaluate('window.__arena.selectStage("rayj-house")')
    check('failed loading preserves the previous renderer, physics and usable entry button',result is False and stage(page)['id']=='neon-street' and page.evaluate('window.__arena.snapshot().stageId')=='neon-street' and not page.locator('#start').is_disabled())
    page.unroute('**/stages/rayj-house/poster.webp');select(page,'rayj-house')
    check('a failed stage can be retried successfully',stage(page)['id']=='rayj-house')
    page.locator('#start').click();page.wait_for_function('window.__arena.ambienceInfo().ready>=2');page.locator('#game-menu').click();page.locator('#sound').click()
    check('sound toggle also mutes stage ambience',page.evaluate('window.__arena.ambienceInfo().muted'))
    page.locator('#sound').click();page.wait_for_function('window.__arena.ambienceInfo().paused')
    check('pause also suspends the ambience track',page.evaluate('window.__arena.ambienceInfo().paused'))
    page.locator('#resume').click();page.wait_for_function('!window.__arena.ambienceInfo().paused')
    check('resume restores the same ambience track',page.evaluate('window.__arena.ambienceInfo().id==="rayj-house"'))
   finally:context.close()
   context,page=open_page(browser,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
   try:
    for id in IDS:
     page.locator(f'button[data-stage="{id}"]').tap();page.wait_for_function('(id)=>window.__arena.stageInfo().id===id&&!document.querySelector("#start").disabled',arg=id,timeout=30000)
     page.locator('#start').tap();page.evaluate('window.__arena.advance(.3)')
     framed=[]
     for yaw in [0,math.pi/2,math.pi,math.pi*1.5]:
      page.evaluate('(yaw)=>{window.__arena.orbit(yaw,.3);window.__arena.advance(0)}',yaw);framed.append(all(.025<a['x']<.975 and .06<a['y']<.94 for a in stage(page)['fighters']))
     check(f'{id}: touch selection, portrait framing and controls remain usable',all(framed) and page.locator('#joystick').is_visible() and page.locator('#action-attack').is_visible())
     page.screenshot(path=str(OUT/f'world-{id}-mobile.png'));setup(page)
    page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(250)
    check('landscape exposes a compact native arena selector',page.locator('#stage-select').is_visible() and not page.locator('.stage-grid').is_visible())
    page.locator('#stage-select').select_option('neon-street');page.wait_for_function('window.__arena.stageInfo().id==="neon-street"&&!document.querySelector("#start").disabled')
    check('landscape can choose a map without losing the enter button',page.locator('#start').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight'))
    page.screenshot(path=str(OUT/'world-selection-landscape.png'))
    page.locator('#start').tap();page.evaluate('window.__arena.advance(.3)');page.set_viewport_size({'width':320,'height':640});page.wait_for_timeout(250)
    check('compact pause control stays within 320px without a match navbar',not page.locator('.topbar').count() and page.locator('#game-menu').evaluate('(e)=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth'))
   finally:context.close()
  finally:browser.close()
 check('no uncaught JavaScript errors during world transitions',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Installed Chromium with software rendering. Actual stages, collision/combat, audio and desktop/mobile emulation; no physical-phone FPS claim.'}
 (OUT/'world-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
