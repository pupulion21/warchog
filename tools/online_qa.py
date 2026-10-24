"""Two real browsers against the actual authoritative server; no mocked gameplay transport."""
from pathlib import Path
import json,os,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
def run():
 checks,errors=[],[]
 def check(name,value,detail=None):checks.append({'name':name,'pass':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 def info(page):return page.evaluate('window.__arena.onlineInfo()')
 def current(page):return page.evaluate('window.__arena.snapshot()')
 def open_page(browser,width=1280,height=850,room=None,touch=False):
  ctx=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch)
  page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL+'/?qa'+('&room='+room if room else ''),wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000)
  if not room:page.locator('#menu-duels').click();page.locator('#duel-online').click()
  page.wait_for_function('document.querySelector("#setup-stage #arena")',timeout=10000)
  return ctx,page
 def pick(page,id):
  page.locator('[data-pick-seat="0"]').click();page.locator(f'[data-fighter="{id}"]').click();page.wait_for_function('(id)=>window.__arena.rosterInfo().preview.id===id&&window.__arena.rosterInfo().preview.ready',arg=id);page.locator('#roster-confirm').click();page.wait_for_function('!window.__arena.rosterInfo().busy');page.keyboard.press('Escape') if page.locator('#fighter-dialog').is_visible() else None
 def ready(page):
  page.wait_for_function('document.querySelector("#online-ready").disabled===false',timeout=30000);page.locator('#online-ready').click()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  contexts=[]
  try:
   ca,a=open_page(browser);contexts.append(ca)
   check('online setup reuses the actual 3D lineup and own-player picker',a.locator('#setup-stage #arena').is_visible() and a.locator('[data-pick-seat="0"]').is_enabled() and a.locator('[data-pick-seat="1"]').is_disabled())
   pick(a,'benja');a.locator('[data-stage="neon-street"]').click();a.wait_for_function('window.__arena.stageInfo().id==="neon-street"')
   a.locator('#online-create').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');code=info(a)['room']['code']
   check('host creates a real private room with a six-character code',len(code)==6 and info(a)['room']['seat']==0)
   a.screenshot(path=str(OUT/'online-room-host.png'))
   cb,b=open_page(browser,390,844,code,True);contexts.append(cb)
   check('invite link opens free online setup directly on a phone viewport',b.locator('#online-code').input_value()==code and b.locator('#online-setup').is_visible())
   pick(b,'cookie');b.locator('#online-join').click();b.wait_for_function('window.__arena.onlineInfo().room?.players[1]');a.wait_for_function('window.__arena.onlineInfo().room?.players[1]')
   b.wait_for_function('window.__arena.rosterInfo().selected[1]==="benja"');a.wait_for_function('window.__arena.rosterInfo().selected[1]==="cookie"')
   check('both peers load the same host map and the correct independent fighter order',info(b)['room']['stage']=='neon-street' and b.evaluate('window.__arena.rosterInfo().selected')==['cookie','benja'] and a.evaluate('window.__arena.rosterInfo().selected')==['benja','cookie'])
   check('guest cannot change the host arena',b.locator('[data-stage="house-cup"]').is_disabled())
   b.screenshot(path=str(OUT/'online-room-phone.png'))
   ready(a);ready(b);a.wait_for_function('window.__arena.menuInfo().started&&window.__arena.onlineInfo().room.phase==="playing"',timeout=12000);b.wait_for_function('window.__arena.menuInfo().started&&window.__arena.onlineInfo().room.phase==="playing"',timeout=12000)
   check('both browsers start one real server match with the CPU disabled',info(a)['room']['code']==info(b)['room']['code'] and a.evaluate('window.__arena.menuInfo().mode')=='online' and b.evaluate('window.__arena.menuInfo().mode')=='online')
   check('server round timer stays visible beside pause on desktop and phone',a.locator('#round-mark').is_visible() and b.locator('#round-mark').is_visible() and ':' in b.locator('#round-mark').inner_text())
   a.locator('#arena').focus();a.keyboard.down('w');a.wait_for_timeout(350);a.keyboard.up('w');a.keyboard.press('i');a.wait_for_function('window.__arena.snapshot().actors[1].hp<200',timeout=8000);b.wait_for_function('window.__arena.snapshot().actors[0].hp<200',timeout=8000)
   health_a=current(a)['actors'];health_b=current(b)['actors']
   check('server-confirmed ranged hit reduces the same rival HP in both browsers',health_a[1]['hp']<200 and health_b[0]['hp']==health_a[1]['hp'],[health_a[1]['hp'],health_b[0]['hp']])
   check('the second seat sees its own fighter as player one in HUD and camera',b.locator('#name-player').inner_text()=='COOKIE' and b.locator('#round-mode').inner_text()=='FREE ONLINE')
   a.keyboard.press('Escape');before=current(a)['tick'];a.wait_for_timeout(300)
   check('Esc opens settings while authoritative online play continues',a.locator('#pause-dialog').is_visible() and current(a)['tick']>before and 'KEEPS GOING' in a.locator('#pause-title').inner_text())
   check('online pause cannot locally restart or replace a rival',a.locator('#pause-restart').is_hidden() and a.locator('#pause-fighters').is_hidden());a.keyboard.press('Escape')
   b.reload(wait_until='networkidle');b.wait_for_function('window.__arena?.ready',timeout=45000)
   # The invite screen can restore the cookie-bound in-flight match.
   b.wait_for_function('window.__arena.menuInfo().started',timeout=25000)
   check('reload reconnects the same second player rather than creating a third seat',info(b)['room']['code']==code and info(b)['room']['seat']==1 and info(b)['room']['players'][1]['fighter']=='cookie')
   a.wait_for_function('window.__arena.onlineInfo().room.phase==="playing"',timeout=10000)
   # A local diagnostic mutation cannot change the server result or the other peer.
   a.evaluate('window.__arena.hit(1,9999,true)');a.wait_for_timeout(350)
   check('client-side HP tampering is overwritten by server state and creates no result',current(a)['actors'][1]['hp']==current(b)['actors'][0]['hp'] and info(a)['room']['result'] is None)
   a.screenshot(path=str(OUT/'online-match-desktop.png'));b.screenshot(path=str(OUT/'online-match-phone.png'))
   # Finish through a real player leaving, not a QA-only outcome endpoint.
   b.locator('#game-menu').click();b.locator('#pause-home').click();a.wait_for_function('window.__arena.onlineInfo().room?.result?.outcome==="Forfeit"',timeout=10000)
   result=info(a)['room']['result'];check('leaving an active match produces a server-confirmed forfeit for the remaining player',result['winner']==0 and a.locator('#result-title').inner_text()=='YOU WIN!')
   check('free online results cannot be mistaken for contract awards','no entry fee or prize' in a.locator('#result-text').inner_text().lower() and 'NO PRIZE' in a.locator('#result-hint').inner_text())
   evidence=a.evaluate('async code=>{const r=await fetch(`/api/matches/${code}`);return {status:r.status,body:await r.json()}}',code)
   check('the match outcome and replay hash survive in the server database',evidence['status']==200 and evidence['body']['result']['replayHash']==result['replayHash'] and len(result['replayHash'])==66)
   check('server availability does not open paid entry without the configured contract signer',a.evaluate('async()=>{const h=await(await fetch("/api/health")).json();return h.online&&!h.paidEntry&&!h.signerConfigured}'))
   a.screenshot(path=str(OUT/'online-result.png'))
   a.locator('#result-reset').click();check('play another returns to online setup without resetting a completed match',a.locator('#online-setup').is_visible() and info(a)['room'] is None)
   # New matches via the public queue, isolated from the private room above.
   a.locator('#online-quick').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');newcode=info(a)['room']['code']
   b.locator('#menu-duels').click();b.locator('#duel-online').click();b.locator('#online-quick').click();b.wait_for_function('(code)=>window.__arena.onlineInfo().room?.code===code',arg=newcode)
   check('public matchmaking pairs two fresh requests into the same room',info(a)['room']['code']==info(b)['room']['code'] and newcode!=code)
   check('online setup fits a narrow phone without horizontal overflow',b.locator('#front-menu').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
   a.locator('#online-leave').click();b.locator('#online-leave').click()
  except Exception:
   for i,ctx in enumerate(contexts):
    for page in ctx.pages:
     try:page.screenshot(path=str(OUT/f'online-error-{i}.png'));print('ONLINE DIAGNOSTIC',i,page.locator('#online-status').inner_text(),page.evaluate('window.__arena?.onlineInfo()'),errors,flush=True)
     except Exception:pass
   raise
  finally:
   for ctx in contexts:ctx.close()
   browser.close()
 check('no uncaught browser errors in two-player online play',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Two isolated real browser sessions, real WebSocket server and SQLite. Chromium/SwiftShader, emulated phone viewport; free practice with no public-chain writes.'}
 (OUT/'online-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
