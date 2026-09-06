import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDemo, DEMOS, emptyPlan } from '../js/demo.mjs';
import { analyzePlan, validatePlan, dateInMonth, addMonths, amortize, historyBaseline } from '../js/cashflow.mjs';

test('기획서의 기준·첫 급여 지연·미발생 수치와 부족 시점을 재현한다',()=>{
  const r=analyzePlan(cloneDemo());
  assert.deepEqual(r.scenarios.base.months.map(m=>m.closing),[700000,1000000,1300000,1600000,1300000,1000000]);
  assert.deepEqual(r.scenarios.delayed.months.map(m=>m.closing),[700000,400000,1300000,1600000,1300000,1000000]);
  assert.deepEqual(r.scenarios.absent.months.map(m=>m.closing),[700000,400000,100000,-200000,-500000,-800000]);
  assert.equal(r.scenarios.delayed.firstNegative,null);assert.equal(r.scenarios.delayed.firstBelowFloor,'2026-10-28');
  assert.equal(r.scenarios.delayed.status,'buffer');assert.equal(r.scenarios.absent.firstNegative,'2026-12-28');
});
test('가상 사례는 결정론적으로 계산되고 원본은 변경되지 않는다',()=>{
  for(const demo of DEMOS){const p=structuredClone(demo.input),before=structuredClone(p);const a=analyzePlan(p);assert.deepEqual(a,analyzePlan(p));assert.deepEqual(p,before);}
});
test('0 소득과 0 추가 대출도 유효하며 빈 계획은 예측 점수를 만들지 않는다',()=>{
  const p=emptyPlan();assert.deepEqual(validatePlan(p),[]);const r=analyzePlan(p);
  assert.equal(r.history.zeroMonths,6);assert.equal(r.scenarios.base.loan.payment,0);assert.equal(r.scenarios.base.finalBalance,0);
});
test('미확정 일회성 소득은 기준에서 제외하고 지급월에만 유입한다',()=>{
  const r=analyzePlan(cloneDemo());assert.equal(r.scenarios.base.entries.filter(e=>e.eventId==='award-1').length,0);
  const awards=r.scenarios.opportunity.entries.filter(e=>e.eventId==='award-1');assert.equal(awards.length,1);assert.equal(awards[0].date,'2026-12-20');
  assert.equal(r.scenarios.opportunity.finalBalance-r.scenarios.base.finalBalance,1000000);
  assert.equal(r.scenarios.opportunity.months[3].allocation,r.scenarios.base.months[3].allocation);
});
test('첫 입금만 지연되고 후속 입금과 이월 금액을 합산한다',()=>{
  const r=analyzePlan(cloneDemo()),events=r.scenarios.delayed.entries.filter(e=>e.category==='event');
  assert.deepEqual(events.map(e=>[e.date,e.amount]),[['2026-11-25',600000],['2026-11-25',600000],['2026-12-25',600000]]);
});
test('여러 이벤트 중 선택한 하나에만 지연·미발생을 적용한다',()=>{
  const p=cloneDemo();p.events[1].status='confirmed';const r=analyzePlan(p);
  assert.ok(r.scenarios.absent.entries.some(e=>e.eventId==='award-1'));assert.ok(r.scenarios.delayed.entries.some(e=>e.eventId==='award-1'&&e.date==='2026-12-20'));
});
test('분석 기간 이후로 밀린 입금은 잔액 대신 이월 목록에 남는다',()=>{
  const p=cloneDemo();p.comparison.delayMonths=6;const s=analyzePlan(p).scenarios.delayed;
  assert.equal(s.deferred.length,1);assert.equal(s.deferred[0].date,'2027-04-25');assert.equal(s.finalBalance,400000);
});
test('종료 이후 정기 급여를 연장하지 않는다',()=>{
  const s=analyzePlan(cloneDemo()).scenarios.base;
  assert.equal(s.months[4].eventIncome,0);assert.equal(s.months[5].eventIncome,0);assert.equal(s.months[4].closing-s.months[3].closing,-300000);
});
test('지연 중에도 소득 대체와 추가 지출은 원래 활동월에 반영한다',()=>{
  const p=cloneDemo();p.events[0].replacedIncome=200000;p.events[0].extraExpense=100000;const r=analyzePlan(p);
  assert.equal(r.scenarios.base.months[1].closing,700000);assert.equal(r.scenarios.delayed.months[1].closing,100000);
  assert.equal(r.scenarios.absent.months[1].closing,400000);
  assert.equal(r.scenarios.base.months[4].income,800000);
});
test('미확정 활동의 대체 소득·추가 지출은 기회 시나리오에서만 적용한다',()=>{
  const p=cloneDemo();p.events[0].status='pending';p.events[0].replacedIncome=200000;p.events[0].extraExpense=100000;
  const r=analyzePlan(p);assert.equal(r.scenarios.base.months[1].income,800000);assert.equal(r.scenarios.opportunity.months[1].income,1200000);
});
test('같은 달 월말은 양수여도 급여 전 출금의 부족을 잡는다',()=>{
  const p=emptyPlan();p.reserve=100000;p.floor=0;p.baseline.income=1000000;p.baseline.essential=800000;p.baseline.incomeDay=25;p.baseline.expenseDay=5;
  const s=analyzePlan(p).scenarios.base;assert.equal(s.months[0].closing,300000);assert.equal(s.minBalance,-700000);assert.equal(s.firstNegative,`${p.startMonth}-05`);
});
test('같은 날은 출금 우선, 말일·윤년·연도 경계를 처리한다',()=>{
  assert.equal(dateInMonth('2028-02',31),'2028-02-29');assert.equal(dateInMonth('2027-02',31),'2027-02-28');assert.equal(addMonths('2026-12',1),'2027-01');
  const p=emptyPlan();p.reserve=0;p.floor=0;p.baseline.income=100;p.baseline.essential=100;p.baseline.incomeDay=1;p.baseline.expenseDay=1;
  assert.equal(analyzePlan(p).scenarios.base.minBalance,-100);
});
test('유지 지출은 차감하고 계획 여유분·배분율은 잔액에서 이중 차감하지 않는다',()=>{
  const p=cloneDemo(),r=analyzePlan(p);p.buffer+=300000;p.allocationPct=50;const b=analyzePlan(p);
  assert.equal(r.scenarios.base.finalBalance,b.scenarios.base.finalBalance);
  p.baseline.maintained+=100000;assert.equal(analyzePlan(p).scenarios.base.finalBalance,r.scenarios.base.finalBalance-600000);
});
test('기존 부채 월별 일정은 기본 납부액에 더하지 않고 대체한다',()=>{
  const p=cloneDemo();p.debtSchedule=[0,0,300000,0,0,0];
  const s=analyzePlan(p).scenarios.base;assert.equal(s.entries.filter(e=>e.category==='existingDebt').length,1);assert.equal(s.finalBalance,1300000);
});
test('원리금은 마지막 회차 정산 후 종료하고 원금을 잔액에 더하지 않는다',()=>{
  const p=cloneDemo();p.loan.termMonths=3;
  const s=analyzePlan(p).scenarios.base;assert.equal(s.loan.totalPayment,900000);assert.equal(s.loan.totalInterest,0);assert.equal(s.months[3].loanPayment,0);assert.equal(s.finalBalance,1000000);
});
test('총 상환액은 원금+총이자이며 기간 연장은 월액을 줄이고 총이자를 늘린다',()=>{
  const loan={principal:10000000,annualRatePct:6,termMonths:36},a=amortize(loan),b=amortize({...loan,termMonths:48});
  assert.equal(a.totalPayment,loan.principal+a.totalInterest);assert.equal(a.rows.at(-1).balance,0);assert.ok(b.payment<a.payment);assert.ok(b.totalInterest>a.totalInterest);
  const tiny=amortize({principal:1,annualRatePct:0,termMonths:12});assert.equal(tiny.totalPayment,1);
});
test('금리 충격은 변동금리만 적용하고 과거 분위수는 사실 요약에만 사용한다',()=>{
  const p=cloneDemo('career'),r=analyzePlan(p);assert.ok(r.scenarios.stress.loan.payment>r.scenarios.base.loan.payment);
  p.loan.rateType='fixed';const f=analyzePlan(p);assert.equal(f.scenarios.stress.loan.payment,f.scenarios.base.loan.payment);
  const before=f.scenarios.base.finalBalance;p.history[0].income=1000000000;assert.equal(analyzePlan(p).scenarios.base.finalBalance,before);
});
test('미확정 소득이 선택된 경우 지연과 미발생은 기준과 같다',()=>{
  const p=cloneDemo();p.comparison.eventId='award-1';const r=analyzePlan(p);
  assert.deepEqual(r.scenarios.base.months,r.scenarios.delayed.months);assert.deepEqual(r.scenarios.base.months,r.scenarios.absent.months);
});
test('잘못된 입력·중복 소득 차감·금액 오버플로를 거부한다',()=>{
  for(const mutate of [p=>p.reserve=-1,p=>p.history[0].income=NaN,p=>p.horizonMonths=600,p=>p.events[0].endMonth='2026-09',p=>p.events[0].payDay=32,p=>p.events[0].replacedIncome=800001,p=>p.events[1].id=p.events[0].id,p=>p.loan.principal=1e20,p=>p.events[1].endMonth='2027-01',p=>p.debtSchedule=[0]]){
    const p=cloneDemo();mutate(p);assert.ok(validatePlan(p).length>0);assert.throws(()=>analyzePlan(p));
  }
});
test('과거 중앙값 가져오기는 기입했던 일정과 비정기 지출을 유지한다',()=>{
  const p=cloneDemo();p.history[0].income=10000000;const b=historyBaseline(p.history,p.baseline);assert.equal(b.income,800000);assert.equal(b.incomeDay,1);
});
test('비정상 JSON 이벤트는 TypeError 대신 입력 오류로 처리한다',()=>{
  const p=cloneDemo();p.events=[null,42,'bad'];assert.ok(validatePlan(p).some(e=>e.includes('입력 형식')));assert.throws(()=>analyzePlan(p),{name:'ModelInputError'});
});
