export function summarizeCaffeineCompanies(records) {
  const groups = new Map();
  for (const row of records) {
    const mg = Number(row.함량);
    if (!Number.isFinite(mg) || mg < 0) continue;
    if (mg === 0 && /카페인\s*섭취\s*안\s*함|미섭취/.test(row.음료명 || '')) continue;
    const company = String(row.업체명 || '').trim() || '미상';
    const group = groups.get(company) || { company, count: 0, totalMg: 0 };
    group.count++; group.totalMg += mg; groups.set(company, group);
  }
  const total = [...groups.values()].reduce((sum, row) => sum + row.count, 0);
  return {total, unknown: groups.get('미상')?.count || 0, rows: [...groups.values()]
    .sort((a,b) => b.count-a.count || a.company.localeCompare(b.company,'ko'))
    .map(row => ({...row, percent:row.count/total*100}))};
}
function render(records) {
  const summary = summarizeCaffeineCompanies(records);
  const head = document.getElementById('cafCompanySummary');
  const target = document.getElementById('cafCompanyTable');
  if (!target || !head) return;
  head.textContent = `섭취 ${summary.total}회 · 업체 미상 ${summary.unknown}회`;
  target.replaceChildren();
  if (!summary.total) { target.textContent = '조회기간에 섭취 기록이 없습니다.'; return; }
  const table = document.createElement('table'); table.style.cssText='width:100%;text-align:left;border-collapse:collapse;';
  const header = table.createTHead().insertRow();
  for(const label of ['업체명','섭취 횟수','비율','카페인 총량']) {const th=document.createElement('th');th.textContent=label;th.style.padding='10px';header.append(th);}
  const body=table.createTBody();
  for(const group of summary.rows) {const row=body.insertRow();for(const value of [group.company,`${group.count}회`,`${group.percent.toFixed(1)}%`,`${Math.round(group.totalMg*10)/10}mg`]) {const cell=row.insertCell();cell.textContent=value;cell.style.cssText='padding:10px;border-top:1px solid #e5e7eb;';}}
  target.append(table);
}
if(typeof window !== 'undefined') window.caffeineCompanies={render,summarizeCaffeineCompanies};
