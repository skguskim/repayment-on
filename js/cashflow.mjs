import { median, quantile, monthlyPayment, ModelInputError } from './model.mjs';

export const VERSION = '2.0.0';
export const SCENARIOS = Object.freeze({ base: '기준 일정', delayed: '첫 입금 지연', absent: '선택 소득 미발생', opportunity: '미확정 소득 수령', stress: '소득·지출 악화' });
export const money = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
const validMonth = s => typeof s === 'string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(s);
export const monthIndex = s => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
export function addMonths(month, count) {
  const n = monthIndex(month) + count;
  return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
}
export function dateInMonth(month, day) {
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function validatePlan(p) {
  const errors = [];
  const labels={income:'실수령 소득',essential:'필수 생활비',maintained:'유지할 선택지출',debt:'기존 부채 납부액',irregular:'비정기 지출',incomeDay:'기본 소득 입금일',expenseDay:'생활비 출금일',debtDay:'기존 부채 납부일',amount:'세후 수령액',replacedIncome:'대체되는 기존 소득',extraExpense:'추가 지출',incomeDropPct:'소득 감소율',expenseRisePct:'생활비 증가율',rateRisePp:'금리 상승폭'};
  const fail = (condition, message) => { if (!condition) errors.push(message); };
  const amount = (n, label) => fail(Number.isSafeInteger(n) && n >= 0 && n <= 1e10, `${label}: 0~100억원 사이의 원 단위 정수를 입력하세요.`);
  const day = (n, label) => fail(Number.isInteger(n) && n >= 1 && n <= 31, `${label}: 1~31일을 입력하세요.`);
  if (!p || typeof p !== 'object') return ['입력 형식이 올바르지 않습니다.'];
  fail(validMonth(p.startMonth), '시작월은 2000~2099년의 올바른 월이어야 합니다.');
  fail(Number.isInteger(p.horizonMonths) && p.horizonMonths >= 6 && p.horizonMonths <= 12, '분석 기간은 6~12개월입니다.');
  for (const k of ['reserve', 'floor', 'buffer']) amount(p[k], {reserve:'현재 유동자금',floor:'최소 유지 잔액',buffer:'계획 여유분'}[k]);
  fail(Number.isFinite(p.allocationPct) && p.allocationPct >= 0 && p.allocationPct <= 100, '상환 배분 비율은 0~100%입니다.');
  fail(Array.isArray(p.history) && p.history.length >= 6 && p.history.length <= 12, '과거 자료는 6~12개월을 입력하세요.');
  if (Array.isArray(p.history)) p.history.slice(0, 12).forEach((h, i) => {
    for (const k of ['income','essential','maintained','debt']) amount(h?.[k], `과거 ${i+1}행 ${labels[k]}`);
  });
  const b = p.baseline || {};
  for (const k of ['income','essential','maintained','debt','irregular']) amount(b[k], `월별 ${labels[k]}`);
  for (const k of ['incomeDay','expenseDay','debtDay']) day(b[k], labels[k]);
  const l = p.loan || {};
  amount(l.principal, '추가 상환 원금');
  fail(Number.isFinite(l.annualRatePct) && l.annualRatePct >= 0 && l.annualRatePct <= 50, '연 금리는 0~50%입니다.');
  fail(Number.isInteger(l.termMonths) && l.termMonths >= 1 && l.termMonths <= 600, '상환 기간은 1~600개월입니다.');
  fail(['fixed','variable'].includes(l.rateType), '고정 또는 변동금리를 선택하세요.');
  day(l.payDay, '추가 상환일');
  if (p.debtSchedule !== null) {
    fail(Array.isArray(p.debtSchedule) && p.debtSchedule.length === p.horizonMonths, '기존 부채 납부 일정의 개수가 분석 개월과 같아야 합니다.');
    if (Array.isArray(p.debtSchedule)) p.debtSchedule.slice(0, 12).forEach(n => amount(n, '기존 부채 납부액'));
  }
  fail(Array.isArray(p.events) && p.events.length <= 12, '미래 소득은 최대 12개입니다.');
  const candidates = Array.isArray(p.events) ? p.events.slice(0, 12) : [];
  const events = candidates.filter(e=>e && typeof e === 'object' && !Array.isArray(e));
  fail(events.length === candidates.length, '미래 소득의 입력 형식이 올바르지 않습니다.');
  const ids = new Set();
  events.forEach((e, i) => {
    const prefix = `미래 소득 ${i+1}`;
    fail(typeof e.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(e.id) && !ids.has(e.id), `${prefix}: 고유 ID가 필요합니다.`);
    ids.add(e.id);
    fail(typeof e.title === 'string' && e.title.trim().length > 0 && e.title.length <= 50, `${prefix}: 이름은 1~50자입니다.`);
    fail(['intern','salary','award','scholarship','other'].includes(e.type), `${prefix}: 소득 종류를 확인하세요.`);
    fail(['confirmed','pending'].includes(e.status), `${prefix}: 확정 상태를 선택하세요.`);
    fail(['once','monthly'].includes(e.frequency), `${prefix}: 수령 주기를 확인하세요.`);
    fail(validMonth(e.startMonth) && validMonth(e.endMonth) && e.startMonth <= e.endMonth, `${prefix}: 시작·종료월을 확인하세요.`);
    fail(!validMonth(e.startMonth) || !validMonth(e.endMonth) || monthIndex(e.endMonth)-monthIndex(e.startMonth) <= 120, `${prefix}: 기간은 최대 10년입니다.`);
    if (e.frequency === 'once') fail(e.startMonth === e.endMonth, `${prefix}: 일회성 소득은 시작월과 종료월이 같아야 합니다.`);
    for (const k of ['amount','replacedIncome','extraExpense']) amount(e[k], `${prefix} ${labels[k]}`);
    day(e.payDay, `${prefix} 입금일`);
  });
  const c = p.comparison || {};
  fail(c.eventId === '' || ids.has(c.eventId), '비교할 미래 소득을 다시 선택하세요.');
  fail(Number.isInteger(c.delayMonths) && c.delayMonths >= 1 && c.delayMonths <= 6, '첫 입금 지연은 1~6개월입니다.');
  for (const [k,max] of [['incomeDropPct',100],['expenseRisePct',100],['rateRisePp',20]]) {
    fail(Number.isFinite(p.stress?.[k]) && p.stress[k] >= 0 && p.stress[k] <= max, `악화 가정 ${labels[k]}: 0~${max} 범위를 확인하세요.`);
  }
  if (validMonth(p.startMonth) && Number.isInteger(p.horizonMonths) && p.horizonMonths <= 12) {
    for (let i=0; i<p.horizonMonths; i++) {
      const m=addMonths(p.startMonth,i);
      const replaced=events.filter(e=>e.startMonth<=m && m<=e.endMonth).reduce((s,e)=>s+e.replacedIncome,0);
      fail(replaced <= b.income, `${m}: 중복 제거할 기존 소득의 합이 기본 소득보다 큽니다.`);
    }
  }
  return [...new Set(errors)];
}

// 월 이자를 원 단위 반올림하고 마지막 회차에서 잔여 원금을 정산한다.
export function amortize(loan, rate = loan.annualRatePct) {
  let balance = loan.principal;
  const regular = Math.ceil(monthlyPayment(balance, rate, loan.termMonths));
  const rows = [];
  for (let i=0; i<loan.termMonths && balance>0; i++) {
    const interest = Math.round(balance * rate / 1200);
    const payment = i === loan.termMonths-1 ? balance+interest : Math.min(regular, balance+interest);
    balance -= payment-interest;
    rows.push({payment,interest,balance});
  }
  return {payment: rows[0]?.payment || 0, totalInterest: rows.reduce((s,r)=>s+r.interest,0), totalPayment: rows.reduce((s,r)=>s+r.payment,0), rows, rate};
}

function simulate(p, key) {
  const stress = key === 'stress';
  const included = p.events.filter(e => (e.status === 'confirmed' || key === 'opportunity') && !(key === 'absent' && e.id === p.comparison.eventId));
  const schedule = amortize(p.loan, p.loan.annualRatePct + (stress && p.loan.rateType === 'variable' ? p.stress.rateRisePp : 0));
  const start = `${p.startMonth}-01`, endMonth = addMonths(p.startMonth,p.horizonMonths-1);
  const end = dateInMonth(endMonth,31), entries = [], deferred = [];
  const push = (date, amount, label, category, eventId='') => {
    if (!amount) return;
    const entry={date,amount,label,category,eventId};
    if (date >= start && date <= end) entries.push(entry);
    else if (date > end && category === 'event') deferred.push(entry);
  };
  const incomeFactor = stress ? 1-p.stress.incomeDropPct/100 : 1;
  const expenseFactor = stress ? 1+p.stress.expenseRisePct/100 : 1;
  for (let i=0; i<p.horizonMonths; i++) {
    const m=addMonths(p.startMonth,i), b=p.baseline;
    const active=included.filter(e=>e.startMonth<=m && m<=e.endMonth);
    const replaced=active.reduce((s,e)=>s+e.replacedIncome,0);
    push(dateInMonth(m,b.incomeDay),Math.round((b.income-replaced)*incomeFactor),'기본 실수령 소득','income');
    for (const [field,label] of [['essential','필수 생활비'],['maintained','유지할 선택지출'],['irregular','비정기 지출 월 예산']]) {
      push(dateInMonth(m,b.expenseDay),-Math.round(b[field]*expenseFactor),label,'living');
    }
    push(dateInMonth(m,b.debtDay),-(p.debtSchedule?.[i] ?? b.debt),'기존 부채 납부','existingDebt');
    push(dateInMonth(m,p.loan.payDay),-(schedule.rows[i]?.payment || 0),'추가 원리금 상환','loan');
    for (const e of active) push(dateInMonth(m,b.expenseDay),-Math.round(e.extraExpense*expenseFactor),`${e.title} 추가 지출`,'eventCost',e.id);
  }
  for (const e of included) {
    const count = e.frequency === 'once' ? 1 : monthIndex(e.endMonth)-monthIndex(e.startMonth)+1;
    for (let i=0; i<count; i++) {
      const earned=addMonths(e.startMonth,i);
      // 첫 회차만 미룬다. 나머지 급여는 원래 날짜에 들어와 이월 급여와 합쳐질 수 있다.
      const paid=key==='delayed' && e.id===p.comparison.eventId && i===0 ? addMonths(earned,p.comparison.delayMonths) : earned;
      if (paid < p.startMonth || earned > endMonth) continue;
      push(dateInMonth(paid,e.payDay),Math.round(e.amount*incomeFactor),`${e.title}${paid!==earned?' (첫 입금 이월)':''}`,'event',e.id);
    }
  }
  // 시간 정보가 없으므로 같은 날에는 출금을 먼저 처리하는 보수 가정.
  entries.sort((a,b)=>a.date.localeCompare(b.date) || a.amount-b.amount || a.label.localeCompare(b.label));
  let balance=p.reserve, minBalance=balance, firstNegative=balance<0?start:null, firstBelowFloor=balance<p.floor?start:null;
  for (const e of entries) {
    balance += e.amount; e.balance=balance;
    minBalance=Math.min(minBalance,balance);
    if (balance<0 && !firstNegative) firstNegative=e.date;
    if (balance<p.floor && !firstBelowFloor) firstBelowFloor=e.date;
  }
  let opening=p.reserve;
  const months=Array.from({length:p.horizonMonths},(_,i)=> {
    const month=addMonths(p.startMonth,i), rows=entries.filter(e=>e.date.startsWith(month));
    const sum=category=>rows.filter(e=>category.includes(e.category)).reduce((s,e)=>s+e.amount,0);
    const income=rows.reduce((s,e)=>s+Math.max(0,e.amount),0), outflow=Math.abs(rows.reduce((s,e)=>s+Math.min(0,e.amount),0));
    const closing=opening+income-outflow;
    const oneOffIncome=rows.filter(e=>e.category==='event' && included.find(x=>x.id===e.eventId)?.frequency==='once').reduce((s,e)=>s+e.amount,0);
    const beforeLoan=income+sum(['living','existingDebt','eventCost']);
    const allocation=Math.floor(Math.max(0,beforeLoan-oneOffIncome-p.buffer)*p.allocationPct/100);
    const row={month,opening,income,outflow,closing,minBalance:Math.min(opening,...rows.map(e=>e.balance)),eventIncome:sum(['event']),loanPayment:Math.abs(sum(['loan'])),allocation};
    opening=closing; return row;
  });
  return {key,label:SCENARIOS[key],months,entries,deferred,loan:schedule,minBalance,firstNegative,firstBelowFloor,finalBalance:balance,minMonthEnd:Math.min(...months.map(m=>m.closing)),floorGap:Math.max(0,p.floor-minBalance),status:firstNegative?'shortage':firstBelowFloor?'buffer':'clear'};
}

export function analyzePlan(p) {
  const errors=validatePlan(p); if(errors.length) throw new ModelInputError(errors);
  const scenarios=Object.fromEntries(Object.keys(SCENARIOS).map(k=>[k,simulate(p,k)]));
  const incomes=p.history.map(h=>h.income);
  return {version:VERSION,scenarios,history:{count:p.history.length,medianIncome:median(incomes),q25Income:quantile(incomes,.25),q75Income:quantile(incomes,.75),zeroMonths:incomes.filter(n=>n===0).length},selectedEvent:p.events.find(e=>e.id===p.comparison.eventId) || null};
}

export function historyBaseline(history, previous) {
  return {...previous,...Object.fromEntries(['income','essential','maintained','debt'].map(k=>[k,Math.round(median(history.map(h=>h[k])))]))};
}
