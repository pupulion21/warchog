import { readFileSync, existsSync, statSync } from 'node:fs';
import { parse } from 'dotenv';
import type { Hex } from 'viem';
import type { EscrowProfile } from '../src/payment-types.ts';
export function serverSettings() {
  const path=process.env.WARCHOG_ENV_FILE??'.local/warchog-server.env';
  let file:Record<string,string>={};
  if(existsSync(path)){
    if(statSync(path).mode&0o077)throw new Error('WARCHOG server configuration must have permissions 0600.');
    file=parse(readFileSync(path));
  }
  const get=(key:string)=>process.env[key]??file[key];
  const key=get('WARCHOG_SIGNER_PRIVATE_KEY');
  let profile:EscrowProfile|undefined;
  const localPath=get('WARCHOG_LOCAL_EVM_PROFILE');
  if(localPath){
    profile=JSON.parse(readFileSync(localPath,'utf8')) as EscrowProfile;
    if(profile.localTest!==true||profile.chainId!==31337||profile.rpcUrls.some(url=>!['127.0.0.1','localhost'].includes(new URL(url).hostname)))throw new Error('Invalid local-only EVM profile.');
  }
  return {dbPath:get('WARCHOG_DB_PATH'),roundSeconds:Math.max(5,Math.min(1800,Number(get('WARCHOG_ROUND_SECONDS'))||180)),
    signerKey:(key||undefined) as Hex|undefined,origins:get('WARCHOG_ORIGINS')?.split(',').map(x=>x.trim()).filter(Boolean),
    paymentsEnabled:get('WARCHOG_PAYMENTS_ENABLED')==='true',profile};
}
