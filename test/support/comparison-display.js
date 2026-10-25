import fs from 'node:fs';import vm from 'node:vm';import {SleepRecordPolicy} from './sleep-policy.js';
export function installComparisonDisplay(context){
  context.window ||= {};context.SleepRecordPolicy ||= SleepRecordPolicy;
  vm.runInContext(fs.readFileSync('public/js/safe-render.js','utf8'),context);context.escapeHtml ||= context.window.safeRender.escapeHtml;
  context.lastDashboardData ||= null;context.getTodayKST ||= ()=> '2026-10-22';
  vm.runInContext(fs.readFileSync('public/js/sleep-comparison-chart.js','utf8'),context);
  const source=fs.readFileSync('index.html','utf8'),a=source.indexOf('    function labelToISODate(');
  vm.runInContext(source.slice(a,source.indexOf('\n    }',a)+6),context);
}
