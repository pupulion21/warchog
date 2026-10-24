"""Real keyboard, mouse and touch acceptance for the match control layout."""
from pathlib import Path
import json,math,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))

def run():
 checks,errors=[],[]
 def check(name,value,detail=None):
  checks.append({'name':name,'pass':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 def snap(page):return page.evaluate('window.__arena.snapshot()')
 def cam(page):return page.evaluate('window.__arena.cameraInfo()')
 def reset(page):page.evaluate('window.__arena.reset();window.__arena.setMode("idle");window.__arena.advance(0)');page.locator('#arena').focus()
 def settle(page):page.wait_for_function('(()=>{const c=window.__arena.cameraInfo();return Math.abs(c.pitch-c.targetPitch)<.03&&Math.abs(c.yaw-c.targetYaw)<.03})()',timeout=15000)
 def open_page(browser,width,height,touch=False):
  context=browser.new_context(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').click();page.locator('#start').click();page.evaluate('window.__arena.advance(.3)');return context,page
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   context,page=open_page(browser,1440,900)
   try:
    check('match has no navigation header, centered orbit toolbar or Training overlays',not page.locator('.topbar').count() and all(not page.locator(s).is_visible() for s in ['.camera-controls','.training-tools','#reset','#roster-toggle']))
    check('health and all right-hand action labels remain visible',all(page.locator(s).is_visible() for s in ['.fight-hud','#action-attack','#action-skill','#action-stomp','#action-dodge','#action-jump']) and [page.locator(s+' kbd').inner_text() for s in ['#action-attack','#action-skill','#action-stomp','#action-dodge','#action-jump']]==['U','I','O','J','K'])
    for key,axis,sign in [('w','z',1),('s','z',-1),('a','x',1),('d','x',-1)]:
     reset(page);page.evaluate('window.__arena.orbit(0,.24);window.__arena.advance(0)');before=snap(page)['actors'][0];page.keyboard.down(key);page.evaluate('window.__arena.advanceControls(.3)');page.keyboard.up(key);after=snap(page)['actors'][0]
     check(f'{key.upper()} moves in its camera-relative direction',(after[axis]-before[axis])*sign>.6)
    reset(page);page.keyboard.down('w');page.evaluate('window.__arena.advanceControls(.25)');walk=snap(page)['actors'][0]['speed'];page.keyboard.down('Shift');page.evaluate('window.__arena.advanceControls(.25)');run=snap(page)['actors'][0]['speed'];page.keyboard.up('Shift');page.keyboard.up('w');check('Shift runs while WASD remains on the left hand',run>walk+1)
    reset(page);page.evaluate('window.__arena.teleport(0,0,.5)');page.keyboard.press('u');page.evaluate('window.__arena.advanceControls(.45)');check('U performs one basic hit',snap(page)['actors'][1]['hp']==191)
    reset(page);page.keyboard.press('i');page.evaluate('window.__arena.advanceControls(.7)');check('I launches the ranged skill and starts its cooldown',snap(page)['actors'][1]['hp']==182 and snap(page)['actors'][0]['skillCooldown']>0)
    reset(page);page.evaluate('window.__arena.teleport(0,0,.5)');page.keyboard.press('o');page.evaluate('window.__arena.advanceControls(.6)');check('O performs the heavy knockdown skill',snap(page)['actors'][1]['hp']==172 and snap(page)['actors'][1]['state']=='down')
    reset(page);page.keyboard.press('j');page.evaluate('window.__arena.advanceControls(.1)');check('J dodges without triggering the old J attack',snap(page)['actors'][0]['action']['kind']=='dodge' and snap(page)['actors'][1]['hp']==200)
    for key in ['k','Space']:
     reset(page);page.keyboard.press(key);page.evaluate('window.__arena.advanceControls(.15)');check(f'{key} jumps without spending the ranged-skill cooldown',snap(page)['actors'][0]['y']>.2 and snap(page)['actors'][0]['skillCooldown']==0)
    reset(page);page.keyboard.press('p');off=snap(page)['lockOn'];page.keyboard.press('p');check('P toggles target lock independently of attacks',not off and snap(page)['lockOn'])
    reset(page);page.evaluate('window.__arena.teleport(0,0,.5)');page.keyboard.down('w');page.keyboard.press('u');page.evaluate('window.__arena.advanceControls(.2)');page.keyboard.up('w');check('left-hand movement and right-hand attack work together',snap(page)['hits']==1 and snap(page)['actors'][0]['z']>.5)
    reset(page);page.evaluate('window.__arena.manual(false)');page.keyboard.down('w');page.keyboard.press('Escape');tick=snap(page)['tick'];page.keyboard.press('u');page.wait_for_timeout(150);check('Esc opens pause and blocks movement and attack simulation',page.locator('#pause-dialog').is_visible() and snap(page)['tick']==tick)
    page.keyboard.up('w');page.keyboard.press('Escape');page.evaluate('window.__arena.advanceControls(.3)');check('Esc resumes without a stuck movement key',not page.locator('#pause-dialog').is_visible() and snap(page)['actors'][0]['speed']<.01)
    page.keyboard.down('Escape');page.keyboard.down('Escape');check('holding Esc does not bounce between pause and play',page.locator('#pause-dialog').is_visible());page.keyboard.up('Escape')
    check('camera, sound, fullscreen and Training are available in pause',all(page.locator(s).is_visible() for s in ['#camera-mode','#camera-reset','#sound','#fullscreen','#training-toggle']))
    page.locator('#game-help').click();check('Controls opens above pause with the new bindings',page.locator('#help-dialog').is_visible() and 'U / I / O' in page.locator('#help-dialog').inner_text());page.keyboard.press('Escape');page.wait_for_function('!document.querySelector("#help-dialog").open&&document.querySelector("#pause-dialog").contains(document.activeElement)');check('closing Controls returns focus to the paused menu',page.locator('#pause-dialog').is_visible())
    page.locator('#sound').click();check('sound toggle in pause updates its label and mute state',page.locator('#sound').get_attribute('aria-label')=='Enable sound' and page.evaluate('window.__arena.ambienceInfo().muted'));page.locator('#sound').click()
    page.locator('#training-toggle').click();check('Training tools expand inside pause',page.locator('#training-panel').is_visible() and page.locator('#pause-dialog #training-panel').count()==1)
    page.locator('#roster-toggle').click();page.wait_for_function('window.__arena.rosterInfo().preview.ready');page.keyboard.press('Escape');check('preview opened from Training returns to the paused game',page.locator('#pause-dialog').is_visible() and not page.locator('#fighter-dialog').is_visible());page.locator('#panel-close').click();page.locator('#resume').click()
    page.keyboard.press('Escape');page.evaluate('document.querySelector("#resume").click();document.querySelector("#arena").dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW",bubbles:true}))');page.wait_for_timeout(100);page.evaluate('window.__arena.advanceControls(.2)');check('the first movement key after Resume survives its queued close event',snap(page)['actors'][0]['speed']>1);page.keyboard.up('w')
    reset(page);page.mouse.move(720,640);page.mouse.down();page.mouse.move(720,140,steps=12);page.mouse.up();settle(page);info=cam(page);check('upward mouse drag looks above the horizon while the camera stays above ground',info['pitch']<-.5 and info['target'][1]>info['position'][1]+3 and info['position'][1]>=1.5,info);page.screenshot(path=str(OUT/'controls-look-up.png'))
    page.keyboard.press('c');settle(page);info=cam(page);check('C restores combat framing after looking at the sky',abs(info['pitch']-.24)<.03 and info['target'][1]<info['position'][1]);page.screenshot(path=str(OUT/'controls-match-desktop.png'))
    page.keyboard.press('Escape');page.locator('#camera-mode').click();check('Follow can be enabled from pause',cam(page)['mode']=='follow');page.locator('#resume').click();page.mouse.move(720,440);page.mouse.down();page.mouse.move(620,440,steps=6);page.mouse.up();settle(page);check('manual camera drag interrupts Follow',cam(page)['mode']=='orbit')
    page.locator('#game-menu').click();page.screenshot(path=str(OUT/'controls-pause-desktop.png'));page.locator('#pause-fighters').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
    for id in ['rayj-house','house-cup','neon-street','cwo-rally','cwo-alley']:
     assert page.evaluate('(id)=>window.__arena.selectStage(id)',id);page.locator('#start').click();page.evaluate('window.__arena.orbit(-.52,-.68);window.__arena.advance(0)');info=cam(page)
     check(f'{id}: upward camera has an enclosed view',info['target'][1]>info['position'][1]+3 and all(s['hit'] for s in page.evaluate('window.__arena.viewportCoverage()')))
     page.locator('#game-menu').click();page.locator('#pause-fighters').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
   finally:context.close()
   for width,height in [(390,844),(320,640),(844,390)]:
    context,page=open_page(browser,width,height,True)
    try:
     page.wait_for_timeout(1900);page.screenshot(path=str(OUT/f'controls-touch-{width}.png'))
     boxes={s:page.locator(s).bounding_box() for s in ['#game-menu','#action-attack','#action-skill','#action-stomp','#action-dodge','.mobile-jump','#joystick']}
     check(f'{width}px touch: all controls have room inside the viewport',all(v and v['x']>=0 and v['y']>=0 and v['x']+v['width']<=width+1 and v['y']+v['height']<=height+1 and v['width']>=44 and v['height']>=44 for v in boxes.values()),boxes)
     page.locator('.mobile-jump').tap();page.evaluate('window.__arena.advanceControls(.12)');check(f'{width}px touch: jump button still works',snap(page)['actors'][0]['y']>.1)
     page.locator('#game-menu').tap();page.locator('#training-toggle').tap();page.locator('#roster-toggle').scroll_into_view_if_needed();close=page.locator('#pause-close').bounding_box();check(f'{width}px touch: resume stays reachable after scrolling Training settings',close and 0<=close['y'] and close['y']+close['height']<=height)
     page.locator('#pause-close').tap();check(f'{width}px touch: close resumes the arena without its settings',not page.locator('#pause-dialog').is_visible() and not page.locator('.camera-controls').is_visible())
     page.locator('#game-menu').tap();page.screenshot(path=str(OUT/f'controls-touch-{width}-pause.png'))
     check(f'{width}px touch: pause scrolls without horizontal overflow',page.locator('#pause-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    finally:context.close()
  finally:browser.close()
 check('no JavaScript errors in the revised control flows',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'url':URL,'scope':'Installed Chromium/SwiftShader. Actual keys, mouse and touch controls with desktop/mobile emulation; not a physical-device performance benchmark.'}
 (OUT/'controls-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)

if __name__=='__main__':run()
