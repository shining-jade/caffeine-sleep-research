import fs from 'node:fs';import vm from 'node:vm';
export function installHistoryView(context){context.window ||= {};context.window.SleepRecordPolicy=context.SleepRecordPolicy;context.window.document=context.document;vm.runInContext(fs.readFileSync('public/js/sleep-comparison-chart.js','utf8'),context);vm.runInContext(fs.readFileSync('public/js/record-history-view.js','utf8'),context);}
