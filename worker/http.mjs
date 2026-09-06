import { askAI } from '../lib/ai.mjs';
import { validatePlan } from '../js/cashflow.mjs';
import { validateChatRequest } from '../js/assistant.mjs';
import { reserveQuota, releaseQuota, clientKeyFor } from './quota.mjs';

export const HEADERS={
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
const json=(status,value,extra={})=>new Response(JSON.stringify(value),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8',...extra}});

async function readJSON(request) {
  if(Number(request.headers.get('content-length'))>48000)throw Object.assign(new Error(),{status:413});
  const reader=request.body?.getReader();
  if(!reader)throw Object.assign(new Error(),{status:400});
  let size=0;const chunks=[];
  while(true){
    const {value,done}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>48000){await reader.cancel();throw Object.assign(new Error(),{status:413});}
    chunks.push(value);
  }
  const body=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(body));}
  catch{throw Object.assign(new Error(),{status:400});}
}

export function createWorker({assets,ask=askAI}={}) {
  return {async fetch(request,env){
    try {
      const url=new URL(request.url), pathname=decodeURIComponent(url.pathname);
      if(pathname==='/api/status') {
        if(!['GET','HEAD'].includes(request.method))return json(405,{error:'GET만 지원합니다.'});
        if(request.method==='HEAD')return new Response(null,{headers:HEADERS});
        const configured=Boolean(env.OPENAI_API_KEY && env.DB && env.APP_ORIGIN);
        return json(200,{configured,model:configured?(env.OPENAI_MODEL||'gpt-4.1-mini'):null,version:'2.0.0'});
      }
      if(pathname==='/api/assistant') {
        if(request.method!=='POST')return json(405,{error:'POST만 지원합니다.'});
        if(!env.APP_ORIGIN || request.headers.get('origin')!==env.APP_ORIGIN)return json(403,{error:'허용된 서비스 주소에서만 AI를 호출할 수 있습니다.'});
        if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json(415,{error:'application/json만 지원합니다.'});
        if(!env.OPENAI_API_KEY || !env.DB)return json(503,{error:'지금은 AI 상담을 사용할 수 없어요.'});
        const body=await readJSON(request);
        if(body?.consent!==true)return json(400,{error:'외부 AI 전송 동의가 필요합니다.'});
        let chat;
        try{chat=validateChatRequest(body);}catch(error){return json(400,{error:error.message});}
        const errors=validatePlan(body.plan);if(errors.length)return json(400,{error:errors[0]});
        const clientKey=await clientKeyFor(request,env.OPENAI_API_KEY);
        let reservation;
        try{reservation=await reserveQuota(env.DB,clientKey);}catch{return json(503,{error:'지금은 AI 상담을 사용할 수 없어요.'});}
        if(!reservation)return json(429,{error:'질문이 많아 잠시 쉬고 있어요. 잠시 후 다시 보내 주세요.'},{'Retry-After':'60'});
        try {
          return json(200,await ask({plan:body.plan,...chat},{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'}));
        }catch{return json(502,{error:'답변을 받지 못했어요. 다시 보내 주세요.'});}
        finally{await releaseQuota(env.DB,reservation).catch(()=>{});}
      }
      if(!['GET','HEAD'].includes(request.method))return json(405,{error:'지원하지 않는 요청입니다.'});
      const file=pathname==='/'?'index.html':pathname.slice(1);
      if(!Object.hasOwn(assets,file))return json(404,{error:'파일을 찾을 수 없습니다.'});
      const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript';
      return new Response(request.method==='HEAD'?null:assets[file],{headers:{...HEADERS,'Content-Type':type+'; charset=utf-8'}});
    }catch(error){return json(error.status===413?413:400,{error:error.status===413?'요청 크기 제한을 초과했습니다.':'요청을 처리할 수 없습니다.'});}
  }};
}
