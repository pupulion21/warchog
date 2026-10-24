"""Verify live GLB presentation, rotation, tentative picks and the single-renderer lifecycle."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation'
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))


def run():
    checks,errors=[],[]
    def check(name,passed,detail=None):
        checks.append({'name':name,'pass':bool(passed),'detail':detail});print(('PASS ' if passed else 'FAIL ')+name,flush=True)
    def info(page):return page.evaluate('window.__arena.showcaseInfo()')
    def roster(page):return page.evaluate('window.__arena.rosterInfo()')
    def wait_preview(page,id=None):
        page.wait_for_function('(id)=>window.__arena.rosterInfo().open&&window.__arena.rosterInfo().preview.ready&&(!id||window.__arena.rosterInfo().preview.id===id)',arg=id,timeout=30000)
    def open_page(browser,**kwargs):
        context=browser.new_context(**kwargs);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000)
        page.wait_for_function('window.__arena.showcaseInfo().parent==="home-stage"');return context,page
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
        try:
            context,page=open_page(browser,viewport={'width':1440,'height':900})
            try:
                page.evaluate('window.__qaCanvas=document.querySelector("#arena")')
                snap=page.evaluate('window.__arena.snapshot()')
                check('home contains a live scene with two rigged fighters',info(page)['parent']=='home-stage' and all(a['ready'] and a['bones']==24 and a['motion']['targets']>0 for a in snap['assets']))
                time=info(page)['time'];page.wait_for_function('(t)=>window.__arena.showcaseInfo().time>t+.12',arg=time)
                check('home idle animations advance while combat remains stopped',page.evaluate('window.__arena.snapshot().tick')==0)
                page.screenshot(path=str(OUT/'showcase-home-desktop.png'))
                box=page.locator('#arena').bounding_box();before=info(page)['modelYaws'][0]
                x=box['x']+box['width']*.55;y=box['y']+box['height']*.5
                page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+150,y,steps=8);page.mouse.up()
                page.wait_for_function('(yaw)=>Math.abs(window.__arena.showcaseInfo().modelYaws[0]-yaw)>.9',arg=before)
                check('drag turns actual fighter roots and releases pointer capture',info(page)['pointer'] is None)
                page.screenshot(path=str(OUT/'showcase-home-turned.png'))
                page.locator('.home-showcase [data-showcase-reset]').click();page.wait_for_function('Math.abs(window.__arena.showcaseInfo().yaw-.18)<.03')
                check('home has a working reset-view control',abs(info(page)['yaw']-.18)<.03)
                page.locator('[data-play="training"]').click();page.wait_for_function('window.__arena.showcaseInfo().parent==="setup-stage"')
                check('setup reuses the exact canvas for a two-fighter 3D lineup',page.evaluate('document.querySelector("#arena")===window.__qaCanvas') and len(info(page)['modelYaws'])==2)
                page.screenshot(path=str(OUT/'showcase-setup-desktop.png'))
                page.locator('[data-pick-seat="0"]').click();wait_preview(page)
                page.wait_for_function('window.__arena.showcaseInfo().parent==="roster-stage"')
                check('native picker receives the same canvas and a third independent 24-joint preview rig',info(page)['parent']=='roster-stage' and roster(page)['preview']['bones']==24 and roster(page)['resources']['skeletons']==3 and page.evaluate('document.querySelector("#arena")===window.__qaCanvas'))
                before_selected=roster(page)['selected'];page.locator('[data-fighter="cookie"]').click();wait_preview(page,'cookie')
                check('browsing previews a candidate without changing either active fighter',roster(page)['selected']==before_selected and not page.locator('#roster-confirm').is_disabled())
                yaw=info(page)['targetYaw'];page.locator('.roster-showcase [data-showcase-turn="1"]').click()
                page.wait_for_function('(yaw)=>window.__arena.showcaseInfo().targetYaw>yaw+.4',arg=yaw)
                check('picker rotation controls act on the live candidate',info(page)['targetYaw']>yaw+.4)
                page.screenshot(path=str(OUT/'showcase-picker-desktop.png'))
                page.keyboard.press('Escape');page.wait_for_function('window.__arena.rosterInfo().resources.skeletons===2')
                check('cancelling disposes the preview rig and preserves the picks',roster(page)['selected']==before_selected and not roster(page)['open'])
                page.locator('#start').click();page.evaluate('window.__arena.advance(.3);window.__arena.hit(0,14)')
                check('entering combat restores the full-size game canvas',info(page)['parent']=='app' and page.locator('#arena').bounding_box()['width']==1440)
                hp=page.evaluate('window.__arena.snapshot().actors[0].hp');page.locator('#arena').focus();page.keyboard.press('f');wait_preview(page)
                page.locator('[data-fighter="rogue"]').click();wait_preview(page,'rogue');page.locator('#roster-close').click()
                page.wait_for_function('window.__arena.showcaseInfo().parent==="app"')
                check('cancelling an in-game preview preserves HP and the original fighters',page.evaluate('window.__arena.snapshot().actors[0].hp')==hp and roster(page)['selected']==before_selected)
                baseline=roster(page)['resources'];page.locator('#arena').focus();page.keyboard.press('f');wait_preview(page)
                # Many quick requests must resolve to the last candidate, never a stale loaded body.
                page.evaluate('for(const id of ["ping","tabsu","mamio","novee","cookie"])window.__arena.previewFighter(id)')
                wait_preview(page,'cookie')
                check('rapid browsing resolves to the newest candidate with at most three source bodies',roster(page)['containers']<=3 and roster(page)['preview']['bones']==24)
                page.locator('#roster-confirm').click();page.wait_for_function('!window.__arena.rosterInfo().open')
                check('Lock in commits the previewed fighter and updates the game HUD',roster(page)['selected'][0]=='cookie' and page.locator('#name-player').inner_text()=='COOKIE')
                page.locator('#arena').focus();page.keyboard.press('f');wait_preview(page)
                page.route('**/novee/novee.glb',lambda route:route.abort())
                page.locator('[data-fighter="novee"]').click()
                page.wait_for_function('!window.__arena.rosterInfo().preview.loading')
                check('failed model loading leaves confirmation disabled and the active fighter intact',not roster(page)['preview']['ready'] and page.locator('#roster-confirm').is_disabled() and roster(page)['selected'][0]=='cookie')
                page.unroute('**/novee/novee.glb');page.locator('[data-fighter="novee"]').click();wait_preview(page,'novee')
                check('a failed preview can be retried successfully',roster(page)['preview']['ready'])
                page.locator('#roster-close').click();page.wait_for_function('window.__arena.rosterInfo().resources.skeletons===2')
                # Warm and repeat an unchanged candidate: scene-owned resources must plateau.
                for _ in range(2):
                    page.locator('#arena').focus();page.keyboard.press('f');wait_preview(page);page.locator('[data-fighter="novee"]').click();wait_preview(page,'novee');page.locator('#roster-close').click();page.wait_for_function('window.__arena.rosterInfo().resources.skeletons===2')
                before=roster(page)['resources']
                for _ in range(3):
                    page.locator('#arena').focus();page.keyboard.press('f');wait_preview(page);page.locator('[data-fighter="novee"]').click();wait_preview(page,'novee');page.locator('#roster-close').click();page.wait_for_function('window.__arena.rosterInfo().resources.skeletons===2')
                check('opening and closing previews releases rigs, materials and textures without growth',before==roster(page)['resources'],{'before':before,'after':roster(page)['resources']})
                check('all presentations use one WebGL canvas',page.locator('canvas').count()==1 and info(page)['contexts']==1)
            finally:context.close()
            context,page=open_page(browser,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
            try:
                page.locator('[data-play="training"]').tap();page.locator('[data-pick-seat="0"]').tap();wait_preview(page)
                box=page.locator('#arena').bounding_box();x=box['x']+box['width']*.3;y=box['y']+box['height']*.45;before=info(page)['targetYaw'];cdp=context.new_cdp_session(page)
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+90,'y':y+2,'id':1}]})
                page.wait_for_function('(yaw)=>window.__arena.showcaseInfo().targetYaw>yaw+.6',arg=before)
                cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]});page.wait_for_function('window.__arena.showcaseInfo().pointer===null')
                check('mobile swipe turns the 3D preview and touch cancellation releases capture',info(page)['targetYaw']>before+.6)
                check('portrait preview and Lock in remain inside the native dialog',page.locator('#roster-confirm').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight') and page.locator('#fighter-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
                page.screenshot(path=str(OUT/'showcase-picker-mobile.png'))
                page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(300)
                check('landscape preview keeps the model canvas and confirmation visible',page.locator('#arena').bounding_box()['height']>70 and page.locator('#roster-confirm').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight'))
                page.screenshot(path=str(OUT/'showcase-picker-landscape.png'))
            finally:context.close()
            context,page=open_page(browser,viewport={'width':1280,'height':850},reduced_motion='reduce')
            try:
                page.wait_for_timeout(400);time=info(page)['time'];page.wait_for_timeout(400)
                check('reduced-motion preference freezes automatic menu motion',info(page)['reducedMotion'] and info(page)['time']==time)
                page.locator('[data-play="training"]').click();page.locator('[data-pick-seat="0"]').click();wait_preview(page)
                page.locator('[data-fighter="bigchog"]').click();wait_preview(page,'bigchog')
                before=info(page)['modelYaws'][0];page.locator('#arena').focus();page.keyboard.press('ArrowRight')
                page.wait_for_function('(yaw)=>Math.abs(window.__arena.showcaseInfo().modelYaws[0]-yaw)>.15',arg=before)
                check('reduced motion still paints newly selected models and keyboard rotation',roster(page)['preview']['bones']==24)
            finally:context.close()
        finally:browser.close()
    check('no uncaught JavaScript errors in showcase flows',not errors,errors)
    report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Installed Chromium with software rendering. Desktop, reduced motion, mobile touch/viewport emulation; no physical phone performance claim.'}
    (OUT/'showcase-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
    if report['status']!='PASS':raise SystemExit(1)

if __name__=='__main__':run()
