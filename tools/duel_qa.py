"""Finite production UI acceptance. All chain/wallet writes are intercepted test doubles."""
from pathlib import Path
import json,os,subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
URL=os.environ.get('CHOG_QA_URL','http://127.0.0.1:5187')
CHROME=os.environ.get('CHOG_QA_CHROMIUM',str(Path.home()/'.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'))

def run():
 subprocess.run(['node','tools/build_duel_qa_fixtures.mjs'],cwd=ROOT,check=True)
 fixture=json.loads((ROOT/'.local/duel-qa-fixtures.json').read_text())
 checks,errors=[],[]
 def check(name,value,detail=None):
  checks.append({'name':name,'pass':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 def context(browser,width=1440,height=1000,touch=False,wallet=True,record=None):
  ctx=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch)
  state={'offline':False,'phase':'base','receipt':'success','calls':[]}
  page=ctx.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
  def rpc(route):
   body=route.request.post_data_json;method=body['method'];state['calls'].append(method)
   def respond(value):route.fulfill(json={'jsonrpc':'2.0','id':body['id'],'result':value},headers={'access-control-allow-origin':'*'})
   if state['offline']:
    route.fulfill(json={'jsonrpc':'2.0','id':body['id'],'error':{'code':-32000,'message':'Test-only simulated RPC outage'}});return
   if method=='eth_chainId':respond('0x279f')
   elif method=='eth_blockNumber':respond('0x100000')
   elif method in ['eth_getBlockByNumber','eth_getBlockByHash']:
    respond({'number':'0x100000','timestamp':hex(1700000000),'hash':'0x'+'1'*64,'parentHash':'0x'+'0'*64,'transactions':[],'gasLimit':'0x1000000','gasUsed':'0x0','baseFeePerGas':'0x1','extraData':'0x','miner':fixture['a'],'size':'0x100','difficulty':'0x0','totalDifficulty':'0x0','nonce':'0x0000000000000000','logsBloom':'0x'+'0'*512,'receiptsRoot':'0x'+'0'*64,'stateRoot':'0x'+'0'*64,'transactionsRoot':'0x'+'0'*64,'sha3Uncles':'0x'+'0'*64,'uncles':[]})
   elif method=='eth_call':
    data=body['params'][0]['data'].lower();value=fixture['responses'][state['phase']].get(data)
    if value is None:errors.append('Unrecognized test RPC calldata '+data[:18]);route.fulfill(json={'jsonrpc':'2.0','id':body['id'],'error':{'code':-32000,'message':'Unknown test call'}})
    else:respond(value)
   elif method=='eth_getTransactionReceipt':
    if state['receipt']=='success':state['phase']='refunded' if state['phase']=='base' else 'paid'
    respond({'transactionHash':'0x'+'4'*64,'transactionIndex':'0x0','blockHash':'0x'+'1'*64,'blockNumber':'0x100000','from':fixture['a'],'to':fixture['escrow'],'cumulativeGasUsed':'0x10000','gasUsed':'0x10000','effectiveGasPrice':'0x1','contractAddress':None,'logs':[],'logsBloom':'0x'+'0'*512,'status':'0x1' if state['receipt']=='success' else '0x0','type':'0x2'})
   else:errors.append('Unexpected test RPC method '+method);route.fulfill(json={'jsonrpc':'2.0','id':body['id'],'error':{'code':-32000,'message':'Unsupported test method'}})
  ctx.route('https://testnet-rpc.monad.xyz/**',rpc);ctx.route('https://rpc-testnet.monadinfra.com/**',rpc)
  if wallet:
   ctx.add_init_script('''window.mockWallet={account:ACCOUNT,network:'0x279f',calls:[],reject:false,events:{}};
    window.ethereum={on:(name,fn)=>(mockWallet.events[name]??=[]).push(fn),removeListener:(name,fn)=>{mockWallet.events[name]=(mockWallet.events[name]??[]).filter(x=>x!==fn)},request:async({method,params})=>{mockWallet.calls.push({method,params});if(method==='eth_requestAccounts'||method==='eth_accounts')return mockWallet.account?[mockWallet.account]:[];if(method==='eth_chainId')return mockWallet.network;if(method==='wallet_switchEthereumChain'){mockWallet.network=params[0].chainId;for(const fn of mockWallet.events.chainChanged??[])fn(mockWallet.network);return null;}if(method==='eth_sendTransaction'){if(mockWallet.reject)throw{code:4001,message:'User rejected transaction'};return '0x'+'4'.repeat(64);}throw new Error('Unexpected mock wallet request '+method);}};
    window.changeMockWallet=(account,network='0x279f')=>{mockWallet.account=account;mockWallet.network=network;for(const fn of mockWallet.events.accountsChanged??[])fn(account?[account]:[]);for(const fn of mockWallet.events.chainChanged??[])fn(network);};'''.replace('ACCOUNT',json.dumps(fixture['a'])))
  page.goto(URL+'/?qa'+('&duel='+record if record else ''),wait_until='networkidle',timeout=60000);page.wait_for_function('window.__arena?.ready',timeout=45000)
  return ctx,page,state
 def open_lobby(page):
  page.locator('#hub [data-open-duel]').click()
  try:page.wait_for_function('document.querySelector("#duel-chain-status").textContent==="Live contract connected"',timeout=20000)
  except Exception:
   print('LOBBY DIAGNOSTIC',page.locator('#duel-dialog').inner_text(),errors,flush=True)
   page.screenshot(path=str(OUT/'warchog-duel-error.png'))
   raise
 def lookup(page,name):
  page.locator('#duel-record').fill(fixture['ids'][name]);page.locator('#duel-load').click();page.wait_for_function('!document.querySelector("#duel-load").disabled&&document.querySelector("#duel-record-panel").hidden===false',timeout=20000)
 def methods(page):return page.locator('[data-recovery]').evaluate_all('(buttons)=>buttons.map(b=>b.dataset.recovery)')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage'])
  try:
   ctx,page,state=context(browser)
   try:
    check('WARCHOG branding replaces product wordmarks while retaining the 3D home','WARCHOG' in page.title() and 'WAR' in page.locator('.arcade-brand').inner_text() and page.locator('#home-stage #arena').is_visible())
    check('entry does not prompt a wallet or load the chain integration before opening a duel',page.evaluate('mockWallet.calls.length===0') and not state['calls'])
    check('home separates 1v1 entry from free CPU practice and Training',page.locator('#hub [data-open-duel]').count()==1 and page.locator('[data-play]').count()==2)
    page.screenshot(path=str(OUT/'warchog-home-desktop.png'))
    open_lobby(page)
    check('live policy displays exact six-decimal contract amounts',page.locator('#duel-entry').inner_text()=='1.00' and page.locator('#duel-prize').inner_text()=='1.90' and page.locator('#duel-fee').inner_text()=='0.10')
    check('missing service keeps new deposits closed, with both practice paths available',page.locator('#duel-join').is_disabled() and page.locator('#duel-training').is_visible() and page.locator('#duel-cpu').is_visible())
    check('lobby explains contract-supported tournaments as coming soon','COMING SOON' in page.locator('.duel-tournament').inner_text())
    page.locator('.duel-rules summary').click();text=page.locator('.duel-rules').inner_text()
    check('rules distinguish 15-minute funding, 60-minute play, 75-minute settlement and separate claims',all(x in text for x in ['15 minutes','60 minutes','75 minutes','separate transaction']))
    page.screenshot(path=str(OUT/'warchog-duel-desktop.png'))
    lookup(page,'funding_a');check('public lookup works without wallet and exposes no cancellation',methods(page)==[] and 'AWAITING FUNDING' in page.locator('#duel-record-state').inner_text())
    page.locator('#duel-wallet').click();page.wait_for_function('document.querySelector("#duel-record-details").textContent.includes("PLAYER 1 · YOU")')
    check('connected sole depositor receives the Funding cancel action',methods(page)==['cancelFunding'])
    page.evaluate('changeMockWallet('+json.dumps(fixture['b'])+')');page.wait_for_function('document.querySelector("#duel-record-details").textContent.includes("PLAYER 2 · YOU")')
    check('changing wallet removes the previous depositor cancellation',methods(page)==[])
    lookup(page,'funding_b');check('either ordered participant can be the sole depositor',methods(page)==['cancelFunding'])
    page.evaluate('changeMockWallet('+json.dumps(fixture['c'])+')');page.wait_for_function('document.querySelector("#duel-wallet").textContent.endsWith("000c")')
    lookup(page,'funding_expired');check('any connected wallet can release expired Funding',methods(page)==['refundExpiredFunding'])
    lookup(page,'active');check('active duel has no unilateral cancellation or fake fight launch',methods(page)==[] and page.locator('#duel-record-state').inner_text()=='DUEL ACTIVE')
    lookup(page,'play_closed');check('closing play window still waits for settlement, without premature refund',methods(page)==[] and 'may still settle' in page.locator('#duel-record-description').inner_text())
    lookup(page,'settlement_expired');check('settlement timeout opens the actual active refund method',methods(page)==['refundExpired'])
    lookup(page,'revoked');check('record-specific revoked authority immediately opens recovery',methods(page)==['refundRevoked'])
    lookup(page,'paused');check('paused results explain the lock without fabricating settlement',methods(page)==[] and 'paused' in page.locator('#duel-record-description').inner_text())
    page.evaluate('changeMockWallet('+json.dumps(fixture['a'])+')');page.wait_for_function('document.querySelector("#duel-wallet").textContent.endsWith("000a")')
    lookup(page,'complete');check('winner credit remains allocated until explicitly claimed',methods(page)==['withdrawFor'] and '1.90' in page.locator('[data-recovery]').inner_text())
    page.evaluate('changeMockWallet('+json.dumps(fixture['b'])+')');page.wait_for_function('document.querySelector("#duel-record-details").textContent.includes("PLAYER 2 · YOU")')
    check('wallet switch never displays the previous winner credit or claim action',methods(page)==[] and '0.00 test USDC' in page.locator('#duel-record-details').inner_text())
    page.evaluate('changeMockWallet('+json.dumps(fixture['a'])+',"0x1")');page.wait_for_function('document.querySelector("#duel-switch").hidden===false')
    lookup(page,'cancelled');check('wrong wallet network blocks recovery while still displaying public credits',methods(page)==['withdrawFor'] and page.locator('[data-recovery]').is_disabled())
    page.locator('#duel-switch').click();page.wait_for_function('document.querySelector("[data-recovery]")?.disabled===false')
    check('explicit switch to Monad testnet enables eligible recovery',page.locator('#duel-switch').is_hidden() and not page.locator('[data-recovery]').is_disabled())
    lookup(page,'paid');check('zero remaining credit does not invent a winner payout for this viewer',methods(page)==[] and page.locator('#duel-record-state').inner_text()=='SETTLED')
    lookup(page,'none');check('a nonexistent ID has no phantom credit or recovery',methods(page)==[] and page.locator('#duel-record-state').inner_text()=='NOT FOUND')
    page.locator('#duel-record').fill('0x123');page.locator('#duel-load').click();check('invalid bytes32 is stopped by form validation',not page.locator('#duel-record').evaluate('(e)=>e.validity.valid'))
    lookup(page,'funding_a');page.evaluate('mockWallet.reject=true');page.locator('[data-recovery="cancelFunding"]').click();page.wait_for_function('document.querySelector("#duel-feedback").textContent.includes("declined")')
    check('wallet rejection leaves Funding and allocation unchanged',page.locator('#duel-record-state').inner_text()=='AWAITING FUNDING' and page.locator('#duel-transaction').is_hidden())
    page.evaluate('mockWallet.reject=false');state['receipt']='reverted';page.locator('[data-recovery="cancelFunding"]').click();page.wait_for_function('document.querySelector("#duel-feedback").textContent.includes("reverted")')
    page.wait_for_function('document.querySelector("#duel-record-panel").hidden===false')
    check('reverted receipt preserves status and links the failed transaction',page.locator('#duel-record-state').inner_text()=='AWAITING FUNDING' and page.locator('#duel-transaction').is_visible())
    state['receipt']='success';page.locator('[data-recovery="cancelFunding"]').click();page.wait_for_function('document.querySelector("#duel-record-state").textContent==="REFUND ALLOCATED"')
    check('confirmed cancellation unlocks credit and offers a separate claim',methods(page)==['withdrawFor'] and '1.00' in page.locator('[data-recovery]').inner_text())
    page.locator('[data-recovery="withdrawFor"]').click();page.wait_for_function('document.querySelector("#duel-feedback").textContent.includes("Claim confirmed")&&!document.querySelector("[data-recovery]")')
    check('confirmed claim removes consumed credit and never pays twice',methods(page)==[] and 'Claim confirmed' in page.locator('#duel-feedback').inner_text())
    sent=page.evaluate('mockWallet.calls.filter(x=>x.method==="eth_sendTransaction").map(x=>x.params[0])')
    check('all mocked recovery writes target the pinned escrow with no native value',len(sent)==4 and all(x['to'].lower()==fixture['escrow'].lower() and int(x.get('value','0x0'),16)==0 for x in sent),sent)
    check('no wallet allowance, paid entry or result-signing request was made',not any('sign' in x['method'].lower() for x in page.evaluate('mockWallet.calls')))
    page.locator('#duel-close').click();check('sticky close returns to the live 3D home',page.locator('#duel-dialog').is_hidden() and page.locator('#home-stage #arena').is_visible())
    page.locator('#menu-duels').click();check('header restores lobby with recent record IDs',page.locator('#duel-recent button').count()==5)
    page.keyboard.press('Escape');check('native Escape closes lobby and restores navigation focus',page.locator('#duel-dialog').is_hidden() and page.locator('#menu-duels').evaluate('(e)=>e===document.activeElement'))
    page.locator('#menu-duels').click();page.locator('#duel-training').click();check('lobby Training shortcut reaches existing full 3D setup',page.locator('#duel-dialog').is_hidden() and page.locator('#setup-title').is_visible())
   finally:ctx.close()
   ctx,page,state=context(browser,wallet=False,record=fixture['ids']['active'])
   try:
    page.wait_for_function('document.querySelector("#duel-record-state").textContent==="DUEL ACTIVE"')
    check('shared duel link opens and loads its record during initial boot without a wallet',page.locator('#duel-dialog').is_visible() and page.locator('#duel-record').input_value()==fixture['ids']['active'] and methods(page)==[])
    page.locator('#duel-close').click();check('shared link can close back to a ready 3D home',page.locator('#home-stage #arena').is_visible())
   finally:ctx.close()
   for width,height in [(390,844),(320,640),(844,390)]:
    ctx,page,state=context(browser,width,height,True,False)
    try:
     check(f'{width}px home has no horizontal overflow',page.locator('#front-menu').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
     page.screenshot(path=str(OUT/f'warchog-home-{width}.png'))
     open_lobby(page);page.screenshot(path=str(OUT/f'warchog-duel-{width}.png'))
     check(f'{width}px duel layout fits horizontally',page.locator('#duel-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
     page.locator('#duel-wallet').click();check(f'{width}px missing wallet gives a useful message without blocking practice','wallet' in page.locator('#duel-feedback').inner_text().lower())
     page.locator('#duel-lookup').scroll_into_view_if_needed();check(f'{width}px sticky close remains reachable after scrolling',page.locator('#duel-close').evaluate('(e)=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}'))
     state['offline']=True;page.locator('#duel-refresh').click();page.wait_for_function('document.querySelector("#duel-chain-status").textContent.includes("unavailable")',timeout=25000)
     check(f'{width}px RPC outage keeps policy labeled as pinned and entry closed',page.locator('#duel-join').is_disabled() and 'pinned' in page.locator('#duel-chain-status').inner_text())
     page.locator('#duel-cpu').click();check(f'{width}px free CPU practice remains reachable without service or wallet',page.locator('#setup-title').is_visible() and page.locator('#duel-dialog').is_hidden())
    finally:ctx.close()
  finally:browser.close()
 check('no JavaScript errors or unhandled RPC requests',not errors,errors)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Production UI, ABI-encoded intercepted RPC and injected mock wallet. No public-chain write. Chromium software rendering and emulated mobile viewports, not physical-device performance.'}
 (OUT/'duel-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(checks)}),flush=True)
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
