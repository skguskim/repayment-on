import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCashChart } from '../js/chart.mjs';
import { analyzePlan } from '../js/cashflow.mjs';
import { cloneDemo } from '../js/demo.mjs';

function setup(t,active='base') {
  const dom=new JSDOM('<div id="cash-chart"></div><button id="outside">다른 항목</button>');
  t.after(()=>dom.window.close());
  const w=dom.window,container=w.document.querySelector('#cash-chart');
  const chart=createCashChart(container),plan=cloneDemo(),result=analyzePlan(plan);
  const $=selector=>container.querySelector(selector);
  const bounds={left:100,top:50,width:320,height:200};
  const geometry=()=>{
    container.getBoundingClientRect=()=>({...bounds});
    $('svg').getBoundingClientRect=()=>({...bounds});
    $('.chart-tooltip').getBoundingClientRect=()=>({width:226,height:90});
  };
  chart.render(result,active,plan.floor);geometry();
  const point=i=>$(`[data-chart-index="${i}"]`);
  const pointer=(target,type,init={})=>{
    const event=new w.MouseEvent(type,{bubbles:true,...init});
    Object.defineProperty(event,'pointerType',{value:init.pointerType||'mouse'});
    target.dispatchEvent(event);
  };
  const key=(target,value)=>target.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  return {w,container,chart,plan,result,$,point,pointer,key,geometry,bounds};
}

test('hover shows the exact month and amount, and leaving dismisses it',t=>{
  const u=setup(t);
  assert.equal(u.$('.chart-tooltip').hidden,true);
  // Hover anywhere in the month's column, not just on the small dot.
  u.pointer(u.$('svg'),'pointermove',{clientX:100+48/400*320});
  assert.equal(u.$('.chart-tooltip').hidden,false);
  assert.equal(u.$('.tooltip-month').textContent,'2026년 9월');
  assert.equal(u.$('.tooltip-selected-value').textContent,'700,000원');
  assert.equal(u.$('.tooltip-base-row').hidden,true);
  u.pointer(u.container,'pointerleave');assert.equal(u.$('.chart-tooltip').hidden,true);
});

test('a touched month stays visible and compares the scenario with the base amount',t=>{
  const u=setup(t,'delayed');
  u.pointer(u.point(1),'pointermove',{pointerType:'touch'});
  assert.equal(u.$('.chart-tooltip').hidden,true,'스크롤 중에는 툴팁을 열지 않는다');
  u.pointer(u.point(1),'click',{pointerType:'touch'});
  assert.equal(u.$('.tooltip-month').textContent,'2026년 10월');
  assert.equal(u.$('.tooltip-selected-value').textContent,'400,000원');
  assert.equal(u.$('.tooltip-base-value').textContent,'1,000,000원');
  assert.equal(u.$('.tooltip-base-row').hidden,false);
  u.pointer(u.container,'pointerleave');assert.equal(u.$('.chart-tooltip').hidden,false);
  u.pointer(u.w.document.querySelector('#outside'),'pointerdown');assert.equal(u.$('.chart-tooltip').hidden,true);
});

test('keyboard moves between months with one tab stop and Escape dismisses the tooltip',t=>{
  const u=setup(t);u.point(0).focus();
  assert.equal(u.$('.chart-tooltip').hidden,false);
  u.key(u.point(0),'ArrowRight');assert.equal(u.w.document.activeElement,u.point(1));
  assert.equal(u.$('.tooltip-month').textContent,'2026년 10월');
  u.key(u.point(1),'End');assert.equal(u.w.document.activeElement,u.point(5));
  assert.equal(u.container.querySelectorAll('[data-chart-index][tabindex="0"]').length,1);
  u.key(u.point(5),'Escape');assert.equal(u.$('.chart-tooltip').hidden,true);
  u.key(u.point(5),'Enter');assert.equal(u.$('.chart-tooltip').hidden,false);
  u.w.document.querySelector('#outside').focus();assert.equal(u.$('.chart-tooltip').hidden,true);
});

test('negative values remain readable and the tooltip stays inside a narrow chart',t=>{
  const u=setup(t,'absent');u.pointer(u.point(5),'click');
  const tooltip=u.$('.chart-tooltip');
  assert.equal(u.$('.tooltip-selected-value').textContent,'-800,000원');
  assert.equal(u.$('.tooltip-selected-value').classList.contains('is-negative'),true);
  assert.ok(parseFloat(tooltip.style.left)>=8);
  assert.ok(parseFloat(tooltip.style.left)+226<=320-8);
  assert.ok(parseFloat(tooltip.style.top)>=8);
  assert.ok(parseFloat(tooltip.style.top)+90<=200-8);
  u.bounds.width=280;u.w.dispatchEvent(new u.w.Event('resize'));
  assert.ok(parseFloat(tooltip.style.left)+226<=280-8);
});

test('recalculation clears pinned values and supports twelve months without stale points',t=>{
  const u=setup(t);u.pointer(u.point(0),'click');
  u.plan.horizonMonths=12;u.plan.reserve=2_000_000;
  u.chart.render(analyzePlan(u.plan),'base',u.plan.floor);u.geometry();
  assert.equal(u.$('.chart-tooltip').hidden,true);
  assert.equal(u.container.querySelectorAll('[data-chart-index]').length,12);
  u.pointer(u.point(0),'pointermove');assert.equal(u.$('.tooltip-selected-value').textContent,'1,700,000원');
  u.key(u.w.document.querySelector('#outside'),'Escape');assert.equal(u.$('.chart-tooltip').hidden,true);
});
