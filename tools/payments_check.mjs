// Read-only readiness check; never logs key material or submits transactions.
import {serverSettings} from '../server/config.ts';
import {Settlement,createReader,defaultProfile} from '../server/settlement.ts';
const settings=serverSettings(),profile=settings.profile??defaultProfile;
const settlement=new Settlement(settings.signerKey,undefined,profile);
let expectedSigner=profile.expectedSigner,configurationVerified=false;
try{expectedSigner=(await createReader(profile).configuration()).signer;configurationVerified=true;}catch{}
const readiness=await settlement.readiness();
const result={chainId:profile.chainId,escrow:profile.address,configurationVerified,expectedSigner,serverSigner:settlement.address??null,
  keyPresent:Boolean(settings.signerKey),paymentsRequested:settings.paymentsEnabled,ready:settings.paymentsEnabled&&readiness.ready,reason:readiness.reason};
console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;
