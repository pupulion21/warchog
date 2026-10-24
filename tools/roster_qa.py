"""Load every real roster GLB, exercise clip bindings and test the fighter picker."""
from pathlib import Path
import json
import math
import os
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation'
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))


def run():
    OUT.mkdir(exist_ok=True)
    checks,errors,forms=[],[],[]

    def check(name,passed,detail=None):
        checks.append({'name':name,'pass':bool(passed),'detail':detail})
        print(('PASS ' if passed else 'FAIL ')+name,flush=True)

    def open_page(browser,mobile=False):
        context=browser.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('response',lambda r:errors.append(f'HTTP {r.status} {r.url}') if r.status>=400 else None)
        page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000)
        page.locator('[data-play="training"]').click();page.locator('#start').click();page.evaluate('window.__arena.advance(.3)')
        return context,page

    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage'])
        try:
            context,page=open_page(browser)
            try:
                entries=page.evaluate('window.__arena.rosterInfo().entries')
                check('all 12 fighters and the extra Mamio form are ready',len(entries)==13 and all(c['ready'] for c in entries))
                page.evaluate('window.__arena.manual(false)');page.keyboard.press('f')
                check('F opens the native fighter dialog',page.locator('#fighter-dialog').evaluate('(d)=>d.open'))
                tick=page.evaluate('window.__arena.snapshot().tick');page.wait_for_timeout(450)
                check('fighter selection pauses combat',page.evaluate('window.__arena.snapshot().tick')==tick)
                page.evaluate('window.__arena.manual(true)')
                page.wait_for_function('Array.from(document.querySelectorAll(".fighter-card img")).every(i=>i.complete&&i.naturalWidth>0)')
                check('every fighter card has a loaded portrait and is selectable',page.locator('.fighter-card:not(:disabled)').count()==13)
                page.screenshot(path=str(OUT/'roster-desktop.png'))
                page.locator('[data-fighter="benja"]').click();page.wait_for_function('window.__arena.rosterInfo().preview.id==="benja"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click();page.wait_for_function('window.__arena.snapshot().assets[0].id==="benja"')
                check('picker loads Benja into the player slot and updates the HUD',page.locator('#name-player').inner_text()=='BENJA' and not page.locator('#fighter-dialog').evaluate('(d)=>d.open'))
                page.locator('#arena').focus();page.keyboard.press('f');page.locator('[data-roster-seat="1"]').click();page.locator('[data-fighter="toad"]').click();page.wait_for_function('window.__arena.rosterInfo().preview.id==="toad"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click()
                page.wait_for_function('window.__arena.snapshot().assets[1].id==="toad"')
                check('rival selection is independent from the player',page.evaluate('window.__arena.rosterInfo().selected')==['benja','toad'] and page.evaluate('window.__arena.snapshot().independentRigs'))

                page.set_viewport_size({'width':640,'height':720})
                style=page.add_style_tag(content='.topbar,.game-ui,.viewport-vignette{display:none!important}')
                page.mouse.move(400,350);page.mouse.wheel(0,-800);page.mouse.wheel(0,-800)
                page.wait_for_function('window.__arena.cameraInfo().zoom<4.1')
                for entry in entries:
                    fighter=entry['id']
                    page.evaluate('(id)=>window.__arena.selectFighter(0,id)',fighter)
                    page.evaluate('window.__arena.reset();window.__arena.teleport(0,0,0);window.__arena.teleport(1,8,-7)')
                    page.evaluate('document.querySelector("#lock-toggle").checked=false;document.querySelector("#lock-toggle").dispatchEvent(new Event("change"));window.__arena.orbit(Math.PI,.2);window.__arena.advance(.3)')
                    snapshot=page.evaluate('window.__arena.snapshot()');asset=snapshot['assets'][0]
                    prop=page.evaluate('window.__arena.visualInfo()[0].sign')
                    loaded=asset['id']==fighter and asset['ready'] and asset['bones']==24 and asset['motion']['targets']>0 and snapshot['independentRigs'] and prop['enabled']
                    check(f'{fighter}: independent rig, animated idle and character prop load',loaded,asset)
                    page.screenshot(path=str(OUT/f'roster-{fighter}.png'))
                    # Trigger gameplay states rather than selecting labels in an inspector.
                    page.evaluate('document.querySelector("#lock-toggle").checked=true;document.querySelector("#lock-toggle").dispatchEvent(new Event("change"));window.__arena.reset();window.__arena.teleport(0,0,.5);window.__arena.advance(.2,{x:0,z:0,attack:true})')
                    attack=page.evaluate('window.__arena.snapshot()')
                    attack_ok=attack['actors'][1]['hp']==191 and attack['assets'][0]['clip']=='attack1' and 'Left_Jab' in attack['assets'][0]['motion']['source']
                    page.evaluate('window.__arena.hit(0,14);window.__arena.advance(.1)')
                    hurt=page.evaluate('window.__arena.snapshot().assets[0]')
                    page.evaluate('window.__arena.advance(.6);window.__arena.hit(0,12,true);window.__arena.advance(.45)')
                    down=page.evaluate('window.__arena.snapshot().assets[0]')
                    page.evaluate('window.__arena.advance(.6)')
                    getup=page.evaluate('window.__arena.snapshot().assets[0]')
                    page.evaluate('window.__arena.advance(1.2);window.__arena.hit(0,500,true);window.__arena.advance(.2)')
                    ko=page.evaluate('window.__arena.snapshot().assets[0]')
                    states_ok=attack_ok and hurt['clip']=='hurt' and down['clip']=='down' and getup['clip']=='getup' and ko['clip']=='ko' and all(a['motion']['targets']>0 for a in [hurt,down,getup,ko])
                    check(f'{fighter}: attack, hurt, knockdown, get-up and KO bind to real clips',states_ok,{'attack':attack['assets'][0],'hurt':hurt,'down':down,'getup':getup,'ko':ko})
                    forms.append({'id':fighter,'loaded':loaded,'states':states_ok})
                style.evaluate('(s)=>s.remove()');page.set_viewport_size({'width':1440,'height':900})

                # Warm a fixed pair and repeat swaps: retained scene resources must plateau.
                for _ in range(2):
                    page.evaluate("window.__arena.selectFighter(0,'tabsu')");page.evaluate("window.__arena.selectFighter(0,'benja')")
                before=page.evaluate('window.__arena.rosterInfo()')
                for _ in range(5):
                    page.evaluate("window.__arena.selectFighter(0,'tabsu')");page.evaluate("window.__arena.selectFighter(0,'benja')")
                after=page.evaluate('window.__arena.rosterInfo()')
                check('repeated fighter swaps keep at most three cached bodies and release replaced rigs/materials/textures',before['resources']==after['resources'] and after['containers']<=3 and after['resources']['skeletons']==2,{'before':before['resources'],'after':after['resources']})
            finally:context.close()

            context,page=open_page(browser,True)
            try:
                page.locator('#arena').focus();page.keyboard.press('f');page.wait_for_function('document.querySelector("#fighter-dialog").open')
                page.wait_for_function('Array.from(document.querySelectorAll(".fighter-card img")).filter(i=>i.getBoundingClientRect().top<innerHeight).every(i=>i.complete&&i.naturalWidth>0)')
                page.screenshot(path=str(OUT/'roster-mobile.png'))
                name_visible=page.locator('[data-fighter="yot"] strong').evaluate('(e)=>{const r=e.getBoundingClientRect(),p=e.closest("button").getBoundingClientRect();return r.bottom<=p.bottom&&r.top>=p.top}')
                check('mobile fighter names fit their cards and the grid scrolls',name_visible and page.locator('#roster-grid').evaluate('(e)=>e.scrollHeight>e.clientHeight'))
                page.locator('[data-fighter="ping"]').tap();page.wait_for_function('window.__arena.rosterInfo().preview.id==="ping"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click();page.wait_for_function('window.__arena.snapshot().assets[0].id==="ping"')
                check('touch selection loads Ping and its long name fits the viewport',page.locator('#name-player').inner_text()=='PINGPINGPINGPING' and page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                page.locator('#arena').focus();page.keyboard.press('f');page.locator('[data-roster-seat="1"]').tap();page.locator('[data-fighter="cookie"]').tap();page.wait_for_function('window.__arena.rosterInfo().preview.id==="cookie"&&window.__arena.rosterInfo().preview.ready');page.locator('#roster-confirm').click()
                page.wait_for_function('window.__arena.snapshot().assets[1].id==="cookie"')
                check('touch can scroll to Cookie and select it for the rival',page.evaluate('window.__arena.rosterInfo().selected')==['ping','cookie'])
                page.set_viewport_size({'width':844,'height':390});page.locator('#arena').focus();page.keyboard.press('f')
                bounds=page.locator('#fighter-dialog').bounding_box();page.screenshot(path=str(OUT/'roster-mobile-landscape.png'))
                check('landscape picker remains within the viewport',bounds['x']>=0 and bounds['y']>=0 and bounds['y']+bounds['height']<=391)
                page.keyboard.press('Escape');check('Escape closes selection',not page.locator('#fighter-dialog').evaluate('(d)=>d.open'))
            finally:context.close()
        finally:browser.close()
    check('no roster JavaScript or HTTP errors',not errors,errors)
    contact=Image.new('RGB',(1024,4*320),'#f1e8dc');draw=ImageDraw.Draw(contact)
    for i,form in enumerate(forms):
        image=Image.open(OUT/f'roster-{form["id"]}.png').convert('RGB');image.thumbnail((256,288));x=(i%4)*256;y=(i//4)*320
        contact.paste(image,(x,y));draw.text((x+12,y+297),form['id'].upper(),fill='#493554')
    contact.save(OUT/'roster-contact-sheet.jpg',quality=93)
    report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'forms':forms,
            'scope':'Installed Chromium/SwiftShader. Actual asset import and animation bindings, UI, touch viewport emulation and resource cleanup; no physical-phone FPS claim.'}
    (OUT/'roster-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
    if report['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':run()
