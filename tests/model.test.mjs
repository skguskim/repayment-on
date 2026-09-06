import test from 'node:test';
import assert from 'node:assert/strict';
import { median, quantile, monthlyPayment, ModelInputError } from '../js/model.mjs';

test('quantile interpolates, clamps endpoints, and leaves the input unchanged',()=>{
  const values=[40,10,30,20];
  assert.equal(quantile(values,.25),17.5);
  assert.equal(quantile(values,.5),25);
  assert.equal(quantile(values,-1),10);
  assert.equal(quantile(values,2),40);
  assert.deepEqual(values,[40,10,30,20]);
});

test('median handles even, odd, empty, zero and non-finite observations',()=>{
  assert.equal(median([30,10,20]),20);
  assert.equal(median([40,10,30,20]),25);
  assert.equal(median([NaN,Infinity,10,0,-Infinity]),5);
  assert.equal(median([]),0);
  assert.equal(median([0,0,0]),0);
});

test('monthlyPayment preserves interest, zero interest and invalid input behavior',()=>{
  assert.ok(Math.abs(monthlyPayment(10_000_000,5,12)-856_074.82)<1);
  assert.equal(monthlyPayment(1_200_000,0,12),100_000);
  assert.equal(monthlyPayment(0,5,12),0);
  for(const args of [[-1,5,12],[100,NaN,12],[100,5,0],[100,5,1.5],[Infinity,5,12]]){
    assert.equal(monthlyPayment(...args),0);
  }
});

test('higher principal and interest increase payment while a longer term reduces it',()=>{
  const base=monthlyPayment(10_000_000,5,36);
  assert.ok(monthlyPayment(12_000_000,5,36)>base);
  assert.ok(monthlyPayment(10_000_000,7,36)>base);
  assert.ok(monthlyPayment(10_000_000,5,48)<base);
});

test('ModelInputError retains the validation details used by the v2 engine',()=>{
  const error=new ModelInputError(['첫 오류','두 번째 오류']);
  assert.ok(error instanceof Error);
  assert.equal(error.name,'ModelInputError');
  assert.equal(error.message,'첫 오류 두 번째 오류');
  assert.deepEqual(error.errors,['첫 오류','두 번째 오류']);
});
