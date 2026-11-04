// Loopback-only judging host. Uses the real mission APIs and production web build.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createServer} from '../server/index.ts';
const root=path.resolve(import.meta.dirname,'..'),state=path.join(root,'.board/judge-runtime'),dist=path.join(root,'web/dist');
fs.mkdirSync(state,{recursive:true});
if(!fs.existsSync(path.join(dist,'index.html')))throw new Error('Run npm --prefix web run build first.');
try{const existing=await fetch('http://127.0.0.1:5180/__judge/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());if(existing.kind==='upside-down-local-judge'){console.log('Already running: http://127.0.0.1:5180');process.exit(0);}}catch{}
// Refuse occupied ports; never kill another service.
const reserve=async(port)=>{const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>server.close(resolve));};
await reserve(4050);await reserve(5180);
process.env.UD_AUTO_WATCH='false';
const instance=createServer(path.join(state,'mission.db')),api=instance.app.listen(4050,'127.0.0.1');
const banner='<div role="status" style="padding:10px 18px;background:#2c2540;color:#eee5ff;font:13px/1.5 system-ui;position:relative;z-index:1000">LOCAL JUDGE PROTOTYPE · Heuristic planning · Manual coding-assistant handoffs · GitHub communication/PR verification available after authorization · CI must be observed · No public deployment</div>';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const front=http.createServer((req,res)=>{
 if(req.url==='/__judge/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({kind:'upside-down-local-judge',status:'ok',mode:'local-heuristic-prototype',api:'http://127.0.0.1:4050'}));return;}
 if(req.url?.startsWith('/api/')){const proxy=http.request({hostname:'127.0.0.1',port:4050,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local coordinator unavailable');});res.on('close',()=>proxy.destroy());req.pipe(proxy);return;}
 if(req.url?.startsWith('/local/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'LEGACY_SERVICE_UNAVAILABLE',message:'Use the Mission Control planning and manual-handoff pages in this local prototype.'}));return;}
 try{const pathname=decodeURIComponent(new URL(req.url??'/','http://127.0.0.1').pathname);let target=path.resolve(dist,'.'+pathname);if(!target.startsWith(dist+path.sep)&&target!==dist){res.writeHead(403);res.end();return;}if(!path.extname(target)||fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(dist,'index.html');if(!fs.existsSync(target)){res.writeHead(404);res.end();return;}const real=fs.realpathSync(target);if(!real.startsWith(fs.realpathSync(dist)+path.sep)){res.writeHead(403);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(target.endsWith('index.html'))res.end(fs.readFileSync(target,'utf8').replace('<body>','<body>'+banner));else fs.createReadStream(target).pipe(res);}catch{res.writeHead(500);res.end('Selected local assets unavailable');}
});
front.listen(5180,'127.0.0.1',()=>{fs.writeFileSync(path.join(state,'control.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:5180',mode:'local-judge',source:root}));console.log('READY: http://127.0.0.1:5180 — local judge prototype; real persisted mission API, heuristic planning, manual tool prompts.');});
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;front.closeAllConnections();api.closeAllConnections();front.close();api.close(()=>{instance.db.close();process.exit(0);});};process.on('SIGINT',stop);process.on('SIGTERM',stop);
