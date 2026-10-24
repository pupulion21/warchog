import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { verifyMessage, isAddress, type Hex } from 'viem';
import { Store } from './store.ts';
import { Rooms, validFighter, type Peer } from './rooms.ts';
import { Settlement } from './settlement.ts';
import { PaidMatches } from './paid.ts';
import type { SettlementReader } from './settlement.ts';
import { PROTOCOL, type ClientPacket, type ServerPacket } from '../src/online-protocol.ts';
import { getStage } from '../src/stage.ts';
import type { EscrowProfile } from '../src/payment-types.ts';

type AppOptions = { dbPath?: string; origins?: string[]; autoTick?: boolean; roundSeconds?: number; countdownMs?: number; disconnectMs?: number; signerKey?: Hex; settlementReader?: SettlementReader; allowPaidSettlement?: boolean;paymentsEnabled?:boolean;profile?:EscrowProfile };
const cookieToken = (req: IncomingMessage) => /(?:^|;\s*)warchog_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
function parsePacket(value: unknown): ClientPacket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message.');
  const p = value as Record<string, unknown>;
  if (['create','queue','choose'].includes(p.type as string)) {
    if(p.mode!==undefined&&p.mode!=='free'&&p.mode!=='paid')throw new Error('Invalid match mode.');
    if (!validFighter(p.fighter) || typeof p.stage !== 'string') throw new Error('Choose a valid fighter and arena.'); getStage(p.stage);
  } else if (p.type === 'join') {
    if (!validFighter(p.fighter) || typeof p.code !== 'string' || !/^[A-Z2-9]{6}$/i.test(p.code)) throw new Error('Enter the six-character room code.');
  } else if (p.type === 'ready') { if (typeof p.ready !== 'boolean') throw new Error('Invalid ready state.'); }
  else if (p.type === 'input') {
    const input = p.input as Record<string, unknown> | undefined;
    if (!Number.isSafeInteger(p.seq) || (p.seq as number) < 0 || typeof p.lockOn !== 'boolean' || !input ||
      !Number.isFinite(input.x) || !Number.isFinite(input.z) || Object.keys(input).some(k => !['x','z','run','attack','skill','stomp','dodge','jump'].includes(k)) ||
      ['run','attack','skill','stomp','dodge','jump'].some(k => input[k] !== undefined && typeof input[k] !== 'boolean')) throw new Error('Only validated control inputs are accepted.');
  } else if (p.type === 'ping') { if (!Number.isFinite(p.sent)) throw new Error('Invalid ping.'); }
  else if (p.type !== 'leave') throw new Error('Unknown message type.');
  return p as unknown as ClientPacket;
}
export function createApp(options: AppOptions = {}) {
  const store = new Store(options.dbPath ?? '.local/warchog.sqlite');
  const rooms = new Rooms(store, options);
  const settlement = new Settlement(options.signerKey,options.settlementReader,options.profile);
  const paid=new PaidMatches(rooms,store,settlement);
  const clients = new Map<string, { ws: WebSocket; peer: Peer }>();
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false, clientTracking: true });
  const limits = new Map<string, { at: number; count: number }>();
  const allowedOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return false;
    return (options.origins ?? [`http://${req.headers.host}`]).includes(origin);
  };
  const session = (req: IncomingMessage) => { const token = cookieToken(req); return token ? store.session(token) : undefined; };
  function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(stringify(value)); }
  async function body(req: IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON is required.');
    let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) throw new Error('Request is too large.'); }
    return JSON.parse(text || '{}') as Record<string, unknown>;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      const ip = req.socket.remoteAddress ?? 'unknown'; let bucket = limits.get(ip);
      if (!bucket || Date.now() - bucket.at > 60_000) { if (limits.size > 1024) limits.clear(); limits.set(ip, bucket = { at: Date.now(), count: 0 }); }
      if (++bucket.count > 120) { json(res, 429, { error: 'Too many requests. Please wait a moment.' }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const readiness=options.paymentsEnabled?await settlement.readiness():{ready:false,reason:'Prize entry is disabled in server configuration.',expectedSigner:settlement.profile.expectedSigner};
        json(res,200,{name:'WARCHOG',protocol:PROTOCOL,online:true,paidEntry:Boolean(options.paymentsEnabled&&readiness.ready),paidSettlementEnabled:Boolean((options.paymentsEnabled||options.allowPaidSettlement)&&settlement.address),
          signerConfigured:Boolean(settlement.address),paymentReason:readiness.reason,expectedSigner:readiness.expectedSigner,chainId:settlement.profile.chainId,escrow:settlement.profile.address,token:settlement.profile.token,localTest:Boolean(settlement.profile.localTest),roundSeconds:rooms.roundSeconds,rulesetHash:rooms.rulesetHash});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/rooms/lookup'){
        const code=url.searchParams.get('code')?.toUpperCase(),room=code?rooms.rooms.get(code):undefined;
        if(!room||room.phase!=='waiting')json(res,404,{error:'Room is unavailable.'});else json(res,200,{mode:room.mode});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/paid/history'){const current=session(req);json(res,200,current?paid.history(current.id):[]);return true;}
      if (req.method !== 'GET' && !allowedOrigin(req)) { json(res, 403, { error: 'Request origin is not allowed.' }); return true; }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const existing = session(req);
        if (existing) { json(res, 200, { wallet: existing.wallet, protocol: PROTOCOL }); return true; }
        const created = store.createSession();
        res.setHeader('Set-Cookie', `warchog_session=${created.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${req.headers.origin?.startsWith('https://') ? '; Secure' : ''}`);
        json(res, 201, { wallet: null, protocol: PROTOCOL }); return true;
      }
      const current = session(req);
      if (!current) { json(res, 401, { error: 'Open an arena session first.' }); return true; }
      if (req.method === 'POST' && url.pathname === '/api/auth/challenge') {
        const data = await body(req);
        if (!isAddress(data.address as string)) throw new Error('Invalid wallet address.');
        const nonce = randomBytes(24).toString('hex'), origin = req.headers.origin!;
        const message = `WARCHOG wallet login\nOrigin: ${origin}\nChain ID: 10143\nWallet: ${data.address}\nSession: ${current.id}\nNonce: ${nonce}\nExpires: ${new Date(Date.now() + 120_000).toISOString()}\nThis signs you into WARCHOG; it does not approve tokens or transactions.`;
        store.db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)').run(nonce, data.address as string, message, origin, Date.now() + 120_000);
        json(res, 200, { nonce, message }); return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
        const data = await body(req);
        if (typeof data.nonce !== 'string' || typeof data.signature !== 'string' || data.signature.length > 300) throw new Error('Invalid login proof.');
        const challenge = store.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(data.nonce) as { address: Hex; message: string; origin: string; expires: number } | undefined;
        // Consume before the asynchronous signature check, including invalid attempts.
        store.db.prepare('DELETE FROM challenges WHERE nonce=?').run(data.nonce);
        if (!challenge || challenge.expires < Date.now() || challenge.origin !== req.headers.origin || !challenge.message.includes(`Session: ${current.id}\n`) || !await verifyMessage({ address: challenge.address, message: challenge.message, signature: data.signature as Hex })) throw new Error('Login proof is invalid or expired.');
        if (rooms.membership.has(current.id)) throw new Error('Leave your room before changing wallet identity.');
        store.db.prepare('UPDATE sessions SET wallet=? WHERE id=?').run(challenge.address.toLowerCase(), current.id);
        const connected=clients.get(current.id);if(connected)connected.peer.wallet=challenge.address.toLowerCase();
        json(res, 200, { wallet: challenge.address }); return true;
      }
      if (req.method === 'GET' && /^\/api\/matches\/[A-Z2-9]{6}$/.test(url.pathname)) {
        const match = store.match(url.pathname.split('/').at(-1)!);
        if (!match || !match.participants.includes(current.id)) { json(res, 404, { error: 'Match not found for this session.' }); return true; }
        json(res, 200, { ...match, participants: undefined }); return true;
      }
      if (url.pathname.startsWith('/api/paid')) {
        if(req.method==='GET'&&url.pathname==='/api/paid/status'){
          const code=url.searchParams.get('code');if(!code||!/^[A-Z2-9]{6}$/.test(code))throw new Error('A room code is required.');
          json(res,200,await paid.refresh(code,current.id));return true;
        }
        if(req.method==='POST'&&url.pathname==='/api/paid/result'){
          const data=await body(req);const code=typeof data.code==='string'?data.code:undefined;
          json(res,200,await paid.proof(current.id,code));return true;
        }
        if(!options.allowPaidSettlement&&!options.paymentsEnabled||!settlement.address){json(res,503,{error:'Prize duels are closed. Free online play is available.',paidEntry:false});return true;}
        if(req.method==='POST'&&url.pathname==='/api/paid/bind'){
          const data=await body(req);if(typeof data.recordId!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(data.recordId))throw new Error('A funded bytes32 record ID is required.');
          json(res,200,await paid.bind(current.id,data.recordId as Hex));return true;
        }
        json(res,404,{error:'Unknown paid-match operation.'});return true;
      }
      json(res, 404, { error: 'Unknown endpoint.' }); return true;
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request.' }); return true; }
  }
  wsServer.on('connection', (ws, req) => {
    const current = session(req)!;
    const send = (packet: ServerPacket) => { if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 512_000) ws.close(1013, 'Connection too slow. Reconnect.'); else ws.send(stringify(packet)); } };
    const peer: Peer = { id: current.id, ...(current.wallet ? { wallet: current.wallet } : {}), active:()=>clients.get(current.id)?.ws===ws&&ws.readyState===WebSocket.OPEN, send };
    const old = clients.get(current.id); clients.set(current.id, { ws, peer }); old?.ws.close(4001, 'Session moved to another tab.');
    let alive = true, windowAt = Date.now(), messages = 0, controlAt = 0, commands = Promise.resolve();
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15_000);
    send({ type: 'hello', protocol: PROTOCOL, room: rooms.reconnect(peer) });
    ws.on('message', (raw, binary) => {
      if (clients.get(current.id)?.ws !== ws) return;
      if (Date.now() - windowAt >= 1000) { messages = 0; windowAt = Date.now(); }
      if (++messages > 100 || binary) { ws.close(1008, 'Invalid message rate or format.'); return; }
      let packet:ClientPacket;
      try{packet=parsePacket(JSON.parse(raw.toString()));}catch(error){send({type:'error',message:error instanceof Error?error.message:'Invalid message.'});return;}
      // A delivered leave must commit before a following close frame can remove the peer.
      if(packet.type==='leave'){rooms.leave(peer.id);send({type:'left'});return;}
      commands = commands.then(async () => {
        if (ws.readyState !== WebSocket.OPEN || clients.get(current.id)?.ws !== ws) return;
        if (packet.type !== 'input' && packet.type !== 'ping') { if (Date.now() - controlAt < 150) throw new Error('Please wait a moment before the next room action.'); controlAt = Date.now(); }
        switch (packet.type) {
          case 'create': case 'queue':
            if(packet.mode==='paid'&&(!options.paymentsEnabled||!(await settlement.readiness()).ready))throw new Error('Prize entry is unavailable. Check the signer and contract status.');
            await rooms.create(peer,packet.fighter,packet.stage,packet.type==='queue',packet.mode??'free');break;
          case 'join':
            if(rooms.rooms.get(packet.code.toUpperCase())?.mode==='paid'&&(!options.paymentsEnabled||!(await settlement.readiness()).ready))throw new Error('Prize entry is unavailable.');
            rooms.join(peer, packet.code, packet.fighter); break;
          case 'choose': rooms.choose(peer.id, packet.fighter, packet.stage); break;
          case 'ready': if(rooms.require(peer.id).mode==='paid')await paid.ready(peer.id,packet.ready);else rooms.ready(peer.id,packet.ready); break;
          case 'input': rooms.input(peer.id, packet.seq, packet.input, packet.lockOn); break;
          case 'ping': send({ type: 'pong', sent: packet.sent }); break;
        }
      }).catch(error => send({ type: 'error', message: error instanceof Error ? error.message : 'Invalid message.' }));
    });
    ws.on('error', () => {});
    ws.on('close', () => { clearInterval(heartbeat); if (clients.get(current.id)?.ws === ws) { clients.delete(current.id); rooms.disconnect(current.id, peer); } });
  });
  function attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/api/ws') return;
      if (!allowedOrigin(req) || !session(req) || wsServer.clients.size >= 128) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      wsServer.handleUpgrade(req, socket, head, ws => wsServer.emit('connection', ws, req));
    });
  }
  let last = performance.now(), debt = 0;
  const timer = options.autoTick === false ? undefined : setInterval(() => {
    const now = performance.now(), delta = now - last; last = now;
    // Excessive process stalls void active matches rather than silently changing tick speed.
    if (delta > 3000) { for (const room of rooms.rooms.values()) if (room.startedAt && !room.result) rooms.finish(room, 'Void', null, 'Server timing interrupted.'); debt = 0; }
    debt += Math.min(delta, 250);
    while (debt >= 1000 / 60) { rooms.tick(); debt -= 1000 / 60; }
  }, 8);
  const paidTimer=options.autoTick===false?undefined:setInterval(()=>{void paid.sync().catch(()=>{});},3000);
  let closed = false;
  function close() { if (closed) return; closed = true; if (timer) clearInterval(timer);if(paidTimer)clearInterval(paidTimer);paid.close(); for (const ws of wsServer.clients) ws.terminate(); wsServer.close(); clients.clear(); rooms.close(); store.close(); }
  return { handle, attach, close, rooms, store, settlement, paid };
}
