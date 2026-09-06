import { analyzePlan, validatePlan, historyBaseline, addMonths, SCENARIOS, money } from './cashflow.mjs';
import { DEMOS, cloneDemo, emptyPlan } from './demo.mjs';
import { createCashChart } from './chart.mjs';
import { CHAT_LIMITS, recentChatHistory, validateChatReply } from './assistant.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=n=>`${(n/10000).toLocaleString('ko-KR',{maximumFractionDigits:2})}만`;
const get=(obj,path)=>path.split('.').reduce((a,k)=>a?.[k],obj);
const set=(obj,path,value)=>{const keys=path.split('.'),last=keys.pop();keys.reduce((a,k)=>a[k],obj)[last]=value;};
const state={draft:cloneDemo(),plan:null,result:null,active:'base',inputTab:'cash',screen:'input',demo:'intern',dirty:true,messages:[],pendingQuestion:'',chatPending:false,chatError:'',ai:false,request:null,revision:0};
const INPUT_STEPS=['cash','events','loan'];
const cashChart=createCashChart($('#cash-chart'));
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}

function field(label,path,{type='number',unit=true,min=0,max=1000000,step='0.01',wide=false,note='',options=null}={}) {
  const raw=get(state.draft,path),value=typeof raw==='number'&&!Number.isFinite(raw)?'':unit&&type==='number'?raw/10000:raw;
  const id=`field-${path.replaceAll('.','-')}`, attrs=`id="${id}" data-path="${path}" ${unit&&type==='number'?'data-money="true"':''}`;
  const control=options?`<select ${attrs}>${options.map(([v,l])=>`<option value="${esc(v)}" ${v===raw?'selected':''}>${esc(l)}</option>`).join('')}</select>`:`<input ${attrs} type="${type}" value="${esc(value)}" ${type==='number'?`min="${min}" max="${max}" step="${step}" inputmode="decimal"`:type==='text'?'maxlength="50"':type==='month'?'min="2000-01" max="2099-12"':''}>`;
  return `<label class="field ${wide?'wide':''}" for="${id}"><span>${label}</span>${control}${note?`<small>${note}</small>`:''}</label>`;
}
const num=(label,path,max=31,min=1)=>field(label,path,{unit:false,max,min,step:1});
const select=(label,path,options,wide=false)=>field(label,path,{unit:false,options,wide});

function renderCash() {
  const p=state.draft;
  $('#panel-cash').innerHTML=`
  <div class="fields">${field('분석 시작월','startMonth',{type:'month',unit:false})}${num('분석 개월 수','horizonMonths',12,6)}${field('현재 유동자금','reserve',{note:'바로 사용할 수 있는 현금·예금'})}${field('최소 유지 잔액','floor',{note:'생활을 위해 남겨둘 잔액'})}</div>
  <h3 class="form-subheading">앞으로의 월별 기본 계획</h3><div class="fields">${field('실수령 소득','baseline.income')}${field('필수 생활비','baseline.essential')}${field('유지할 선택지출','baseline.maintained')}${field('비정기 지출 월 예산','baseline.irregular')}${num('기본 소득 입금일','baseline.incomeDay')}${num('생활비 출금일','baseline.expenseDay')}${field('계획 여유분','buffer',{note:'상환에 쓰지 않을 여유 금액'})}${num('상환 배분 비율 (%)','allocationPct',100,0)}</div>
  <p class="micro">생활비는 입력한 출금일에 한 번에 반영해요.</p>
  <details class="compact-details"><summary>과거 ${p.history.length}개월 자료로 기본 계획 채우기</summary><p class="micro">금액 단위: 만원. 각 항목의 중앙값을 입력에 반영해요.</p><div class="table-wrap"><table class="history-table"><caption class="sr-only">과거 월별 소득과 지출</caption><thead><tr><th>기간</th><th>소득</th><th>필수</th><th>유지지출</th><th>기존상환</th></tr></thead><tbody>${p.history.map((h,i)=>`<tr><th scope="row">${p.history.length-i}개월 전</th>${['income','essential','maintained','debt'].map((k,j)=>`<td><input aria-label="${p.history.length-i}개월 전 ${['소득','필수지출','유지지출','기존상환'][j]}, 만원" data-path="history.${i}.${k}" data-money="true" type="number" min="0" max="1000000" step="0.01" value="${esc(Number.isFinite(h[k])?h[k]/10000:'')}"></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="history-actions"><button type="button" id="add-history" class="subtle-button" ${p.history.length>=12?'disabled':''}>+ 한 달</button><button type="button" id="remove-history" class="subtle-button" ${p.history.length<=6?'disabled':''}>− 한 달</button><button type="button" id="use-history" class="subtle-button">중앙값 가져오기</button></div></details>`;
}
function renderEvents() {
  const p=state.draft;
  $('#panel-events').innerHTML=`<p class="notice">실제로 쓸 수 있는 세후 금액을 입력하세요. 미확정 소득은 별도로 비교할 수 있어요.</p>
  <div id="event-list">${p.events.length?p.events.map((e,i)=>`<article class="event-card"><div class="event-heading"><strong>예정 소득 ${i+1}</strong><button class="event-remove" type="button" data-remove-event="${i}" aria-label="예정 소득 ${i+1} 삭제">삭제</button></div><div class="fields">
    ${field('소득 이름',`events.${i}.title`,{type:'text',unit:false,wide:true})}
    ${select('소득 종류',`events.${i}.type`,[['intern','인턴 급여'],['salary','급여·성과급'],['award','상금'],['scholarship','장학금'],['other','기타']])}
    ${select('확정 상태',`events.${i}.status`,[['confirmed','확정'],['pending','미확정']])}
    ${field('세후 수령액',`events.${i}.amount`)}${select('수령 주기',`events.${i}.frequency`,[['monthly','매월'],['once','한 번만']])}
    ${field(e.frequency==='once'?'지급 예정월':'첫 지급월',`events.${i}.startMonth`,{type:'month',unit:false})}${e.frequency==='monthly'?field('마지막 지급월',`events.${i}.endMonth`,{type:'month',unit:false}):''}
    ${num('매월 입금일',`events.${i}.payDay`)}
    ${field('대체되는 기존 소득',`events.${i}.replacedIncome`,{note:'기본 소득에서 해당 기간만 제외'})}${field('해당 기간 추가 지출',`events.${i}.extraExpense`,{note:'교통비 등 · 생활비 출금일 적용'})}
  </div><p class="micro">${e.frequency==='monthly'?'입력한 기간에 매월 반영해요.':'지급 예정월에 한 번 반영해요.'}</p></article>`).join(''):'<div class="empty-events">아직 예정 소득이 없어요.<br>소득을 추가하지 않아도 계산할 수 있습니다.</div>'}</div>
  <button id="add-event" type="button" class="subtle-button wide" ${p.events.length>=12?'disabled':''}>+ 미래소득 추가</button>
  <h3 class="form-subheading">어떤 소득을 비교할까요?</h3><div class="fields">${select('지연·미발생 비교 대상','comparison.eventId',[['','선택 없음'],...p.events.map(e=>[e.id,e.title])],true)}${num('첫 입금 지연 (개월)','comparison.delayMonths',6,1)}</div><p class="micro">첫 입금만 늦추고, 이후 입금은 원래 일정대로 비교해요.</p>`;
}
function renderLoan() {
  const p=state.draft;
  $('#panel-loan').innerHTML=`<div class="fields">${field('기존 부채 월 납부액','baseline.debt')}${num('기존 부채 납부일','baseline.debtDay')}</div>
  <label class="consent"><input id="schedule-toggle" type="checkbox" ${p.debtSchedule?'checked':''}>월마다 납부액이 달라요</label>
  ${p.debtSchedule?`<div class="schedule-inputs">${p.debtSchedule.map((v,i)=>field(`${addMonths(p.startMonth,i)} 납부액`,`debtSchedule.${i}`)).join('')}</div>`:''}
  
  <h3 class="form-subheading">추가 대출 상환</h3><div class="fields">${field('추가 상환 원금','loan.principal',{note:'추가 대출이 없다면 0'})}${num('상환 기간 (개월)','loan.termMonths',600,1)}${field('연 금리 (%)','loan.annualRatePct',{unit:false,max:50,step:.1})}${select('금리 유형','loan.rateType',[['fixed','고정금리'],['variable','변동금리']])}${num('추가 원리금 납부일','loan.payDay')}</div>
  <p class="micro">매달 같은 금액을 갚는 방식이에요. 대출금은 잔액에 더하지 않으며, 수수료는 제외해요.</p>
  <details class="compact-details"><summary>소득·지출 악화 가정 조정</summary><div class="fields">${num('소득 감소율 (%)','stress.incomeDropPct',100,0)}${num('생활비 증가율 (%)','stress.expenseRisePct',100,0)}${num('변동금리 상승 (%p)','stress.rateRisePp',20,0)}</div><p class="micro">소득·지출 악화 비교에 적용해요. 금리 상승은 변동금리에만 반영해요.</p></details>`;
}
function renderInputs() {renderCash();renderEvents();renderLoan();setInputTab(state.inputTab);}
function setInputTab(tab) {
  state.inputTab=tab;
  $$('[data-input-tab]').forEach(b=>{const selected=b.dataset.inputTab===tab;b.setAttribute('aria-selected',selected);b.tabIndex=selected?0:-1;});
  ['cash','events','loan'].forEach(k=>$(`#panel-${k}`).hidden=k!==tab);
  const index=INPUT_STEPS.indexOf(tab);
  $('#input-step-label').textContent=`${index+1} / 3`;
  $('#previous-input').hidden=index===0;
  $('#next-input').hidden=index===2;
  $('#next-input').textContent=index===0?'미래소득 입력 →':'상환 조건 입력 →';
}
function showScreen(screen,{focus=true}={}) {
  state.screen=screen;
  cashChart.hide();
  const results=screen==='results';
  $('#input-screen').hidden=results;
  $('#results').hidden=!results;
  document.body.dataset.screen=screen;
  document.title=results?'내 현금흐름 결과 · 상환ON':'내 조건 입력 · 상환ON';
  ['input','results'].forEach(key=>{
    const step=$(`#progress-${key}`);
    if(key===screen)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
  });
  if(focus){
    const target=results?$('#result-title'):$('#input-title');
    (results?$('.site-header'):$('.card-heading')).scrollIntoView({block:'start',behavior:'instant'});
    target.focus({preventScroll:true});
  }
}
function navigateScreen(screen) {
  if(screen==='results' && (!state.result||state.dirty))return;
  if(state.screen!==screen)window.history.pushState({repaymentScreen:screen},'',`#${screen}`);
  showScreen(screen);
}
function collect() {
  const p=structuredClone(state.draft);
  $$('[data-path]').forEach(el=>{
    const v=el.type==='number'?(el.value===''?NaN:el.valueAsNumber):el.value;
    set(p,el.dataset.path,el.dataset.money?Math.round(v*10000):v);
  });
  p.events.forEach(e=>{if(e.frequency==='once')e.endMonth=e.startMonth;});
  return p;
}
function cancelRequest() {state.revision++;state.request?.abort();state.request=null;state.chatPending=false;}
function resetChat() {cancelRequest();state.messages=[];state.pendingQuestion='';state.chatError='';renderChat();}
function markDirty() {
  cashChart.hide();
  state.dirty=true;resetChat();
  $('#dirty-note').textContent='수정한 조건은 다시 계산해야 반영돼요.';$('#dirty-note').hidden=!state.result;$('#dirty-note').classList.add('pending-banner');
  ['download','print','ask-button'].forEach(id=>$(`#${id}`).disabled=true);
  $('#result-status').setAttribute('aria-label','이전 계산 결과 · 입력 수정 후 재계산 필요');
}
function showErrors(errors) {
  $$('[data-path]').forEach(el=>el.setAttribute('aria-invalid',String(!el.checkValidity() || (el.type==='number'&&el.value===''))));
  const invalid=$('[aria-invalid="true"]');
  if(invalid)setInputTab(invalid.closest('[role="tabpanel"]').id.replace('panel-',''));
  $('#error-box').innerHTML=`<strong>입력 내용을 확인해 주세요</strong><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`;
  $('#error-box').hidden=false;$('#error-box').focus();$('#error-box').scrollIntoView({block:'start',behavior:'instant'});
}
function commit(p,{demo=state.demo}={}) {
  const errors=validatePlan(p);if(errors.length){showErrors(errors);return false;}
  cancelRequest();state.plan=structuredClone(p);state.draft=structuredClone(p);state.result=analyzePlan(p);state.demo=demo;state.dirty=false;resetChat();
  $('#error-box').hidden=true;$$('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  $('#dirty-note').hidden=true;$('#dirty-note').textContent='';$('#dirty-note').classList.remove('pending-banner');
  ['download','print'].forEach(id=>$(`#${id}`).disabled=false);
  $('#result-status').removeAttribute('aria-label');
  renderDemo();renderResults();return true;
}
function renderDemo() {
  $('#demo-list').innerHTML=DEMOS.map((d,i)=>`<button type="button" class="demo-card ${state.demo===d.id?'selected':''}" data-demo="${d.id}" aria-label="${d.name} 가상 사례" aria-pressed="${state.demo===d.id}"><span class="demo-icon" aria-hidden="true">${['↗','◷','≈'][i]}</span><span><strong>${['대학생','취업준비생','사회초년생'][i]}</strong><small>${['인턴 급여 예정','소득 공백 점검','상환 계획 비교'][i]}</small></span>${state.demo===d.id?'<span class="demo-tag" aria-hidden="true">✓</span>':''}</button>`).join('');
  $('#demo-label').textContent=state.demo?'예시 금액이에요. 내 상황에 맞게 바꿔주세요.':'새로고침하면 입력한 내용이 지워져요.';
}

function scenarioNote() {
  const p=state.plan,e=state.result.selectedEvent;
  const notes={base:'확정한 소득만 반영했어요.',delayed:!e?'비교 대상이 없어 기준 일정과 같습니다.':e.status==='pending'?'미확정 소득은 기준에 포함되지 않아 결과가 같아요.':`${e.title}: 첫 회차만 ${p.comparison.delayMonths}개월 늦추고, 나머지 회차는 원래 일정대로 반영합니다.`,absent:e?`${e.title} 없이 계산했어요. 해당 활동으로 생기는 추가 지출도 제외했어요.`:'비교 대상이 없어 기준 일정과 같습니다.',opportunity:'미확정 소득도 예정대로 받는 경우예요.',stress:`전체 소득 ${p.stress.incomeDropPct}% 감소, 생활비·추가 지출 ${p.stress.expenseRisePct}% 증가, ${p.loan.rateType==='fixed'?'고정금리 유지':`금리 ${p.stress.rateRisePp}%p 상승`} 가정입니다.`};
  const deferred=state.result.scenarios[state.active].deferred;
  return notes[state.active]+(deferred.length?` 분석 기간 이후로 밀린 입금 ${money(deferred.reduce((s,e)=>s+e.amount,0))}은 현재 잔액에 포함하지 않았습니다.`:'');
}
function renderResults() {
  const p=state.plan,r=state.result,s=r.scenarios[state.active];
  $('#result-period').textContent=`${p.startMonth}부터 ${p.horizonMonths}개월`;
  const titles={clear:'입력한 일정에서는 최소 잔액을 유지해요',buffer:'현금은 남지만, 최소 유지 잔액을 밑돌아요',shortage:'생활비와 상환액을 위한 자금이 부족해져요'};
  const detail=s.firstNegative?`${s.firstNegative}부터 잔액이 부족해져요.`:s.firstBelowFloor?`${s.firstBelowFloor}에 설정한 최소 유지 잔액 ${money(p.floor)} 아래로 내려갑니다.`:'입력한 기간에는 최소 유지 잔액 아래로 내려가지 않아요.';
  $('#result-status').className=`result-status ${s.status}`;
  $('#result-status').innerHTML=`<span class="status-icon" aria-hidden="true">${s.status==='clear'?'✓':'!'}</span><div><strong>${titles[s.status]}</strong><p>${esc(detail)}</p></div>`;
  $('#scenario-tabs').innerHTML=Object.entries(SCENARIOS).map(([key,label])=>`<button type="button" id="scenario-${key}" role="tab" aria-controls="scenario-view" aria-selected="${state.active===key}" tabindex="${state.active===key?0:-1}" data-scenario="${key}">${label}</button>`).join('');
  $('#scenario-view').setAttribute('aria-labelledby',`scenario-${state.active}`);
  $('#metrics').innerHTML=[['기간 중 최소 잔액',s.minBalance,`유지 잔액 ${compact(p.floor)}원 기준`],['마지막 월말 잔액',s.finalBalance,`${s.months.at(-1).month} 말`],['추가 상환 · 첫 월',s.loan.payment,`전체 총이자 ${compact(s.loan.totalInterest)}원`]].map(([l,v,n])=>`<article class="metric"><span>${l}</span><strong class="${v<0?'negative':''}" title="${money(v)}">${compact(v)}<small>원</small></strong><small>${n}</small></article>`).join('');
  $('#chart-period').textContent=`${p.startMonth} — ${addMonths(p.startMonth,p.horizonMonths-1)}`;
  cashChart.render(r,state.active,p.floor);$('#scenario-note').textContent=scenarioNote();
  $('#ledger').innerHTML=`<p class="micro">금액 단위: 원. 음수는 부족한 금액이에요.</p><div class="table-wrap"><table><caption class="sr-only">${s.label} 월별 계산표</caption><thead><tr><th>월</th><th>총유입</th><th>총유출</th><th>월말 잔액</th><th>월중 최소</th><th>추가 상환 여유액</th></tr></thead><tbody>${s.months.map(m=>`<tr><th scope="row">${m.month}</th>${['income','outflow','closing','minBalance','allocation'].map(k=>`<td class="${m[k]<0?'negative':''}">${m[k].toLocaleString('ko-KR')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><details class="compact-details"><summary>날짜별 입출금 ${s.entries.length}건 보기</summary><div class="table-wrap"><table><caption class="sr-only">날짜별 현금흐름</caption><thead><tr><th>날짜</th><th>내용</th><th>입출금</th><th>처리 후 잔액</th></tr></thead><tbody>${s.entries.map(e=>`<tr><td>${e.date}</td><td>${esc(e.label)}</td><td>${e.amount.toLocaleString('ko-KR')}</td><td class="${e.balance<0?'negative':''}">${e.balance.toLocaleString('ko-KR')}</td></tr>`).join('')}</tbody></table></div></details>`;
  renderChat();
}
function renderChat() {
  const log=$('#chat-messages'),items=[...state.messages];
  if(state.pendingQuestion)items.push({role:'user',content:state.pendingQuestion});
  if(state.chatPending)items.push({role:'assistant',content:'답변을 작성하고 있어요…',pending:true});
  while(log.children.length>items.length)log.lastElementChild.remove();
  items.forEach((message,i)=>{
    let bubble=log.children[i];
    if(!bubble){
      bubble=document.createElement('div');
      const speaker=document.createElement('span');speaker.className='chat-speaker';
      bubble.append(speaker,document.createElement('p'));log.append(bubble);
    }
    bubble.className=`chat-message ${message.role}${message.pending?' pending':''}`;
    const label=message.role==='user'?'나':'상환ON';
    if(bubble.firstElementChild.textContent!==label)bubble.firstElementChild.textContent=label;
    if(bubble.lastElementChild.textContent!==message.content)bubble.lastElementChild.textContent=message.content;
  });
  log.hidden=!items.length;
  log.scrollTop=log.scrollHeight;
  $('#chat-empty').hidden=items.length>0;
  $('#chat-empty').textContent=state.ai?'현재 잔액과 상환 일정을 참고해 함께 살펴볼게요.':'지금은 AI 상담을 사용할 수 없어요.';
  $('#clear-chat').hidden=!items.length;
  $('#chat-error').hidden=!state.chatError;
  $('#chat-error-text').textContent=state.chatError;
  $('#retry-chat').hidden=!state.pendingQuestion || state.chatPending || state.dirty || !state.ai || !$('#ai-consent').checked;
  const disabled=state.dirty || !state.ai || state.chatPending;
  $('#ask-button').disabled=disabled;
  $('#ask-button').textContent=state.chatPending?'답변 중':'보내기';
  $('#question').disabled=disabled;
  $$('[data-question]').forEach(button=>button.disabled=disabled);
}
async function ask(question) {
  if(state.chatPending)return;
  if(state.dirty || !state.plan){toast('변경한 입력을 먼저 계산해 주세요.');return;}
  const q=question.trim();
  if(!q){$('#question').focus();return;}
  if(q.length>CHAT_LIMITS.question){state.chatError='질문은 2,000자 이내로 입력해 주세요.';renderChat();return;}
  if(!state.ai){state.chatError='지금은 AI 상담을 사용할 수 없어요.';renderChat();return;}
  if(!$('#ai-consent').checked){state.chatError='아래의 ‘외부 AI로 질문하기’에 동의한 뒤 보내 주세요.';renderChat();$('#ai-consent').focus();return;}
  cancelRequest();const revision=state.revision,controller=new AbortController();
  state.request=controller;state.pendingQuestion=q;state.chatPending=true;state.chatError='';
  $('#question').value='';renderChat();
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch('/api/assistant',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({plan:state.plan,activeScenario:state.active,question:q,history:recentChatHistory(state.messages),consent:true})
    });
    if(!response.ok)throw new Error(response.status===429?'RATE_LIMIT':'REQUEST_FAILED');
    const reply=validateChatReply(await response.json());
    if(revision!==state.revision)return;
    state.messages.push({role:'user',content:q},{role:'assistant',content:reply});
    state.messages=state.messages.slice(-40);state.pendingQuestion='';
  } catch(error) {
    if(revision!==state.revision)return;
    state.chatError=error.message==='RATE_LIMIT'?'질문이 많아 잠시 쉬고 있어요. 잠시 후 다시 보내 주세요.':'답변을 받지 못했어요. 다시 보내 주세요.';
  } finally {
    clearTimeout(timer);
    if(revision===state.revision){state.request=null;state.chatPending=false;renderChat();}
  }
}

function downloadReport() {
  if(state.dirty)return;
  const p=state.plan,r=state.result,s=r.scenarios[state.active];
  const plain=s=>String(s).replace(/[|\r\n]/g,' ').replace(/[<>]/g,'');
  const lines=[
    '# 상환ON 현금흐름 보고서', '',
    '- 기간: '+p.startMonth+'부터 '+p.horizonMonths+'개월',
    '- 선택 시나리오: '+s.label,
    '- 시작 잔액: '+money(p.reserve)+' / 최소 유지 잔액: '+money(p.floor),
    '- 월 소득: '+money(p.baseline.income),
    '- 월 생활비·지출: '+money(p.baseline.essential+p.baseline.maintained+p.baseline.irregular),
    '- 추가 대출: '+money(p.loan.principal)+' / 연 '+p.loan.annualRatePct+'% / '+p.loan.termMonths+'개월', '',
    '## 비교 결과', '',
    '| 시나리오 | 마지막 잔액 | 기간 중 최소 잔액 | 첫 부족 날짜 | 첫 최소 잔액 미달 |',
    '|---|---:|---:|---|---|',
    ...Object.values(r.scenarios).map(x=>'| '+[x.label,money(x.finalBalance),money(x.minBalance),x.firstNegative||'없음',x.firstBelowFloor||'없음'].join(' | ')+' |'), '',
    '## 월별 내역 · '+s.label, '',
    '| 월 | 총유입 | 총유출 | 월말 잔액 | 월중 최소 |',
    '|---|---:|---:|---:|---:|',
    ...s.months.map(m=>'| '+[m.month,money(m.income),money(m.outflow),money(m.closing),money(m.minBalance)].join(' | ')+' |'), '',
    '## 예정 소득', '',
    ...p.events.map(e=>'- '+plain(e.title)+': '+(e.status==='confirmed'?'확정':'미확정')+', '+e.startMonth+'~'+e.endMonth+', '+(e.frequency==='once'?'한 번':'매월')+' '+e.payDay+'일 '+money(e.amount)), '',
    '## 계산 기준', '', scenarioNote(),
    '- 생활비는 입력한 출금일에 한 번에 반영해요. 같은 날에는 출금을 먼저 계산해요.',
    '- 추가 대출금은 잔액에 더하지 않으며, 수수료는 제외해요.',
    '- 정기 소득은 입력한 마지막 지급월까지만 반영해요. 이후 생활비와 상환 일정을 확인하세요.'
  ];
  const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`상환ON_분석_${p.startMonth}.md`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('보고서를 저장했어요.');
}

$('#plan-form').addEventListener('submit',e=>{e.preventDefault();const p=collect();if(commit(p,{demo:null})){navigateScreen('results');toast('입력한 조건으로 계산했어요.');}});
$('#plan-form').addEventListener('input',e=>{if(e.target.matches('input,select'))markDirty();});
$('#plan-form').addEventListener('change',e=>{
  const el=e.target;if(!el.matches('input,select'))return;markDirty();state.draft=collect();
  if(el.id==='schedule-toggle'){const count=Number.isInteger(state.draft.horizonMonths)&&state.draft.horizonMonths>=6&&state.draft.horizonMonths<=12?state.draft.horizonMonths:6;state.draft.debtSchedule=el.checked?Array(count).fill(state.draft.baseline.debt):null;renderLoan();}
  if(el.dataset.path==='horizonMonths' && Number.isInteger(state.draft.horizonMonths) && state.draft.horizonMonths>=6 && state.draft.horizonMonths<=12){
    if(state.draft.debtSchedule)state.draft.debtSchedule=Array.from({length:state.draft.horizonMonths},(_,i)=>state.draft.debtSchedule[i]??state.draft.baseline.debt);renderLoan();
  }
  if(el.dataset.path?.endsWith('.frequency'))renderEvents();
  if(el.dataset.path?.endsWith('.title')){
    const options=$$('[data-path="comparison.eventId"] option');
    options.forEach(option=>{const event=state.draft.events.find(e=>e.id===option.value);if(event)option.textContent=event.title;});
  }
  if(el.dataset.path==='startMonth' && /^20\d\d-(0[1-9]|1[0-2])$/.test(el.value))renderLoan();
});
$('#ask-form').addEventListener('submit',e=>{e.preventDefault();ask($('#question').value);});
$('#question').addEventListener('keydown',e=>{
  if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){e.preventDefault();ask($('#question').value);}
});
$('#ai-consent').addEventListener('change',()=>{
  if(!$('#ai-consent').checked){
    cancelRequest();if(state.pendingQuestion)$('#question').value=state.pendingQuestion;
    state.pendingQuestion='';toast('외부 AI 사용을 껐어요.');
  }
  state.chatError='';renderChat();
});

document.addEventListener('click',e=>{
  if(e.target.closest('#home-link')){e.preventDefault();navigateScreen('input');return;}
  const b=e.target.closest('button');if(!b)return;
  if(b.id==='edit-plan'){navigateScreen('input');return;}
  if(b.id==='next-input'||b.id==='previous-input'){
    const index=INPUT_STEPS.indexOf(state.inputTab)+(b.id==='next-input'?1:-1);
    if(INPUT_STEPS[index]){setInputTab(INPUT_STEPS[index]);$('.card-heading').scrollIntoView({block:'start',behavior:'instant'});$(`#tab-${state.inputTab}`).focus({preventScroll:true});}return;
  }
  if(b.dataset.inputTab){setInputTab(b.dataset.inputTab);return;}
  if(b.dataset.scenario){if(state.dirty){toast('수정한 조건을 먼저 계산해 주세요.');return;}if(state.active===b.dataset.scenario)return;state.active=b.dataset.scenario;resetChat();renderResults();return;}
  if(b.dataset.demo || b.id==='blank-button'){
    cancelRequest();state.active='base';state.inputTab='cash';state.draft=b.dataset.demo?cloneDemo(b.dataset.demo):emptyPlan();
    state.demo=b.dataset.demo||null;state.plan=null;state.result=null;
    renderInputs();renderDemo();markDirty();$('#error-box').hidden=true;navigateScreen('input');
    if(b.id==='blank-button')$('#field-reserve').focus({preventScroll:true});return;
  }
  if(b.dataset.question){$('#question').value=b.dataset.question;ask(b.dataset.question);return;}
  if(['add-event','add-history','remove-history','use-history'].includes(b.id) || b.dataset.removeEvent!==undefined) {
    state.draft=collect();const p=state.draft;
    if(b.id==='add-event' && p.events.length<12){
      const validStart=/^20\d\d-(0[1-9]|1[0-2])$/.test(p.startMonth)?p.startMonth:'2026-09';
      const id=`event-${crypto.randomUUID().slice(0,8)}`;p.events.push({id,title:'새 예정 소득',type:'intern',status:'pending',amount:0,startMonth:validStart,endMonth:validStart,payDay:25,frequency:'once',replacedIncome:0,extraExpense:0});if(!p.comparison.eventId)p.comparison.eventId=id;renderEvents();
    }
    if(b.dataset.removeEvent!==undefined){const [removed]=p.events.splice(Number(b.dataset.removeEvent),1);if(p.comparison.eventId===removed.id)p.comparison.eventId=p.events[0]?.id||'';renderEvents();}
    if(b.id==='add-history' && p.history.length<12){p.history.unshift({income:0,essential:0,maintained:0,debt:0});renderCash();$('#panel-cash details').open=true;}
    if(b.id==='remove-history' && p.history.length>6){p.history.shift();renderCash();$('#panel-cash details').open=true;}
    if(b.id==='use-history'){
      if(p.history.some(h=>Object.values(h).some(n=>!Number.isSafeInteger(n)||n<0))){showErrors(['과거 자료에 비어 있거나 잘못된 값이 있습니다.']);return;}
      p.baseline=historyBaseline(p.history,p.baseline);renderCash();renderLoan();toast('과거 내역을 입력에 반영했어요.');
    }
    markDirty();return;
  }
  if(b.id==='clear-chat'){resetChat();$('#question').value='';$('#question').focus();return;}
  if(b.id==='retry-chat'){ask(state.pendingQuestion);return;}
  if(b.id==='download')downloadReport();
  if(b.id==='print'&&!state.dirty){const details=$$('.detail-card'),saved=details.map(d=>d.open);details.forEach(d=>d.open=true);window.addEventListener('afterprint',()=>details.forEach((d,i)=>d.open=saved[i]),{once:true});window.print();}
});
document.addEventListener('keydown',e=>{
  if(e.target.getAttribute('role')!=='tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const group=e.target.closest('[role=tablist]'),buttons=[...group.querySelectorAll('[role=tab]')],i=buttons.indexOf(e.target);
  const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length,id=buttons[next].id;
  buttons[next].click();document.getElementById(id)?.focus();
});
window.addEventListener('popstate',()=>{
  if(!['#input','#results'].includes(window.location.hash))return;
  const requested=window.location.hash==='#results'?'results':'input';
  const screen=requested==='results' && state.result && !state.dirty?'results':'input';
  if(requested!==screen)window.history.replaceState({repaymentScreen:screen},'',`#${screen}`);
  showScreen(screen);
});
window.history.replaceState({repaymentScreen:'input'},'','#input');
renderInputs();renderDemo();renderChat();showScreen('input',{focus:false});
fetch('/api/status').then(r=>r.ok?r.json():Promise.reject()).then(data=>{
  state.ai=data.configured===true;
  $('#ai-consent').disabled=!state.ai;
  $('#ai-consent-row').hidden=!state.ai;
  $('#ai-privacy').hidden=!state.ai;
  renderChat();
}).catch(()=>{state.ai=false;$('#ai-consent').disabled=true;$('#ai-consent-row').hidden=true;$('#ai-privacy').hidden=true;renderChat();});
