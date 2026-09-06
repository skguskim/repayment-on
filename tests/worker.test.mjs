import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createWorker } from '../worker/http.mjs';
import { reserveQuota, releaseQuota, clientKeyFor } from '../worker/quota.mjs';
import { cloneDemo } from '../js/demo.mjs';

function database(t) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  const dir=new URL('../drizzle/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(file,dir),'utf8'));
  return {sql,prepare(query){const statement=sql.prepare(query);return {bind(...values){return {
    async run(){return statement.run(...values);},async first(){return statement.get(...values)??null;},
  };}};}};
}
const origin='https://repayment.example';
const payload=()=>({plan:cloneDemo(),question:'9월 말 잔액을 설명해줘',history:[],activeScenario:'base',consent:true});
const request=(body=payload(),headers={})=>new Request(origin+'/api/assistant',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.1',...headers},body:JSON.stringify(body)});
const environment=db=>({DB:db,OPENAI_API_KEY:'test-secret',APP_ORIGIN:origin});

test('배포 서버는 공개 파일만 제공하고 키와 서버 코드를 숨긴다',async t=>{
  const worker=createWorker({assets:{'index.html':'상환ON'}}),env=environment(database(t));
  assert.equal((await worker.fetch(new Request(origin+'/'),env)).status,200);
  for(const file of ['.env','lib/ai.mjs','worker/http.mjs','.openai/hosting.json','package.json'])assert.equal((await worker.fetch(new Request(origin+'/'+file),env)).status,404);
  const status=await worker.fetch(new Request(origin+'/api/status'),env);assert.equal((await status.json()).configured,true);
  assert.equal((await (await worker.fetch(new Request(origin+'/api/status'),{...env,OPENAI_API_KEY:''})).json()).configured,false);
});

test('배포 서버는 출처·동의·입력·질문 크기를 외부 호출 전에 검사한다',async t=>{
  let calls=0;const db=database(t),worker=createWorker({assets:{},ask:async()=>{calls++;}}),env=environment(db);
  assert.equal((await worker.fetch(request(payload(),{origin:'https://elsewhere.example'}),env)).status,403);
  assert.equal((await worker.fetch(request({...payload(),consent:false}),env)).status,400);
  assert.equal((await worker.fetch(request({...payload(),plan:{}}),env)).status,400);
  assert.equal((await worker.fetch(request({...payload(),question:'x'.repeat(2001)}),env)).status,400);
  assert.equal((await worker.fetch(request({...payload(),question:'x'.repeat(50000)}),env)).status,413);
  assert.equal((await worker.fetch(request(payload(),{'content-type':'text/plain'}),env)).status,415);
  assert.equal(calls,0);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM ai_requests').get().n,0);
});

test('배포 서버의 대화는 계산 조건을 바꾸지 않고 요청 메타데이터만 남긴다',async t=>{
  const db=database(t),env=environment(db),body=payload(),before=structuredClone(body);
  const worker=createWorker({assets:{},ask:async p=>{assert.deepEqual(p.plan,body.plan);return {mode:'ai',reply:'9월 말에는 70만원이 남아요.'};}});
  const response=await worker.fetch(request(body),env);assert.equal(response.status,200);assert.equal((await response.json()).mode,'ai');assert.deepEqual(body,before);
  const rows=db.sql.prepare('SELECT * FROM ai_requests').all();assert.equal(rows.length,1);assert.equal(rows[0].lease_until,0);
  assert.deepEqual(Object.keys(rows[0]).sort(),['client_key','created_at','id','lease_until']);
  assert.ok(!JSON.stringify(rows).includes('192.0.2.1'));assert.ok(!JSON.stringify(rows).includes(body.question));
});

test('외부 AI 실패는 일반 오류로 돌아오고 사용 중인 요청 자리를 반환한다',async t=>{
  const db=database(t),worker=createWorker({assets:{},ask:async()=>{throw new Error('internal test-secret');}});
  const response=await worker.fetch(request(),environment(db));assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/test-secret|internal/);
  assert.equal(db.sql.prepare('SELECT SUM(lease_until) n FROM ai_requests').get().n,0);
  const broken=environment({prepare(){throw new Error('database secret');}});assert.equal((await worker.fetch(request(),broken)).status,503);
});

test('서로 다른 배포 인스턴스도 동시에 두 개까지만 AI를 호출한다',async t=>{
  const db=database(t),env=environment(db),jobs=[];
  const ask=()=>new Promise(resolve=>jobs.push(()=>resolve({mode:'ai',reply:'확인했어요.'})));
  const first=createWorker({assets:{},ask}),second=createWorker({assets:{},ask});
  const p1=first.fetch(request(),env),p2=second.fetch(request(),env);
  while(jobs.length<2)await new Promise(resolve=>setImmediate(resolve));
  const denied=await first.fetch(request(),env);assert.equal(denied.status,429);
  jobs.forEach(release=>release());assert.equal((await p1).status,200);assert.equal((await p2).status,200);
});

test('분당 제한·일일 전체 한도·날짜 변경·만료된 요청을 SQL로 검증한다',async t=>{
  const db=database(t),now=Date.UTC(2026,8,7,12);
  for(let i=0;i<6;i++){const id=await reserveQuota(db,'same-client',now);assert.ok(id);await releaseQuota(db,id);}
  assert.equal(await reserveQuota(db,'same-client',now),null);
  const later=await reserveQuota(db,'same-client',now+60001);assert.ok(later);await releaseQuota(db,later);
  for(let i=7;i<100;i++){const id=await reserveQuota(db,'client-'+i,now+60001);assert.ok(id);await releaseQuota(db,id);}
  assert.equal(await reserveQuota(db,'another-client',now+60001),null);
  const nextDay=now+86400000;assert.ok(await reserveQuota(db,'fresh-client',nextDay));assert.ok(await reserveQuota(db,'fresh-client',nextDay));
  assert.equal(await reserveQuota(db,'fresh-client',nextDay),null);assert.ok(await reserveQuota(db,'fresh-client',nextDay+30001));
});

test('클라이언트 구분 값은 원본 IP를 남기지 않고 날짜마다 달라진다',async()=>{
  const req=request(),now=Date.UTC(2026,8,7);
  const a=await clientKeyFor(req,'secret',now),b=await clientKeyFor(req,'secret',now+86400000);
  assert.equal(a.length,64);assert.notEqual(a,b);assert.notEqual(a,await clientKeyFor(req,'other-secret',now));
});
