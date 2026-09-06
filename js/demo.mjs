const history = (income,essential,maintained,debt) => Array.from({length:6},()=>({income,essential,maintained,debt}));
export const DEMOS = [
  {id:'intern',name:'인턴을 앞둔 대학생',tag:'기획서 사례',description:'급여가 한 달 늦어지면?',input:{
    startMonth:'2026-09',horizonMonths:6,reserve:1000000,floor:500000,buffer:100000,allocationPct:70,
    history:history(800000,750000,100000,100000),
    baseline:{income:800000,essential:750000,maintained:100000,debt:100000,irregular:0,incomeDay:1,expenseDay:28,debtDay:28},
    loan:{principal:900000,annualRatePct:0,termMonths:6,rateType:'fixed',payDay:28},debtSchedule:null,
    events:[{id:'intern-1',title:'겨울 인턴 급여',type:'intern',status:'confirmed',amount:600000,startMonth:'2026-10',endMonth:'2026-12',payDay:25,frequency:'monthly',replacedIncome:0,extraExpense:0},{id:'award-1',title:'공모전 상금',type:'award',status:'pending',amount:1000000,startMonth:'2026-12',endMonth:'2026-12',payDay:20,frequency:'once',replacedIncome:0,extraExpense:0}],
    comparison:{eventId:'intern-1',delayMonths:1},stress:{incomeDropPct:15,expenseRisePct:10,rateRisePp:2}
  }},
  {id:'jobseeker',name:'소득 공백의 취업준비생',tag:'공백 점검',description:'장학금이 없으면 얼마나 버틸까?',input:{
    startMonth:'2026-09',horizonMonths:6,reserve:2600000,floor:500000,buffer:100000,allocationPct:70,
    history:history(0,600000,100000,0),baseline:{income:0,essential:600000,maintained:100000,debt:0,irregular:0,incomeDay:1,expenseDay:10,debtDay:25},
    loan:{principal:0,annualRatePct:5,termMonths:12,rateType:'fixed',payDay:25},debtSchedule:null,
    events:[{id:'scholar-1',title:'예정 장학금',type:'scholarship',status:'pending',amount:2000000,startMonth:'2026-11',endMonth:'2026-11',payDay:25,frequency:'once',replacedIncome:0,extraExpense:0}],
    comparison:{eventId:'scholar-1',delayMonths:1},stress:{incomeDropPct:15,expenseRisePct:10,rateRisePp:2}
  }},
  {id:'career',name:'첫 직장의 사회초년생',tag:'상환 비교',description:'상환 기간을 늘리면 총이자는?',input:{
    startMonth:'2026-09',horizonMonths:12,reserve:3000000,floor:1500000,buffer:200000,allocationPct:70,
    history:history(2400000,1100000,300000,150000),baseline:{income:2400000,essential:1100000,maintained:300000,debt:150000,irregular:100000,incomeDay:25,expenseDay:10,debtDay:26},
    loan:{principal:10000000,annualRatePct:6,termMonths:36,rateType:'variable',payDay:26},debtSchedule:null,
    events:[{id:'bonus-1',title:'연말 성과급',type:'salary',status:'pending',amount:1200000,startMonth:'2026-12',endMonth:'2026-12',payDay:25,frequency:'once',replacedIncome:0,extraExpense:0}],
    comparison:{eventId:'bonus-1',delayMonths:1},stress:{incomeDropPct:15,expenseRisePct:10,rateRisePp:2}
  }}
];
export const cloneDemo = (id='intern') => structuredClone(DEMOS.find(d=>d.id===id).input);
export function emptyPlan() {
  const p=cloneDemo();
  const now=new Date(); p.startMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  p.history=history(0,0,0,0);p.reserve=0;p.baseline={...p.baseline,income:0,essential:0,maintained:0,debt:0};
  p.loan.principal=0;p.events=[];p.comparison.eventId='';return p;
}
