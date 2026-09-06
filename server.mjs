import { promises as fs, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askAI } from './lib/ai.mjs';
import { validatePlan } from './js/cashflow.mjs';
import { validateChatRequest } from './js/assistant.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_FILES=['index.html','styles.css','js/app.mjs','js/chart.mjs','js/model.mjs','js/cashflow.mjs','js/demo.mjs','js/assistant.mjs'];
export const HEADERS={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
function json(res,status,value) {res.writeHead(status,{...HEADERS,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function readJSON(req) {
  return new Promise((resolve,reject)=>{
    let size=0,chunks=[],failed=false;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>48000) {failed=true;chunks=[];reject(Object.assign(new Error('요청이 너무 큽니다.'),{status:413}));}
      else if(!failed) chunks.push(chunk);
    });
    req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(new Error('JSON 형식 오류'),{status:400}));}});
    req.on('error',reject);
  });
}
export function createAppServer(config={}) {
  const apiKey=config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const model=config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const origin=config.origin ?? process.env.APP_ORIGIN ?? '';
  const limit=config.rateLimit ?? 6, dailyLimit=config.dailyLimit ?? 100;
  const clients=new Map();let active=0,day=0,count=0;
  const server=createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/api/status') {
        if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'GET만 지원합니다.'});
        if(req.method==='HEAD'){res.writeHead(200,HEADERS);res.end();return;}
        return json(res,200,{configured:Boolean(apiKey),model:apiKey?model:null,version:'2.0.0'});
      }
      if(pathname==='/api/assistant') {
        if(req.method!=='POST')return json(res,405,{error:'POST만 지원합니다.'});
        const localPort=server.address()?.port;
        const origins=origin?[origin]:[`http://127.0.0.1:${localPort}`,`http://localhost:${localPort}`];
        // Origin과 Host 모두 고정 허용 주소와 비교하여 DNS rebinding을 차단한다.
        if(!origins.includes(req.headers.origin) || !origins.some(o=>new URL(o).host===req.headers.host)) return json(res,403,{error:'허용된 서비스 주소에서만 AI를 호출할 수 있습니다.'});
        if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'application/json만 지원합니다.'});
        if(!apiKey)return json(res,503,{error:'지금은 AI 상담을 사용할 수 없어요.'});
        const now=Date.now(), ip=req.socket.remoteAddress;
        if(Math.floor(now/86400000)!==day){day=Math.floor(now/86400000);count=0;}
        for(const [k,v] of clients) if(now-v.start>=60000) clients.delete(k);
        const bucket=clients.get(ip)||{start:now,count:0};
        if(bucket.count>=limit || count>=dailyLimit || active>=2 || clients.size>=1000)return json(res,429,{error:'질문이 많아 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.'});
        bucket.count++;clients.set(ip,bucket);
        const body=await readJSON(req);
        if(body?.consent!==true)return json(res,400,{error:'외부 AI 전송 동의가 필요합니다.'});
        let chat;
        try {chat=validateChatRequest(body);} catch(error) {return json(res,400,{error:error.message});}
        const errors=validatePlan(body.plan);if(errors.length)return json(res,400,{error:errors[0]});
        if(active>=2 || count>=dailyLimit)return json(res,429,{error:'AI 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.'});
        active++;count++;
        try {return json(res,200,await askAI({plan:body.plan,...chat},{apiKey,model,fetchImpl:config.fetchImpl,timeoutMs:config.timeoutMs}));}
        catch {return json(res,502,{error:'답변을 받지 못했어요. 잠시 후 다시 시도해 주세요.'});}
        finally {active--;}
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'지원하지 않는 요청입니다.'});
      const file=pathname==='/'?'index.html':pathname.slice(1);
      if(!CLIENT_FILES.includes(file))return json(res,404,{error:'파일을 찾을 수 없습니다.'});
      const data=await fs.readFile(path.join(root,file));
      res.writeHead(200,{...HEADERS,'Content-Type':mime[path.extname(file)],'Content-Length':data.length});
      res.end(req.method==='HEAD'?undefined:data);
    } catch(err) {if(!res.headersSent)json(res,err.status||400,{error:err.status===413?'요청 크기 제한을 초과했습니다.':'요청을 처리할 수 없습니다.'});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
  const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
  createAppServer().listen(port,host,()=>console.log(`상환ON: http://${host}:${port} · ${process.env.OPENAI_API_KEY?'AI 설정됨':'AI 미설정'}`));
}
