import deployment from '../contracts/deployments/monad-testnet.json';
import type { EscrowProfile } from './payment-types.ts';
const pinned: EscrowProfile = { chainId: deployment.chainId, name: deployment.network,
  address: deployment.address as `0x${string}`, token: deployment.token.address as `0x${string}`,
  expectedSigner: deployment.roles.resultSigner as `0x${string}`, explorer: 'https://testnet.monadscan.com',
  rpcUrls: ['https://testnet-rpc.monad.xyz','https://rpc-testnet.monadinfra.com'] };
// Only a deliberately built LOCAL QA bundle can override the pinned public deployment.
// No query parameter, browser storage or backend response can change the transaction destination.
function localProfile(): EscrowProfile | undefined {
  const raw=import.meta.env.VITE_WARCHOG_LOCAL_EVM_PROFILE;
  if(!raw)return;
  const profile=JSON.parse(raw) as EscrowProfile;
  if(profile.localTest!==true||profile.chainId!==31337||!/^0x[0-9a-fA-F]{40}$/.test(profile.address)||!/^0x[0-9a-fA-F]{40}$/.test(profile.token)||
    !profile.rpcUrls.length||profile.rpcUrls.some(url=>!['127.0.0.1','localhost'].includes(new URL(url).hostname)))throw new Error('Invalid local EVM test profile.');
  return {...profile,name:'LOCAL EVM · TEST ONLY'};
}
export const escrowProfile=localProfile()??pinned;
