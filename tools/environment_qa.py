"""Inspect enclosure and real rendered sky/interiors across all five arenas."""
from pathlib import Path
import json,math,os
from PIL import Image,ImageStat,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
IDS=['rayj-house','cwo-alley','house-cup','neon-street','cwo-rally']

def review_sheets():
 for filename,labels in [('environment-contact-sheet.jpg',['outside','up']),('architecture-contact-sheet.jpg',['shell','entrance'])]:
  sheet=Image.new('RGB',(1200,5*400),'#eee6ee');draw=ImageDraw.Draw(sheet)
  for row,id in enumerate(IDS):
   for col,label in enumerate(labels):
    with Image.open(OUT/f'environment-{id}-{label}.png') as im:
     im=im.convert('RGB');im.thumbnail((600,365));sheet.paste(im,(col*600,row*400))
    draw.text((col*600+14,row*400+377),id.upper()+' / '+label.upper(),fill='#644174')
  sheet.save(OUT/filename,quality=92)

def run():
 checks,errors,metrics=[],[],[]
 def check(name,passed,detail=None):
  checks.append({'name':name,'pass':bool(passed),'detail':detail});print(('PASS ' if passed else 'FAIL ')+name,flush=True)
 def capture(page,id,label,position,target):
  page.evaluate('([position,target])=>window.__arena.inspectEnvironment(position,target)',[position,target]);page.wait_for_timeout(120)
  path=OUT/f'environment-{id}-{label}.png';page.locator('#arena').screenshot(path=str(path));return path
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   context=browser.new_context(viewport={'width':1280,'height':800});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
    for id in IDS:
     assert page.evaluate('(id)=>window.__arena.selectStage(id)',id)
     page.locator('#start').click();page.evaluate('window.__arena.advance(.3)')
     info=page.evaluate('window.__arena.stageInfo()');metrics.append({'id':id,'geometry':info['geometry'],'environment':info['environment'],'batches':info['staticBatches']})
     check(f'{id}: complete sky, wide terrain and authored district surround the arena',info['environment']['enclosedSky'] and info['environment']['terrainExtent']>=300 and info['environment']['buildings']>=80 and info['environment']['trees']>=50,info['environment'])
     check(f'{id}: full environment stays below 128 material/zone groups',info['staticBatches']<128,info['staticBatches'])
     check(f'{id}: facade details cover the front, back and both sides',info['environment']['facadePanels']>=10 and all(n>0 for n in info['environment']['facadeSides'].values()),info['environment']['facadeSides'])
     check(f'{id}: architecture shares the venue depth while the district stays behind it',info['rendering']['architecturalGroups']==[1] and info['rendering']['backgroundGroups']==[0] and info['rendering']['venueDepthClear'],info['rendering'])
     # A dense set of actual ray intersections, including the zenith and directions behind the original drawing.
     directions=[]
     for elevation in [-1.3,-.55,0,.55,1.3]:
      for angle in range(12):
       yaw=angle*math.tau/12;directions.append([math.sin(yaw)*math.cos(elevation),math.sin(elevation),math.cos(yaw)*math.cos(elevation)])
     directions.extend([[0,1,0],[0,-1,0]])
     misses=[]
     for origin in [[0,2,0],[8,2,0],[0,18,-26]]:
      page.evaluate('(p)=>window.__arena.inspectEnvironment(p,[0,2,0.1])',origin)
      samples=page.evaluate('([p,dirs])=>window.__arena.environmentCoverage(p,dirs)',[origin,directions])
      misses.extend([{'origin':origin,'direction':directions[i]} for i,result in enumerate(samples) if not result['hit']])
     check(f'{id}: 186 rays find geometry or sky in every sampled direction',not misses,misses)
     # Actual game camera extremes, with 25 viewport rays at every heading/pitch.
     sweep=[];page.evaluate('window.__arena.inspectEnvironment(null);window.__arena.reset()')
     for heading in range(8):
      for pitch in [.04,1.22]:
       page.evaluate('([yaw,pitch])=>{window.__arena.orbit(yaw,pitch);window.__arena.advance(0)}',[heading*math.tau/8,pitch])
       samples=page.evaluate('window.__arena.viewportCoverage()');sweep.append({'yaw':heading,'pitch':pitch,'misses':sum(not s['hit'] for s in samples)})
     check(f'{id}: 360-degree low/overhead camera sweep has no sampled background holes',all(v['misses']==0 for v in sweep),sweep)
     style=page.add_style_tag(content='.topbar,.game-ui,.viewport-vignette{display:none!important}')
     up=capture(page,id,'up',[0,2,0],[0,30,.1]);up_hit=page.evaluate('window.__arena.environmentCoverage([0,2,0],[[0,1,0]])[0]')
     with Image.open(up) as image:variation=max(ImageStat.Stat(image.convert('RGB')).stddev)
     indoor=id in ['rayj-house','house-cup']
     check(f'{id}: looking upward renders a detailed '+('ceiling' if indoor else 'sky')+' instead of a flat clear color',variation>2.5 and up_hit['role']==('ceiling' if indoor else 'sky'),{'pixelDeviation':variation,'hit':up_hit})
     if indoor:
      check(f'{id}: indoor ceiling is visible from inside',page.evaluate('window.__arena.stageInfo().environment.roofCutaway')>.98)
      # Probe close to each boundary so an intervening roof beam cannot mask a hole.
      seams=page.evaluate('(y)=>[[[0,y,-8.2],[0,0,-1]],[[0,y,8.2],[0,0,1]],[[9.5,y,2],[1,0,0]],[[-9.5,y,2],[-1,0,0]]].map(([p,d])=>window.__arena.environmentCoverage(p,[d])[0])',5.85 if id=='rayj-house' else 8.25)
      check(f'{id}: ceiling joins all four walls without a sky gap',all(s['hit'] and s['group']==1 and s['role']!='sky' and s['distance']<1.5 for s in seams),seams)
      rays=[[3.5,0,-8.43]] if id=='rayj-house' else [[1.25,0,-8.7]]
      door=page.evaluate('(rays)=>window.__arena.environmentCoverage([0,2,0],rays)',rays)
      check(f'{id}: doorway is in front of its wall and shares the architecture depth',all(s['hit'] and s['group']==1 and s['role']=='details' for s in door),door)
     capture(page,id,'outside',[0,18,-26],[0,4,0])
     if indoor:check(f'{id}: overhead tour reveals the arena with a deliberate roof cutaway',page.evaluate('window.__arena.stageInfo().environment.roofCutaway')<.02)
     capture(page,id,'horizon',[0,3,0],[20,14,0]);capture(page,id,'reverse',[0,4,0],[0,7,-30])
     capture(page,id,'entrance',[0,2.5,1],[0,3,-8.6])
     page.evaluate('window.__arena.inspectEnvironment([22,17,-26],[0,4,0],false)');page.locator('#arena').screenshot(path=str(OUT/f'environment-{id}-shell.png'))
     page.evaluate('window.__arena.inspectEnvironment(null)');style.evaluate('(e)=>e.remove()');page.locator('#game-menu').click();page.locator('#pause-fighters').click();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
    # Identical final environment after repeated switching must release its old panorama and geometry.
    assert page.evaluate('window.__arena.selectStage("cwo-alley")');before=page.evaluate('window.__arena.stageInfo().resources')
    for id in ['rayj-house','house-cup','neon-street','cwo-rally','cwo-alley']:assert page.evaluate('(id)=>window.__arena.selectStage(id)',id)
    after=page.evaluate('window.__arena.stageInfo().resources')
    check('switching environments releases old sky textures, geometry and materials',before==after,{'before':before,'after':after})
   finally:context.close()
   context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce');page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('[data-play="training"]').tap();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
    for id in IDS:
     assert page.evaluate('(id)=>window.__arena.selectStage(id)',id);page.locator('#start').tap();page.evaluate('window.__arena.advance(.3)')
     samples=[]
     for yaw in [0,math.pi/2,math.pi,3*math.pi/2]:
      page.evaluate('(yaw)=>{window.__arena.orbit(yaw,1.22);window.__arena.advance(0)}',yaw);samples+=page.evaluate('window.__arena.viewportCoverage()')
     check(f'{id}: portrait overhead framing remains enclosed with reduced motion',all(s['hit'] for s in samples))
     page.screenshot(path=str(OUT/f'environment-{id}-mobile.png'))
     page.evaluate('window.__arena.reset();window.__arena.teleport(0,-7.7,0);window.__arena.teleport(1,7.7,0)')
     distant=[]
     for yaw in [0,math.pi/2,math.pi,3*math.pi/2]:
      page.evaluate('(yaw)=>{window.__arena.orbit(yaw,.1);window.__arena.advance(0)}',yaw)
      info=page.evaluate('window.__arena.stageInfo()');distant.append(info)
     check(f'{id}: district renders behind the fighting venue and both distant fighters',all(info['rendering']['backgroundGroups']==[0] and info['rendering']['fighterGroups']==[[1],[1]] and info['rendering']['venueDepthClear'] for info in distant))
     check(f'{id}: far portrait camera cuts away foreground buildings and preserves framing',any(info['environment']['foregroundCutaway'] for info in distant) and all(.02<a['x']<.98 and .15<a['y']<.86 and 0<a['depth']<1 for info in distant for a in info['fighters']),[{'camera':info['camera'],'cutaway':info['environment']['foregroundCutaway'],'fighters':info['fighters']} for info in distant])
     page.evaluate('window.__arena.orbit(0,.1);window.__arena.advance(0)');page.screenshot(path=str(OUT/f'environment-{id}-far-apart.png'))
     page.locator('#game-menu').tap();page.locator('#pause-fighters').tap();page.wait_for_function('window.__arena.showcaseInfo().mode==="setup"')
   finally:context.close()
  finally:browser.close()
 check('no uncaught JavaScript errors while inspecting environments',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'metrics':metrics,'scope':'Installed Chromium/SwiftShader. Actual rendered ceilings, skies and outer districts; sampled ray/viewport coverage and mobile emulation, not a physical-device performance benchmark.'}
 (OUT/'environment-report.json').write_text(json.dumps(report,indent=2)+'\n');review_sheets();print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)

if __name__=='__main__':run()
