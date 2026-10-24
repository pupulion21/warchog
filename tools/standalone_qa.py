"""Owns a finite standalone-server process and private temporary database."""
from pathlib import Path
import json,os,socket,subprocess,tempfile,time,urllib.request
ROOT=Path(__file__).resolve().parent.parent
def run():
 checks=[]
 def check(name,value):checks.append({'name':name,'pass':bool(value)});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 with socket.socket() as reserve:reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
 url=f'http://127.0.0.1:{port}'
 with tempfile.TemporaryDirectory(prefix='warchog-standalone-',dir=ROOT/'.local') as taskdir,(ROOT/'.local/standalone-server.log').open('w') as log:
  env={k:v for k,v in os.environ.items() if k not in ['WARCHOG_SIGNER_PRIVATE_KEY','WARCHOG_ALLOW_PAID_SETTLEMENT']}
  env.update(WARCHOG_PORT=str(port),WARCHOG_HOST='127.0.0.1',WARCHOG_DB_PATH=str(Path(taskdir)/'matches.sqlite'),WARCHOG_ENV_FILE=str(Path(taskdir)/'server.env'),WARCHOG_PAYMENTS_ENABLED='false')
  server=subprocess.Popen(['node','--experimental-strip-types','server/index.ts'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
  try:
   for _ in range(100):
    if server.poll() is not None:raise RuntimeError('Standalone server failed; see .local/standalone-server.log')
    try:
     with urllib.request.urlopen(url+'/api/health',timeout=.5) as r:health=json.load(r)
     break
    except OSError:time.sleep(.1)
   else:raise RuntimeError('Standalone server did not start.')
   check('standalone Node server enables real online play with prize entry closed',health['online'] and not health['paidEntry'] and not health['paidSettlementEnabled'])
   with urllib.request.urlopen(url,timeout=5) as r:check('standalone server serves the WARCHOG production game','WARCHOG' in r.read().decode() and r.status==200)
   req=urllib.request.Request(url+'/api/session',data=b'{}',headers={'Origin':url,'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=5) as r:check('standalone API sets an HttpOnly same-origin player session','HttpOnly' in r.headers['Set-Cookie'] and 'SameSite=Strict' in r.headers['Set-Cookie'])
   check('persistent player-session database is private',oct((Path(taskdir)/'matches.sqlite').stat().st_mode&0o777)=='0o600')
  finally:
   server.terminate()
   try:server.wait(timeout=10)
   except subprocess.TimeoutExpired:server.kill();server.wait()
  check('standalone server shuts down cleanly on SIGTERM',server.returncode==0)
  with socket.socket() as probe:check('task-owned server port is released',probe.connect_ex(('127.0.0.1',port))!=0)
 report={'status':'PASS' if all(c['pass'] for c in checks) else 'FAIL','checks':checks,'scope':'Built assets, real standalone Node server, temporary private SQLite database, no wallet or chain writes.'}
 (ROOT/'validation/standalone-report.json').write_text(json.dumps(report,indent=2)+'\n')
 if report['status']!='PASS':raise SystemExit(1)
if __name__=='__main__':run()
