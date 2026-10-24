"""Read-only live testnet readiness/UI check. No injected wallet and no public transaction."""
from pathlib import Path
import json,os,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
checks=[]
def check(name,value):checks.append({'name':name,'pass':bool(value)});print(('PASS ' if value else 'FAIL ')+name,flush=True)
def run():
 errors=[];rpc_methods=[]
 with urllib.request.urlopen(URL+'/api/health',timeout=20) as r:health=json.load(r)
 check('live backend verifies the registered Monad testnet signer and enables entry',health['paidEntry'] and health['signerConfigured'] and health['chainId']==10143 and health['expectedSigner'].lower()=='0x2d59a037e968c5027f083c1a0ad9ab6c046b39a9')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   context=browser.new_context(viewport={'width':1440,'height':900});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   def request(req):
    if req.method=='POST':
     try:
      data=req.post_data_json
      if isinstance(data,dict) and 'method' in data:rpc_methods.append(data['method'])
     except Exception:pass
   page.on('request',request)
   page.goto(URL+'/?qa',wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000);page.locator('#menu-duels').click();page.wait_for_function('document.querySelector("#duel-join").disabled===false',timeout=25000)
   check('the live UI exposes the 1 test-USDC entry with the correct winner award',page.locator('#duel-entry').inner_text()=='1.00' and page.locator('#duel-prize').inner_text()=='1.90' and page.locator('#duel-fee').inner_text()=='0.10')
   page.screenshot(path=str(ROOT/'validation/payments-live-ready.png'))
   page.locator('#duel-join').click();check('paid setup requests the player wallet before any funding',page.locator('#paid-connect').is_visible() and page.locator('#paid-deposit').is_hidden() and not page.evaluate('Boolean(window.ethereum)'))
   check('readiness navigation sends no public transaction or signing request',not any(m in ['eth_sendTransaction','eth_sendRawTransaction','personal_sign','eth_signTypedData_v4'] for m in rpc_methods))
   check('read-only live readiness has no uncaught browser error',not errors)
   context.close()
  finally:browser.close()
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Actual Monad testnet configuration and local application UI. No wallet injected, no public transactions or result signatures requested.'}
 (ROOT/'validation/payments-live-ready-report.json').write_text(json.dumps(report,indent=2)+'\n')
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
