import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as engine from '../js/cashflow.mjs';
import * as demo from '../js/demo.mjs';
import * as assistant from '../js/assistant.mjs';
import * as chart from '../js/chart.mjs';

// 브라우저·URL에 접근하지 않는 DOM 단위 테스트. 레이아웃/실제 브라우저 검증을 대체하지 않는다.
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const app=(await readFile(new URL('../js/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
async function setup(t,{configured=false,backend,calculated=true}={}) {
  const errors=[],network=[];let report;
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://unit-test.invalid',virtualConsole});
  const w=dom.window,d=w.document;
  Object.assign(w,engine,demo,assistant,chart,{structuredClone,AbortController,Blob});
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.print=()=>{};
  w.URL.createObjectURL=blob=>{report=blob;return 'blob:unit-test';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=()=>{};
  w.fetch=async(url,options)=>{network.push({url,options});if(url==='/api/status')return {ok:true,json:async()=>({configured,model:configured?'test-model':null})};if(url==='/api/assistant'&&backend)return backend(options);throw new Error('Unmocked request');};
  w.eval(app);await settle();
  t.after(()=>{w.close();assert.deepEqual(errors,[],'DOM 스크립트 오류 없음');});
  const $=s=>d.querySelector(s),click=s=>{const e=$(s);assert.ok(e,`요소 존재: ${s}`);e.click();};
  const input=(s,value)=>{const el=$(s);assert.ok(el,s);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const submit=s=>$(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  if(calculated)submit('#plan-form');
  return {w,d,$,click,input,submit,network,report:()=>report};
}
test('초기 화면에는 조건 입력만 있고 계산 버튼을 눌러야 결과로 이동한다',async t=>{
  const u=await setup(t,{calculated:false});
  assert.equal(u.$('#input-screen').hidden,false);assert.equal(u.$('#results').hidden,true);
  assert.equal(u.$('#metrics').textContent,'');assert.equal(u.$('#download').disabled,true);
  assert.equal(u.w.location.hash,'#input');assert.match(u.$('#demo-label').textContent,/예시 금액/);
  u.input('#field-reserve','200');u.submit('#plan-form');
  assert.equal(u.$('#input-screen').hidden,true);assert.equal(u.$('#results').hidden,false);
  assert.equal(u.w.location.hash,'#results');assert.equal(u.d.activeElement.id,'result-title');
  assert.equal(u.$('#progress-results').getAttribute('aria-current'),'step');
  assert.match(u.$('#metrics').textContent,/170만/);
});
test('조건 수정과 재계산이 입력값을 보존하며 새 결과를 표시한다',async t=>{
  const u=await setup(t);u.click('#edit-plan');
  assert.equal(u.$('#results').hidden,true);assert.equal(u.$('#input-screen').hidden,false);
  assert.equal(u.$('#field-reserve').value,'100');assert.equal(u.d.activeElement.id,'input-title');
  u.click('#next-input');assert.equal(u.$('#panel-events').hidden,false);
  u.click('#next-input');assert.equal(u.$('#panel-loan').hidden,false);assert.equal(u.$('#next-input').hidden,true);
  u.click('#previous-input');u.click('#previous-input');u.input('#field-reserve','200');
  u.submit('#plan-form');assert.equal(u.$('#results').hidden,false);assert.match(u.$('#metrics').textContent,/170만/);
});
test('초기 오류와 다른 탭의 잘못된 조건은 결과로 이동하지 않고 수정할 탭을 연다',async t=>{
  const u=await setup(t,{calculated:false});u.input('#field-reserve','-1');u.click('#tab-loan');u.submit('#plan-form');
  assert.equal(u.$('#results').hidden,true);assert.equal(u.w.location.hash,'#input');
  assert.equal(u.$('#panel-cash').hidden,false);assert.equal(u.d.activeElement.id,'error-box');
  assert.equal(u.$('#metrics').textContent,'');
});
test('방문 기록에서 결과로 돌아갈 때 수정 전 결과를 다시 노출하지 않는다',async t=>{
  const u=await setup(t);u.click('#edit-plan');u.input('#field-reserve','200');
  u.w.history.replaceState({repaymentScreen:'results'},'','#results');
  u.w.dispatchEvent(new u.w.PopStateEvent('popstate'));
  assert.equal(u.w.location.hash,'#input');assert.equal(u.$('#results').hidden,true);
  assert.equal(u.$('#field-reserve').value,'200');
});
test('브라우저 뒤로가기·앞으로가기가 입력과 계산 결과를 복원한다',{timeout:2000},async t=>{
  const u=await setup(t);
  const traverse=async direction=>{
    const done=new Promise(resolve=>u.w.addEventListener('popstate',resolve,{once:true}));
    u.w.history[direction]();await done;
  };
  await traverse('back');assert.equal(u.$('#input-screen').hidden,false);assert.equal(u.$('#field-reserve').value,'100');
  await traverse('forward');assert.equal(u.$('#results').hidden,false);assert.match(u.$('#metrics').textContent,/70만/);
  u.w.history.pushState(null,'','#method');u.w.dispatchEvent(new u.w.PopStateEvent('popstate'));
  assert.equal(u.$('#results').hidden,false,'계산 안내로 이동해도 결과 화면을 유지한다');
});
test('계산 결과는 표시하고 사용할 수 없는 외부 AI 옵션은 숨긴다',async t=>{
  const u=await setup(t);assert.match(u.$('#metrics').textContent,/70만/);assert.equal(u.$('#ai-consent-row').hidden,true);assert.equal(u.$('#ai-privacy').hidden,true);assert.equal(u.$('#ai-consent').disabled,true);
  assert.equal(u.d.querySelectorAll('[data-scenario]').length,5);
});
test('다섯 시나리오 전환이 위험 신호와 표를 함께 갱신한다',async t=>{
  const u=await setup(t);u.click('#scenario-delayed');assert.match(u.$('#result-status').textContent,/최소 유지 잔액을 밑돌/);assert.match(u.$('#metrics').textContent,/40만/);
  u.click('#scenario-absent');assert.match(u.$('#result-status').textContent,/2026-12-28/);assert.match(u.$('#metrics').textContent,/-80만/);
  u.click('#scenario-opportunity');assert.match(u.$('#metrics').textContent,/200만/);assert.match(u.$('#scenario-note').textContent,/미확정 소득도 예정대로/);
});
test('입력 수정 시 이전 결과로 질문·보고서를 만들지 못하며 재계산 후 활성화된다',async t=>{
  const u=await setup(t);u.input('#field-reserve','200');assert.equal(u.$('#download').disabled,true);assert.equal(u.$('#ask-button').disabled,true);
  u.submit('#plan-form');assert.equal(u.$('#download').disabled,false);assert.match(u.$('#metrics').textContent,/170만/);assert.equal(u.$('#error-box').hidden,true);
});
test('잘못된 입력을 오류로 표시하고 기존 결과를 덮어쓰지 않는다',async t=>{
  const u=await setup(t);const before=u.$('#metrics').textContent;u.input('#field-reserve','-1');u.submit('#plan-form');assert.equal(u.$('#error-box').hidden,false);assert.match(u.$('#error-box').textContent,/현재 유동자금/);assert.equal(u.$('#metrics').textContent,before);
});
test('미래소득 추가·일회성 변경·삭제 및 금액 입력을 처리한다',async t=>{
  const u=await setup(t);u.click('#tab-events');assert.equal(u.$('#panel-events').hidden,false);u.click('#add-event');assert.equal(u.d.querySelectorAll('.event-card').length,3);
  u.input('#field-events-2-title','추가 장학금');u.input('#field-events-2-amount','50');u.submit('#plan-form');u.click('#scenario-opportunity');assert.match(u.$('#metrics').textContent,/250만/);
  u.click('[data-remove-event="2"]');assert.equal(u.d.querySelectorAll('.event-card').length,2);u.submit('#plan-form');assert.equal(u.$('#error-box').hidden,true);
});
test('미래소득 이름은 HTML이나 스크립트로 실행되지 않는다',async t=>{
  const u=await setup(t);u.click('#tab-events');u.input('#field-events-0-title','<img src=x onerror=alert(1)>');u.submit('#plan-form');u.click('#scenario-delayed');
  assert.equal(u.d.querySelectorAll('img').length,0);assert.match(u.$('#scenario-note').textContent,/<img/);assert.equal(u.d.querySelectorAll('#ledger [onerror]').length,0);
});
test('월별 납부 일정은 개월 수 변경을 따라가고 0원 일정도 유효하다',async t=>{
  const u=await setup(t);u.click('#tab-loan');u.click('#schedule-toggle');assert.equal(u.d.querySelectorAll('[data-path^="debtSchedule."]').length,6);
  u.input('#field-debtSchedule-0','0');u.click('#tab-cash');u.input('#field-horizonMonths','12');u.click('#tab-loan');assert.equal(u.d.querySelectorAll('[data-path^="debtSchedule."]').length,12);u.submit('#plan-form');assert.equal(u.$('#error-box').hidden,true);
});
test('빈 분석 기간에서 납부 일정 토글도 예외 없이 입력 오류로 처리한다',async t=>{
  const u=await setup(t);u.input('#field-horizonMonths','');u.click('#tab-loan');u.click('#schedule-toggle');u.submit('#plan-form');assert.match(u.$('#error-box').textContent,/분석 기간/);
});
test('과거 관측월 추가·중앙값 반영과 직접 입력을 처리한다',async t=>{
  const u=await setup(t);u.click('#add-history');assert.equal(u.d.querySelectorAll('.history-table tbody tr').length,7);u.click('#use-history');assert.equal(u.$('#field-baseline-income').value,'80');
  u.click('#blank-button');u.submit('#plan-form');assert.equal(u.$('#error-box').hidden,true);assert.equal(u.d.querySelectorAll('[data-demo][aria-pressed="true"]').length,0);
});
const aiResponse=reply=>({ok:true,json:async()=>({mode:'ai',reply})});
const asks=u=>u.network.filter(request=>request.url==='/api/assistant').map(request=>JSON.parse(request.options.body));

test('동의 전에는 질문이나 재무 입력을 전송하지 않고 필요한 동의를 안내한다',async t=>{
  const u=await setup(t,{configured:true});u.input('#question','내 돈 언제 부족해?');u.submit('#ask-form');await settle();
  assert.equal(asks(u).length,0);assert.equal(u.$('#ai-consent-row').hidden,false);assert.equal(u.$('#ai-consent').checked,false);
  assert.match(u.$('#chat-error').textContent,/동의/);assert.equal(u.$('#chat-messages').children.length,0);assert.equal(u.$('#question').value,'내 돈 언제 부족해?');
});

test('자연어 문답이 쌓이고 계산값·입력·시나리오는 그대로 유지된다',async t=>{
  const responses=['원금의 절반을 추가로 갚으려는 뜻인가요?','45만원을 더 내면 9월 말 잔액은 70만원에서 25만원으로 줄어요.'];
  const u=await setup(t,{configured:true,backend:async()=>aiResponse(responses.shift())});
  const before={inputs:[...u.d.querySelectorAll('[data-path]')].map(el=>el.value),metrics:u.$('#metrics').textContent,ledger:u.$('#ledger').textContent,chart:u.$('#cash-chart').innerHTML};
  u.click('#ai-consent');u.input('#question','내가 이거 이번 달에 절반 갚으면 어떻게 돼?');u.submit('#ask-form');await settle();
  assert.match(u.$('#chat-messages').textContent,/원금의 절반/);assert.equal(u.d.querySelectorAll('.chat-message').length,2);
  assert.equal(u.$('#question').value,'');assert.equal(u.$('#ask-button').disabled,false);
  u.input('#question','응, 예정 납부액 외에 45만원을 더 갚는다는 뜻이야');u.submit('#ask-form');await settle();
  const sent=asks(u);assert.equal(sent.length,2);assert.equal(sent[0].consent,true);assert.deepEqual(sent[0].history,[]);
  assert.deepEqual(sent[1].history,[{role:'user',content:sent[0].question},{role:'assistant',content:'원금의 절반을 추가로 갚으려는 뜻인가요?'}]);
  assert.equal(sent[1].activeScenario,'base');assert.deepEqual(sent[0].plan,sent[1].plan);
  assert.equal(u.d.querySelectorAll('.chat-message').length,4);assert.match(u.$('#chat-messages').textContent,/25만원/);
  assert.deepEqual([...u.d.querySelectorAll('[data-path]')].map(el=>el.value),before.inputs);
  assert.equal(u.$('#metrics').textContent,before.metrics);assert.equal(u.$('#ledger').textContent,before.ledger);assert.equal(u.$('#cash-chart').innerHTML,before.chart);
  assert.equal(u.d.querySelector('#proposal-box, #apply-proposal, #undo-change'),null);
});

test('질문과 AI 답변의 HTML은 실행하지 않고 텍스트로 표시한다',async t=>{
  const text='<img src=x onerror=alert(1)>\n잔액을 함께 살펴볼게요.';
  const u=await setup(t,{configured:true,backend:async()=>aiResponse(text)});u.click('#ai-consent');
  u.input('#question','<script>alert(1)</script>');u.submit('#ask-form');await settle();
  assert.equal(u.$('.chat-message.assistant p').textContent,text);
  assert.equal(u.d.querySelectorAll('#chat-messages img, #chat-messages script, #chat-messages [onerror]').length,0);
});

test('오류 시 가짜 답변 대신 재시도를 제공하고 실패한 대화를 다음 요청에 넣지 않는다',async t=>{
  let attempts=0;const u=await setup(t,{configured:true,backend:async()=>++attempts===1?{ok:false,status:502}:aiResponse('지금 계획에서 9월 말 잔액은 70만원이에요.')});
  u.click('#ai-consent');u.input('#question','내 돈 언제 부족해?');u.submit('#ask-form');await settle();
  assert.equal(u.d.querySelectorAll('.chat-message.assistant').length,0);assert.equal(u.$('#retry-chat').hidden,false);assert.match(u.$('#chat-error').textContent,/다시 보내/);
  u.click('#retry-chat');await settle();
  assert.equal(u.$('#chat-error').hidden,true);assert.equal(u.d.querySelectorAll('.chat-message.user').length,1);
  assert.equal(asks(u)[1].question,asks(u)[0].question);assert.deepEqual(asks(u)[1].history,[]);
});

test('응답 대기 중 중복 전송을 막고 새 조건 뒤 늦게 도착한 답변을 버린다',async t=>{
  let resolve;const u=await setup(t,{configured:true,backend:()=>new Promise(r=>resolve=r)});
  u.click('#ai-consent');u.input('#question','이번 달은?');u.submit('#ask-form');await settle();u.submit('#ask-form');
  assert.equal(asks(u).length,1);assert.equal(u.$('#ask-button').disabled,true);assert.equal(u.$('#question').disabled,true);assert.match(u.$('.chat-message.pending').textContent,/답변을 작성/);
  u.input('#field-reserve','200');assert.equal(u.network.at(-1).options.signal.aborted,true);
  resolve(aiResponse('오래된 결과'));await settle();
  assert.equal(u.$('#ask-button').disabled,true);assert.equal(u.$('#chat-messages').textContent,'');
  u.submit('#plan-form');assert.equal(u.$('#ask-button').disabled,false);
});

test('시나리오 변경은 새 문맥으로 대화를 시작하고 이전 응답은 버린다',async t=>{
  let resolve,first=true;const u=await setup(t,{configured:true,backend:()=>first?(first=false,new Promise(r=>resolve=r)):Promise.resolve(aiResponse('급여가 늦어지면 10월 최소 잔액은 40만원이에요.'))});
  u.click('#ai-consent');u.input('#question','어때?');u.submit('#ask-form');await settle();
  u.click('#scenario-delayed');resolve(aiResponse('기존 시나리오 답변'));await settle();
  assert.equal(u.$('#chat-messages').textContent,'');assert.equal(u.$('#ask-button').disabled,false);
  u.input('#question','지금은 어때?');u.submit('#ask-form');await settle();
  assert.equal(asks(u)[1].activeScenario,'delayed');assert.deepEqual(asks(u)[1].history,[]);assert.match(u.$('#chat-messages').textContent,/40만원/);
});

test('동의 철회는 대기 중인 요청을 취소하며 늦은 답변을 표시하지 않는다',async t=>{
  let resolve;const u=await setup(t,{configured:true,backend:()=>new Promise(r=>resolve=r)});
  u.click('#ai-consent');u.input('#question','지금은 어때?');u.submit('#ask-form');await settle();
  u.click('#ai-consent');assert.equal(u.network.at(-1).options.signal.aborted,true);resolve(aiResponse('표시하면 안 되는 답'));await settle();
  assert.equal(u.$('#chat-messages').textContent,'');assert.equal(u.$('#question').value,'지금은 어때?');
  u.submit('#ask-form');assert.equal(asks(u).length,1);
});

test('한국어 조합 Enter·Shift Enter는 전송하지 않고 일반 Enter만 전송한다',async t=>{
  const u=await setup(t,{configured:true,backend:async()=>aiResponse('반가워요.')});u.click('#ai-consent');u.input('#question','안녕');
  const press=options=>u.$('#question').dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options}));
  press({isComposing:true});press({keyCode:229});press({shiftKey:true});await settle();assert.equal(asks(u).length,0);
  press({});await settle();assert.equal(asks(u).length,1);assert.match(u.$('#chat-messages').textContent,/반가워요/);
});

test('대화 지우기는 계산을 유지하고 다음 질문에서 지난 대화를 전송하지 않는다',async t=>{
  const u=await setup(t,{configured:true,backend:async()=>aiResponse('도와드릴게요.')});u.click('#ai-consent');
  u.input('#question','안녕');u.submit('#ask-form');await settle();
  const before=u.$('#metrics').textContent;u.click('#clear-chat');
  assert.equal(u.$('#chat-messages').hidden,true);assert.equal(u.$('#metrics').textContent,before);assert.equal(u.$('#clear-chat').hidden,true);
  u.input('#question','다시 시작하자');u.submit('#ask-form');await settle();assert.deepEqual(asks(u)[1].history,[]);
});

test('지난 대화는 네 번의 문답 이내로 전달하고 재계산 시 초기화된다',async t=>{
  const u=await setup(t,{configured:true,backend:async()=>aiResponse('답변이에요.')});u.click('#ai-consent');
  for(let i=0;i<6;i++){u.input('#question',String(i));u.submit('#ask-form');await settle();}
  assert.equal(asks(u).at(-1).history.length,8);assert.equal(asks(u).at(-1).history[0].content,'1');
  u.submit('#plan-form');assert.equal(u.$('#chat-messages').hidden,true);
  u.input('#question','새로 계산한 내용은?');u.submit('#ask-form');await settle();assert.deepEqual(asks(u).at(-1).history,[]);
});

test('보고서가 비교 결과와 계산 조건을 포함한다',async t=>{
  const u=await setup(t);u.click('#download');const text=await u.report().text();assert.match(text,/2026-12-28/);assert.match(text,/월 소득/);assert.match(text,/추가 대출금은 잔액에 더하지/);assert.doesNotMatch(text,/재현용|스냅샷|결정론적|```json/);
});
test('키보드 화살표로 입력·시나리오 탭을 바꾸고 초점을 유지한다',async t=>{
  const u=await setup(t);u.$('#tab-cash').dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(u.$('#tab-events').getAttribute('aria-selected'),'true');assert.equal(u.d.activeElement.id,'tab-events');
  u.$('#scenario-base').dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(u.d.activeElement.id,'scenario-delayed');
});
