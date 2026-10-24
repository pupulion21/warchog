import deployment from '../contracts/deployments/monad-testnet.json';
import { duelView, isRecordId, shortAddress, usdc, type Address, type DuelSnapshot, type RecordId, type RecoveryAction } from './duel-model.ts';
import type { Configuration, WalletProvider } from './duel-chain.ts';
import { escrowProfile } from './chain-profile.ts';

const explorer = escrowProfile.explorer;
const storageKey = `warchog:${escrowProfile.chainId}:${escrowProfile.address.toLowerCase()}:duels`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const message = (error: unknown) => {
  const value = error as { code?: number; shortMessage?: string; message?: string };
  if (value.code === 4001 || /rejected|denied/i.test(value.shortMessage ?? value.message ?? '')) return 'Wallet request declined. You can try again when ready.';
  return (value.shortMessage ?? value.message ?? 'Could not reach Monad testnet. Please try again.').split('\n')[0].slice(0, 220);
};
let chainModule: Promise<typeof import('./duel-chain.ts')> | undefined;
const chain = () => chainModule ??= import('./duel-chain.ts');

export function duelMarkup() {
  return `<dialog id="duel-dialog" class="duel-dialog" aria-labelledby="duel-title">
    <header class="duel-header"><div><span class="comic-eyebrow">WARCHOG / THE MAIN EVENT</span><h2 id="duel-title" tabindex="-1">ONE RIVAL. <em>ONE WINNER.</em></h2></div><button id="duel-close" aria-label="Close duel lobby">×</button></header>
    <div class="duel-network"><span class="network-pill">${escrowProfile.name.toUpperCase()}</span><span id="duel-chain-status" role="status">Contract policy · not checked yet</span><button id="duel-refresh" class="paper-button">Refresh status ↻</button></div>
    <div class="duel-layout"><section class="duel-main" aria-label="1v1 duel entry"><button id="duel-online" class="arcade-enter">PLAY ONLINE · FREE <span>↗</span></button><p id="duel-online-status">Invite a friend or find a rival. No entry fee or prize.</p><div class="duel-prize"><span>WINNER TAKES</span><strong><b id="duel-prize">1.90</b> <small>test USDC</small></strong><p>Two players. One prize pool. Pick your CHOG and bring your best.</p><div class="duel-split"><span>YOUR ENTRY <b><span id="duel-entry">1.00</span> USDC</b></span><span>PRIZE POOL <b><span id="duel-pool">2.00</span> USDC</b></span><span>HOUSE FEE <b><span id="duel-fee">0.10</span> USDC · 5%</b></span></div></div>
      <div class="duel-service"><span class="duel-service-dot"></span><div><strong>Prize duels are not open yet.</strong><p>Play online for free while prize entries are closed. Existing testnet refunds and credits remain accessible.</p></div></div>
      <button id="duel-join" class="arcade-enter" disabled>PRIZE DUELS NOT OPEN YET <span>↗</span></button><div class="duel-practice-links"><button id="duel-training" class="paper-button">TRAINING ↗</button><button id="duel-cpu" class="paper-button">PRACTICE VS CPU ↗</button><span>Free play · no deposit</span></div>
      <ol class="duel-steps" aria-label="How a duel works"><li><b>01</b><div><strong>Find your rival</strong><p>Two assigned wallets agree to the same match rules.</p></div></li><li><b>02</b><div><strong>Fund your entries</strong><p>Each player deposits 1 test USDC. Both deposits activate the duel.</p></div></li><li><b>03</b><div><strong>Fight & confirm</strong><p>The match referee confirms a finished match, forfeit, or void.</p></div></li><li><b>04</b><div><strong>Claim your credit</strong><p>The winner claims 1.90 test USDC. Voided duels return paid entries with no fee.</p></div></li></ol>
      <details class="duel-rules"><summary>Deadlines, forfeits & refunds</summary><p>Funding closes at the agreed deadline, within 15 minutes of creation. The sole depositor can cancel before the second entry arrives.</p><p>After activation, the play window is 60 minutes and settlement closes at 75 minutes. These are contract deadlines; the bout rules come from the duel service.</p><p>A confirmed forfeit pays the winner the same 1.90 USDC. An active duel cannot be cancelled unilaterally. A void, revoked result authority, or expired settlement window releases paid entries as refunds. Claiming is a separate transaction.</p><p>Pausing deposits or result acceptance does not block available refunds or credit claims. Wallet transactions use testnet MON for gas.</p></details>
    </section><aside class="duel-account" aria-label="Your duel and credits"><span class="comic-eyebrow">YOUR CORNER</span><h3>MY DUEL & CREDITS</h3><button id="duel-wallet" class="paper-button">CONNECT WALLET</button><p id="duel-wallet-status">Look up a duel without connecting. Connect to check your credit or request an available refund.</p><button id="duel-switch" class="paper-button" hidden>SWITCH TO MONAD TESTNET</button>
      <form id="duel-lookup"><label for="duel-record">DUEL ID</label><div class="duel-lookup-row"><input id="duel-record" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="0x… · 64 hex characters" aria-describedby="duel-record-help" required pattern="0x[0-9a-fA-F]{64}"><button id="duel-load" class="paper-button" type="submit">LOOK UP</button></div><small id="duel-record-help">Paste the record ID from your duel receipt.</small></form><div id="duel-recent" class="duel-recent" aria-label="Recently viewed duels"></div>
      <p id="duel-feedback" role="status" aria-live="polite">Your duel status and claimable credit will appear here.</p><a id="duel-transaction" target="_blank" rel="noopener noreferrer" hidden>View transaction ↗</a>
      <section id="duel-record-panel" class="duel-record-panel" hidden aria-labelledby="duel-record-state"><span id="duel-record-state" class="record-state"></span><p id="duel-record-description"></p><dl id="duel-record-details"></dl><div id="duel-recovery" class="duel-recovery"></div><button id="duel-share" class="paper-button">COPY DUEL LINK ↗</button><small id="duel-record-updated"></small></section>
      <div class="duel-tournament"><span>TOURNAMENTS</span><b>COMING SOON</b><p>The current contract supports 1v1 duels.</p></div>
    </aside></div><footer class="duel-footer"><span>TESTNET TOKENS · <a href="${explorer}/address/${deployment.token.address}" target="_blank" rel="noopener noreferrer">USDC ↗</a></span><a href="${deployment.explorer}" target="_blank" rel="noopener noreferrer">VIEW DUEL CONTRACT ↗</a></footer>
  </dialog>`;
}

export class DuelLobby {
  private dialog = $<HTMLDialogElement>('duel-dialog');
  private config?: Configuration;
  private snapshot?: DuelSnapshot;
  private provider?: WalletProvider;
  private account?: Address;
  private network?: number;
  private busy = false;
  private loading = false;
  private request = 0;
  private walletRequest = 0;
  private checking = false;
  private readonly walletChanged = () => { void this.syncWallet(); };
  constructor(private practice: (mode: 'training' | 'versus') => void, private release: () => void, online?: (mode:'free'|'paid') => void,private resume?:(code:string)=>void) {
    document.querySelectorAll<HTMLButtonElement>('[data-open-duel]').forEach(button => button.onclick = () => this.open());
    $('duel-close').onclick = () => this.dialog.close();
    $('duel-online').onclick = () => { this.dialog.close(); online?.('free'); };
    $('duel-join').onclick=()=>{this.dialog.close();online?.('paid');};
    $('duel-wallet').onclick = () => void this.connect();
    $('duel-switch').onclick = () => void this.switchNetwork();
    $('duel-refresh').onclick = () => void this.refresh();
    $('duel-lookup').onsubmit = event => { event.preventDefault(); void this.lookup(); };
    for (const [id, mode] of [['duel-training', 'training'], ['duel-cpu', 'versus']] as const) $(id).onclick = () => { this.dialog.close(); this.practice(mode); };
    $('duel-share').onclick = () => void this.copyLink();
    this.renderRecent();
    if(escrowProfile.localTest)document.querySelector('.duel-footer')!.textContent='LOCAL EVM · TEST TOKENS ONLY';
    const record = new URL(location.href).searchParams.get('duel');
    if (record && isRecordId(record)) { $<HTMLInputElement>('duel-record').value = record; queueMicrotask(() => this.open()); }
  }
  get isOpen() { return this.dialog.open; }
  open() {
    this.renderRecent();
    this.release();
    if (!this.dialog.open) this.dialog.showModal();
    $('duel-title').focus({ preventScroll: true });
    void this.refresh();
    void this.paymentReadiness();
    void this.savedMatches();
  }
  private async savedMatches(){try{const response=await fetch('/api/paid/history');if(!response.ok)return;const history=await response.json() as {code:string;paid?:{recordId?:string;stage:string}}[];for(const match of history){if(!match.paid?.recordId)continue;const button=document.createElement('button');button.className='paper-button';button.dataset.resumePaid=match.code;button.textContent=`RESUME ${match.code} · ${match.paid.stage.toUpperCase()}`;button.onclick=()=>{this.dialog.close();this.resume?.(match.code);};$('duel-recent').append(button);}}catch{}}
  private async paymentReadiness(){
    const button=$<HTMLButtonElement>('duel-join');button.disabled=true;
    try{
      const response=await fetch('/api/health',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Prize service unavailable.');
      const h=await response.json();
      const matches=h.chainId===escrowProfile.chainId&&h.escrow?.toLowerCase()===escrowProfile.address.toLowerCase()&&h.token?.toLowerCase()===escrowProfile.token.toLowerCase();
      button.disabled=!h.paidEntry||!matches;button.innerHTML=button.disabled?'PRIZE ENTRY UNAVAILABLE <span>↗</span>':'ENTER 1 USDC DUEL <span>↗</span>';
      document.querySelector('.duel-service strong')!.textContent=button.disabled?'Prize service is being configured.':'Prize duels are open.';
      document.querySelector('.duel-service p')!.textContent=button.disabled?(matches?h.paymentReason??'Free online remains available.':'The game and backend escrow configuration do not match.'):'Two signed-in wallets agree their picks, then approve and deposit 1 test USDC each.';
    }catch{button.disabled=true;}
  }
  private async refresh() {
    if (this.checking || this.busy) return;
    this.checking = true; this.config = undefined; this.renderRecord();
    $('duel-chain-status').textContent = 'Checking live contract…';
    $<HTMLButtonElement>('duel-refresh').disabled = true;
    try {
      this.config = await (await chain()).configuration();
      const c = this.config;
      $('duel-chain-status').textContent = c.revoked ? 'Result authority revoked · refunds available' : c.intakePaused && c.resultsPaused ? 'Deposits & results paused · recovery stays open' : c.intakePaused ? 'Deposits paused · recovery stays open' : c.resultsPaused ? 'Results paused · recovery stays open' : 'Live contract connected';
      for (const [id, key] of [['duel-entry', 'entry'], ['duel-pool', 'pool'], ['duel-prize', 'winnerAward'], ['duel-fee', 'treasuryFee']] as const) $(id).textContent = usdc(c.policy[key]);
      if (isRecordId($<HTMLInputElement>('duel-record').value.trim())) await this.lookup();
    } catch (error) { $('duel-chain-status').textContent = 'Live status unavailable · showing pinned contract policy'; this.feedback(message(error)); }
    finally { this.checking = false; $<HTMLButtonElement>('duel-refresh').disabled = false; this.renderRecord(); }
  }
  private getProvider() {
    const provider = (window as unknown as { ethereum?: WalletProvider }).ethereum;
    if (!provider) throw new Error('Open WARCHOG in a browser with an Ethereum-compatible wallet to connect. Training works without a wallet.');
    if (this.provider !== provider) {
      this.provider?.removeListener?.('accountsChanged', this.walletChanged);
      this.provider?.removeListener?.('chainChanged', this.walletChanged);
      this.provider = provider;
      provider.on?.('accountsChanged', this.walletChanged); provider.on?.('chainChanged', this.walletChanged);
    }
    return provider;
  }
  private async connect() {
    if (this.busy) return;
    $<HTMLButtonElement>('duel-wallet').disabled = true;
    try { const provider = this.getProvider(); await provider.request({ method: 'eth_requestAccounts' }); await this.syncWallet(); }
    catch (error) { this.feedback(message(error)); }
    finally { $<HTMLButtonElement>('duel-wallet').disabled = false; }
  }
  private async syncWallet() {
    const version = ++this.walletRequest;
    ++this.request; this.loading = false; this.snapshot = undefined; this.account = undefined; this.network = undefined; this.renderRecord();
    try {
      const provider = this.getProvider();
      const [accounts, network] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
      if (version !== this.walletRequest) return;
      this.account = accounts[0]; this.network = Number(network);
      $('duel-wallet').textContent = this.account ? shortAddress(this.account) : 'CONNECT WALLET';
      $('duel-wallet-status').textContent = this.account ? this.network === escrowProfile.chainId ? 'Monad testnet connected. Credits below belong to this wallet.' : 'Wallet is on another network. Switch to Monad testnet to use recovery actions.' : 'Wallet disconnected. You can still look up public duel records.';
      $('duel-switch').hidden = !this.account || this.network === escrowProfile.chainId;
      if (isRecordId($<HTMLInputElement>('duel-record').value.trim())) await this.lookup();
    } catch (error) { this.feedback(message(error)); }
    finally { this.renderRecord(); }
  }
  private async switchNetwork() {
    if (this.busy) return;
    $<HTMLButtonElement>('duel-switch').disabled = true;
    try {
      const provider = this.getProvider();
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x'+escrowProfile.chainId.toString(16) }] }); }
      catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x'+escrowProfile.chainId.toString(16), chainName: escrowProfile.name, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: escrowProfile.rpcUrls, blockExplorerUrls: [explorer] }] });
      }
      await this.syncWallet();
    } catch (error) { this.feedback(message(error)); }
    finally { $<HTMLButtonElement>('duel-switch').disabled = false; }
  }
  private async lookup() {
    if (this.busy) return;
    const id = $<HTMLInputElement>('duel-record').value.trim();
    if (!isRecordId(id)) { this.feedback('Enter a full duel ID: 0x followed by 64 hexadecimal characters.'); return; }
    const version = ++this.request;
    const account = this.account;
    this.snapshot = undefined; this.loading = true; this.renderRecord();
    $<HTMLButtonElement>('duel-load').disabled = true;
    this.feedback('Reading your duel from Monad testnet…');
    try {
      const snapshot = await (await chain()).readDuel(id, account);
      if (version !== this.request) return;
      this.snapshot = snapshot;
      this.feedback(snapshot.duel.state === 0 ? 'No record found. Check the full duel ID and network.' : 'Duel updated from the contract.');
      if (snapshot.duel.state !== 0) this.remember(id);
    } catch (error) { if (version === this.request) this.feedback(message(error)); }
    finally {
      if (version === this.request) this.loading = false;
      $<HTMLButtonElement>('duel-load').disabled = this.busy || this.loading;
      this.renderRecord();
    }
  }
  private renderRecord() {
    const snapshot = this.snapshot;
    $('duel-record-panel').hidden = !snapshot;
    if (!snapshot) return;
    const view = duelView(snapshot, this.account);
    $('duel-record-state').textContent = view.label;
    $('duel-record-description').textContent = view.description;
    const details = $('duel-record-details'); details.replaceChildren();
    const add = (name: string, value: string) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; details.append(dt, dd); };
    if (snapshot.duel.state !== 0) {
      snapshot.duel.players.forEach((player, seat) => add(`PLAYER ${seat + 1}${view.seat === seat ? ' · YOU' : ''}`, `${shortAddress(player)} · ${snapshot.duel.fundedMask & (1 << seat) ? 'FUNDED' : 'UNPAID'}`));
      add('YOUR CLAIMABLE CREDIT', this.account ? `${usdc(snapshot.credit)} test USDC` : 'Connect wallet to check');
      if (snapshot.duel.state === 1) add('FUNDING DEADLINE', this.date(snapshot.duel.fundingDeadline));
      if (snapshot.duel.state === 2) { add('PLAY DEADLINE', this.date(snapshot.duel.playDeadline)); add('SETTLEMENT DEADLINE', this.date(snapshot.duel.settlementDeadline)); }
      add('TOTAL DEPOSITED', `${usdc(snapshot.duel.ledger.totalDeposited)} test USDC`);
      add('TOTAL TRANSFERRED', `${usdc(snapshot.duel.ledger.totalPaid)} test USDC`);
    }
    const recovery = $('duel-recovery'); recovery.replaceChildren();
    for (const action of view.actions) {
      const button = document.createElement('button'); button.className = 'arcade-enter'; button.dataset.recovery = action.method; button.textContent = action.label;
      button.disabled = this.busy || this.loading || !this.config || this.network !== escrowProfile.chainId;
      button.onclick = () => void this.recover(action.method); recovery.append(button);
    }
    $('duel-record-updated').textContent = `Read at ${this.date(snapshot.chainTime)} · Refresh for current eligibility.`;
  }
  private async recover(method: RecoveryAction) {
    if (!this.snapshot || !this.account || !this.provider || !this.config || this.network !== escrowProfile.chainId || this.busy) return;
    const { id } = this.snapshot, account = this.account, provider = this.provider;
    this.busy = true; this.renderRecord();
    for (const name of ['duel-wallet', 'duel-switch', 'duel-refresh', 'duel-load']) $<HTMLButtonElement>(name).disabled = true;
    $('duel-transaction').hidden = true; this.feedback('Checking eligibility before opening your wallet…');
    try {
      await (await chain()).recover(provider, account, id, method, hash => {
        const link = $<HTMLAnchorElement>('duel-transaction'); link.href = `${explorer}/tx/${hash}`; link.hidden = false;
        this.feedback('Transaction submitted. Waiting for confirmation…');
      });
      this.feedback(method === 'withdrawFor' ? 'Claim confirmed. Tokens were transferred to the recipient wallet.' : 'Refund unlocked. Claim the credit below to transfer your tokens.');
    } catch (error) { this.feedback(`${message(error)}${!$('duel-transaction').hidden ? ' Check the transaction before trying again.' : ''}`); }
    finally {
      this.busy = false;
      for (const name of ['duel-wallet', 'duel-switch', 'duel-refresh', 'duel-load']) $<HTMLButtonElement>(name).disabled = false;
      this.snapshot = undefined;
      try {
        const version = ++this.request;
        const accountNow = this.account;
        const snapshot = await (await chain()).readDuel(id, accountNow);
        if (version === this.request && accountNow === this.account) this.snapshot = snapshot;
      } catch { this.feedback('Refresh your duel to check its latest credit. Your transaction link remains available.'); }
      this.renderRecord();
    }
  }
  private date(seconds: bigint) { return new Date(Number(seconds) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  private feedback(text: string) { $('duel-feedback').textContent = text; }
  private async copyLink() {
    if (!this.snapshot) return;
    const url = new URL(location.href); url.searchParams.delete('qa'); url.searchParams.set('duel', this.snapshot.id);
    try { await navigator.clipboard.writeText(url.href); this.feedback('Duel link copied.'); }
    catch { this.feedback('Copy the duel ID above to share this record.'); }
  }
  private recent(): RecordId[] {
    try { const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(stored) ? stored.filter((id): id is RecordId => typeof id === 'string' && isRecordId(id)).slice(0, 5) : []; }
    catch { return []; }
  }
  private remember(id: RecordId) { try { localStorage.setItem(storageKey, JSON.stringify([id, ...this.recent().filter(value => value !== id)].slice(0, 5))); } catch { /* Storage is optional. */ } this.renderRecent(); }
  private renderRecent() {
    const recent = $('duel-recent'); recent.replaceChildren();
    for (const id of this.recent()) { const button = document.createElement('button'); button.className = 'paper-button'; button.textContent = shortAddress(id); button.title = id; button.onclick = () => { if (this.busy) return; $<HTMLInputElement>('duel-record').value = id; void this.lookup(); }; recent.append(button); }
  }
}
