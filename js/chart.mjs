import { money } from './cashflow.mjs';

const WIDTH=400, HEIGHT=250, LEFT=48, RIGHT=30, TOP=24, BOTTOM=38;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthLabel=month=>`${month.slice(0,4)}년 ${Number(month.slice(5))}월`;
const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));

export function createCashChart(container) {
  const doc=container.ownerDocument;
  let selected,baseline,points=[],activeIndex=-1,pinned=false;
  const find=selector=>container.querySelector(selector);
  const buttons=()=>[...container.querySelectorAll('[data-chart-index]')];

  function hide() {
    if(!find('.chart-tooltip'))return;
    find('.chart-tooltip').hidden=true;
    find('.chart-guide').setAttribute('visibility','hidden');
    buttons().forEach(point=>{point.classList.remove('is-active');point.removeAttribute('aria-describedby');});
    activeIndex=-1;pinned=false;
  }

  function positionTooltip() {
    if(activeIndex<0)return;
    const tooltip=find('.chart-tooltip'),svg=find('svg');
    const box=container.getBoundingClientRect(),plot=svg.getBoundingClientRect(),tip=tooltip.getBoundingClientRect();
    const point=points[activeIndex];
    const x=plot.left-box.left+point.x/WIDTH*plot.width;
    const y=plot.top-box.top+point.y/HEIGHT*plot.height;
    const above=y-tip.height-14;
    tooltip.style.left=`${clamp(x-tip.width/2,8,box.width-tip.width-8)}px`;
    tooltip.style.top=`${clamp(above>=8?above:y+14,8,box.height-tip.height-8)}px`;
  }

  function show(index) {
    if(!points[index])return;
    activeIndex=index;
    const month=selected.months[index],tooltip=find('.chart-tooltip');
    find('.tooltip-month').textContent=monthLabel(month.month);
    find('.tooltip-selected-label').textContent=selected.label;
    find('.tooltip-selected-value').textContent=money(month.closing);
    find('.tooltip-selected-value').classList.toggle('is-negative',month.closing<0);
    find('.tooltip-base-row').hidden=selected.key==='base';
    find('.tooltip-base-value').textContent=money(baseline.months[index].closing);
    const guide=find('.chart-guide');
    guide.setAttribute('x1',points[index].x);guide.setAttribute('x2',points[index].x);guide.setAttribute('visibility','visible');
    buttons().forEach((point,i)=>{
      point.classList.toggle('is-active',i===index);point.tabIndex=i===index?0:-1;
      if(i===index)point.setAttribute('aria-describedby','cash-chart-tooltip');else point.removeAttribute('aria-describedby');
    });
    tooltip.hidden=false;positionTooltip();
  }

  function indexAt(event) {
    const target=event.target.closest('[data-chart-index]');
    if(target)return Number(target.dataset.chartIndex);
    const box=find('svg').getBoundingClientRect();
    if(!box.width)return -1;
    const x=(event.clientX-box.left)/box.width*WIDTH;
    return clamp(Math.round((x-LEFT)/(WIDTH-LEFT-RIGHT)*(points.length-1)),0,points.length-1);
  }

  container.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||pinned||!event.target.closest('svg'))return;
    show(indexAt(event));
  });
  container.addEventListener('pointerleave',()=>{if(!pinned&&!container.contains(doc.activeElement))hide();});
  container.addEventListener('click',event=>{
    if(!event.target.closest('svg'))return;
    const index=indexAt(event);
    if(pinned&&activeIndex===index){hide();return;}
    show(index);pinned=activeIndex>=0;
  });
  container.addEventListener('focusin',event=>{
    const point=event.target.closest('[data-chart-index]');
    if(point){pinned=false;show(Number(point.dataset.chartIndex));}
  });
  container.addEventListener('focusout',event=>{if(!container.contains(event.relatedTarget))hide();});
  container.addEventListener('keydown',event=>{
    const point=event.target.closest('[data-chart-index]');
    if(!point)return;
    if(event.key==='Escape'){event.preventDefault();hide();return;}
    const current=Number(point.dataset.chartIndex);
    if(event.key==='Enter'||event.key===' '){event.preventDefault();if(pinned&&activeIndex===current)hide();else{show(current);pinned=true;}return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const index=event.key==='Home'?0:event.key==='End'?points.length-1:(current+(event.key==='ArrowRight'?1:-1)+points.length)%points.length;
    buttons()[index].focus();
  });
  doc.addEventListener('pointerdown',event=>{if(!container.contains(event.target))hide();});
  doc.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  // The app has one chart for its lifetime; resize only repositions an open tooltip.
  doc.defaultView.addEventListener('resize',positionTooltip);

  function render(result,active,floor) {
    selected=result.scenarios[active];baseline=result.scenarios.base;activeIndex=-1;pinned=false;
    const values=[...selected.months.map(m=>m.closing),...baseline.months.map(m=>m.closing),floor,0];
    const min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,100000),low=min-span*.13,high=max+span*.17;
    const x=i=>LEFT+i*(WIDTH-LEFT-RIGHT)/(selected.months.length-1),y=n=>TOP+(high-n)/(high-low)*(HEIGHT-TOP-BOTTOM);
    points=selected.months.map((m,i)=>({x:x(i),y:y(m.closing)}));
    const line=rows=>rows.map((m,i)=>`${x(i)},${y(m.closing)}`).join(' ');
    const grid=Array.from({length:5},(_,i)=>low+(high-low)*i/4).map(v=>`<line x1="${LEFT}" x2="${WIDTH-RIGHT}" y1="${y(v)}" y2="${y(v)}" stroke="#edf1ea"/><text x="${LEFT-9}" y="${y(v)+4}" text-anchor="end" fill="#758379" font-size="11">${(v/10000).toFixed(0)}만</text>`).join('');
    container.innerHTML=`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="group" aria-labelledby="chart-title" aria-describedby="chart-desc">
      <title id="chart-title">${esc(selected.label)}와 기준 일정의 월말 잔액 비교</title>
      <desc id="chart-desc">각 월을 선택하면 잔액을 확인할 수 있습니다. 키보드 좌우 화살표로 월을 이동하고 Escape로 닫습니다.</desc>
      ${grid}<line x1="${LEFT}" x2="${WIDTH-RIGHT}" y1="${y(floor)}" y2="${y(floor)}" stroke="#ba783b" stroke-dasharray="5 5"/>
      <polyline points="${line(baseline.months)}" fill="none" stroke="#829ebb" stroke-width="2" stroke-dasharray="${active==='base'?'0':'5 4'}"/>
      <polyline points="${line(selected.months)}" fill="none" stroke="#147560" stroke-width="3" stroke-linejoin="round"/>
      <line class="chart-guide" y1="${TOP}" y2="${HEIGHT-BOTTOM}" visibility="hidden"/>
      ${selected.months.map((m,i)=>`<g class="chart-point" data-chart-index="${i}" role="button" tabindex="${i===0?0:-1}" aria-label="${esc(monthLabel(m.month)+', '+selected.label+' 월말 잔액 '+money(m.closing))}">
        <circle class="chart-hit" cx="${x(i)}" cy="${y(m.closing)}" r="16" fill="transparent"/>
        <circle class="chart-dot" cx="${x(i)}" cy="${y(m.closing)}" r="4" fill="${m.closing<0?'#b34049':'#147560'}" stroke="white" stroke-width="2"/>
      </g>${selected.months.length<=6||i%2===0||i===selected.months.length-1?`<text x="${x(i)}" y="${HEIGHT-13}" text-anchor="middle" fill="#687e72" font-size="11">${Number(m.month.slice(5))}월${m.month.slice(5)==='01'?` (${m.month.slice(2,4)})`:''}</text>`:''}`).join('')}
      </svg>
      <div id="cash-chart-tooltip" class="chart-tooltip" role="tooltip" hidden><strong class="tooltip-month"></strong>
        <div class="tooltip-row"><span class="tooltip-selected-label"></span><b class="tooltip-selected-value"></b></div>
        <div class="tooltip-row tooltip-base-row"><span>기준 일정</span><b class="tooltip-base-value"></b></div>
      </div>`;
  }
  return {render,hide};
}
