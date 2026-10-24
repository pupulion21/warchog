import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createApp } from './app.ts';
import { serverSettings } from './config.ts';
const port = Number(process.env.WARCHOG_PORT) || 5190, host = process.env.WARCHOG_HOST ?? '127.0.0.1';
const app = createApp(serverSettings());
const root=resolve(process.env.WARCHOG_ASSET_DIR??'dist');
const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
const server=createServer((req,res)=>{void app.handle(req,res).then(handled=>{
 if(handled)return;
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 let pathname:string;try{pathname=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
 if(pathname!=='/'&&pathname!=='/favicon.svg'&&!pathname.startsWith('/assets/')){res.writeHead(404);res.end();return;}
 const path=resolve(root,pathname==='/'?'index.html':'.'+pathname);
 if(!path.startsWith(root+sep)||!existsSync(path)||!statSync(path).isFile()){res.writeHead(404);res.end('Build the game with npm run build first.');return;}
 res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Content-Length':statSync(path).size,'X-Content-Type-Options':'nosniff','Cache-Control':pathname==='/'?'no-cache':'public, max-age=3600'});
 if(req.method==='HEAD')res.end();else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Request failed.');});});
app.attach(server);
server.listen(port,host,()=>{console.log(`WARCHOG game server: http://${host}:${port}`);console.log('Free online enabled. Prize entry follows verified server/contract readiness.');});
let stopping=false;
function stop(){if(stopping)return;stopping=true;app.close();server.close();server.closeAllConnections();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
