"""Real original escrow bytecode + two browsers + real local-wallet transactions. No public RPC writes."""
from pathlib import Path
import json,os,time,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ['CHOG_QA_URL'];RPC=os.environ['WARCHOG_TEST_RPC'];TOKEN=os.environ['WARCHOG_TEST_TOKEN'];ESCROW=os.environ['WARCHOG_TEST_ESCROW']
PLAYERS=json.loads(os.environ['WARCHOG_TEST_PLAYERS']);ADMIN=os.environ['WARCHOG_TEST_ADMIN'];TREASURY=os.environ['WARCHOG_TEST_TREASURY'];SELECTORS=json.loads(os.environ['WARCHOG_TEST_SELECTORS'])
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))
def rpc(method,params):
 req=urllib.request.Request(RPC,data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=10) as r:body=json.load(r)
 if 'error' in body:raise RuntimeError(body['error']['message'])
 return body['result']
def uint_call(to,data):return int(rpc('eth_call',[{'to':to,'data':data},'latest']),16)
def balance(address):return uint_call(TOKEN,'0x70a08231'+address[2:].rjust(64,'0'))
def credit(id,address):return uint_call(ESCROW,SELECTORS['credits']+id[2:]+address[2:].rjust(64,'0'))
def state(id):return int(rpc('eth_call',[{'to':ESCROW,'data':SELECTORS['getDuel']+id[2:]},'latest'])[2:66],16)
def configure(fail):
 data=SELECTORS['configure']+hex(int(fail))[2:].rjust(64,'0')+'0'*64
 tx=rpc('eth_sendTransaction',[{'from':ADMIN,'to':TOKEN,'data':data}])
 for _ in range(100):
  receipt=rpc('eth_getTransactionReceipt',[tx])
  if receipt:assert int(receipt['status'],16)==1;return
  time.sleep(.1)
 raise RuntimeError('Local mock-token configuration timed out.')
def pause_results(paused):
 tx=rpc('eth_sendTransaction',[{'from':ADMIN,'to':ESCROW,'data':SELECTORS['pauseResults' if paused else 'unpauseResults']}])
 for _ in range(100):
  receipt=rpc('eth_getTransactionReceipt',[tx])
  if receipt:assert int(receipt['status'],16)==1;return
  time.sleep(.1)
 raise RuntimeError('Local escrow pause change timed out.')

def run():
 assert RPC.startswith('http://127.0.0.1:') and int(rpc('eth_chainId',[]),16)==31337
 checks,errors=[],[]
 def check(name,value,detail=None):checks.append({'name':name,'pass':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 def info(page):return page.evaluate('window.__arena.onlineInfo()')
 def open_context(browser,seat,width=1280,height=900,room=None):
  ctx=browser.new_context(viewport={'width':width,'height':height})
  init='''const rpcURL=RPC_URL,assigned=ASSIGNED;window.testWallet={calls:[],rejectNext:false};
   const local=async(method,params=[])=>{const r=await fetch(rpcURL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const b=await r.json();if(b.error)throw b.error;return b.result};
   window.ethereum={on:()=>{},removeListener:()=>{},request:async({method,params=[]})=>{testWallet.calls.push({method,selector:method==='eth_sendTransaction'?params[0]?.data?.slice(0,10):undefined});
    if(method==='eth_accounts'||method==='eth_requestAccounts')return[assigned];if(method==='eth_chainId')return'0x7a69';if(method==='wallet_switchEthereumChain')return null;
    if(method==='eth_sendTransaction'){if(testWallet.rejectNext){testWallet.rejectNext=false;throw{code:4001,message:'User rejected transaction'}};if(params[0].from.toLowerCase()!==assigned.toLowerCase())throw Error('Wrong local account');return local(method,params);}
    if(method==='personal_sign')return local(method,params);throw Error('Unexpected local wallet method '+method);}};'''.replace('RPC_URL',json.dumps(RPC)).replace('ASSIGNED',json.dumps(PLAYERS[seat]))
  ctx.add_init_script(init);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL+'/?qa'+('&room='+room+'&mode=paid' if room else ''),wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000)
  if not room:
   page.locator('#menu-duels').click();page.wait_for_function('document.querySelector("#duel-join").disabled===false',timeout=20000);page.locator('#duel-join').click()
  page.wait_for_function('document.querySelector("#paid-panel").hidden===false')
  return ctx,page
 def connect(page):
  page.locator('#paid-connect').click();page.wait_for_function('document.querySelector("#paid-wallet").textContent.includes("SIGNED IN")',timeout=20000)
 def lock(page):page.wait_for_function('document.querySelector("#online-ready").disabled===false',timeout=20000);page.locator('#online-ready').click()
 def approve(page):page.wait_for_function('!document.querySelector("#paid-approve").hidden',timeout=15000);page.locator('#paid-approve').click();page.wait_for_function('!document.querySelector("#paid-deposit").hidden&&!document.querySelector("#paid-deposit").disabled',timeout=20000)
 def deposit(page,mask):
  page.locator('#paid-deposit').click();page.wait_for_function('(mask)=>window.__arena.onlineInfo().room?.paid?.fundedMask===mask',arg=mask,timeout=20000)
 def submit(page):page.wait_for_function('!document.querySelector("#paid-submit").hidden&&!document.querySelector("#paid-submit").disabled',timeout=20000);page.locator('#paid-submit').click()
 def claim(page):page.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")?.disabled===false',timeout=20000);page.locator('[data-paid-recovery="withdrawFor"]').click();page.wait_for_function('document.querySelector("#paid-status").textContent.includes("Claim confirmed")&&!document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=20000)
 contexts=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   ca,a=open_context(browser,0);contexts.append(ca);connect(a);a.locator('#online-create').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');code=info(a)['room']['code']
   cb,b=open_context(browser,1,390,844,code);contexts.append(cb);connect(b);b.locator('#online-join').click();b.wait_for_function('window.__arena.onlineInfo().room?.players[1]');a.wait_for_function('window.__arena.onlineInfo().room?.players[1]')
   check('two actual local wallets authenticate and enter a prize room',info(a)['room']['mode']=='paid' and info(b)['room']['mode']=='paid' and all(p['wallet'] for p in info(a)['room']['players']))
   lock(a);lock(b);a.wait_for_function('window.__arena.onlineInfo().room?.paid?.recordId',timeout=20000);b.wait_for_function('window.__arena.onlineInfo().room?.paid?.recordId',timeout=20000)
   record=info(a)['room']['paid']['recordId'];check('server agrees one immutable record and terms for both wallets',record==info(b)['room']['paid']['recordId'] and state(record)==0 and info(a)['room']['phase']=='funding')
   a.screenshot(path=str(OUT/'paid-funding-desktop.png'));b.screenshot(path=str(OUT/'paid-funding-phone.png'))
   a.evaluate('testWallet.rejectNext=true');a.locator('#paid-approve').click();a.wait_for_function('document.querySelector("#paid-status").textContent.includes("declined")')
   check('rejecting approval collects no entry and starts no fight',state(record)==0 and balance(PLAYERS[0])==5_000_000 and not a.evaluate('window.__arena.menuInfo().started'))
   approve(a);deposit(a,1)
   check('first confirmed transaction creates Funding and receives exactly one entry',state(record)==1 and balance(PLAYERS[0])==4_000_000 and balance(ESCROW)==1_000_000)
   check('one funded seat cannot start the authoritative fight',not a.evaluate('window.__arena.menuInfo().started') and not b.evaluate('window.__arena.menuInfo().started'))
   approve(b);deposit(b,3);a.wait_for_function('window.__arena.onlineInfo().room?.phase==="playing"',timeout=12000);b.wait_for_function('window.__arena.menuInfo().started',timeout=12000)
   check('the second actual entry atomically activates the contract and starts play',state(record)==2 and balance(ESCROW)==2_000_000)
   a.locator('#arena').focus();a.keyboard.press('i');a.wait_for_function('window.__arena.snapshot().actors[1].hp<200',timeout=7000)
   a.wait_for_function('window.__arena.onlineInfo().room?.result',timeout=20000);b.wait_for_function('window.__arena.onlineInfo().room?.result',timeout=10000)
   check('server gameplay produces the real Finished result for the higher-HP player',info(a)['room']['result']['outcome']=='Finished' and info(a)['room']['result']['winner']==0)
   a.wait_for_function('window.__arena.onlineInfo().room?.paid?.stage==="result-ready"',timeout=15000)
   check('signed outcome alone does not transfer or allocate escrow funds',state(record)==2 and credit(record,PLAYERS[0])==0 and balance(ESCROW)==2_000_000)
   submit(a);a.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=20000)
   check('original Solidity accepts the signed result and allocates the exact 95/5 split',state(record)==3 and credit(record,PLAYERS[0])==1_900_000 and credit(record,TREASURY)==100_000 and credit(record,PLAYERS[1])==0)
   check('allocation stays separate from the actual winner transfer',balance(PLAYERS[0])==4_000_000 and balance(ESCROW)==2_000_000)
   configure(True);a.locator('[data-paid-recovery="withdrawFor"]').click();a.wait_for_function('document.querySelector("#paid-status").textContent.includes("reverted")||document.querySelector("#paid-status").textContent.includes("paused")',timeout=15000)
   check('a real token-transfer failure preserves claimable winner credit',credit(record,PLAYERS[0])==1_900_000 and balance(PLAYERS[0])==4_000_000)
   configure(False);claim(a)
   check('confirmed winner claim moves 1.90 USDC to the bound wallet exactly once',balance(PLAYERS[0])==5_900_000 and credit(record,PLAYERS[0])==0 and balance(ESCROW)==100_000)
   a.screenshot(path=str(OUT/'paid-settled-claimed.png'))
   check('the losing wallet never sees a winner claim action',b.locator('[data-paid-recovery="withdrawFor"]').count()==0)
   # A second match tests actual cancellation/refund, without fee or fake gameplay.
   a.locator('#result-reset').click();b.locator('#result-reset').click();a.locator('#online-create').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');second=info(a)['room']['code']
   b.locator('#online-code').fill(second);b.locator('#online-join').click();b.wait_for_function('window.__arena.onlineInfo().room?.code===document.querySelector("#online-code").value');a.wait_for_function('window.__arena.onlineInfo().room?.players[1]')
   lock(a);lock(b);a.wait_for_function('window.__arena.onlineInfo().room?.paid?.recordId',timeout=20000);second_id=info(a)['room']['paid']['recordId']
   approve(a);deposit(a,1);before=balance(PLAYERS[0]);pause_results(True);b.wait_for_function('document.querySelector("#paid-status").textContent.includes("paused")',timeout=15000)
   check('result pause blocks additional entry while keeping the sole-depositor cancel action',b.locator('#paid-approve').is_hidden() and a.locator('[data-paid-recovery="cancelFunding"]').count()==1)
   a.wait_for_function('document.querySelector("[data-paid-recovery=cancelFunding]")?.disabled===false',timeout=12000);a.locator('[data-paid-recovery="cancelFunding"]').click();a.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=15000)
   check('sole-depositor cancellation creates an exact refund credit without paying it out early',state(second_id)==4 and credit(second_id,PLAYERS[0])==1_000_000 and balance(PLAYERS[0])==before)
   claim(a);check('refund claim works during a pause, restores the full entry, and leaves treasury credit unchanged',balance(PLAYERS[0])==before+1_000_000 and credit(second_id,PLAYERS[0])==0 and credit(second_id,TREASURY)==0);pause_results(False)
   a.screenshot(path=str(OUT/'paid-refund-claimed.png'))
   # A fully funded, equal-HP timeout must settle as Void and refund both entries.
   a.locator('#online-leave').click();b.locator('#online-leave').click()
   a.locator('#online-create').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');third=info(a)['room']['code']
   b.locator('#online-code').fill(third);b.locator('#online-join').click();a.wait_for_function('window.__arena.onlineInfo().room?.players[1]');b.wait_for_function('window.__arena.onlineInfo().room?.players[1]')
   lock(a);lock(b);a.wait_for_function('window.__arena.onlineInfo().room?.paid?.recordId',timeout=20000);third_id=info(a)['room']['paid']['recordId']
   before_void=[balance(x) for x in PLAYERS];approve(a);deposit(a,1);approve(b);deposit(b,3)
   a.wait_for_function('window.__arena.onlineInfo().room?.result?.outcome==="Void"',timeout=25000);b.wait_for_function('window.__arena.onlineInfo().room?.result',timeout=10000)
   submit(a);a.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=20000);b.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=20000)
   check('a server-confirmed Void is accepted by Solidity and refunds both paid seats without a fee',state(third_id)==4 and credit(third_id,PLAYERS[0])==1_000_000 and credit(third_id,PLAYERS[1])==1_000_000 and credit(third_id,TREASURY)==0)
   claim(a);claim(b);check('both Void refunds can be claimed independently to restore their entries',[balance(x) for x in PLAYERS]==before_void)
   # Forfeit proof survives leaving the room and can be resumed from private history.
   a.locator('#result-reset').click();b.locator('#result-reset').click()
   a.locator('#online-create').click();a.wait_for_function('window.__arena.onlineInfo().room?.code');fourth=info(a)['room']['code']
   b.locator('#online-code').fill(fourth);b.locator('#online-join').click();a.wait_for_function('window.__arena.onlineInfo().room?.players[1]');b.wait_for_function('window.__arena.onlineInfo().room?.players[1]')
   lock(a);lock(b);a.wait_for_function('window.__arena.onlineInfo().room?.paid?.recordId',timeout=20000);fourth_id=info(a)['room']['paid']['recordId']
   approve(a);deposit(a,1);approve(b);deposit(b,3);b.wait_for_function('window.__arena.menuInfo().started',timeout=15000)
   b.locator('#game-menu').click();b.locator('#pause-home').click();a.wait_for_function('window.__arena.onlineInfo().room?.result?.outcome==="Forfeit"',timeout=12000);a.wait_for_function('window.__arena.onlineInfo().room?.paid?.stage==="result-ready"',timeout=15000)
   a.locator('#result-home').click();a.locator('#menu-duels').click();a.locator(f'[data-resume-paid="{fourth}"]').click();a.wait_for_function('document.querySelector("#online-status").textContent.includes("Saved prize duel")',timeout=10000)
   check('private history restores an unsettled paid record without collecting another entry',state(fourth_id)==2 and a.locator('#paid-deposit').is_hidden())
   submit(a);a.wait_for_function('document.querySelector("[data-paid-recovery=withdrawFor]")',timeout=20000)
   check('persisted Forfeit signature pays the same winner/treasury split as Finished',state(fourth_id)==3 and credit(fourth_id,PLAYERS[0])==1_900_000 and credit(fourth_id,TREASURY)==100_000)
   before_last_claim=balance(PLAYERS[0]);claim(a);check('a restored historical winner credit still transfers only to its bound wallet',balance(PLAYERS[0])==before_last_claim+1_900_000 and credit(fourth_id,PLAYERS[0])==0)
   a.screenshot(path=str(OUT/'paid-history-claimed.png'))
   # All writes came from user-facing buttons into the owned local EVM.
   check('wallet interaction used personal login signatures and explicit transaction requests',all(any(x['method']=='personal_sign' for x in page.evaluate('testWallet.calls')) for page in [a,b]))
  except Exception:
   for index,ctx in enumerate(contexts):
    for page in ctx.pages:
     try:page.screenshot(path=str(OUT/f'paid-error-{index}.png'));print('PAID DIAGNOSTIC',index,page.locator('#paid-status').inner_text(),page.evaluate('window.__arena?.onlineInfo()'),errors,flush=True)
     except Exception:pass
   raise
  finally:
   for ctx in contexts:ctx.close()
   browser.close()
 check('no uncaught JavaScript errors in real EVM payment flows',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Owned localhost Anvil chain 31337, original PaidDuelEscrowV2 bytecode, local MockUSDC, two real browsers with unlocked local EIP-1193 test accounts. Actual EVM receipts/balances/credits; no public-chain transactions or production signer use.'}
 (OUT/'paid-local-e2e-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
