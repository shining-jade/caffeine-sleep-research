import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCaffeineCompanies} from '../public/js/caffeine-companies.js';
test('company summary counts consumption, preserves unknown brands and excludes explicit nonconsumption',()=>{
 const rows=[{업체명:' 메가커피 ',함량:80},{업체명:'메가커피',함량:0,음료명:'디카페인'}, {함량:20,음료명:'아메리카노'}, {함량:0,음료명:'카페인 섭취 안 함'}];
 const summary=summarizeCaffeineCompanies(rows);
 assert.equal(summary.total,3);assert.equal(summary.unknown,1);
 assert.deepEqual(summary.rows,[{company:'메가커피',count:2,totalMg:80,percent:2/3*100},{company:'미상',count:1,totalMg:20,percent:1/3*100}]);
});
