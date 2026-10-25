import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('public/js/sleep-record-policy.js','utf8'),context);
export const SleepRecordPolicy=context.SleepRecordPolicy;
