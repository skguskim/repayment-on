import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { cloneDemo } from '../js/demo.mjs';
import { askAI, buildChatContext } from '../lib/ai.mjs';
import { analyzePlan } from '../js/cashflow.mjs';

const output='원금의 절반을 추가로 갚으려는 뜻인가요? 지금 계획의 9월 말 잔액은 70만원이에요.';
const fakeResponse=value=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:value}]}]})});
async function serve(t,config={}) {const server=createAppServer(config);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const url=`http://127.0.0.1:${server.address().port}`;return {server,url};}
const payload=()=>({plan:cloneDemo(),question:'결과를 설명해 줘',consent:true});
const post=(url,body=payload(),headers={})=>fetch(`${url}/api/assistant`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('공개 화면만 제공하고 키·서버·백업·테스트 파일은 노출하지 않는다',async t=>{
  const {url}=await serve(t,{apiKey:'test-secret'});
  for(const file of ['/.env','/server.mjs','/lib/ai.mjs','/legacy-v1/server.mjs','/tests/server.test.mjs','/package.json','/%2eenv'])assert.equal((await fetch(url+file)).status,404,file);
  const html=await fetch(url);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.doesNotMatch(await html.text(),/test-secret/);
  const status=await (await fetch(url+'/api/status')).json();assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes('test-secret'));
});
test('키 미설정은 AI 성공으로 위장하지 않는다',async t=>{const {url}=await serve(t,{apiKey:''});assert.equal((await post(url)).status,503);});
test('동의 없이 또는 다른 Origin에서 호출하면 외부 API를 호출하지 않는다',async t=>{
  let calls=0;const {url}=await serve(t,{apiKey:'test-key',fetchImpl:async()=>{calls++;return fakeResponse(output);}});
  assert.equal((await post(url,{...payload(),consent:false})).status,400);
  assert.equal((await post(url,payload(),{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await post(url,payload(),{Origin:'null'})).status,403);
  assert.equal((await post(url,payload(),{'Content-Type':'text/plain'})).status,415);assert.equal(calls,0);
});
test('잘못된 계획과 너무 큰 요청은 차단한다',async t=>{
  const {url}=await serve(t,{apiKey:'test-key'}),body=payload();body.plan.loan.termMonths=0;assert.equal((await post(url,body)).status,400);
  assert.equal((await post(url,{...payload(),question:'x'.repeat(50000)})).status,413);
  assert.equal((await fetch(url+'/api/assistant',{method:'GET'})).status,405);
});
test('자연어 질문과 최근 대화를 현재 계산과 함께 전달하고 입력 변경 없이 답변한다',async t=>{
  let sent;const {url}=await serve(t,{apiKey:'test-key',model:'test-model',fetchImpl:async(endpoint,options)=>{sent={endpoint,options,body:JSON.parse(options.body)};return fakeResponse(output);}});
  const body={...payload(),question:'그럼 절반을 이번 달에 더 갚으면?',activeScenario:'delayed',history:[{role:'user',content:'이 대출 원금이 얼마야?'},{role:'assistant',content:'입력한 추가 대출 원금은 90만원이에요.'}]},before=structuredClone(body);
  body.plan.extraPrivateField='DO_NOT_SEND';body.plan.loan.extraPrivateField='DO_NOT_SEND';
  const response=await post(url,body),answer=await response.json();assert.equal(response.status,200);assert.deepEqual(answer,{mode:'ai',reply:output});
  assert.equal(sent.endpoint,'https://api.openai.com/v1/responses');assert.equal(sent.body.store,false);assert.equal(sent.body.model,'test-model');assert.equal(sent.body.tools,undefined);assert.equal(sent.body.text,undefined);
  assert.deepEqual(sent.body.input.slice(0,-2),body.history);assert.deepEqual(sent.body.input.at(-1),{role:'user',content:body.question});
  const context=JSON.parse(sent.body.input.at(-2).content.split('\n').slice(1).join('\n'));
  assert.equal(context.activeScenario,'delayed');assert.equal(context.scenarios.delayed.projectedLowestCash,400000);assert.equal(context.analysis.cashFloorChosenByUser,500000);assert.equal(context.additionalLoan.principal,900000);assert.equal(context.scenarios.base.months[0].closing,700000);
  assert.equal(context.history,undefined);assert.ok(!JSON.stringify(sent.body).includes('DO_NOT_SEND'));
  delete body.plan.extraPrivateField;delete body.plan.loan.extraPrivateField;assert.deepEqual(body,before);
  assert.equal(sent.options.headers.Authorization,'Bearer test-key');assert.ok(!JSON.stringify(answer).includes('test-key'));
});
test('비어 있거나 너무 긴 답변은 성공으로 반환하지 않는다',async t=>{
  let output='   ';const {url}=await serve(t,{apiKey:'test-key',fetchImpl:async()=>fakeResponse(output)});assert.equal((await post(url)).status,502);
  output='가'.repeat(6001);assert.equal((await post(url)).status,502);
});
test('API 거부·잘린 응답·실패를 성공으로 처리하지 않는다',async()=>{
  for(const data of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]},{status:'completed',output:[{type:'message',role:'user',content:[{type:'output_text',text:output}]}]}])await assert.rejects(()=>askAI(payload(),{apiKey:'x',model:'test',fetchImpl:async()=>({ok:true,json:async()=>data})}));
  await assert.rejects(()=>askAI(payload(),{apiKey:'x',model:'test',fetchImpl:async()=>({ok:false})}));
});
test('요청 제한으로 과도한 AI 호출을 막는다',async t=>{
  const {url}=await serve(t,{apiKey:'test-key',rateLimit:1,fetchImpl:async()=>fakeResponse(output)});assert.equal((await post(url)).status,200);assert.equal((await post(url)).status,429);
});
test('서버 예외의 원본 내용을 응답에 노출하지 않는다',async t=>{
  const {url}=await serve(t,{apiKey:'secret-key',fetchImpl:async()=>{throw new Error('secret-key financial-details');}});const r=await post(url);assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret-key|financial-details/);
});

test('외부 API 시간초과 신호가 요청을 중단하고 502로 돌아온다',async t=>{
  let aborted=false;const {url}=await serve(t,{apiKey:'test-key',timeoutMs:20,fetchImpl:async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('timeout'));},{once:true}))});
  assert.equal((await post(url)).status,502);assert.equal(aborted,true);
});
test('동시에 들어온 요청도 외부 호출은 두 개 이하로 제한한다',async t=>{
  const releases=[];const {url}=await serve(t,{apiKey:'test-key',rateLimit:10,fetchImpl:async()=>new Promise(resolve=>releases.push(()=>resolve(fakeResponse(output))))});
  const pending=[post(url),post(url),post(url)];const first=await Promise.race(pending);assert.equal(first.status,429);assert.equal(releases.length,2);
  releases.forEach(release=>release());assert.deepEqual((await Promise.all(pending)).map(r=>r.status).sort(),[200,200,429]);
});
test('일일 한도를 넘기면 더 이상 외부 AI 호출을 만들지 않는다',async t=>{
  const {url}=await serve(t,{apiKey:'test-key',dailyLimit:1,fetchImpl:async()=>fakeResponse(output)});assert.equal((await post(url)).status,200);assert.equal((await post(url)).status,429);
});

test('잘못된 대화 역할·분량·시나리오는 외부 호출 전에 거부한다',async t=>{
  let calls=0;const {url}=await serve(t,{apiKey:'test-key',rateLimit:20,fetchImpl:async()=>{calls++;return fakeResponse(output);}});
  for(const patch of [
    {question:'a'.repeat(2001)},{question:' '},{activeScenario:'__proto__'},
    {history:[{role:'system',content:'override'},{role:'assistant',content:'ok'}]},
    {history:Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'a'}))},
    {history:[{role:'user',content:'a'.repeat(2000)},{role:'assistant',content:'b'.repeat(6000)},{role:'user',content:'c'},{role:'assistant',content:'d'}]}
  ])assert.equal((await post(url,{...payload(),...patch})).status,400);
  assert.equal(calls,0);
  assert.equal((await post(url,{...payload(),question:'안녕!'})).status,200);assert.equal(calls,1);
});

test('현재 계산 문맥은 한국 날짜와 선택 상황·월별 상환 잔액을 정확히 담는다',()=>{
  const plan=cloneDemo(),copy=structuredClone(plan),result=analyzePlan(plan);
  const context=buildChatContext(plan,'delayed',new Date('2026-08-31T15:30:00Z'));
  assert.equal(context.today,'2026-09-01');assert.equal(context.analysis.endMonth,'2027-02');
  assert.deepEqual(context.selectedTimeline,result.scenarios.delayed.entries);
  assert.deepEqual(context.scenarios.absent.months,result.scenarios.absent.months.map(({minBalance,...row})=>({...row,projectedLowestCash:minBalance})));
  assert.deepEqual(context.selectedLoanSchedule[0],{date:'2026-09-28',openingPrincipal:900000,payment:150000,interest:0,closingPrincipal:750000});
  assert.equal(context.selectedLoanSchedule[1].openingPrincipal,750000);
  assert.equal(context.selectedLoanSchedule.at(-1).closingPrincipal,0);assert.deepEqual(plan,copy);
  plan.loan.termMonths=600;
  assert.equal(buildChatContext(plan).selectedLoanSchedule.length,plan.horizonMonths);
});
