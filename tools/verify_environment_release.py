"""Finite production verification; owns and closes its preview server and QA browsers."""
from pathlib import Path
import hashlib,json,os,socket,subprocess,time,tempfile
ROOT=Path(__file__).resolve().parent.parent
REPORT=ROOT/'validation/architecture-production-report.json'
LOGS=ROOT/'.local';LOGS.mkdir(exist_ok=True)
PORT=int(os.environ.get('CHOG_RELEASE_QA_PORT','5188'))
SUITES=['environment','world','showcase']

def run(suites=None,report_path=None,log_prefix='architecture',report_names=None):
 with socket.socket() as probe:
  if probe.connect_ex(('127.0.0.1',PORT))==0:raise SystemExit(f'Port {PORT} already belongs to another server; choose CHOG_RELEASE_QA_PORT.')
 url=f'http://127.0.0.1:{PORT}'
 bundle=next((ROOT/'dist/assets').glob('index-*.js'))
 serverfiles=[*sorted((ROOT/'server').glob('*.ts')),*[ROOT/'src'/name for name in ['combat.ts','physics.ts','stage.ts','online-protocol.ts','payment-types.ts']]]
 serverhashes={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in serverfiles}
 frontendfiles=[ROOT/'dist/index.html',bundle,*sorted((ROOT/'dist/assets').glob('*.css')),*sorted((ROOT/'dist/assets').glob('duel-chain-*.js'))]
 frontendhashes={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in frontendfiles}
 records=[]
 with tempfile.TemporaryDirectory(prefix='warchog-release-',dir=LOGS) as taskdir,(LOGS/f'{log_prefix}-preview-server.log').open('w') as serverlog:
  server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',str(PORT),'--strictPort'],cwd=ROOT,env={**os.environ,'WARCHOG_DB_PATH':str(Path(taskdir)/'matches.sqlite'),'WARCHOG_ENV_FILE':str(Path(taskdir)/'server.env'),'WARCHOG_PAYMENTS_ENABLED':'false','WARCHOG_SIGNER_PRIVATE_KEY':''},stdout=serverlog,stderr=subprocess.STDOUT)
  try:
   for _ in range(100):
    if server.poll() is not None:raise RuntimeError('Production preview exited before becoming ready.')
    with socket.socket() as probe:
     if probe.connect_ex(('127.0.0.1',PORT))==0:break
    time.sleep(.1)
   else:raise RuntimeError('Production preview did not open its port.')
   env={**os.environ,'CHOG_QA_URL':url}
   for name in (suites or SUITES):
    print('Checking production:',name,flush=True)
    with (LOGS/f'{log_prefix}-production-{name}.log').open('w') as log:
     result=subprocess.run(['python',f'tools/{name}_qa.py'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:raise RuntimeError(f'{name} failed; see .local/{log_prefix}-production-{name}.log')
    filename=(report_names or {}).get(name,f'{name}-report.json')
    report=json.loads((ROOT/'validation'/filename).read_text());assert report['status']=='PASS'
    records.append({'suite':name,'checks':len(report['checks']),'report':f'validation/{filename}'})
    print(name,'PASS',len(report['checks']),flush=True)
   digest=hashlib.sha256(bundle.read_bytes()).hexdigest()
   assert serverhashes=={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in serverfiles},'Server sources changed during verification; rebuild and rerun.'
   assert frontendhashes=={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in frontendfiles},'Frontend assets changed during verification; rebuild and rerun.'
   record={'status':'PASS','url':url,'bundle':str(bundle.relative_to(ROOT)),'bundleSha256':digest,'frontendFiles':frontendhashes,'serverSourceFiles':serverhashes,'suites':records,'checks':sum(r['checks'] for r in records),'scope':'Actual production bundle and authoritative server in installed Chromium/SwiftShader. Isolated QA database. Desktop, mobile emulation and reduced motion; not a physical-phone frame-rate benchmark.'}
   (report_path or REPORT).write_text(json.dumps(record,indent=2)+'\n');print('Production acceptance PASS:',record['checks'],'checks',flush=True)
  finally:
   server.terminate()
   try:server.wait(timeout=10)
   except subprocess.TimeoutExpired:server.kill();server.wait()

if __name__=='__main__':run()
