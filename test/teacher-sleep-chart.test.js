import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('teacher/index.html', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const end = source.indexOf('\nfunction ', start + 9);
  return source.slice(start, end < 0 ? undefined : end);
}

function renderSleepChart(sleep, target = 8) {
  const c = vm.createContext({
    currentStudentId: 'synthetic', getLimit: () => 170,
    charts: {pdfDual: {data: {
      labels: sleep.map((_, i) => `10-0${i + 1}`),
      datasets: [{data: sleep.map(() => 0), backgroundColor: sleep.map(() => '#ccfbf1')},
        {data: sleep.map(() => 150)}, {data: sleep}, {data: sleep.map(() => target)}]
    }}}
  });
  vm.runInContext(['getSleepChartMax', 'buildStaticPdfDualChartHTML'].map(extract).join('\n'), c);
  return c.buildStaticPdfDualChartHTML();
}

// A fixed 14-hour denominator collapses both of these values to the top edge.
test('PDF sleep chart preserves distinct 14- and 16-hour records inside the plot', () => {
  const html = renderSleepChart([14, 16]);
  const y = [...html.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.equal(y.length, 2);
  assert.ok(y[0] > y[1], '16 hours must plot above 14 hours');
  assert.ok(y[1] > 0, 'the highest point needs room below the plot edge');
});

test('PDF sleep chart uses the same scale for a high sleep target and records', () => {
  const html = renderSleepChart([8], 16);
  const point = Number(/<circle cx="[\d.]+" cy="([\d.]+)"/.exec(html)[1]);
  const target = Number(/top:([\d.]+)%;border-top:2px dashed rgba\(59,130,246/.exec(html)[1]);
  assert.ok(target > 0 && target < point, '16-hour target must remain inside the plot above 8 hours');
  assert.ok(Math.abs((100 - target) / (100 - point) - 2) < 0.001);
});

test('PDF sleep chart keeps missing days as gaps', () => {
  const html = renderSleepChart([8, null, 16]);
  assert.equal([...html.matchAll(/<circle /g)].length, 2);
  assert.equal([...html.matchAll(/<polyline /g)].length, 2);
});

test('static PDF supports midpoint object points and preserves missing caffeine',()=>{
 const c=vm.createContext({currentStudentId:'synthetic',getLimit:()=>150,getCafBarColor:()=> '#abc',charts:{pdfDual:{data:{labels:['10-18','10-19'],comparisonDates:['2026-10-18','2026-10-19'],datasets:[{data:[{x:0,y:null},{x:1,y:0}]},{data:[{x:0,y:150},{x:2,y:150}]},{data:[{x:.5,y:10},{x:1.5,y:12}]},{data:[{x:0,y:8}]}]}}}});
 vm.runInContext(['getSleepChartMax','buildStaticPdfDualChartHTML'].map(extract).join('\n'),c);
 const html=c.buildStaticPdfDualChartHTML(),pts=[...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
 assert.equal(pts.length,2);assert.ok(pts[0][0]<pts[1][0]);assert.ok(pts[0][1]>pts[1][1]);assert.ok(!html.includes('NaN'));assert.match(html,/10-20/);assert.match(html,/경계/);assert.match(html,/미기록|미확인/);assert.equal([...html.matchAll(/data-caffeine-bar=/g)].length,1);
});
