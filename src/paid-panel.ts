import { escrowProfile } from './chain-profile.ts';
import { duelView, shortAddress, usdc, type Address, type RecordId } from './duel-model.ts';
import type { RoomView } from './online-protocol.ts';
import type { ResultProof } from './payment-types.ts';
import type { WalletProvider } from './duel-chain.ts';
type FundingInfo=Awaited<ReturnType<typeof import('./duel-chain.ts')['fundingInfo']>>;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
export function paidPanelMarkup(){return `<section id="paid-panel" class="paid-panel" hidden aria-label="Duel entry and payout"><span class="comic-eyebrow" id="paid-network"></span><h3>YOUR ENTRY & CREDIT</h3><button id="paid-connect" class="paper-button">CONNECT WALLET</button><p id="paid-wallet">Sign in to enter a 1 USDC testnet duel.</p><p id="paid-status" role="status" aria-live="polite">Both players lock their picks before funding.</p><div id="paid-funding" hidden><p id="paid-chain-status"></p><div id="paid-seats" class="paid-seats"></div><small id="paid-record"></small><p id="paid-balance"></p><button id="paid-approve" class="arcade-enter" hidden>1 · APPROVE 1 TEST USDC</button><button id="paid-deposit" class="arcade-enter" hidden>2 · DEPOSIT 1 TEST USDC</button><button id="paid-submit" class="arcade-enter" hidden>SUBMIT OFFICIAL RESULT</button><div id="paid-recovery"></div></div><a id="paid-tx" target="_blank" rel="noopener noreferrer" hidden>View transaction ↗</a><small class="paid-policy">1 USDC per player · winner 1.90 · house fee 0.10. Voided duels return paid entries. Credits require a separate claim.</small></section>`;}
export class PaidPanel{
  private room:RoomView|null=null;private mode:'free'|'paid'='free';private provider?:WalletProvider;private account?:Address;private network?:number;private authenticated=false;
  private busy=false;private reading=false;private timer?:ReturnType<typeof setInterval>;private info?:FundingInfo;private message='';private sticky=false;private version=0;
  private changed=()=>{this.account=undefined;this.authenticated=false;this.info=undefined;++this.version;this.message='Wallet changed. Reconnect the assigned wallet to continue.';this.render();};
  constructor(private error:(message:string)=>void){
    $('paid-network').textContent=escrowProfile.name.toUpperCase();
    $('paid-connect').onclick=()=>void this.connect().catch(error=>{this.message=error.message;this.sticky=true;this.render();});
    $('paid-approve').onclick=()=>void this.action('approve');$('paid-deposit').onclick=()=>void this.action('deposit');$('paid-submit').onclick=()=>void this.action('submit');
  }
  get ready(){return Boolean(this.account&&this.authenticated&&this.network===escrowProfile.chainId);}
  async connect(){
    if(this.busy)return;
    this.busy=true;this.sticky=false;this.render();
    try{
      const provider=(window as unknown as {ethereum?:WalletProvider}).ethereum;
      if(!provider)throw new Error('Open this page in a browser with an Ethereum-compatible wallet.');
      if(this.provider!==provider){this.provider?.removeListener?.('accountsChanged',this.changed);this.provider?.removeListener?.('chainChanged',this.changed);this.provider=provider;provider.on?.('accountsChanged',this.changed);provider.on?.('chainChanged',this.changed);}
      const accounts=await provider.request({method:'eth_requestAccounts'});const account=accounts[0];if(!account)throw new Error('Choose a wallet account.');
      let network=Number(await provider.request({method:'eth_chainId'}));
      if(network!==escrowProfile.chainId){
        try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+escrowProfile.chainId.toString(16)}]});}
        catch(error){if((error as {code?:number}).code!==4902)throw error;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x'+escrowProfile.chainId.toString(16),chainName:escrowProfile.name,nativeCurrency:{name:escrowProfile.localTest?'Local Ether':'MON',symbol:escrowProfile.localTest?'ETH':'MON',decimals:18},rpcUrls:escrowProfile.rpcUrls,...(!escrowProfile.localTest?{blockExplorerUrls:[escrowProfile.explorer]}:{})}]});}
        network=Number(await provider.request({method:'eth_chainId'}));
      }
      const chain=await import('./duel-chain.ts');const wallet=await chain.walletIdentity(provider,account);
      const session=await this.api('/api/session',{});
      if(session.wallet?.toLowerCase()!==account.toLowerCase()){
        const challenge=await this.api('/api/auth/challenge',{address:account});
        this.message='Sign the WARCHOG login message. It does not approve tokens.';this.render();
        const signature=await wallet.signMessage({account,message:challenge.message});
        const verified=await this.api('/api/auth/verify',{nonce:challenge.nonce,signature});
        if(verified.wallet?.toLowerCase()!==account.toLowerCase())throw new Error('Wallet login did not match the selected account.');
      }
      await chain.walletIdentity(provider,account);
      this.account=account;this.network=network;this.authenticated=true;this.message='Wallet signed in. Lock picks with your rival to prepare the entry.';
    }finally{this.busy=false;this.render();void this.refresh();}
  }
  setMode(mode:'free'|'paid'){this.mode=mode;this.place();this.render();}
  update(room:RoomView|null){
    const old=this.room?.code,stage=this.room?.paid?.stage,mask=this.room?.paid?.fundedMask;this.room=room;
    if(!this.busy&&!this.sticky&&(stage!==room?.paid?.stage||mask!==room?.paid?.fundedMask))this.message='';
    if(room)this.mode=room.mode;
    if(room?.paid?.recordId){try{const key=`warchog:${escrowProfile.chainId}:${escrowProfile.address.toLowerCase()}:duels`;const old=JSON.parse(localStorage.getItem(key)??'[]');const ids=Array.isArray(old)?old.filter(id=>typeof id==='string'&&/^0x[0-9a-fA-F]{64}$/.test(id)):[];localStorage.setItem(key,JSON.stringify([room.paid.recordId,...ids.filter(id=>id!==room.paid!.recordId)].slice(0,5)));}catch{}}
    if(old!==room?.code){++this.version;this.info=undefined;this.message='';this.sticky=false;}
    this.place();this.render();
    if(this.mode==='paid'&&room){this.timer??=setInterval(()=>void this.refresh(),3000);if(!this.reading)void this.refresh();}
    else{clearInterval(this.timer);this.timer=undefined;}
  }
  private place(){
    const panel=$('paid-panel');panel.hidden=this.mode!=='paid';
    const result=$('result');
    if(this.room?.result&&document.getElementById('front-menu')?.hidden)result.insertBefore(panel,$('result-reset'));
    else $('online-setup').append(panel);
  }
  private async refresh(){
    const room=this.room;if(!room?.paid?.terms||!room.paid.recordId||this.reading||this.busy)return;
    this.reading=true;const version=this.version,account=this.account;
    try{
      if(room.recoveryOnly){const response=await fetch('/api/paid/status?code='+encodeURIComponent(room.code));if(response.ok&&version===this.version)room.paid=await response.json();}
      const paid=room.paid;
      if(account&&paid?.terms&&paid.recordId){const chain=await import('./duel-chain.ts');const info=await chain.fundingInfo(paid.terms,paid.recordId,account);if(version===this.version&&account===this.account)this.info=info;}
    }catch(error){if(version===this.version)this.message=error instanceof Error?error.message:'Could not refresh contract state.';}
    finally{this.reading=false;this.render();}
  }
  private async action(kind:'approve'|'deposit'|'submit'|string){
    const room=this.room,account=this.account,provider=this.provider;
    if(!room?.paid?.recordId||!room.paid.terms||!account||!provider||!this.ready||this.busy)return;
    this.busy=true;this.sticky=false;this.message='Checking the contract before opening your wallet…';$('paid-tx').hidden=true;this.render();
    const hash=(hash:RecordId)=>{const link=$<HTMLAnchorElement>('paid-tx');link.textContent=escrowProfile.localTest?`Local transaction ${shortAddress(hash)}`:'View transaction ↗';link.href=escrowProfile.localTest?'#':`${escrowProfile.explorer}/tx/${hash}`;link.hidden=false;this.message='Transaction submitted. Waiting for confirmation…';this.render();};
    try{
      const chain=await import('./duel-chain.ts');
      if(kind==='approve')await chain.approveEntry(provider,account,room.paid.terms,room.paid.recordId,hash);
      else if(kind==='deposit')await chain.depositEntry(provider,account,room.paid.terms,room.paid.recordId,hash);
      else if(kind==='submit'){const proof=await this.api('/api/paid/result',{code:room.code}) as ResultProof;await chain.submitProof(provider,account,proof,room.paid.recordId,hash);}
      else await chain.recover(provider,account,room.paid.recordId,kind as Parameters<typeof chain.recover>[3],hash);
      this.sticky=true;
      this.message=kind==='approve'?'Approval confirmed.':kind==='deposit'?'Entry confirmed.':kind==='submit'?'Result transaction confirmed. Checking claimable credit.':kind==='withdrawFor'?'Claim confirmed. Tokens were transferred to your wallet.':'Refund transaction confirmed. Claim the allocated credit separately.';
    }catch(error){const e=error as {code?:number;shortMessage?:string;message?:string};this.sticky=true;this.message=e.code===4001||/rejected|denied/i.test(e.shortMessage??e.message??'')?'Wallet request declined. No success was recorded.':(e.shortMessage??e.message??'Transaction failed. Refresh before retrying.').split('\n')[0].slice(0,220);this.error(this.message);}
    finally{this.busy=false;await this.refresh();this.render();}
  }
  private async api(path:string,data:unknown):Promise<any>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(12000)});const body=await response.json();if(!response.ok)throw new Error(body.error??'The prize service is unavailable.');return body;}
  private render(){
    const room=this.room,paid=room?.paid,info=this.info;
    $('paid-wallet').textContent=this.account?`${shortAddress(this.account)} · ${this.ready?'SIGNED IN':'RECONNECT REQUIRED'}`:'Sign in with the wallet assigned to this duel.';
    $<HTMLButtonElement>('paid-connect').disabled=this.busy;$('paid-connect').textContent=this.ready?'WALLET CONNECTED ✓':'CONNECT WALLET';
    $('paid-status').textContent=this.message||(info&&(info.config.intakePaused||info.config.resultsPaused)?'Contract entries or results are paused. Available refunds and credit claims remain open.':paid?.message)||'Both players lock their picks before funding.';
    $('paid-funding').hidden=!paid?.recordId;
    $('paid-chain-status').textContent=paid?.message??'';
    for(const id of ['paid-approve','paid-deposit','paid-submit'])$(id).hidden=true;
    const recovery=$('paid-recovery');recovery.replaceChildren();
    if(!paid?.recordId)return;
    $('paid-record').textContent=`RECORD ${shortAddress(paid.recordId)} · ${paid.terms?.fundingDeadline?new Date(Number(paid.terms.fundingDeadline)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}`;
    $('paid-record').title=paid.recordId;
    const mask=info?.snapshot.duel.fundedMask??paid.fundedMask;
    $('paid-seats').textContent=`PLAYER 1 ${mask&1?'FUNDED ✓':'UNPAID'} · PLAYER 2 ${mask&2?'FUNDED ✓':'UNPAID'}`;
    $('paid-balance').textContent=info?`Balance ${usdc(info.balance)} · Claimable ${usdc(info.snapshot.credit)} test USDC`:'Connect your wallet to read its balance and credit.';
    const assigned=Boolean(this.account&&paid.terms&&paid.terms.players[room!.seat]?.toLowerCase()===this.account.toLowerCase());
    if(info&&assigned&&this.ready){
      const expired=info.config.chainTime>BigInt(paid.terms!.fundingDeadline);
      const mayFund=!room?.recoveryOnly&&info.snapshot.duel.state<2&&!info.ownFunded&&!expired&&!info.config.intakePaused&&!info.config.resultsPaused&&!info.snapshot.revoked;
      $('paid-approve').hidden=!mayFund||info.allowance>=1_000_000n;
      $('paid-deposit').hidden=!mayFund||info.allowance<1_000_000n;
      $<HTMLButtonElement>('paid-approve').disabled=this.busy;$<HTMLButtonElement>('paid-deposit').disabled=this.busy||info.balance<1_000_000n;
      $('paid-submit').hidden=!room?.result||info.snapshot.duel.state!==2||info.snapshot.revoked||info.snapshot.resultsPaused;
      $<HTMLButtonElement>('paid-submit').disabled=this.busy||paid.stage!=='result-ready';
      for(const action of duelView(info.snapshot,this.account).actions){const button=document.createElement('button');button.className='arcade-enter';button.dataset.paidRecovery=action.method;button.textContent=action.label;button.disabled=this.busy;button.onclick=()=>void this.action(action.method);recovery.append(button);}
    }
  }
}
