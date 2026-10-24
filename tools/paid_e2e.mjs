// Actual EVM + browser acceptance. All deployments/transactions are restricted to owned localhost Anvil.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,openSync,closeSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createPublicClient,createWalletClient,http,encodeFunctionData} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
const root=process.cwd();mkdirSync(join(root,'.local'),{recursive:true});
const task=mkdtempSync(join(root,'.local/paid-e2e-'));
const logs=[];let anvil,app;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
function start(command,args,env,path){const fd=openSync(path,'w',0o600);logs.push(fd);return spawn(command,args,{cwd:root,env,stdio:['ignore',fd,fd]});}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');for(let i=0;i<40&&child.exitCode===null;i++)await wait(100);if(child.exitCode===null){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}}
const env={...process.env,WARCHOG_ENV_FILE:join(task,'empty.env')};delete env.WARCHOG_SIGNER_PRIVATE_KEY;delete env.WARCHOG_LOCAL_EVM_PROFILE;
try{
 const compile=start('forge',['build','--root','contracts','--out',join(root,'.local/contracts-build'),'--cache-path',join(root,'.local/contracts-cache')],env,join(root,'.local/paid-e2e-forge.log'));
 const compileCode=await new Promise(r=>compile.once('exit',r));if(compileCode!==0)throw new Error('Pinned Solidity build failed; see .local/paid-e2e-forge.log');
 const rpcPort=await port(),rpc=`http://127.0.0.1:${rpcPort}`;
 anvil=start('anvil',['--host','127.0.0.1','--port',String(rpcPort),'--chain-id','31337','--block-time','1','--mixed-mining','--silent'],env,join(root,'.local/paid-e2e-anvil.log'));
 const client=createPublicClient({chain:foundry,transport:http(rpc,{retryCount:0,timeout:5000})});
 for(let i=0;i<100;i++){try{if(await client.getChainId()===31337)break;}catch{}if(anvil.exitCode!==null)throw new Error('Owned Anvil exited.');if(i===99)throw new Error('Anvil startup timed out.');await wait(100);}
 const addresses=await client.request({method:'eth_accounts'}),deployer=createWalletClient({account:addresses[0],chain:foundry,transport:http(rpc)});
 const tokenArtifact=JSON.parse(readFileSync('.local/contracts-build/MockUSDC.sol/MockUSDC.json'));
 const escrowArtifact=JSON.parse(readFileSync('.local/contracts-build/PaidDuelEscrowV2.sol/PaidDuelEscrowV2.json'));
 const receipt=hash=>client.waitForTransactionReceipt({hash,pollingInterval:100});
 const token=(await receipt(await deployer.deployContract({abi:tokenArtifact.abi,bytecode:tokenArtifact.bytecode.object}))).contractAddress;
 const key=generatePrivateKey(),signer=privateKeyToAccount(key);
 const escrow=(await receipt(await deployer.deployContract({abi:escrowArtifact.abi,bytecode:escrowArtifact.bytecode.object,args:[token,31337n,signer.address,addresses[4],500,addresses[0]]}))).contractAddress;
 for(const address of [addresses[1],addresses[2]])await receipt(await deployer.writeContract({address:token,abi:tokenArtifact.abi,functionName:'mint',args:[address,5_000_000n]}));
 const profile={chainId:31337,name:'LOCAL EVM · TEST ONLY',address:escrow,token,rpcUrls:[rpc],explorer:'',expectedSigner:signer.address,localTest:true};
 const profilePath=join(task,'profile.json');writeFileSync(profilePath,JSON.stringify(profile),{mode:0o600});
 writeFileSync('validation/paid-local-deployment.json',JSON.stringify({...profile,players:[addresses[1],addresses[2]],treasury:addresses[4],scope:'Owned ephemeral localhost Anvil, original escrow bytecode, six-decimal local MockUSDC. No public-chain deployment or transaction.'},null,2)+'\n');
 const build=start('node',['node_modules/vite/bin/vite.js','build','--outDir',join(task,'dist')],{...env,VITE_WARCHOG_LOCAL_EVM_PROFILE:JSON.stringify(profile)},join(root,'.local/paid-e2e-build.log'));
 const buildCode=await new Promise(r=>build.once('exit',r));if(buildCode!==0)throw new Error('Local EVM browser build failed; see .local/paid-e2e-build.log');
 const bundles=readdirSync(join(task,'dist/assets')).filter(name=>name.endsWith('.js'));
 if(bundles.some(name=>readFileSync(join(task,'dist/assets',name),'utf8').includes(key.slice(2))))throw new Error('Server key leaked into local test bundle.');
 const appPort=await port(),url=`http://127.0.0.1:${appPort}`;
 app=start('node',['--experimental-strip-types','server/index.ts'],{...env,WARCHOG_LOCAL_EVM_PROFILE:profilePath,WARCHOG_SIGNER_PRIVATE_KEY:key,WARCHOG_PAYMENTS_ENABLED:'true',WARCHOG_DB_PATH:join(task,'matches.sqlite'),WARCHOG_ASSET_DIR:join(task,'dist'),WARCHOG_PORT:String(appPort),WARCHOG_ROUND_SECONDS:'12'},join(root,'.local/paid-e2e-server.log'));
 for(let i=0;i<150;i++){try{const h=await(await fetch(url+'/api/health')).json();if(h.paidEntry)break;}catch{}if(app.exitCode!==null)throw new Error('Local EVM backend exited.');if(i===149)throw new Error('Paid readiness did not become true.');await wait(100);}
 console.log('Owned local EVM and prize-enabled game are ready. Running real browser funding/settlement tests.');
 const selectors=Object.fromEntries(['getDuel','credits','ledgerOf','totalReserved'].map(functionName=>{const args=functionName==='credits'?['0x'+'0'.repeat(64),addresses[1]]:functionName==='totalReserved'?[]:['0x'+'0'.repeat(64)];return [functionName,encodeFunctionData({abi:escrowArtifact.abi,functionName,args}).slice(0,10)];}));
 selectors.configure=encodeFunctionData({abi:tokenArtifact.abi,functionName:'configure',args:[false,false]}).slice(0,10);
 for(const functionName of ['pauseResults','unpauseResults'])selectors[functionName]=encodeFunctionData({abi:escrowArtifact.abi,functionName,args:[]});
 const qa=start('python',['tools/paid_browser_qa.py'],{...env,CHOG_QA_URL:url,WARCHOG_TEST_RPC:rpc,WARCHOG_TEST_TOKEN:token,WARCHOG_TEST_ESCROW:escrow,WARCHOG_TEST_PLAYERS:JSON.stringify([addresses[1],addresses[2]]),WARCHOG_TEST_ADMIN:addresses[0],WARCHOG_TEST_TREASURY:addresses[4],WARCHOG_TEST_SELECTORS:JSON.stringify(selectors)},join(root,'.local/paid-e2e-browser.log'));
 const qaCode=await new Promise(r=>qa.once('exit',r));if(qaCode!==0)throw new Error('Paid browser/EVM acceptance failed; see .local/paid-e2e-browser.log');
 console.log('Paid local EVM/browser acceptance PASS.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await stop(app);await stop(anvil);for(const fd of logs)closeSync(fd);rmSync(task,{recursive:true,force:true});}
