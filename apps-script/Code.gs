/**
 * 카페인 모니터링 시스템 - Google Apps Script 백엔드
 */

// Students 시트 자동 학번 생성
// 학년, 반, 번호가 입력되면 자동으로 학번 ID 생성 (예: 1학년 1반 1번 → 1101)
function onEdit(e) {
  try {
    const sheet = e.source.getActiveSheet();
    const sheetName = sheet.getName();

    // students 시트에서만 동작
    if (sheetName !== 'students') return;

    const range = e.range;
    const row = range.getRow();

    // 헤더 행은 제외
    if (row === 1) return;

    // 편집된 컬럼이 A(학년), B(반), C(번호) 중 하나인 경우
    const col = range.getColumn();
    if (col >= 1 && col <= 3) {
      const gradeCell = sheet.getRange(row, 1); // A: 학년
      const classCell = sheet.getRange(row, 2); // B: 반
      const numberCell = sheet.getRange(row, 3); // C: 번호
      const idCell = sheet.getRange(row, 5);    // E: 학번 ID

      const grade = gradeCell.getValue();
      const classNum = classCell.getValue();
      const number = numberCell.getValue();

      // 모든 값이 입력되었는지 확인
      if (grade && classNum && number) {
        // 학번 생성: 학년(1자리) + 반(1자리) + 번호(2자리)
        const studentId = String(grade) + String(classNum) + String(number).padStart(2, '0');
        idCell.setValue(Number(studentId));

        safeLog_(`자동 학번 생성: ${row}행 - ${studentId}`);
      }
    }
  } catch (error) {
    safeLog_('onEdit 오류: ' + error);
  }
}

// 학번 분석 함수
function parseStudentId(studentId) {
  const str = normalizeId(studentId);
  if (str.length === 4) {
    return {
      grade: str.charAt(0),
      class: str.charAt(1),
      number: str.substring(2)
    };
  }
  return { grade: "-", class: "-", number: "-" };
}

// ⭐ 학번 정규화: 숫자 1101.0 → "1101", 문자 "1101" → "1101"
function normalizeId(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return String(Math.round(val)).trim();
  return String(val).replace(/\.0+$/, '').trim();
}

// KST 시간 포맷 함수
function getKSTTimestamp() {
  const now = new Date();
  return Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
}

// KST 날짜만 포맷
function getKSTDate() {
  const now = new Date();
  return Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");
}

// 로그인 확인
// Students 시트 구조: A:학년, B:반, C:번호, D:이름, E:학번ID
function checkLogin(studentId, name) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("students");

    if (!sheet) {
      safeLog_('❌ students 시트를 찾을 수 없음');
      return { success: false, message: "학생 명단 시트를 찾을 수 없습니다." };
    }

    const lastRow = sheet.getLastRow();
    const data = lastRow > 1 ? sheet.getRange(2, 4, lastRow - 1, 2).getValues() : [];
    const inputId = normalizeId(studentId);
    const inputName = String(name).trim();
    for (let i = 0; i < data.length; i++) {
      // ⭐ normalizeId로 숫자(1101.0) → "1101" 처리
      const rowId   = normalizeId(data[i][1]);  // E열: 학번
      const rowName = String(data[i][0]).trim(); // D열: 이름

      if (rowId === inputId && rowName === inputName) {
        safeLog_('✅ 로그인 성공: ' + i + '행에서 일치');
        // 비수치 학번(교직원·교생)은 "학번_이름" 복합키로 고유화
        const uniqueId = /^\d+$/.test(inputId) ? inputId : inputId + '_' + name.trim();
        return {
          success: true,
          studentId: uniqueId,
          name: name
        };
      }
    }

    safeLog_('❌ 일치하는 데이터 없음');
    return { success: false, message: "등록되지 않은 정보입니다. 학번과 이름을 다시 확인해주세요." };
  } catch (error) {
    safeLog_('❌ 로그인 오류: ' + error);
    return { success: false, message: "오류가 발생했습니다: " + error.message };
  }
}

// 카페인 데이터 저장
// 컬럼: A:타임스탬프, B:학년, C:반, D:번호, E:전체학번, F:성명, G:음료명, H:함량, I:섭취시간, J:고유ID, K:섭취이유
function saveCaffeineData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));

    // 섭취 시간 처리
    let intakeTime = payload.time || kstTimestamp;
    if (intakeTime.includes('T')) {
      const dt = new Date(intakeTime);
      intakeTime = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    }

    appendRecordRow_(sheet, [
      kstTimestamp,      // A: 타임스탬프 (기록 시간)
      p.grade,           // B: 학년
      p.class,           // C: 반
      p.number,          // D: 번호
      normalizeId(payload.studentId), // E: 전체학번
      payload.name,      // F: 성명
      payload.drink,     // G: 음료명
      payload.mg,        // H: 함량
      intakeTime,        // I: 섭취시간
      payload.id || '',      // J: 고유ID
      payload.reason || '',  // K: 섭취이유
      payload.symptom || '', // L: 부작용 경험
      '',                    // M: 연구대상자코드 (기존 수식 유지)
      String(payload.company || '').trim().slice(0, 120), // N: 업체명
      String(payload.foodName || '').trim().slice(0, 240) // O: 원본 식품명
    ]);

    return { success: true };
  } catch (error) {
    safeLog_('카페인 저장 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 저장 (중복 날짜 처리)
// 컬럼: A:타임스탬프, B:학년, C:반, D:번호, E:전체학번, F:성명, G:날짜, H:취침, I:기상, J:시간, K:컨디션, L:메모, M:고유ID
function getWakeDateFromSleepPayload(payload) {
  const sleepDate = String(payload && payload.date || '').substring(0, 10);
  const sleepTime = String(payload && payload.sleepTime || '').substring(0, 5);
  const wakeTime = String(payload && payload.wakeTime || '').substring(0, 5);
  if (!sleepDate) return '';
  if (!sleepTime || !wakeTime || wakeTime > sleepTime) return sleepDate;
  const parts = sleepDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return sleepDate;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function saveSleepData(payload, syncConfirmation) {
  try {
    // payload 검증
    if (!payload) {
      safeLog_('❌ saveSleepData: payload가 undefined입니다');
      throw new Error("데이터가 전달되지 않았습니다.");
    }

    safeLog_('=== saveSleepData 시작 ===');
    safeLog_('받은 데이터: ' + JSON.stringify(payload));

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("sleep") || (() => {
      const s = ss.insertSheet("sleep");
      appendRecordRow_(s, [
        "타임스탬프", "학년", "반", "번호", "전체학번", "성명",
        "날짜", "취침시간", "기상날짜", "기상시간", "수면시간",
        "컨디션", "메모", "고유ID",
        "취침전스마트폰", "취침전활동", "잠들기소요시간", "수면중각성", "낮졸림"
      ]);
      s.setFrozenRows(1);
      safeLog_("✅ sleep 시트 자동 생성 완료");
      return s;
    })();

    // 필수 필드 확인
    if (!payload.studentId) {
      safeLog_('❌ payload.studentId가 없습니다: ' + JSON.stringify(payload));
      throw new Error("학번이 전달되지 않았습니다.");
    }

    if (!payload.date) {
      safeLog_('❌ payload.date가 없습니다');
      throw new Error("날짜가 전달되지 않았습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));
    const resolvedWakeDate = payload.wakeDate || getWakeDateFromSleepPayload(payload);

    safeLog_(`학번: ${payload.studentId}, 날짜: ${payload.date}`);

    // 기존 데이터 확인 - 같은 날짜에 같은 학생의 데이터가 있는지 체크
    const data = sheet.getDataRange().getValues();
    let existingRowIndex = -1;

    safeLog_(`기존 데이터 검색 시작: 총 ${data.length - 1}행 확인`);
    safeLog_(`검색 조건 - 학번: "${payload.studentId}", 날짜: "${payload.date}"`);

    for (let i = 1; i < data.length; i++) {
      const rowStudentId = normalizeId(data[i][4]); // E열
      const rowDateRaw = data[i][6];                  // G열

      // 날짜 형식 통일 (Date 객체든 문자열이든 YYYY-MM-DD 형식으로)
      let rowDate = '';
      if (rowDateRaw instanceof Date) {
        rowDate = Utilities.formatDate(rowDateRaw, "Asia/Seoul", "yyyy-MM-dd");
      } else if (rowDateRaw) {
        rowDate = String(rowDateRaw).trim();
        // YYYY-MM-DD 형식이 아니면 변환 시도
        if (rowDate.includes('/')) {
          const parts = rowDate.split('/');
          if (parts.length === 3) {
            rowDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          }
        }
      }

      // 디버깅 로그 (처음 3개만)
      if (i <= 3) {
        safeLog_(`Row ${i + 1}: 학번="${rowStudentId}", 날짜="${rowDate}" (원본: ${rowDateRaw})`);
      }

      // 같은 학생의 같은 날짜 기록이 있는 경우
      // 비수치 학번(교직원·교생)은 이름(F열)까지 함께 비교해 개인 구분
      const payloadNormId = normalizeId(payload.studentId);
      const isNumericPayloadId = /^\d+$/.test(payloadNormId);
      const rowName = String(data[i][5] || '').trim(); // F열: 성명
      const nameMatch = isNumericPayloadId || rowName === String(payload.name || '').trim();
      if (rowStudentId === payloadNormId &&
          rowDate === String(payload.date).trim() &&
          nameMatch) {
        existingRowIndex = i + 1; // 시트는 1-based index
        safeLog_(`✅ 기존 데이터 발견: Row ${existingRowIndex}`);
        safeLog_(`   학번 일치: "${rowStudentId}" === "${payload.studentId}"`);
        safeLog_(`   날짜 일치: "${rowDate}" === "${payload.date}"`);
        break;
      }
    }

    if (existingRowIndex === -1) {
      safeLog_(`기존 데이터 없음 - 새로 추가됨`);
    }

    let wasUpdated = false;

    if (existingRowIndex > 0) {
      // 기존 데이터가 있으면 해당 행 삭제
      safeLog_(`⚠️ Row ${existingRowIndex} 삭제 시작...`);
      // Replace this row atomically below; failed saves retain the old record.
      safeLog_(`✅ 기존 수면 기록 삭제 완료: 학번=${payload.studentId}, 날짜=${payload.date}`);
      wasUpdated = true;
    }

    // 새로운 데이터 추가 (항상)
    safeLog_(`새 데이터 추가 중...`);
    appendRecordRow_(sheet, [
      kstTimestamp,           // A: 타임스탬프
      p.grade,                // B: 학년
      p.class,                // C: 반
      p.number,               // D: 번호
      normalizeId(payload.studentId),      // E: 전체학번
      payload.name,           // F: 성명
      payload.date,           // G: 날짜
      payload.sleepTime,      // H: 취침 시간
      resolvedWakeDate,       // I: wake date
      payload.wakeTime,       // I: 기상 시간
      payload.hours,          // J: 수면 시간
      payload.condition,      // K: 컨디션 (이모지)
      payload.memo || '',     // L: 메모
      payload.id || '',       // M: 고유ID
      payload.smartphone || '',  // N: 취침 전 스마트폰
      payload.activity || '',    // O: 취침 전 활동
      payload.latency || '',     // P: 수면 잠들기 소요시간
      payload.awakenings || '',  // Q: 수면 중 각성
      payload.daytime || ''      // R: 낮 졸림
    ], existingRowIndex > 0 ? existingRowIndex : null, syncConfirmation);

    safeLog_(`✅ 수면 기록 저장 완료: 학번=${payload.studentId}, 날짜=${payload.date}, 덮어쓰기=${wasUpdated}`);
    safeLog_('=== saveSleepData 종료 ===');

    return {
      success: true,
      updated: wasUpdated,
      message: wasUpdated ? '같은 날짜의 기존 데이터가 수정되었습니다.' : '수면 기록이 저장되었습니다.'
    };
  } catch (error) {
    safeLog_('❌ 수면 저장 오류: ' + error);
    safeLog_('오류 스택: ' + error.stack);
    throw error;
  }
}

// 체중 데이터 저장
function saveWeightData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");

    if (!sheet) {
      throw new Error("info 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));

    // 기존 데이터 확인
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === normalizeId(payload.studentId)) {
        rowIndex = i + 1; // 시트 행 번호 (1-based)
        break;
      }
    }

    if (rowIndex > 0) {
      // 기존 데이터 업데이트
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);
      sheet.getRange(rowIndex, 7).setValue(payload.weight);
    } else {
      // 새 데이터 추가
      appendRecordRow_(sheet, [
        kstTimestamp,      // A: 타임스탬프
        p.grade,           // B: 학년
        p.class,           // C: 반
        p.number,          // D: 번호
        payload.name,      // E: 성명
        normalizeId(payload.studentId), // F: 전체학번
        payload.weight     // G: 몸무게
      ]);
    }

    return { success: true };
  } catch (error) {
    safeLog_('체중 저장 오류: ' + error);
    throw error;
  }
}

function toProfileHHMM_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, 'Asia/Seoul', 'HH:mm');
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    var minutes = Math.round(value * 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  var match = String(value).trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  return match && Number(match[1]) < 24 ? match[1].padStart(2, '0') + ':' + match[2] : '';
}

// 체중 데이터 조회
function getWeightData(studentId, strictRead) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('info 시트를 찾을 수 없습니다');
      return { success: false, weight: null };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      safeLog_('info 데이터가 없습니다');
      return { success: false, weight: null };
    }

    // F열(6)~K열(11): 학번, 몸무게, 목표카페인, 목표취침, 목표기상, 연령대
    const range = sheet.getRange(2, 6, lastRow - 1, 6);
    const data = range.getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === normalizeId(studentId)) {
        const weight = parseFloat(data[i][1]);
        if (weight && weight > 0) {
          safeLog_(`초기설정 조회 성공: ${studentId} = ${weight}kg`);
          return {
            success: true,
            weight: weight,
            targetCaf:     data[i][2] ? parseInt(data[i][2])    : null,
            targetBedtime: toProfileHHMM_(data[i][3]) || null,
            targetWakeTime: toProfileHHMM_(data[i][4]) || null,
            ageGroup:      data[i][5] ? String(data[i][5]).trim() : 'teen'
          };
        }
      }
    }

    safeLog_(`초기설정 정보 없음: ${studentId}`);
    return { success: false, weight: null };
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('체중 조회 오류: ' + error);
    return { success: false, weight: null };
  }
}

// 학생 앱 재실행 시 필요한 초기 데이터를 한 번의 게이트웨이 요청으로 조회
function getStudentBootstrap(studentId) {
  return {
    weight: getWeightData(studentId, true),
    stats: getStats(studentId, true),
    caffeineLogs: getCaffeineLogs(studentId, null, null, true),
    sleepLogs: getSleepLogs(studentId, null, null, true),
    sleepSettings: getSleepSettings(true)
  };
}

// 초기 설정 저장 (체중 + 목표 카페인 + 목표 취침/기상시간)
function saveInitialSetup(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");
    if (!sheet) throw new Error("info 시트를 찾을 수 없습니다.");

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));
    const normId = normalizeId(payload.studentId);

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === normId) { rowIndex = i + 1; break; }
    }

    if (rowIndex > 0) {
      // 기존 행 업데이트
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);        // A: 타임스탬프
      sheet.getRange(rowIndex, 7).setValue(payload.weight);      // G: 몸무게
      sheet.getRange(rowIndex, 8).setValue(payload.targetCaf || '');   // H: 목표카페인
      sheet.getRange(rowIndex, 9).setValue(payload.targetBedtime || ''); // I: 목표취침
      sheet.getRange(rowIndex, 10).setValue(payload.targetWakeTime || ''); // J: 목표기상
      sheet.getRange(rowIndex, 11).setValue(payload.ageGroup || 'teen'); // K: 연령대
    } else {
      // 새 행 추가
      appendRecordRow_(sheet, [
        kstTimestamp,   // A: 타임스탬프
        p.grade,        // B: 학년
        p.class,        // C: 반
        p.number,       // D: 번호
        payload.name,   // E: 성명
        normId,         // F: 전체학번
        payload.weight, // G: 몸무게
        payload.targetCaf || '',       // H: 목표카페인
        payload.targetBedtime || '',   // I: 목표취침시간
        payload.targetWakeTime || '',  // J: 목표기상시간
        payload.ageGroup || 'teen'     // K: 연령대
      ]);
    }

    safeLog_(`초기설정 저장 완료: ${normId}, 체중=${payload.weight}, 목표카페인=${payload.targetCaf}, 취침=${payload.targetBedtime}, 기상=${payload.targetWakeTime}`);
    return { success: true };
  } catch (error) {
    safeLog_('초기설정 저장 오류: ' + error);
    throw error;
  }
}

// 카페인 데이터 업데이트
function updateCaffeineData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();

    let intakeTime = payload.time || kstTimestamp;
    if (intakeTime.includes('T')) {
      const dt = new Date(intakeTime);
      intakeTime = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    }

    let rowIndex = -1;
    if (payload.id) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][9]) === String(payload.id)) { // J열: 고유ID
          rowIndex = i + 1;
          break;
        }
      }
    }

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);          // A: 타임스탬프
      sheet.getRange(rowIndex, 7).setValue(payload.drink);         // G: 음료명
      sheet.getRange(rowIndex, 8).setValue(payload.mg);            // H: 함량
      sheet.getRange(rowIndex, 9).setValue(intakeTime);            // I: 섭취시간
      sheet.getRange(rowIndex, 11).setValue(payload.reason || '');  // K: 섭취이유
      sheet.getRange(rowIndex, 12).setValue(payload.symptom || ''); // L: 부작용 경험
      return { success: true };
    }

    throw new Error("수정할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('카페인 수정 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 업데이트
function updateSleepData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("sleep");

    if (!sheet) {
      throw new Error("수면 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const resolvedWakeDate = payload.wakeDate || getWakeDateFromSleepPayload(payload);

    let rowIndex = -1;
    if (payload.id) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][13]) === String(payload.id)) { // M열: 고유ID
          rowIndex = i + 1;
          break;
        }
      }
    }

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);              // A: 타임스탬프
      sheet.getRange(rowIndex, 7).setValue(payload.date);              // G: 날짜
      sheet.getRange(rowIndex, 8).setValue(payload.sleepTime);         // H: 취침
      sheet.getRange(rowIndex, 9).setValue(resolvedWakeDate);            // I: wake date
      sheet.getRange(rowIndex, 10).setValue(payload.wakeTime);          // J: wake time
      sheet.getRange(rowIndex, 11).setValue(payload.hours);            // J: 시간
      sheet.getRange(rowIndex, 12).setValue(payload.condition);        // K: 컨디션
      sheet.getRange(rowIndex, 13).setValue(payload.memo || '');       // L: 메모
      if (payload.smartphone !== undefined) sheet.getRange(rowIndex, 15).setValue(payload.smartphone || ''); // N
      if (payload.activity   !== undefined) sheet.getRange(rowIndex, 16).setValue(payload.activity   || ''); // O
      if (payload.latency    !== undefined) sheet.getRange(rowIndex, 17).setValue(payload.latency    || ''); // P
      if (payload.awakenings !== undefined) sheet.getRange(rowIndex, 18).setValue(payload.awakenings || ''); // Q
      if (payload.daytime    !== undefined) sheet.getRange(rowIndex, 19).setValue(payload.daytime    || ''); // R
      return { success: true };
    }

    throw new Error("수정할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('수면 수정 오류: ' + error);
    throw error;
  }
}

// 카페인 데이터 삭제 (실제 행 삭제)
function deleteCaffeineData(id) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][9]) === String(id)) { // J열: 고유ID
        const rowIndex = i + 1;
        sheet.deleteRow(rowIndex);
        safeLog_(`카페인 기록 삭제 완료: ID=${id}, Row=${rowIndex}`);
        return { success: true };
      }
    }

    throw new Error("삭제할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('카페인 삭제 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 삭제 (실제 행 삭제)
function deleteSleepData(id) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("sleep");

    if (!sheet) {
      throw new Error("수면 시트를 찾을 수 없습니다.");
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][13]) === String(id)) { // N열: 고유ID
        const rowIndex = i + 1;
        sheet.deleteRow(rowIndex);
        safeLog_(`수면 기록 삭제 완료: ID=${id}, Row=${rowIndex}`);
        return { success: true };
      }
    }

    throw new Error("삭제할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('수면 삭제 오류: ' + error);
    throw error;
  }
}

// 카페인 로그 조회
function getCaffeineLogs(studentId, startDate, endDate, strictRead) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('카페인 시트를 찾을 수 없습니다');
      return [];
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      safeLog_('카페인 데이터가 없습니다');
      return [];
    }

    const data = sheet.getRange(2, 1, lastRow - 1, Math.min(15, sheet.getLastColumn())).getValues();
    const logs = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowStudentId = String(row[4]).trim(); // E열: 전체학번

      if (rowStudentId === normalizeId(studentId)) {
        const intakeTime = row[8]; // I열: 섭취시간
        let timeStr = '';

        if (intakeTime instanceof Date) {
          timeStr = Utilities.formatDate(intakeTime, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
        } else if (typeof intakeTime === 'string') {
          timeStr = intakeTime;
        }

        const dateStr = timeStr.split(' ')[0];

        if (startDate && endDate) {
          if (dateStr < startDate || dateStr > endDate) {
            continue;
          }
        }

        logs.push({
          id: row[9] || '',                    // J열: 고유ID
          name: row[6] || '',                  // G열: 음료명
          amount: parseFloat(row[7]) || 0,     // H열: 함량
          time: timeStr,
          reason: row[10] || '',              // K열: 섭취이유
          company: row[13] || '',
          foodName: row[14] || '',
          symptom: row[11] || ''              // L열: 부작용 경험
        });
      }
    }

    logs.sort((a, b) => {
      const dateA = new Date(a.time);
      const dateB = new Date(b.time);
      return dateB - dateA;
    });

    return logs;
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('카페인 로그 조회 오류: ' + error);
    return [];
  }
}

// 수면 로그 조회 (강화된 디버깅 버전)
function getSleepLogs(studentId, startDate, endDate, strictRead) {
  try {
    safeLog_(`=== getSleepLogs 시작 ===`);
    safeLog_(`입력 파라미터:`);
    safeLog_(`  studentId: "${studentId}" (타입: ${typeof studentId})`);
    safeLog_(`  startDate: ${startDate}`);
    safeLog_(`  endDate: ${endDate}`);

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("sleep");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('❌ 수면 시트를 찾을 수 없습니다');
      return [];
    }

    const lastRow = sheet.getLastRow();
    safeLog_(`✓ 수면 시트 총 행 수: ${lastRow}`);

    if (lastRow <= 1) {
      safeLog_('⚠️ 수면 데이터가 없습니다 (헤더만 존재)');
      return [];
    }

    // 모든 데이터 읽기 (A:R, 18개 컬럼)
    const data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
    safeLog_(`✓ 읽어온 데이터 행 수: ${data.length}`);

    const logs = [];
    let matchCount = 0;
    let skipCount = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowStudentId = String(row[4]).trim(); // E열: 전체학번

      // 모든 행의 학번 출력 (처음 5개만)
      if (i < 5) {
        safeLog_(`Row ${i + 2}: 학번="${rowStudentId}" vs 입력학번="${studentId}"`);
      }

      // 학번 비교
      if (rowStudentId === normalizeId(studentId)) {
        matchCount++;
        safeLog_(`  ✓ Row ${i + 2} 매칭됨!`);

        const sleepDate = row[6]; // G열: 날짜
        let dateStr = '';

        // 날짜 형식 처리
        if (sleepDate instanceof Date) {
          dateStr = Utilities.formatDate(sleepDate, "Asia/Seoul", "yyyy-MM-dd");
          safeLog_(`    날짜(Date): ${dateStr}`);
        } else if (sleepDate) {
          dateStr = String(sleepDate);
          safeLog_(`    날짜(String): ${dateStr}`);
        } else {
          safeLog_(`    ⚠️ 날짜가 비어있음`);
          dateStr = '';
        }

        // 날짜 필터링
        if (startDate && endDate) {
          if (dateStr < startDate || dateStr > endDate) {
            safeLog_(`    ⏭️ 날짜 범위 벗어남 (${startDate} ~ ${endDate})`);
            skipCount++;
            continue;
          }
        }

        // 시간 데이터 처리
        let startTime = '';
        let endTime = '';

        if (row[7] instanceof Date) {
          startTime = Utilities.formatDate(row[7], "Asia/Seoul", "HH:mm");
        } else {
          startTime = String(row[7] || '');
        }

        let wakeDateStr = '';
        if (row[8] instanceof Date) {
          wakeDateStr = Utilities.formatDate(row[8], "Asia/Seoul", "yyyy-MM-dd");
        } else {
          wakeDateStr = String(row[8] || '').substring(0, 10);
        }

        if (row[9] instanceof Date) {
          endTime = Utilities.formatDate(row[9], "Asia/Seoul", "HH:mm");
        } else {
          endTime = String(row[9] || '');
        }

        // 로그 객체 생성
        const log = {
          id: String(row[13] || ''),           // N: id
          date: dateStr,                       // G열: 날짜
          start: startTime,                    // H열: 취침
          wakeDate: wakeDateStr,
          end: endTime,                        // I열: 기상
          savedAt: recordTimestampText_(row[0]),
          sourceRow:i+1,
          hours: recordNumber_(row[10]),      // J열: 시간
          condition: String(row[11] || ''),    // L: condition
          memo: String(row[12] || ''),         // M: memo
          smartphone: String(row[14] || ''),   // O: smartphone
          activity:   String(row[15] || ''),   // P: activity
          latency:    String(row[16] || ''),   // Q: latency
          awakenings: String(row[17] || ''),   // R: awakenings
          daytime:    String(row[18] || '')    // S: daytime
        };

        safeLog_(`    로그 생성: ${JSON.stringify(log)}`);
        logs.push(log);
      }
    }

    safeLog_(`\n📊 결과 요약:`);
    safeLog_(`  총 검사한 행: ${data.length}`);
    safeLog_(`  학번 매칭: ${matchCount}개`);
    safeLog_(`  날짜 필터로 제외: ${skipCount}개`);
    safeLog_(`  최종 반환: ${logs.length}개`);

    // 날짜 역순 정렬
    logs.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });

    safeLog_(`=== getSleepLogs 완료 ===\n`);

    return logs;
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('❌ 수면 로그 조회 오류: ' + error);
    safeLog_('오류 스택: ' + error.stack);
    return [];
  }
}

// 대시보드 데이터 조회 (사용 안 함 - getStats, getFilteredStats 사용)
function getDashboardData(studentId, startDate, endDate) {
  try {
    const ss = getSpreadsheet_();
    const caffeineSheet = ss.getSheetByName("caffeine");
    const sleepSheet = ss.getSheetByName("sleep");

    const dates = [];
    const caffeineData = [];
    const sleepData = [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
      dates.push(dateStr.substr(5));

      let dailyCaffeine = 0;
      let dailySleep = 0;

      if (caffeineSheet) {
        const caffeineRows = caffeineSheet.getDataRange().getValues();
        for (let i = 1; i < caffeineRows.length; i++) {
          if (normalizeId(caffeineRows[i][4]) === normalizeId(studentId)) {
            const intakeTime = caffeineRows[i][8]; // I열
            let intakeDateStr;
            if (intakeTime instanceof Date) {
              intakeDateStr = Utilities.formatDate(intakeTime, "Asia/Seoul", "yyyy-MM-dd");
            } else if (typeof intakeTime === 'string') {
              intakeDateStr = intakeTime.split(' ')[0];
            }
            if (intakeDateStr === dateStr) {
              dailyCaffeine += parseFloat(caffeineRows[i][7]) || 0; // H열
            }
          }
        }
      }

      if (sleepSheet) {
        const sleepRows = sleepSheet.getDataRange().getValues();
        for (let i = 1; i < sleepRows.length; i++) {
          if (normalizeId(sleepRows[i][4]) === normalizeId(studentId)) {
            const sleepDate = sleepRows[i][6]; // G열
            let sleepDateStr;
            if (sleepDate instanceof Date) {
              sleepDateStr = Utilities.formatDate(sleepDate, "Asia/Seoul", "yyyy-MM-dd");
            } else {
              sleepDateStr = String(sleepDate);
            }
            if (sleepDateStr === dateStr) {
              dailySleep = parseFloat(sleepRows[i][9]) || 0; // J열
            }
          }
        }
      }

      caffeineData.push(dailyCaffeine);
      sleepData.push(dailySleep);
    }

    return {
      labels: dates,
      caffeineData: caffeineData,
      sleepData: sleepData
    };
  } catch (error) {
    safeLog_('대시보드 데이터 조회 오류: ' + error);
    return {
      labels: [],
      caffeineData: [],
      sleepData: []
    };
  }
}

// 통계 조회 (최근 7일)
function getStats(studentId, strictRead) {
  try {
    if(strictRead){const ss=getSpreadsheet_();if(!ss.getSheetByName('caffeine')||!ss.getSheetByName('sleep'))throw new Error('BOOTSTRAP_SHEET_MISSING');}
    return getFilteredStats(studentId,getKSTDate());
  } catch(error) {
    if(strictRead)throw error;
    return {todayTotal:0,todayHasRecord:false,labels:[],caffeineData:[],caffeineHasData:[],sleepData:[]};
  }
}

function getFilteredStats(studentId, endDateStr) {
  const end=recordDateText_(endDateStr);
  if(!end)throw new Error('분석 기간을 다시 선택해주세요.');
  const data=getWeeklyDetailedData(studentId,shiftRecordDate_(end,-6),end);
  const last=data.dailyRecords[data.dailyRecords.length-1];
  return {todayTotal:last?.caffeine||0,todayHasRecord:last?.caffeine!==null,chartEndDate:end,
    labels:data.dailyRecords.map(r=>r.date.slice(5).replace('-','/')),
    caffeineData:data.dailyRecords.map(r=>r.caffeine),caffeineHasData:data.dailyRecords.map(r=>r.caffeine!==null),sleepData:data.dailyRecords.map(r=>r.sleep),
    sleepRecordedDays:data.sleepRecordedDays,conditionRecordedDays:data.conditionRecordedDays};
}

function debugCurrentCode() {
  safeLog_('🔍 ===== 코드 상태 진단 시작 =====');

  // 1. getWeeklyDetailedData 함수 테스트
  safeLog_('\n📝 테스트 1: getWeeklyDetailedData 함수');
  try {
    const testResult = getWeeklyDetailedData('1101'); // 학번 예시

    safeLog_('반환 타입: ' + typeof testResult);

    if (typeof testResult === 'string') {
      safeLog_('❌❌❌ 치명적 오류: 문자열로 반환됨!');
      safeLog_('❌ 코드가 수정되지 않았습니다!');
      safeLog_('❌ 최종_정리_코드.gs 파일의 getWeeklyDetailedData 함수로 교체 필요');
    } else if (typeof testResult === 'object') {
      safeLog_('✅ 객체로 반환됨 (정상)');
      safeLog_('✅ recordedDays: ' + testResult.recordedDays);
      safeLog_('✅ totalDays: ' + testResult.totalDays);

      if (testResult.recordedDays !== undefined) {
        safeLog_('✅✅✅ 코드가 올바르게 수정됨!');
      } else {
        safeLog_('❌ recordedDays가 없음 - 수정 실패');
      }
    }
  } catch (error) {
    safeLog_('❌ 함수 실행 오류: ' + error);
  }

  // 2. generateAIHealthReport 함수 확인
  safeLog_('\n📝 테스트 2: generateAIHealthReport 함수 시그니처 확인');
  const funcString = generateAIHealthReport.toString();

  if (funcString.includes('recordedDays < 3')) {
    safeLog_('✅ 데이터 부족 체크 코드 있음');
  } else {
    safeLog_('❌ 데이터 부족 체크 코드 없음 - 수정 필요');
  }

  if (funcString.includes('getInsufficientDataMessage')) {
    safeLog_('✅ 데이터 부족 메시지 함수 호출 있음');
  } else {
    safeLog_('❌ 데이터 부족 메시지 함수 호출 없음 - 수정 필요');
  }

  safeLog_('\n🔍 ===== 코드 상태 진단 완료 =====');
  safeLog_('\n📋 결과 요약:');
  safeLog_('위 로그를 확인하여:');
  safeLog_('- ✅가 모두 표시되면: 코드 수정 완료, 웹앱 재배포 필요');
  safeLog_('- ❌가 하나라도 있으면: 코드 재수정 필요');
}

// ============================================
// 주간 상세 데이터 수집 (카페인/수면 개별 카운트)
// ============================================

function getWeeklyDetailedData(studentId, startDate, endDate) {
  const ss=getSpreadsheet_(), dates=[];
  const end=endDate||Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  const start=startDate||shiftRecordDate_(end,-6);
  const startTime=Date.parse(start+'T00:00:00Z'),endTime=Date.parse(end+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(startTime)||!Number.isFinite(endTime)||new Date(startTime).toISOString().slice(0,10)!==start||new Date(endTime).toISOString().slice(0,10)!==end||endTime<startTime||endTime-startTime>3660*86400000)throw new Error('분석 기간을 다시 선택해주세요.');
  for(let day=start;day<=end;day=shiftRecordDate_(day,1)) dates.push(day);
  const caffeine=new Map(), sleep=new Map();
  const read=name=>{const sheet=ss.getSheetByName(name);return sheet?sheet.getDataRange().getValues().slice(1):[];};
  read('caffeine').forEach(row=>{
    if(String(row[4]).trim()!==String(studentId).trim())return;
    const day=recordDateText_(row[8]); if(!dates.includes(day))return;
    const item=caffeine.get(day)||{total:0,valid:true};
    const amount=recordNumber_(row[7]);
    if(amount===null)item.valid=false;else item.total+=amount;
    caffeine.set(day,item);
  });
  read('sleep').forEach((row,index)=>{
    if(String(row[4]).trim()!==String(studentId).trim())return;
    const rawDay=recordDateText_(row[6]),time=recordTimeText_(row[7]);
    const day=time&&Number(time.slice(0,2))<4?shiftRecordDate_(rawDay,-1):rawDay;
    if(!dates.includes(day))return;
    const previous=sleep.get(day),stamp=recordTimestampText_(row[0]);
    if(!previous||!previous.stamp||!stamp||stamp>=previous.stamp) sleep.set(day,{row,stamp,index});
  });
  let caffeineTotal=0,sleepTotal=0,conditionTotal=0,caffeineRecordedDays=0,sleepRecordedDays=0,conditionRecordedDays=0,caffeineMissingDays=0,recordedDays=0;
  const overCaffeineDays=[],details=[],dailyRecords=[];
  dates.forEach(day=>{
    const caf=caffeine.get(day),slp=sleep.get(day);
    const hours=slp?recordNumber_(slp.row[10]):null;
    const condition=slp?conditionScore_(slp.row[11]):null;
    if(caf?.valid){caffeineRecordedDays++;caffeineTotal+=caf.total;overCaffeineDays.push({date:day,mg:caf.total});}
    if(caf&&!caf.valid)caffeineMissingDays++;
    if(hours!==null){sleepRecordedDays++;sleepTotal+=hours;}
    if(condition!==null){conditionRecordedDays++;conditionTotal+=condition;}
    if(caf||slp)recordedDays++;
    dailyRecords.push({date:day,caffeine:caf?.valid?caf.total:null,sleep:hours,condition});
    details.push(day+': '+(caf?.valid?'카페인 '+caf.total+'mg':caf?'카페인 함량 누락':'카페인 미기록')+', '+(hours!==null?'수면 '+hours+'h':'수면 미기록')+', '+(condition!==null?'기상 후 컨디션 '+condition+'점':'컨디션 미기록'));
  });
  return {details:details.join('\n'),dailyRecords,recordedDays,caffeineRecordedDays,sleepRecordedDays,conditionRecordedDays,caffeineMissingDays,totalDays:dates.length,caffeineTotal,sleepTotal,conditionTotal,overCaffeineDays};
}
function recordNumber_(value) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=Number(value);return Number.isFinite(number)&&number>=0?number:null;
}
function recordDateText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','yyyy-MM-dd');
  const match=String(value||'').match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  return match?match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'):'';
}
function recordTimeText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','HH:mm');
  const match=String(value||'').match(/^(\d{1,2}):(\d{2})/);return match?match[1].padStart(2,'0')+':'+match[2]:'';
}
function recordTimestampText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
  return String(value||'').trim().replace('T',' ');
}
function shiftRecordDate_(day,offset) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
function conditionScore_(value) {
  const text=String(value||'').replace(/[\ufe0e\ufe0f]/g,'').trim();
  const emojis=['😫','😴','😐','🙂','😊'];
  const index=emojis.findIndex(e=>text.includes(e));if(index>=0)return index+1;
  return /^[1-5]$/.test(text)?Number(text):null;
}
function recordSleepCategory_(hours) {
  return hours===null?'미기록':hours<8?'권장보다 짧음':hours<=10?'권장 범위':'권장보다 김';
}
function buildRecordFeedback_(data,limit,teacher,period,thresholds,lifestyle) {
  const count=data.totalDays||7, cafDays=data.caffeineRecordedDays||0,slpDays=data.sleepRecordedDays||0,condDays=data.conditionRecordedDays||0;
  const caf=cafDays?data.caffeineTotal/cafDays:null,slp=slpDays?data.sleepTotal/slpDays:null,condition=condDays?data.conditionTotal/condDays:null;
  const note=days=>days>0&&days<3?' — 기록이 적어 경향 해석에 주의가 필요합니다.':'';
  let text=(teacher?'건강 관찰 소견':'기록 기반 건강 피드백')+' ('+period+')\n평균은 각 항목의 유효 기록일 기준이며 미기록은 제외합니다.\n\n☕ 카페인\n';
  if(caf===null)text+='카페인 미기록 또는 함량 누락으로 평균을 계산하지 않습니다.\n';
  else {
    text+='기록일 기준 일평균 '+Math.round(caf)+'mg / 목표 섭취량 '+Math.round(limit)+'mg · 기록 '+cafDays+'/'+count+'일'+note(cafDays)+'\n';
    if(cafDays>=3) {
      if(teacher)text+=getTeacherCaffeineSummary_(caf,limit,cafDays,data.overCaffeineDays||[],thresholds).section+'\n';
      else text+=(caf>limit?'기록일 평균이 목표 섭취량을 넘었습니다.':'기록일 평균은 목표 섭취량 이내입니다.')+'\n';
    }
    const zero=(data.overCaffeineDays||[]).filter(d=>d.mg===0).length;
    if(zero)text+=zero+'일은 카페인 없이 보낸 것으로 명시적 0mg이 기록되었습니다.\n';
  }
  text+='카페인 기록 '+cafDays+'/'+count+'일'+(data.caffeineMissingDays?' · 함량 누락 '+data.caffeineMissingDays+'일':'')+'\n\n😴 수면\n';
  text+=slp===null?'수면 미기록 — 수면시간을 판단할 수 없습니다.\n':'평균 '+slp.toFixed(1)+'h · 기록 '+slpDays+'/'+count+'일'+note(slpDays)+'\n';
  if(slpDays>=3)text+='수면시간: '+recordSleepCategory_(slp)+' (수업 기준 8~10시간)\n';
  text+=condition===null?'기상 후 컨디션 미기록\n':'기상 후 컨디션 평균 '+condition.toFixed(1)+'점 · 기록 '+condDays+'/'+count+'일'+note(condDays)+'\n';
  text+='수면시간과 기상 후 컨디션은 별도로 살펴봅니다.\n';
  if(teacher&&lifestyle)text+='\n생활 습관 관찰\n'+lifestyle+'\n';
  text+='\n💡 실천 제안\n1. 기록이 없는 날과 카페인을 섭취하지 않은 날의 0mg 기록을 구분해 주세요.\n2. 수면시간과 기상 후 컨디션을 기록하고 나의 생활과 함께 비교해 보세요.\n이 피드백은 자기관찰을 위한 교육자료입니다.';
  return text;
}

function getStudentAnalysisPeriod_(startDate, endDate) {
  if (startDate == null && endDate == null) {
    endDate = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    const start = new Date(endDate + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - 6);
    startDate = start.toISOString().slice(0, 10);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  if (!validDate(startDate) || !validDate(endDate)
      || new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z') !== 6 * 86400000) {
    throw new Error('INVALID_PERIOD');
  }
  return { start: startDate, end: endDate };
}

function generateAIHealthReport(studentId, name, weekCaffeineTotal, avgCaffeine, avgSleep, weight, limit, startDate, endDate) {
  let period;
  try {period=getStudentAnalysisPeriod_(startDate,endDate);}catch(_error){return {success:false,errorCode:'INVALID_PERIOD',error:'분석 기간을 다시 선택해주세요.'};}
  const data=getWeeklyDetailedData(studentId,period.start,period.end);
  return {success:true,source:'Rule',policyVersion:'2026-10-14',recordedDays:data.recordedDays,
    analysis:buildRecordFeedback_(data,Number(limit)||150,false,period.start+' ~ '+period.end)};
}

function getInsufficientDataMessage(recordedDays, totalDays, avgCaffeine, avgSleep, caffeineCount, sleepCount) {
  safeLog_('⚠️ 데이터 부족 메시지 생성');
  safeLog_(`카페인: ${caffeineCount}일, 수면: ${sleepCount}일`);

  // 프론트엔드 카드 렌더러가 파싱할 수 있는 구조화된 마커 형식으로 반환
  const cafNeed = Math.max(0, 3 - caffeineCount);
  const slpNeed = Math.max(0, 3 - sleepCount);

  let message = `__INSUFFICIENT__\n`;
  message += `☕:${caffeineCount}:${cafNeed}\n`;
  message += `😴:${sleepCount}:${slpNeed}\n`;
  if (caffeineCount > 0) message += `__CAF_AVG__:${Math.round(avgCaffeine)}\n`;
  if (sleepCount > 0)    message += `__SLP_AVG__:${avgSleep.toFixed(1)}\n`;

  return message;
}

// ============================================
// 대체 분석 메시지 (예시 구조 기반 - ☕ 😴 💪 섹션 형식)
// ============================================

function getStructuredFallbackAnalysis(avgCaffeine, avgSleep, limit, weekTotal, caffeineCount, sleepCount, totalDays, overCaffeineDays) {
  return buildRecordFeedback_({caffeineRecordedDays:caffeineCount,sleepRecordedDays:sleepCount,caffeineTotal:avgCaffeine*caffeineCount,sleepTotal:avgSleep*sleepCount,totalDays:totalDays||7,overCaffeineDays:overCaffeineDays||[]},limit,false,'조회 기간');
}

function getBadgeThresholds() {
  try {
    const props = PropertiesService.getScriptProperties();
    return {
      success: true,
      habitStart:     parseInt(props.getProperty('BADGE_HABIT_DAYS')   || '3'),
      streak:         parseInt(props.getProperty('BADGE_STREAK_DAYS')  || '7'),
      monthly:        parseInt(props.getProperty('BADGE_MONTHLY_DAYS') || '10'),
      habitStartName: props.getProperty('BADGE_HABIT_NAME')   || '습관의 시작',
      streakName:     props.getProperty('BADGE_STREAK_NAME')  || '꾸준한 습관',
      monthlyName:    props.getProperty('BADGE_MONTHLY_NAME') || '챌린지 달성'
    };
  } catch(e) {
    return {
      success: false, error: e.message,
      habitStart: 3, streak: 7, monthly: 10,
      habitStartName: '습관의 시작', streakName: '꾸준한 습관', monthlyName: '챌린지 달성'
    };
  }
}

function saveBadgeThresholds(habitStart, streak, monthly, habitStartName, streakName, monthlyName) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_HABIT_DAYS',   String(parseInt(habitStart) || 3));
    props.setProperty('BADGE_STREAK_DAYS',  String(parseInt(streak)     || 7));
    props.setProperty('BADGE_MONTHLY_DAYS', String(parseInt(monthly)    || 10));
    if (habitStartName !== undefined) props.setProperty('BADGE_HABIT_NAME',   String(habitStartName).trim() || '습관의 시작');
    if (streakName     !== undefined) props.setProperty('BADGE_STREAK_NAME',  String(streakName).trim()     || '꾸준한 습관');
    if (monthlyName    !== undefined) props.setProperty('BADGE_MONTHLY_NAME', String(monthlyName).trim()    || '챌린지 달성');
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// 수면 기준 설정 (연령대별: 청소년/성인)
// ============================================

function getSleepSettings(strictRead) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('SLEEP_SETTINGS');
    if (raw) return { success: true, settings: JSON.parse(raw) };
    return { success: true, settings: { ageGroup: 'teen', sleepSevere: 7, sleepWarn: 8, sleepGood: 10, sleepMax: 11 } };
  } catch(e) {
    if (strictRead) throw e;
    return { success: false, error: e.message, settings: { ageGroup: 'teen', sleepSevere: 7, sleepWarn: 8, sleepGood: 10, sleepMax: 11 } };
  }
}

function saveSleepSettings(settings) {
  try {
    PropertiesService.getScriptProperties().setProperty('SLEEP_SETTINGS', JSON.stringify(settings));
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Teacher message attachments / PDF delivery
// Shared message helpers preserve attachment metadata for both dashboards.
// ---------------------------------------------------------------------------
function ensureTeacherMessageSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('teacher_messages');
  const headers = [
    'timestamp', 'studentId', 'studentName', 'title', 'content',
    'readStatus', 'readTime', 'studentReply', 'studentReplyTime', 'studentReplyRead',
    'attachmentName', 'attachmentUrl', 'attachmentType'
  ];
  if (!sheet) {
    sheet = ss.insertSheet('teacher_messages');
    appendRecordRow_(sheet, headers);
    return sheet;
  }
  const width = sheet.getLastColumn();
  if (width < headers.length) {
    sheet.getRange(1, width + 1, 1, headers.length - width).setValues([headers.slice(width)]);
  }
  return sheet;
}

function formatTeacherMsgDate_(value) {
  if (!value) return '';
  return value instanceof Date
    ? Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')
    : String(value);
}

function messageDigest_(parts) {
  const values = parts.map(value => value instanceof Date ? value.toISOString()
    : String(value === null || value === undefined ? '' : value));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// Include original message/attachment fields, never mutable read/reply columns.
function teacherMessageKey_(row) {
  return messageDigest_([0, 1, 2, 3, 4, 10, 11, 12].map(index => row[index]));
}

function studentReplyKey_(row) {
  return messageDigest_([teacherMessageKey_(row), row[7], row[8]]);
}

function messageTargetChanged_() {
  return { success: false, code: 'MESSAGE_TARGET_CHANGED',
    error: '메시지가 삭제 또는 변경되었거나 동일한 메시지가 여러 건 있습니다. 목록을 확인한 뒤 다시 선택하세요.' };
}

// Mutation gateway holds the shared script lock while resolving and writing.
function resolveTeacherMessageRow_(sheet, rowIndex, expectedKey) {
  if (!sheet || !Number.isInteger(rowIndex) || rowIndex < 2 || typeof expectedKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedKey)) return 0;
  const rows = sheet.getDataRange().getValues();
  let found = 0;
  for (let i = 1; i < rows.length; i++) {
    if (teacherMessageKey_(rows[i]) !== expectedKey) continue;
    if (found) return 0;
    found = i + 1;
  }
  return found;
}

function readTeacherMessageRow_(row, rowIndex, includeStudent) {
  const item = {
    rowIndex: rowIndex,
    messageKey: teacherMessageKey_(row),
    timestamp: formatTeacherMsgDate_(row[0]),
    title: String(row[3] || ''),
    content: String(row[4] || ''),
    readStatus: String(row[5] || '미읽음'),
    readTime: formatTeacherMsgDate_(row[6]),
    studentReply: String(row[7] || ''),
    studentReplyTime: formatTeacherMsgDate_(row[8]),
    studentReplyRead: String(row[9] || ''),
    attachmentName: String(row[10] || ''),
    attachmentUrl: String(row[11] || ''),
    attachmentType: String(row[12] || '')
  };
  if (includeStudent) {
    item.studentId = String(row[1] || '');
    item.studentName = String(row[2] || '');
  }
  return item;
}

function sendTeacherMessage(data) {
  try {
    const sheet = ensureTeacherMessageSheet_();
    const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    appendRecordRow_(sheet, [
      ts,
      String(data.studentId),
      String(data.studentName),
      String(data.title),
      String(data.content),
      '미읽음',
      '',
      '',
      '',
      '',
      String(data.attachmentName || ''),
      String(data.attachmentUrl || ''),
      String(data.attachmentType || '')
    ]);
    return { success: true };
  } catch (err) {
    safeLog_('sendTeacherMessage error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function getSentTeacherMessages() {
  try {
    const sheet = ensureTeacherMessageSheet_();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      result.push(readTeacherMessageRow_(rows[i], i + 1, true));
    }
    result.reverse();
    return { success: true, data: result };
  } catch (err) {
    safeLog_('getSentTeacherMessages error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function getTeacherMessages(studentId) {
  try {
    const sheet = ensureTeacherMessageSheet_();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      if (normalizeId(rows[i][1]) === normalizeId(studentId)) {
        result.push(readTeacherMessageRow_(rows[i], i + 1, false));
      }
    }
    result.reverse();
    return { success: true, data: result };
  } catch (err) {
    safeLog_('getTeacherMessages error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function saveTeacherPdfAndSendMessage(data) {
  try {
    if (!data || !data.studentId || !data.studentName || !data.html) {
      throw new Error('PDF 전송 정보가 부족합니다.');
    }
    const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
    const fileName = String(data.fileName || ('health-report-' + data.studentId + '-' + ts + '.pdf')).replace(/[\\/:*?"<>|]/g, '_');
    const htmlBlob = Utilities.newBlob(String(data.html), 'text/html', fileName.replace(/\.pdf$/i, '.html'));
    const pdfBlob = htmlBlob.getAs(MimeType.PDF).setName(fileName);
    const file = DriveApp.createFile(pdfBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const sheet = ensureTeacherMessageSheet_();
    const msgTs = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    appendRecordRow_(sheet, [
      msgTs,
      String(data.studentId),
      String(data.studentName),
      String(data.title || '건강 기록 PDF'),
      String(data.content || '건강 기록 PDF를 확인해 주세요.') + '\n\nPDF 링크: ' + file.getUrl(),
      '미읽음',
      '',
      '',
      '',
      '',
      file.getName(),
      file.getUrl(),
      'pdf'
    ]);
    return { success: true, fileName: file.getName(), fileUrl: file.getUrl(), fileId: file.getId() };

  } catch (err) {
    safeLog_('saveTeacherPdfAndSendMessage error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ============================================
// 뱃지 설정 v2 — 연속/누적 타입 지원
// ============================================

/**
 * 뱃지 설정 반환
 * config 형식: {
 *   challengeName: string,
 *   badges: [{ id, type('streak'|'count'), days, name, emoji, color, bg }, ...]
 * }
 */
function getBadgeConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('BADGE_CONFIG_V2');
    if (raw) {
      return { success: true, config: JSON.parse(raw) };
    }
    // 기본 설정 (구버전 설정값 반영)
    const habitDays   = parseInt(props.getProperty('BADGE_HABIT_DAYS')   || '3');
    const streakDays  = parseInt(props.getProperty('BADGE_STREAK_DAYS')  || '7');
    const monthlyDays = parseInt(props.getProperty('BADGE_MONTHLY_DAYS') || '10');
    const habitName   = props.getProperty('BADGE_HABIT_NAME')   || '습관의 시작';
    const streakName  = props.getProperty('BADGE_STREAK_NAME')  || '꾸준한 습관';
    const monthlyName = props.getProperty('BADGE_MONTHLY_NAME') || '챌린지 달성';
    return {
      success: true,
      config: {
        challengeName: '건강 챌린지',
        badges: [
          { id: 'b1', type: 'streak', days: habitDays,   name: habitName,   emoji: '🌱', color: '#059669', bg: '#ecfdf5' },
          { id: 'b2', type: 'streak', days: streakDays,  name: streakName,  emoji: '🏆', color: '#d97706', bg: '#fffbeb' },
          { id: 'b3', type: 'count',  days: monthlyDays, name: monthlyName, emoji: '🌟', color: '#7c3aed', bg: '#f5f3ff' }
        ]
      }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * 뱃지 설정 저장
 * @param {Object} configJson  { challengeName, badges: [...] }
 */
function saveBadgeConfig(configJson) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_CONFIG_V2', JSON.stringify(configJson));
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// 챌린지 뱃지 설정 v3 — 교사 승인 방식 + 카페인/수면/기간 지원
// ============================================

/**
 * 챌린지 뱃지 설정 v3 반환
 * config 형식: {
 *   challengeName: string,
 *   challengeStart: string (YYYY-MM-DD),
 *   challengeEnd: string (YYYY-MM-DD),
 *   badges: [{ id, name, image, bg, color,
 *              type: 'caffeine'|'sleep'|'both',
 *              method: 'consecutive'|'cumulative',
 *              days }, ...]
 * }
 */
function getChallengeBadgeConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('BADGE_CONFIG_V3');
    if (raw) {
      return { success: true, config: JSON.parse(raw) };
    }
    // v3 없으면 v2에서 변환 (하위 호환)
    const v2Raw = props.getProperty('BADGE_CONFIG_V2');
    if (v2Raw) {
      const v2 = JSON.parse(v2Raw);
      const v3 = {
        challengeName: v2.challengeName || '건강 챌린지',
        challengeStart: '',
        challengeEnd: '',
        badges: (v2.badges || []).map(function(b) {
          return {
            id: b.id,
            name: b.name,
            image: b.emoji || '🏅',
            bg: b.bg || '#f5f3ff',
            color: b.color || '#7c3aed',
            type: 'caffeine',
            method: b.type === 'streak' ? 'consecutive' : 'cumulative',
            days: b.days || 3
          };
        })
      };
      return { success: true, config: v3 };
    }
    // 기본값 (미설정)
    return {
      success: true,
      config: { challengeName: '', challengeStart: '', challengeEnd: '', badges: [] }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * 챌린지 뱃지 설정 v3 저장
 * @param {Object} config  { challengeName, challengeStart, challengeEnd, badges: [...] }
 */
function saveChallengeBadgeConfig(config) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_CONFIG_V3', JSON.stringify(config));
    safeLog_('✅ saveChallengeBadgeConfig 저장 완료: ' + config.challengeName);
    return { success: true };
  } catch(e) {
    safeLog_('❌ saveChallengeBadgeConfig 오류: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── 승인 대기 / 기각 / 수여설정 GAS 동기화 ─────────────────
function getPendingBadges() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('PENDING_BADGES');
    return { success: true, data: raw ? JSON.parse(raw) : [] };
  } catch(e) { return { success: false, error: e.message, data: [] }; }
}
function savePendingBadgesData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('PENDING_BADGES', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}
function getDismissedBadges() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('DISMISSED_BADGES');
    return { success: true, data: raw ? JSON.parse(raw) : [] };
  } catch(e) { return { success: false, error: e.message, data: [] }; }
}
function saveDismissedBadgesData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('DISMISSED_BADGES', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}
function getAwardSettings() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('AWARD_SETTINGS');
    return { success: true, data: raw ? JSON.parse(raw) : null };
  } catch(e) { return { success: false, error: e.message, data: null }; }
}
function saveAwardSettingsData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('AWARD_SETTINGS', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ============================================
// AI 분석 결과 저장/불러오기 (교사가 수정한 내용 → 시트에 보관)
// ============================================
// 컬럼 순서: A=이름, B=학번, C=시작일, D=종료일, E=내용, F=저장일시

function stripHtmlForSheet(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function saveAIReport(studentId, startDate, endDate, content, name) {
  try {
    const ss    = getSpreadsheet_();
    let sheet   = ss.getSheetByName('ai_reports');
    if (!sheet) {
      sheet = ss.insertSheet('ai_reports');
      appendRecordRow_(sheet, ['이름', '학번', '시작일', '종료일', '내용', '저장일시']);
      sheet.setFrozenRows(1);
    }
    const now  = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const sid  = String(studentId);
    const sname = String(name || '');
    const cleanContent = stripHtmlForSheet(String(content || ''));
    sheet.getRange(1,7).setValue('정책버전');
    // 기존 행 찾아 덮어쓰기 (학번+시작일+종료일 기준)
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === sid && String(data[i][2]) === startDate && String(data[i][3]) === endDate) {
        // 이름도 최신화, 내용·저장일시 갱신
        sheet.getRange(i + 1, 1, 1, 7).setValues([[sname, sid, startDate, endDate, cleanContent, now, '2026-10-14']]);
        return { success: true, action: 'updated' };
      }
    }
    // 없으면 새 행 추가
    appendRecordRow_(sheet, [sname, sid, startDate, endDate, cleanContent, now, '2026-10-14']);
    return { success: true, action: 'inserted' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function getAIReport(studentId, startDate, endDate) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = ss.getSheetByName('ai_reports');
    if (!sheet) return { success: true, content: null };
    const sid  = String(studentId);
    const data = sheet.getDataRange().getValues();
    // 헤더가 이름/학번 순인지 학번 순인지 자동 감지
    const isNewFormat = data.length > 0 && String(data[0][0]) === '이름';
    for (let i = data.length - 1; i >= 1; i--) {
      if (isNewFormat) {
        // 새 형식: B=학번(1), C=시작일(2), D=종료일(3), E=내용(4), F=저장일시(5)
        if (String(data[i][1]) === sid && String(data[i][2]) === startDate && String(data[i][3]) === endDate) {
          return { success: true, content: String(data[i][4]), savedAt: String(data[i][5]), policyVersion:String(data[i][6]||'') };
        }
      } else {
        // 구 형식: A=학번(0), B=시작일(1), C=종료일(2), D=내용(3), E=저장일시(4)
        if (String(data[i][0]) === sid && String(data[i][1]) === startDate && String(data[i][2]) === endDate) {
          return { success: true, content: String(data[i][3]), savedAt: String(data[i][4]) };
        }
      }
    }
    return { success: true, content: null };
  } catch(e) {
    return { success: false, error: e.message, content: null };
  }
}

// 편집기 전용 분석 시험. 실존 학생 조회/저장 없이 고정 가상 기록만 사용합니다.
function testAIAnalysis() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/script.external_request"]);
  const payload = {
    studentId: "fictional-analysis-fixture", name: "실존 인물이 아닌 가상 자료",
    weight: 60, limit: 150, startDate: "2000-01-01", endDate: "2000-01-03",
    caffeineData: { topReasons: "가상 응답: 기호", topSymptoms: "없음" },
    sleepData: { topPhone: "안 함", topActivity: "30분 미만", topLatency: "15분 이내", topWake: "0회", topDrowsy: "없음" }
  };
  const weekly = {
    caffeineRecordedDays: 3, sleepRecordedDays: 3, recordedDays: 3, totalDays: 3,
    caffeineTotal: 150, sleepTotal: 24.5, overCaffeineDays: [],
    details: "모든 수치는 검증을 위해 만든 가상 기록입니다.\n2000-01-01: 카페인 0mg, 수면 8시간\n2000-01-02: 카페인 50mg, 수면 8시간\n2000-01-03: 카페인 100mg, 수면 8.5시간"
  };
  const models = [getTeacherAnalysisModel_(), "gemini-3.5-flash-lite"];
  const report = { fictionalDataOnly: true, results: [] };
  models.forEach(function(model) {
    const result = analyzeTeacherHealthData_(payload, weekly, model, 1);
    report.results.push({model: model, source: result.source || "ERROR", httpStatus: result.httpStatus || null, errorCode: result.errorCode || null, analysis: result.analysis || ""});
  });
  console.info(JSON.stringify(report));
  return report;
}

// 수면 로그 테스트 함수
function testSleepLogs() {
  const studentId = "0000";
  safeLog_("=== 수면 로그 테스트 시작 ===");
  safeLog_("학번: " + studentId);

  const logs = getSleepLogs(studentId);

  safeLog_("=== 결과 ===");
  safeLog_("총 로그 개수: " + logs.length);

  if (logs.length > 0) {
    safeLog_("첫 번째 로그:");
    safeLog_(JSON.stringify(logs[0], null, 2));
  } else {
    safeLog_("로그가 없습니다!");
  }
}

// 카페인 로그 테스트 함수
function testCaffeineLogs() {
  const studentId = "1101";
  safeLog_("=== 카페인 로그 테스트 시작 ===");
  safeLog_("학번: " + studentId);

  const logs = getCaffeineLogs(studentId);

  safeLog_("=== 결과 ===");
  safeLog_("총 로그 개수: " + logs.length);

  if (logs.length > 0) {
    safeLog_("첫 번째 로그:");
    safeLog_(JSON.stringify(logs[0], null, 2));
  } else {
    safeLog_("로그가 없습니다!");
  }
}

// ============================================
// 학번 자동 생성 관련 함수
// ============================================

// 수동으로 모든 학생의 학번 생성 (한 번만 실행)
function generateAllStudentIds() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("students");

    if (!sheet) {
      safeLog_('students 시트를 찾을 수 없습니다');
      return;
    }

    const lastRow = sheet.getLastRow();
    let updateCount = 0;

    for (let row = 2; row <= lastRow; row++) {
      const grade = sheet.getRange(row, 1).getValue();    // A: 학년
      const classNum = sheet.getRange(row, 2).getValue(); // B: 반
      const number = sheet.getRange(row, 3).getValue();   // C: 번호

      if (grade && classNum && number) {
        const studentId = String(grade) + String(classNum) + String(number).padStart(2, '0');
        sheet.getRange(row, 5).setValue(Number(studentId)); // E: 학번 ID
        updateCount++;
        safeLog_(`${row}행: ${grade}학년 ${classNum}반 ${number}번 → 학번 ${studentId}`);
      }
    }

    safeLog_(`총 ${updateCount}개의 학번이 생성되었습니다.`);
  } catch (error) {
    safeLog_('학번 생성 오류: ' + error);
  }
}

// ============================================
// 테스트 함수들
// ============================================

// 연결 테스트
function testConnection() {
  safeLog_('testConnection 호출됨');
  return {
    success: true,
    message: 'Google Apps Script 연결 성공!',
    timestamp: new Date().toISOString()
  };
}

// 간단한 객체 저장 테스트
function testSaveSimple(data) {
  safeLog_('=== testSaveSimple 시작 ===');
  safeLog_('받은 데이터 타입: ' + typeof data);
  safeLog_('받은 데이터: ' + JSON.stringify(data));

  if (!data) {
    safeLog_('❌ data가 undefined입니다');
    throw new Error('데이터가 전달되지 않았습니다');
  }

  if (!data.studentId) {
    safeLog_('❌ data.studentId가 없습니다');
    throw new Error('studentId가 없습니다');
  }

  safeLog_('✅ 데이터 검증 성공');

  return {
    success: true,
    receivedData: data,
    message: '데이터를 성공적으로 받았습니다'
  };
}

// saveSleepData 디버깅 버전
function saveSleepDataDebug(payload) {
  safeLog_('=== saveSleepDataDebug 시작 ===');
  safeLog_('Arguments 개수: ' + arguments.length);
  safeLog_('payload 타입: ' + typeof payload);
  safeLog_('payload 값: ' + JSON.stringify(payload));

  // 각 필드 개별 확인
  const fields = ['studentId', 'name', 'date', 'sleepTime', 'wakeTime', 'hours', 'condition', 'memo', 'id'];
  const report = {};

  if (payload) {
    fields.forEach(field => {
      report[field] = {
        exists: payload.hasOwnProperty(field),
        type: typeof payload[field],
        value: payload[field]
      };
    });
  } else {
    report.error = 'payload is null or undefined';
  }

  safeLog_('필드 분석: ' + JSON.stringify(report, null, 2));

  return {
    success: true,
    analysis: report,
    rawPayload: payload
  };
}

// 수면 저장 단순화 버전 (디버깅용)
function saveSleepDataSimple(studentId, name, date, sleepTime, wakeTime, hours, condition, memo, id) {
  safeLog_('=== saveSleepDataSimple (개별 파라미터) ===');
  safeLog_(`studentId: ${studentId}`);
  safeLog_(`name: ${name}`);
  safeLog_(`date: ${date}`);

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    throw new Error("수면 시트를 찾을 수 없습니다.");
  }

  const kstTimestamp = getKSTTimestamp();
  const p = parseStudentId(studentId);

  appendRecordRow_(sheet, [
    kstTimestamp,
    p.grade,
    p.class,
    p.number,
    studentId,
    name,
    date,
    sleepTime,
    wakeTime,
    hours,
    condition,
    memo || '',
    id || Date.now()
  ]);

  return { success: true, message: '저장 완료' };
}

// ============================================
// 중복 데이터 테스트 함수
// ============================================

// 특정 학번의 수면 데이터 확인
function checkSleepDataForStudent() {
  const testStudentId = "1101";  // 테스트할 학번
  const testDate = "2026-02-14";  // 테스트할 날짜

  safeLog_(`=== 수면 데이터 확인: 학번=${testStudentId}, 날짜=${testDate} ===`);

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    safeLog_("❌ sleep 시트 없음");
    return;
  }

  const data = sheet.getDataRange().getValues();
  safeLog_(`총 데이터 행 수: ${data.length - 1}`);

  let foundCount = 0;

  for (let i = 1; i < data.length; i++) {
    const rowStudentId = normalizeId(data[i][4]);
    const rowDateRaw = data[i][6];

    let rowDate = '';
    if (rowDateRaw instanceof Date) {
      rowDate = Utilities.formatDate(rowDateRaw, "Asia/Seoul", "yyyy-MM-dd");
    } else {
      rowDate = String(rowDateRaw).trim();
    }

    if (rowStudentId === testStudentId) {
      safeLog_(`\nRow ${i + 1}:`);
      safeLog_(`  날짜: ${rowDate}`);
      safeLog_(`  취침: ${data[i][7]}`);
      safeLog_(`  기상: ${data[i][8]}`);
      safeLog_(`  시간: ${data[i][9]}시간`);
      safeLog_(`  컨디션: ${data[i][10]}`);
      safeLog_(`  메모: ${data[i][11]}`);

      if (rowDate === testDate) {
        safeLog_(`  ⭐ 대상 날짜와 일치!`);
        foundCount++;
      }
    }
  }

  safeLog_(`\n${testDate} 날짜의 데이터: ${foundCount}개`);
  if (foundCount > 1) {
    safeLog_(`⚠️ 중복 데이터 발견! ${foundCount}개가 있습니다.`);
  }
}

// 중복 제거 실행
function removeDuplicateSleepData() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    safeLog_("❌ sleep 시트 없음");
    return;
  }

  safeLog_("=== 중복 데이터 제거 시작 ===");

  const data = sheet.getDataRange().getValues();
  const seen = new Set();
  const rowsToDelete = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const studentId = normalizeId(data[i][4]);
    const dateRaw = data[i][6];

    let date = '';
    if (dateRaw instanceof Date) {
      date = Utilities.formatDate(dateRaw, "Asia/Seoul", "yyyy-MM-dd");
    } else {
      date = String(dateRaw).trim();
    }

    const key = `${studentId}-${date}`;

    if (seen.has(key)) {
      safeLog_(`중복 발견: Row ${i + 1} - ${key}`);
      rowsToDelete.push(i + 1);
    } else {
      seen.add(key);
    }
  }

  safeLog_(`\n삭제할 행 수: ${rowsToDelete.length}`);

  // 뒤에서부터 삭제 (인덱스 변화 방지)
  rowsToDelete.forEach(rowIndex => {
    safeLog_(`Row ${rowIndex} 삭제`);
    sheet.deleteRow(rowIndex);
  });

  safeLog_("✅ 중복 제거 완료");
}

// ============================================
// AI 이미지 분석 기능 (Gemini Vision API)
// ============================================

// ============================================================
// 공공데이터 포털 식약처 카페인 DB API
// ============================================================

/**
 * 공공데이터 포털 카페인 DB API 키 저장 (최초 1회 실행)
 * Apps Script 편집기에서 직접 실행하세요.
 */
function setCaffeinePublicAPIKey() {
  // ⚠️ 보안상 API 키를 코드에 직접 입력하지 마세요.
  // Apps Script 편집기 → 프로젝트 설정(⚙️) → 스크립트 속성 탭에서
  // 속성: CAFFEINE_PUBLIC_API_KEY / 값: 공공데이터 포털 API 키 를 직접 등록하세요.
  const apiKey = PropertiesService.getScriptProperties().getProperty("CAFFEINE_PUBLIC_API_KEY");
  if (!apiKey) {
    safeLog_("❌ API 키가 스크립트 속성에 설정되지 않았습니다.");
    safeLog_("   Apps Script → 프로젝트 설정 → 스크립트 속성에서 CAFFEINE_PUBLIC_API_KEY를 추가하세요.");
    return;
  }
  safeLog_("✅ 공공데이터 포털 카페인 DB API 키 확인 완료");
}

/**
 * 식품의약품안전처 카페인 함량 DB API 내부 호출
 * @param {string} foodName - 검색할 식품/음료명
 * @param {number} numOfRows - 결과 개수 (기본 10)
 * @returns {Object} { success, data: [{foodName, caffeineAmount, caffeinePerServing, servingSize, maker, category}] }
 */
function searchCaffeineDBAPI(foodName, numOfRows) {
  try {
    numOfRows = numOfRows || 10;
    const apiKey = PropertiesService.getScriptProperties().getProperty("CAFFEINE_PUBLIC_API_KEY");
    if (!apiKey) {
      safeLog_("❌ 공공데이터 API 키 없음 → setCaffeinePublicAPIKey() 실행 필요");
      return { success: false, error: "API 키 미설정", data: [] };
    }

    // 한글 키워드 인코딩
    const encodedName = encodeURIComponent(foodName);
    const url = "https://apis.data.go.kr/B553748/CaffeineInfo/getCaffeineInfo"
      + "?serviceKey=" + apiKey
      + "&type=json"
      + "&pageNo=1"
      + "&numOfRows=" + numOfRows
      + "&food_Nm=" + encodedName;

    safeLog_("📡 공공DB 호출: " + foodName);

    const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    safeLog_("공공DB 응답코드: " + responseCode);

    if (responseCode !== 200) {
      safeLog_("❌ 공공DB 오류: " + responseText.substring(0, 200));
      return { success: false, error: "API 오류 " + responseCode, data: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      safeLog_("공공DB JSON 파싱 실패: " + responseText.substring(0, 300));
      return { success: false, error: "응답 파싱 실패", data: [] };
    }

    // 응답 구조: { response: { body: { items: { item: [...] }, totalCount } } }
    const body = parsed && parsed.response && parsed.response.body;
    if (!body) return { success: false, error: "응답 구조 오류", data: [] };

    const totalCount = parseInt(body.totalCount) || 0;
    if (totalCount === 0) {
      safeLog_("공공DB 결과 없음: " + foodName);
      return { success: true, data: [], totalCount: 0 };
    }

    let items = body.items && body.items.item;
    if (!items) return { success: true, data: [], totalCount: 0 };
    if (!Array.isArray(items)) items = [items]; // 1건이면 객체로 옴

    const results = items.map(function(item) {
      const caffeineBase    = parseFloat(item.caffein_Amount         || 0); // 100ml/g 기준 mg
      const caffeineServing = parseFloat(item.caffein_AmountPerServ  || 0); // 1회분 mg
      return {
        foodName:          String(item.food_Nm  || "").trim(),
        caffeineAmount:    caffeineBase,
        caffeinePerServing: caffeineServing,
        servingSize:       String(item.serv_Wt  || "").trim(), // 1회 제공량
        maker:             String(item.comp_Nm  || "").trim(), // 제조사
        category:          String(item.food_Cls || "").trim(), // 식품분류
        reportYear:        String(item.rpt_Yr   || "").trim()  // 보고연도
      };
    });

    safeLog_("✅ 공공DB " + results.length + "건 (전체 " + totalCount + "건)");
    return { success: true, data: results, totalCount: totalCount };

  } catch (error) {
    safeLog_("❌ searchCaffeineDBAPI 오류: " + error);
    return { success: false, error: error.toString(), data: [] };
  }
}

/**
 * 음료명 검색 - Gemini AI 1차 + 식약처 공공DB 2차 병합
 * AI가 폭넓게 먼저 검색, 공공DB 결과가 있으면 앞에 추가
 * @param {string} keyword
 * @returns {Object} { success, results: [{name, caffeine, maker, serving, category, source}] }
 */
function searchDrinkCaffeine(keyword) {
  try {
    if (!keyword || keyword.trim().length < 1) {
      return { success: true, results: [] };
    }
    keyword = keyword.trim();
    safeLog_("검색 키워드: [" + keyword + "]");

    // 1차: Gemini AI 검색 (항상 실행 - 가장 빠르고 넓은 커버리지)
    var aiResults = [];
    try {
      aiResults = searchDrinkCaffeineWithAI(keyword) || [];
      safeLog_("AI 결과: " + aiResults.length + "건");
    } catch (aiErr) {
      safeLog_("AI 검색 오류(무시): " + aiErr);
    }

    // 2차: 식약처 공공DB 검색 (성공하면 앞에 추가)
    var dbResults = [];
    try {
      var dbResult = searchCaffeineDBAPI(keyword, 5);
      if (dbResult && dbResult.success && dbResult.data && dbResult.data.length > 0) {
        safeLog_("공공DB 결과: " + dbResult.data.length + "건");
        dbResults = dbResult.data.map(function(item) {
          var caffeine = item.caffeinePerServing > 0
            ? Math.round(item.caffeinePerServing)
            : Math.round(item.caffeineAmount);
          return {
            name:     item.foodName,
            caffeine: caffeine,
            maker:    item.maker,
            serving:  item.servingSize,
            category: item.category,
            source:   "db"
          };
        });
      }
    } catch (dbErr) {
      safeLog_("공공DB 오류(무시): " + dbErr);
    }

    // DB 결과 먼저, AI 결과 뒤에 (중복 이름 제거)
    var seen = {};
    var merged = [];
    dbResults.forEach(function(item) {
      var key = (item.name || "").replace(/\s/g, "").toLowerCase();
      if (key && !seen[key]) { seen[key] = true; merged.push(item); }
    });
    aiResults.forEach(function(item) {
      var key = (item.name || "").replace(/\s/g, "").toLowerCase();
      if (key && !seen[key]) { seen[key] = true; merged.push(item); }
    });

    safeLog_("최종: " + merged.length + "건 (DB:" + dbResults.length + " AI:" + aiResults.length + ")");
    return { success: true, results: merged, fromDB: dbResults.length > 0 };

  } catch (error) {
    safeLog_("searchDrinkCaffeine 오류: " + error);
    return { success: false, error: error.toString(), results: [] };
  }
}

/**
 * Gemini AI 텍스트 검색 - 한국 시중 음료 카페인 정보 반환
 * @param {string} keyword
 * @returns {Array}
 */
function searchDrinkCaffeineWithAI(keyword) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      safeLog_("Gemini API 키 없음");
      return [];
    }

    var modelName = "gemini-2.0-flash";
    var apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/"
      + modelName + ":generateContent?key=" + apiKey;

    var prompt =
      "당신은 한국 시중 음료의 카페인 함량 전문가입니다.\n"
      + "검색어: \"" + keyword + "\"\n\n"
      + "이 검색어와 관련된 한국 시중 음료 제품을 최대 6개 찾아주세요.\n"
      + "편의점·카페에서 구매 가능한 제품 위주, 브랜드별/용량별 변형도 포함하세요.\n\n"
      + "반드시 아래 JSON 배열 형식만 응답하세요 (설명 없이, 마크다운 없이):\n"
      + "[\n"
      + "  {\n"
      + "    \"name\": \"제품 전체명 (예: 스타벅스 아메리카노 톨 355ml)\",\n"
      + "    \"caffeine\": 카페인mg숫자(1회제공량기준),\n"
      + "    \"maker\": \"브랜드명\",\n"
      + "    \"serving\": \"1회제공량(예: 355ml)\",\n"
      + "    \"category\": \"음료종류(예: 커피음료)\"\n"
      + "  }\n"
      + "]\n\n"
      + "caffeine은 반드시 1회 제공량 기준 mg값. 관련 음료 없으면 [] 반환.";

    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topK: 10,
        topP: 0.8,
        maxOutputTokens: 1000
      }
    };

    safeLog_("Gemini 검색 API 호출 (재시도 포함)...");
    var srchFetchResult   = fetchWithRetry(apiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }, 3);

    var srchFetchResponse = srchFetchResult.response;
    if (!srchFetchResponse || srchFetchResponse.getResponseCode() !== 200) {
      safeLog_("Gemini 검색 실패: " + (srchFetchResult.errorCode || 'UNKNOWN'));
      return [];
    }

    var responseCode = srchFetchResponse.getResponseCode();
    var responseText = srchFetchResponse.getContentText();
    safeLog_("Gemini 응답코드: " + responseCode);

    var result = JSON.parse(responseText);
    if (!result.candidates || result.candidates.length === 0) {
      safeLog_("Gemini 후보 없음");
      return [];
    }

    var aiText = result.candidates[0].content.parts[0].text.trim();
    safeLog_("Gemini 응답 원문: " + aiText.substring(0, 500));

    // 코드블록 마크다운 제거
    aiText = aiText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    var aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      // JSON 배열만 추출 시도
      var match = aiText.match(/\[[\s\S]*\]/);
      if (match) {
        try { aiData = JSON.parse(match[0]); }
        catch (e2) { safeLog_("배열 추출 실패"); return []; }
      } else {
        safeLog_("JSON 파싱 실패: " + aiText.substring(0, 100));
        return [];
      }
    }

    if (!Array.isArray(aiData)) {
      safeLog_("결과가 배열이 아님");
      return [];
    }

    var cleaned = [];
    for (var i = 0; i < aiData.length; i++) {
      var item = aiData[i];
      var name = String(item.name || "").trim();
      if (!name) continue;
      cleaned.push({
        name:     name,
        caffeine: Math.round(Math.max(0, parseFloat(item.caffeine) || 0)),
        maker:    String(item.maker    || "").trim(),
        serving:  String(item.serving  || "").trim(),
        category: String(item.category || "").trim(),
        source:   "ai"
      });
    }

    safeLog_("AI 파싱 완료: " + cleaned.length + "건");
    for (var j = 0; j < cleaned.length; j++) {
      safeLog_("  [" + j + "] " + cleaned[j].name + " | " + cleaned[j].caffeine + "mg");
    }
    return cleaned;

  } catch (error) {
    safeLog_("searchDrinkCaffeineWithAI 오류: " + error);
    safeLog_(error.stack || "");
    return [];
  }
}


/**
 * AI 이미지 분석 + 공공DB 교차검증 (개선버전)
 * Gemini로 제품명/카페인 추출 → 공공DB에서 정확한 값 조회
 */
function analyzeDrinkImageWithAI(base64Image) {
  try {
    safeLog_('=== AI 이미지 분석 시작 (공공DB 교차검증 포함) ===');

    const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      safeLog_("❌ Gemini API 키 없음");
      return { success: false, error: "API 키가 설정되지 않았습니다" };
    }

    const modelName = "gemini-2.0-flash";
    const apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey;

    // Step 1: Gemini 이미지 분석 - 음료/의약품 모두 카페인 성분 직독
    const prompt = "You are an expert at reading Korean product labels, nutrition facts tables, and pharmaceutical ingredient lists.\n\n"
      + "TARGET: Extract caffeine content from ANY product — beverages (음료), energy drinks, coffee, medicine/pharmaceuticals (의약품), supplements.\n\n"
      + "ANALYSIS PRIORITY (in order):\n"
      + "1. PHARMACEUTICAL INGREDIENT LIST (성분/유효성분표): look for '카페인무수물', '카페인(KP)', '카페인수화물', 'Caffeine anhydrous'\n"
      + "   e.g. '카페인무수물(KP) 50mg' → caffeine=50. Read the mg number directly. -> confidence=high, source=label\n"
      + "2. FRONT LABEL caffeine declaration on beverages: '고카페인함유 (NNNmg/캔)', '카페인 NNNmg', 'caffeine NNNmg'\n"
      + "   -> confidence=high, source=label\n"
      + "3. Nutrition facts table (영양성분표 / Nutrition Facts) - read caffeine row directly\n"
      + "   -> confidence=high, source=label\n"
      + "4. If no caffeine number found but product is identified, use product name for DB search\n"
      + "   -> confidence=medium, source=estimate\n"
      + "5. If nothing identifiable, return caffeine=null\n"
      + "   -> confidence=low, source=estimate\n\n"
      + "KNOWN HINTS: Monster Energy 355ml=100mg, Red Bull 250ml=80mg, Starbucks Doubleshot 200ml=108mg\n"
      + "Common OTC caffeine pills (박카스, 타이레놀이엑스 등) contain 30~50mg caffeine per tablet.\n\n"
      + "Respond ONLY with a valid JSON object, no other text:\n"
      + "{\n"
      + "  \"drinkName\": \"Full product name in Korean (e.g. 몬스터에너지 355ml / 타이레놀이엑스 1정)\",\n"
      + "  \"caffeine\": <total caffeine in mg as a number, or null if not found>,\n"
      + "  \"volume\": \"serving size string e.g. 355ml or 1정, or null\",\n"
      + "  \"confidence\": \"high|medium|low\",\n"
      + "  \"source\": \"label|estimate\",\n"
      + "  \"searchKeyword\": \"short 2-3 word Korean keyword (e.g. 몬스터에너지, 타이레놀이엑스)\"\n"
      + "}\n\n"
      + "confidence: high=caffeine mg read directly from label/ingredient list, medium=product identified, low=unknown\n"
      + "source: label=read from text on product, estimate=inferred\n"
      + "IMPORTANT: If caffeine is listed per tablet/capsule in ingredient list, report that value as caffeine.";

    const geminiPayload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: base64Image } }  // ⭐ 프론트에서 항상 JPEG로 압축 변환됨
        ]
      }],
      generationConfig: { temperature: 0.1, topK: 10, topP: 0.8, maxOutputTokens: 400 }
    };

    safeLog_('🔍 Gemini API 호출 (재시도 포함)...');
    const imgFetchResult   = fetchWithRetry(apiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(geminiPayload),
      muteHttpExceptions: true
    }, 3);

    const imgFetchResponse = imgFetchResult.response;
    const imgErrCode       = imgFetchResult.errorCode;

    if (!imgFetchResponse || imgFetchResponse.getResponseCode() !== 200) {
      const errInfo = getApiErrorInfo(imgErrCode || 'UNKNOWN_ERROR');
      // ⭐ 실제 응답 본문을 로그에 기록 → 400/UNKNOWN_ERROR 원인 파악용
      const errBody = imgFetchResponse ? imgFetchResponse.getContentText().substring(0, 300) : '(응답 없음)';
      safeLog_("❌ 이미지 분석 API 실패: HTTP " + (imgFetchResponse ? imgFetchResponse.getResponseCode() : 'null')
                 + ", errorCode=" + (imgErrCode || 'UNKNOWN_ERROR')
                 + ", body=" + errBody);
      return {
        success:   false,
        error:     errInfo.title + ' — ' + errInfo.desc,
        errorCode: imgErrCode || 'UNKNOWN_ERROR'
      };
    }

    const responseCode = imgFetchResponse.getResponseCode();
    const responseText = imgFetchResponse.getContentText();
    safeLog_("Gemini 응답코드: " + responseCode);

    let geminiResult;
    try {
      geminiResult = JSON.parse(responseText);
    } catch (parseErr) {
      safeLog_("❌ 응답 JSON 파싱 실패: " + responseText.substring(0, 200));
      return { success: false, error: "AI 응답을 해석할 수 없습니다. 다시 시도해주세요.", errorCode: "PARSE_ERROR" };
    }

    // candidates 없는 경우: 이미지 품질 불량, 안전 필터, 할당량 초과 등
    if (!geminiResult.candidates || geminiResult.candidates.length === 0) {
      // promptFeedback 확인 (안전 필터 등)
      const feedback = geminiResult.promptFeedback;
      const blockReason = feedback && feedback.blockReason ? feedback.blockReason : null;
      safeLog_("⚠️ candidates 없음. blockReason=" + blockReason + ", 원문=" + responseText.substring(0, 300));

      if (blockReason === "SAFETY") {
        return { success: false, error: "이미지를 분석할 수 없습니다 (안전 정책).\n음료 라벨/영양성분표 사진을 다시 촬영해주세요.", errorCode: "SAFETY_BLOCK" };
      }
      return { success: false, error: "AI가 이미지를 인식하지 못했습니다.\n📸 사진이 흐리거나 너무 어두우면 다시 촬영해주세요.", errorCode: "NO_CANDIDATES" };
    }

    // finishReason 확인 (MAX_TOKENS, SAFETY 등)
    const finishReason = geminiResult.candidates[0].finishReason;
    if (finishReason === "SAFETY") {
      return { success: false, error: "이미지 분석이 차단되었습니다 (안전 정책).\n음료 라벨 사진을 다시 촬영해주세요.", errorCode: "SAFETY_BLOCK" };
    }
    if (!geminiResult.candidates[0].content || !geminiResult.candidates[0].content.parts) {
      return { success: false, error: "📸 사진이 너무 어둡거나 흐릿합니다. 밝은 곳에서 가까이 다시 촬영해주세요.", errorCode: "EMPTY_CONTENT" };
    }

    let aiText = geminiResult.candidates[0].content.parts[0].text.trim();
    if (aiText.includes("```")) {
      aiText = aiText.replace(/```json/g, "").replace(/```/g, "").trim();
    }

    let aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      safeLog_("AI JSON 파싱 실패. aiText=" + aiText.substring(0, 300));
      // AI가 자연어로 답변한 경우 (이미지 품질 불량 등)
      if (aiText.length > 0) {
        const lower = aiText.toLowerCase();
        if (lower.includes("unclear") || lower.includes("blur") || lower.includes("흐") || lower.includes("불분명") || lower.includes("인식")) {
          return { success: false, error: "📸 사진이 흐릿하거나 너무 어둡습니다.\n밝은 곳에서 성분표에 가까이 대고 다시 촬영해주세요.", errorCode: "BLUR_IMAGE" };
        }
      }
      return { success: false, error: "📸 성분표/영양성분표가 잘 보이도록 다시 촬영해주세요.\n(너무 어둡거나 흔들린 경우 재촬영 필요)", errorCode: "PARSE_FAIL" };
    }

    safeLog_("AI 추출: " + JSON.stringify(aiData));

    // ⭐ null 문자열 정규화: AI가 "null" 문자열을 반환하는 경우 빈 문자열로 치환
    function sanitizeNull(v) {
      if (v === null || v === undefined || v === "null" || v === "undefined") return "";
      return String(v).trim();
    }

    const aiDrinkName = sanitizeNull(aiData.drinkName);
    const aiVolume    = sanitizeNull(aiData.volume);

    // ⭐ 음료/식품 아닌 이미지 감지: drinkName이 비어있고 confidence=low → 잘못된 사진
    if (!aiDrinkName && (aiData.confidence === "low" || !aiData.confidence)) {
      safeLog_("⚠️ 제품 인식 실패 (drinkName 없음, confidence=low) → 재촬영 안내");
      return {
        success:   false,
        error:     "음료나 식품 라벨이 인식되지 않았습니다.\n📸 음료의 영양성분표나 성분표가 잘 보이도록 촬영해주세요.",
        errorCode: "NOT_A_DRINK"
      };
    }

    // Step 2: 영양성분표 직독 (high/label) → 공공DB로 제조사 등 부가 정보만 보강
    if (aiData.confidence === "high" && aiData.source === "label" && aiData.caffeine !== null) {
      safeLog_("✅ 영양성분표 직독 완료 - 공공DB 부가정보 조회");
      let makerInfo = "", servingInfo = "";
      if (aiData.searchKeyword) {
        const dbCheck = searchCaffeineDBAPI(aiData.searchKeyword, 3);
        if (dbCheck.success && dbCheck.data.length > 0) {
          const m = dbCheck.data[0];
          if (m.maker) makerInfo = m.maker;
          if (m.servingSize) servingInfo = m.servingSize;
        }
      }
      const caffeine  = parseInt(aiData.caffeine);
      const volumeStr = aiVolume || servingInfo || "";
      return {
        success:    true,
        drinkName:  aiDrinkName || "제품",
        caffeine:   caffeine,
        volume:     volumeStr,
        maker:      makerInfo,
        confidence: "high",
        source:     "label",
        dbVerified: false,
        analysis:   (aiDrinkName || "제품") + " · " + caffeine + "mg"
                    + (volumeStr ? " · " + volumeStr : "")
                    + " (성분표/영양성분표 직접 확인 ✅)"
      };
    }

    // Step 3: 제품명 기반 추정 → 공공DB 교차검증
    const searchTerm = sanitizeNull(aiData.searchKeyword) || aiDrinkName || "";
    if (searchTerm) {
      safeLog_("📡 공공DB 교차검증: " + searchTerm);
      const dbResult = searchCaffeineDBAPI(searchTerm, 5);

      if (dbResult.success && dbResult.data.length > 0) {
        const best      = dbResult.data[0];
        const caffeine  = best.caffeinePerServing > 0
          ? Math.round(best.caffeinePerServing)
          : Math.round(best.caffeineAmount);
        const volumeStr = best.servingSize || aiVolume || "";

        safeLog_("✅ 공공DB 매칭: " + best.foodName + " " + caffeine + "mg");
        return {
          success:    true,
          drinkName:  best.foodName,
          caffeine:   caffeine,
          volume:     volumeStr,
          maker:      best.maker,
          confidence: "high",
          source:     "database",
          dbVerified: true,
          dbInfo:     { maker: best.maker, serving: best.servingSize, category: best.category },
          analysis:   best.foodName + " · " + caffeine + "mg"
                      + (volumeStr ? " · " + volumeStr : "")
                      + (best.maker ? " · " + best.maker : "")
                      + " (식약처 공공DB 확인 ✅)"
        };
      }
      safeLog_("공공DB 결과 없음 → AI 추정값 사용");
    }

    // Step 4: DB도 없음 → AI 추정값 반환 (낮은 신뢰도 안내 포함)
    const aiCaffeine = (aiData.caffeine !== null && aiData.caffeine !== undefined)
      ? parseInt(aiData.caffeine) : 0;
    let warningMsg = (aiData.confidence === "low")
      ? " ⚠️ 추정치 — 성분표가 잘 보이도록 다시 촬영해주세요"
      : " (AI 추정 — 오차 가능)";

    return {
      success:    true,
      drinkName:  aiDrinkName || "알 수 없는 제품",
      caffeine:   aiCaffeine,
      volume:     aiVolume || "",
      maker:      "",
      confidence: aiData.confidence || "low",
      source:     "estimate",
      dbVerified: false,
      analysis:   (aiDrinkName || "알 수 없는 제품") + " · 약 " + aiCaffeine + "mg"
                  + (aiVolume ? " · " + aiVolume : "")
                  + warningMsg
    };

  } catch (error) {
    safeLog_('❌ analyzeDrinkImageWithAI 오류: ' + error);
    safeLog_('스택: ' + error.stack);
    return { success: false, error: error.toString() };
  }
}

// ── 공공DB API 연결 테스트 ─────────────────────────────────────
function testCaffeineDBSearch() {
  safeLog_("=== 공공DB 검색 테스트 ===");
  ["아메리카노", "레드불", "몬스터", "콜라"].forEach(function(kw) {
    safeLog_("\n🔍 " + kw);
    const r = searchDrinkCaffeine(kw);
    if (r.success && r.results.length > 0) {
      r.results.forEach(function(item) {
        safeLog_("  ✅ " + item.name + " - " + item.caffeine + "mg" + (item.maker ? " (" + item.maker + ")" : "") + (item.serving ? " / " + item.serving : ""));
      });
    } else {
      safeLog_("  결과 없음: " + JSON.stringify(r));
    }
  });
}

// testImageAnalysis → testCaffeineDBSearch 로 통합됨 (위의 새 함수 참조)

// ============================================
// Gemini API 키 설정 함수
// ============================================

/**
 * Gemini API 키 설정
 * ✅ 사용법: Apps Script 편집기 → 프로젝트 설정(⚙️) → 스크립트 속성 탭에서
 *           속성 이름: GEMINI_API_KEY, 값: 발급받은 Gemini API 키를 직접 입력하세요.
 *           이 함수는 키 등록 여부를 확인하는 용도로 사용합니다.
 */
function setGeminiAPIKey() {
  // ⚠️ 보안상 API 키를 코드에 직접 입력하지 마세요.
  // Apps Script → 프로젝트 설정 → 스크립트 속성에서 GEMINI_API_KEY를 등록하세요.
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    safeLog_("❌ API 키가 스크립트 속성에 설정되지 않았습니다!");
    safeLog_("   Apps Script → 프로젝트 설정 → 스크립트 속성에서 GEMINI_API_KEY를 추가하세요.");
    return;
  }
  safeLog_("✅ Gemini API 키가 설정되어 있습니다!");
  safeLog_("실제 연결 확인은 checkGeminiAPIKey()를 실행하세요.");
}

/**
 * 편집기 전용 연결 시험. 학생 기록을 읽거나 전송하지 않고 요청 1회만 실행합니다.
 * 키/원문 오류/응답 내용은 기록하지 않습니다. 웹 API에 공개하지 마세요.
 */
function checkGeminiAPIKey() {
  const apiKey = String(PropertiesService.getScriptProperties()
    .getProperty("GEMINI_API_KEY") || "").trim();
  const model = "gemini-3.5-flash-lite";
  const result = { configured: !!apiKey, success: false, model: model, httpStatus: null, code: "NO_API_KEY" };
  if (apiKey) {
    // IDE의 세부 권한 승인 흐름을 사용합니다. 승인 예외를 삼키지 않습니다.
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/script.external_request"]);
    try {
      const response = UrlFetchApp.fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "post", contentType: "application/json", muteHttpExceptions: true,
          headers: { "x-goog-api-key": apiKey },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with exactly CONNECTION_OK." }] }],
            generationConfig: { maxOutputTokens: 1024 }
          })
        }
      );
      result.httpStatus = response.getResponseCode();
      if (result.httpStatus !== 200) {
        const codes = { 400: "INVALID_REQUEST_OR_KEY", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "MODEL_NOT_FOUND", 429: "QUOTA_EXCEEDED" };
        result.code = codes[result.httpStatus] || "HTTP_ERROR";
      } else {
        result.code = "INVALID_RESPONSE";
        try {
          const data = JSON.parse(response.getContentText());
          const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
          const answer = Array.isArray(parts) ? parts.filter(function(part) { return !part.thought && typeof part.text === "string"; }).map(function(part) { return part.text; }).join("").trim() : "";
          if (answer === "CONNECTION_OK") {
            result.success = true;
            result.code = "CONNECTION_OK";
          }
        } catch (ignored) { /* 원문 응답을 로그에 남기지 않습니다. */ }
      }
    } catch (error) {
      result.code = "TRANSPORT_ERROR";
      const message = String(error && error.message || "");
      result.errorMentionsExternalRequestScope = /script\.external_request/.test(message);
      result.urlFetchPermissionDenied = /UrlFetchApp\.fetch/.test(message) && /permission|권한/i.test(message);
      if (/permission|authorization|권한|승인/i.test(message)) result.code = "URL_FETCH_PERMISSION_DENIED";
      else if (/header|헤더/i.test(message)) result.code = "INVALID_REQUEST_HEADER";
      else if (/DNS/i.test(message)) result.code = "DNS_ERROR";
      else if (/too many times|quota|할당량/i.test(message)) result.code = "URL_FETCH_QUOTA_EXCEEDED";
    }
  }
  // 고정된 진단 필드만 출력하며 학생/키/제공자 원문은 포함하지 않습니다.
  console.info(JSON.stringify(result));
  return result;
}

/**
 * API 키 삭제 (필요시)
 */
function deleteGeminiAPIKey() {
  PropertiesService.getScriptProperties()
    .deleteProperty("GEMINI_API_KEY");

  safeLog_("🗑️ API 키가 삭제되었습니다");
}

function testWithRealStudentId() {
  safeLog_('=== 실제 학번으로 테스트 ===');

  // 여기에 실제 사용 중인 학번 입력
  const realStudentId = '0'; // 또는 본인의 실제 학번

  const result = getWeeklyDetailedData(realStudentId);

  safeLog_('학번: ' + realStudentId);
  safeLog_('반환 타입: ' + typeof result);
  safeLog_('recordedDays: ' + result.recordedDays);
  safeLog_('totalDays: ' + result.totalDays);

  if (result.recordedDays > 0) {
    safeLog_('✅✅✅ 데이터 있음! 정상 작동!');
  } else {
    safeLog_('⚠️ 이 학번에는 데이터가 없습니다');
    safeLog_('스프레드시트에서 데이터가 있는 학번을 확인하세요');
  }
}
/**
 * 교사용 전체 데이터 조회
 * students / caffeine / sleep / info 시트 전체 반환
 *
 * 시트 컬럼 구조:
 *   students : A=학년, B=반, C=번호, D=이름, E=학번
 *   caffeine : A=타임스탬프, B=학년, C=반, D=번호, E=전체학번,
 *              F=성명, G=음료명, H=함량, I=섭취시간, J=고유ID
 *   sleep    : A=타임스탬프, B=학년, C=반, D=번호, E=전체학번,
 *              F=성명, G=날짜, H=취침, I=기상, J=시간,
 *              K=수면 후 컨디션, L=메모, M=고유ID
 *   info     : A=타임스탬프, B=학년, C=반, D=번호, E=성명,
 *              F=전체학번, G=몸무게
 */
// 비수치 학번(교직원·교생)의 고유 ID 생성.
// 새 형식("교직원_이름")은 그대로, 구 형식("교직원")은 "_이름" 접미사 추가.
function makeTeacherUniqueId(rawId, name) {
  if (/^\d+$/.test(rawId)) return rawId;           // 숫자 학번은 그대로
  const suffix = '_' + String(name || '').trim();
  return rawId.endsWith(suffix) ? rawId : rawId + suffix;
}

function getTeacherData() {
  try {
    const ss = getSpreadsheet_();

    // ── students ─────────────────────────────────────
    const studSheet = ss.getSheetByName('students');
    if (!studSheet) throw new Error('students 시트를 찾을 수 없습니다');
    const studRaw = studSheet.getDataRange().getValues();
    const students = [];

    for (let i = 1; i < studRaw.length; i++) {
      const r = studRaw[i];
      const rawId = String(r[4]).trim();
      if (!rawId || rawId === 'undefined') continue;
      // ※ 테스트 계정(학번=0) 제외하려면 아래 주석 해제
      // if (rawId === '0') continue;
      const studName = String(r[3] || '');
      // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키로 고유화
      const id = makeTeacherUniqueId(rawId, studName);
      students.push({
        학번: id,
        이름: studName,
        학년: String(parseInt(r[0]) || ''),
        반:   String(parseInt(r[1]) || ''),
        번호: String(parseInt(r[2]) || '')
      });
    }

    // ── caffeine ─────────────────────────────────────
    const cafSheet = ss.getSheetByName('caffeine');
    if (!cafSheet) throw new Error('caffeine 시트를 찾을 수 없습니다');
    const cafLastRow = cafSheet.getLastRow();
    const caffeine = [];

    if (cafLastRow > 1) {
      const cafRaw = cafSheet.getRange(2, 1, cafLastRow - 1, Math.min(15, cafSheet.getLastColumn())).getValues();
      for (let i = 0; i < cafRaw.length; i++) {
        const r = cafRaw[i];
        const cafRawId = String(r[4]).trim();  // E열: 전체학번
        if (!cafRawId || cafRawId === 'undefined') continue;
        const cafName = String(r[5] || '');    // F열: 성명
        // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키
        const id = makeTeacherUniqueId(cafRawId, cafName);

        // I열: 섭취시간 → "yyyy-MM-dd HH:mm:ss" 형식
        const intakeTime = r[8];
        let timeStr = '';
        if (intakeTime instanceof Date) {
          timeStr = Utilities.formatDate(intakeTime, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
        } else {
          timeStr = String(intakeTime || '');
        }

        caffeine.push({
          학번:   id,
          음료명:  String(r[6] || ''),   // G열
          함량:   recordNumber_(r[7]), // H열
          섭취시간: timeStr,
          이유:   String(r[10] || ''),   // K열
          업체명: String(r[13] || ''),
          원본식품명: String(r[14] || ''),
          부작용: String(r[11] || '')    // L열
        });
      }
    }

    // ── sleep ─────────────────────────────────────────
    const sleepSheet = ss.getSheetByName('sleep');
    if (!sleepSheet) throw new Error('sleep 시트를 찾을 수 없습니다');
    const sleepLastRow = sleepSheet.getLastRow();
    const sleep = [];

    if (sleepLastRow > 1) {
      const sleepRaw = sleepSheet.getRange(2, 1, sleepLastRow - 1, 19).getValues();
      for (let i = 0; i < sleepRaw.length; i++) {
        const r = sleepRaw[i];
        const sleepRawId = String(r[4]).trim();  // E열: 전체학번
        if (!sleepRawId || sleepRawId === 'undefined') continue;
        const sleepName = String(r[5] || '');    // F열: 성명
        // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키
        const id = makeTeacherUniqueId(sleepRawId, sleepName);

        // G열: 날짜 → "yyyy-MM-dd"
        const dateVal = r[6];
        const wakeDateVal = r[8];
        let dateStr = '';
        let wakeDateStr = '';
        if (dateVal instanceof Date) {
          dateStr = Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
        } else {
          dateStr = String(dateVal || '').substring(0, 10);
        }
        if (wakeDateVal instanceof Date) {
          wakeDateStr = Utilities.formatDate(wakeDateVal, 'Asia/Seoul', 'yyyy-MM-dd');
        } else {
          wakeDateStr = String(wakeDateVal || '').substring(0, 10);
        }

        // H열: 취침, I열: 기상 → "HH:mm" 형식
        function toHHMM(val) {
          if (!val) return '';
          if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'HH:mm');
          const m = String(val).match(/^(\d{1,2}):(\d{2})/);
          return m ? m[1].padStart(2, '0') + ':' + m[2] : String(val);
        }

        sleep.push({
          학번:           id,
          날짜:           dateStr,
          wakeDate:       wakeDateStr,
          취침:           toHHMM(r[7]),          // H열
          기상:           toHHMM(r[9]),          // I열
          저장시각:        recordTimestampText_(r[0]),
          원본행번호:      i+2,
          시간:           recordNumber_(r[10]), // J열
          '수면 후 컨디션': String(r[11] || ''),  // K열
          메모:           String(r[12] || ''),   // L열
          스마트폰:        String(r[14] || ''),   // N열
          활동:           String(r[15] || ''),   // O열
          잠들기:          String(r[16] || ''),   // P열
          각성:           String(r[17] || ''),   // Q열
          낮졸림:          String(r[18] || '')    // R열
        });
      }
    }

    // ── info (몸무게) ─────────────────────────────────
    const infoSheet = ss.getSheetByName('info');
    if (!infoSheet) throw new Error('info 시트를 찾을 수 없습니다');
    const infoRaw = infoSheet.getDataRange().getValues();
    const info = [];
    const seenInfo = new Set();

    for (let i = 1; i < infoRaw.length; i++) {
      const r = infoRaw[i];
      const id = String(r[5]).trim();  // F열: 전체학번
      if (!id || id === '' || id === 'undefined') continue;
      if (seenInfo.has(id)) continue;  // 중복 제거 (최초 기록 사용)
      seenInfo.add(id);
      info.push({
        학번: id,
        몸무게: parseFloat(r[6]) || 60,        // G열: 몸무게
        목표카페인: parseFloat(r[7]) || null,  // H열: 목표 카페인
        목표취침: toProfileHHMM_(r[8]),           // I열: 목표 취침
        목표기상: toProfileHHMM_(r[9])            // J열: 목표 기상
      });
    }

    safeLog_(`✅ getTeacherData 완료: 학생 ${students.length}명, 카페인 ${caffeine.length}건, 수면 ${sleep.length}건, 체중 ${info.length}건`);

    // ── teacher_awards (교사 수여 뱃지) ─────────────────
    // 교사 앱 localStorage를 GAS 시트 기준으로 동기화하기 위해 함께 반환
    const manualAwards = {}; // { [studentId]: [ awardObj, ... ] }
    try {
      const awardSheet = ss.getSheetByName('teacher_awards');
      if (awardSheet && awardSheet.getLastRow() > 1) {
        const awardData  = awardSheet.getDataRange().getValues();
        // ⭐ 헤더 컬럼 수로 신규/구버전 판단 (학번 길이에 무관 → 학번 0도 정상 처리)
        const totalCols2 = awardData[0] ? awardData[0].length : 0;
        // ⭐ 포맷 판단: 컬럼 수가 아닌 B열(index1) 헤더값으로 구분
        // 신규(12+열): B열='학년' → E열(index4)=학번, G열(index6)=awardId
        // 구버전( 9열): B열='studentid' → B열(index1)=학번, C열(index2)=awardId
        const hdr1_2 = String(awardData[0][1] || '').toLowerCase();
        const isNew2 = (totalCols2 >= 12) && (hdr1_2 === '학년' || hdr1_2 === 'grade');
        safeLog_('getTeacherData - 뱃지 포맷: ' + (isNew2 ? '신규(12+열)' : '구버전') + ', 컬럼=' + totalCols2 + ', B헤더="' + hdr1_2 + '"');

        for (let i = 1; i < awardData.length; i++) {
          const row = awardData[i];
          const ts  = _tsToStr_(row[0]);
          const sid = isNew2 ? normalizeId(row[4]) : normalizeId(row[1]);
          if (!sid) continue; // 학번 없는 행 스킵

          if (!manualAwards[sid]) manualAwards[sid] = [];
          manualAwards[sid].push({
            grantedAt : ts,
            awardId   : isNew2 ? String(row[6]  || '') : String(row[2] || ''),
            name      : isNew2 ? String(row[7]  || '') : String(row[3] || ''),
            image     : isNew2 ? String(row[8]  || '🏅') : String(row[4] || '🏅'),
            bg        : isNew2 ? String(row[9]  || '#f5f3ff') : String(row[5] || '#f5f3ff'),
            color     : isNew2 ? String(row[10] || '#7c3aed') : String(row[6] || '#7c3aed'),
            message   : isNew2 ? String(row[11] || '') : String(row[7] || ''),
            grantedBy : isNew2 ? String(row[12] || '') : String(row[8] || '')
          });
        }
        safeLog_('getTeacherData - 뱃지 로드 완료: ' + Object.keys(manualAwards).length + '명');
      }
    } catch (awardErr) {
      safeLog_('⚠️ teacher_awards 로드 실패 (계속 진행): ' + awardErr);
    }

    return {
      success      : true,
      hiddenStudentIds: getTeacherHiddenStudents().hiddenStudentIds,
      students     : students,
      caffeine     : caffeine,
      sleep        : sleep,
      info         : info,
      manualAwards : manualAwards  // ⭐ 교사 앱 localStorage 동기화용
    };

  } catch (err) {
    safeLog_('❌ getTeacherData 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용 AI 건강분석 요청 처리
 * ⭐ 학생용과 별도로 생활기록부 소견 스타일 전용 프롬프트 사용
 */
function getTeacherCaffeineThresholds_(values) {
  values = values || {};
  const warn = Number(values.warn == null ? 56 : values.warn);
  const over = Number(values.over == null ? 100 : values.over);
  return isFinite(warn) && isFinite(over) && warn >= 10 && over >= 50 && warn < over && over < 120
    ? {warn: warn, over: over} : {warn: 56, over: 100};
}

// Teacher lists, charts and reports classify against the teacher basis, independently of the personal goal.
function getTeacherCaffeineSummary_(average, limit, recordedDays, dailyRecords, values) {
  const thresholds = getTeacherCaffeineThresholds_(values);
  const pct = average / limit * 100;
  const stage = !recordedDays ? -1 : average === 0 ? 0 : pct >= 200 ? 5 : pct >= 120 ? 4 : pct >= thresholds.over ? 3 : pct >= thresholds.warn ? 2 : 1;
  const labels = ['카페인 섭취 안 함', '1단계: 안전', '2단계: 적정/제한', '3단계: 과다', '4단계: 고위험', '5단계: 위험/중독'];
  const status = stage < 0 ? '카페인 미기록' : labels[stage];
  const overLimit = limit * thresholds.over / 100;
  const overDays = (dailyRecords || []).filter(d => d.mg > 0 && d.mg >= overLimit);
  let section = !recordedDays ? '카페인 미기록으로 섭취 상태를 판정할 수 없습니다.'
    : average === 0 ? '카페인 기록 ' + recordedDays + '일 모두 카페인 섭취 안 함(0mg)으로 기록되었습니다.'
    : '기록일 기준 일평균 ' + Math.round(average) + 'mg이며, 일일 최대 섭취량(' + limit + 'mg)의 ' + Math.round(pct) + '%로 ' + status + '입니다.';
  if (overDays.length) {
    section += '\n카페인 기록 ' + recordedDays + '일 중 ' + overDays.length + '일에 초과 경계(' + Math.round(overLimit * 10) / 10 + 'mg, ' + thresholds.over + '%) 이상을 섭취했습니다.\n초과 기록:\n'
      + overDays.map(d => '  - ' + d.date.substr(5) + ': ' + d.mg + 'mg').join('\n');
  }
  return {stage: stage, status: status, overDays: overDays, section: section};
}

function getTeacherLifestyleValues_(summary, ignored) {
  return String(summary || '').split(',').map(v => v.trim()).filter(v => {
    const label = v.replace(/\([^)]*\)/g, '').replace(/\s/g, '');
    return label && ['없음', '데이터없음', '기록없음'].concat(ignored || []).indexOf(label) < 0;
  });
}

function handleAIReportForTeacher(payload) {
  try {
    return analyzeTeacherHealthData_(payload, getWeeklyDetailedData(payload.studentId, payload.startDate || null, payload.endDate || null), getTeacherAnalysisModel_(), 3);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getTeacherAnalysisModel_() { return "gemini-2.0-flash"; }

// 데이터 수집을 분리하여 고정 가상 기록으로도 같은 분석 처리를 검사합니다.
function analyzeTeacherHealthData_(payload, weeklyData, modelName, maxRetry) {
  const caf=payload.caffeineData||{},slp=payload.sleepData||{};
  const observations=[];
  for(const [label,value] of [['섭취 이유',caf.topReasons],['기록된 불편 경험',caf.topSymptoms],['취침 전 스마트폰',slp.topPhone],['신체활동',slp.topActivity],['잠드는 데 걸린 시간',slp.topLatency],['낮 졸림',slp.topDrowsy]]) {
    if(value&&value!=='없음'&&value!=='데이터 없음'&&!String(value).startsWith('안 함'))observations.push(label+': '+value);
  }
  return {success:true,source:'Rule',policyVersion:'2026-10-14',recordedDays:weeklyData.recordedDays,
    analysis:buildRecordFeedback_(weeklyData,Number(payload.limit)||150,true,(payload.startDate||'')+' ~ '+(payload.endDate||''),payload.caffeineThresholds,observations.join('\n'))};
}

function getTeacherFallbackAnalysis(avgCaffeine, avgSleep, limit, cafDays, sleepDays, periodLabel, overDays, periodForHeader, lifeAdvice, caffeineThresholds) {
  return buildRecordFeedback_({caffeineRecordedDays:cafDays,sleepRecordedDays:sleepDays,caffeineTotal:avgCaffeine*cafDays,sleepTotal:avgSleep*sleepDays,totalDays:7,overCaffeineDays:overDays||[]},limit,true,periodForHeader||periodLabel,caffeineThresholds,lifeAdvice);
}

function getTeacherInsufficientMessage(cafDays, sleepDays, totalDays, periodLabel) {
  totalDays   = totalDays   || 7;
  periodLabel = periodLabel || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd") + ' 기준 최근 7일';
  return `[건강 관찰 소견 / ${periodLabel}]

◎ 분석 불가 안내
현재 수집된 데이터가 분석 최소 기준(카페인·수면 각 3일 이상)에 미달하여 AI 건강 소견 작성이 불가합니다.

◎ 현재 기록 현황
- 카페인 기록: ${cafDays}/${totalDays}일 ${cafDays >= 3 ? '(충족)' : '(미충족 — ' + (3 - cafDays) + '일 추가 필요)'}
- 수면 기록:   ${sleepDays}/${totalDays}일 ${sleepDays >= 3 ? '(충족)' : '(미충족 — ' + (3 - sleepDays) + '일 추가 필요)'}

◎ 지도 방향
해당 학생이 카페인 및 수면 데이터를 꾸준히 입력할 수 있도록 독려하시기 바랍니다. 각 항목 3일 이상 기록 시 AI 건강 소견이 자동 생성됩니다.`;
}

// ============================================
// 문의하기 기능
// ============================================

/**
 * 학생이 문의 제출
 */
function submitInquiry(data) {
  try {
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName("inquiries");

    // inquiries 시트가 없으면 생성 (새 헤더 구조)
    if (!sheet) {
      sheet = ss.insertSheet("inquiries");
      sheet.getRange(1, 1, 1, 11).setValues([[
        "타임스탬프", "학년", "반", "번호", "학번", "이름", "제목", "내용", "상태", "응답내용", "응답시간"
      ]]);
      sheet.setFrozenRows(1);
    }

    const timestamp = getKSTTimestamp();
    const p = parseStudentId(data.studentId);

    appendRecordRow_(sheet, [
      timestamp,               // A: 타임스탬프
      p.grade,                 // B: 학년
      p.class,                 // C: 반
      p.number,                // D: 번호
      String(data.studentId),  // E: 학번
      String(data.name),       // F: 이름
      String(data.title || ''),// G: 제목
      String(data.content || ''),// H: 내용
      "미응답",                // I: 상태
      "",                      // J: 응답내용
      ""                       // K: 응답시간
    ]);

    safeLog_(`✅ 문의 저장 완료: ${data.studentId} - ${data.title}`);
    return { success: true };
  } catch (error) {
    safeLog_('❌ 문의 저장 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 전체 문의 목록 조회 (새 헤더: A타임스탬프, B학년, C반, D번호, E학번, F이름, G제목, H내용, I상태, J응답내용, K응답시간)
 */
// A read-only fingerprint avoids migrating existing inquiry rows. Reply/notification
// columns are excluded so acknowledgments do not invalidate an open reply draft.
function inquiryKey_(row) {
  const original = row.slice(0, 8).map(value => value instanceof Date
    ? value.toISOString() : String(value === null || value === undefined ? '' : value));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(original), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// Gateway inquiry mutations already run inside the same script lock. Resolve
// again under that lock: a row number from an older screen is only a hint.
function resolveInquiryRow_(sheet, rowIndex, expectedKey) {
  if (!Number.isInteger(rowIndex) || rowIndex < 2 || typeof expectedKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedKey)) return 0;
  const rows = sheet.getDataRange().getValues();
  let found = 0;
  for (let i = 1; i < rows.length; i++) {
    if (inquiryKey_(rows[i]) !== expectedKey) continue;
    if (found) return 0; // Identical legacy rows cannot be safely distinguished.
    found = i + 1;
  }
  return found;
}

function inquiryTargetChanged_() {
  return { success: false, code: 'INQUIRY_TARGET_CHANGED',
    error: '문의가 삭제 또는 변경되었거나 동일한 문의가 여러 건 있습니다. 목록을 확인한 뒤 다시 선택하세요. 작성한 응답은 유지됩니다.' };
}

function getInquiries() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: true, data: [] };

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    const inquiries = [];
    for (let i = 1; i < data.length; i++) {
      inquiries.push({
        rowIndex:  i + 1,
        inquiryKey: inquiryKey_(data[i]),
        timestamp: data[i][0] ? String(data[i][0]) : '',
        grade:     String(data[i][1] || ''),
        classNum:  String(data[i][2] || ''),
        number:    String(data[i][3] || ''),
        studentId: String(data[i][4] === null || data[i][4] === undefined ? '' : data[i][4]),
        name:      String(data[i][5] || ''),
        title:     String(data[i][6] || ''),
        content:   String(data[i][7] || ''),
        status:    String(data[i][8] || '미응답'),
        reply:     String(data[i][9] || ''),
        replyTime: data[i][10] ? String(data[i][10]) : ''
      });
    }

    inquiries.reverse();
    return { success: true, data: inquiries };
  } catch (error) {
    safeLog_('❌ 문의 조회 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 문의에 응답 (상태: I=9, 응답내용: J=10, 응답시간: K=11)
 */
function replyToInquiry(rowIndex, replyContent, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: false, error: "inquiries 시트 없음" };

    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    if (typeof replyContent !== 'string' || !replyContent.trim()) return { success: false, error: '응답 내용을 입력하세요.' };
    const replyTime = getKSTTimestamp();
    sheet.getRange(targetRow, 9, 1, 3).setValues([["응답완료", replyContent, replyTime]]);

    safeLog_(`✅ 문의 응답 완료: 행 ${rowIndex}`);
    return { success: true };
  } catch (error) {
    safeLog_('❌ 문의 응답 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 문의 행 삭제
 * @param {number} rowIndex - 삭제할 시트 행 번호 (1-based)
 */
function deleteInquiry(rowIndex, expectedKey) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: false, error: 'inquiries 시트 없음' };
    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    sheet.deleteRow(targetRow);
    safeLog_('✅ 문의 삭제 완료: 행 ' + rowIndex);
    return { success: true };
  } catch (err) {
    safeLog_('❌ deleteInquiry 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 교사가 아직 확인하지 않은 새 문의 목록 조회
 * L열(12번): 교사확인 — 빈 값이면 미확인
 */
function getUnreadInquiries() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: true, data: [] };
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const notified = String(data[i][11] || '');
      if (notified === '확인') continue;
      result.push({
        rowIndex:  i + 1,
        inquiryKey: inquiryKey_(data[i]),
        timestamp: data[i][0] ? String(data[i][0]) : '',
        studentId: String(data[i][4] || ''),
        name:      String(data[i][5] || ''),
        title:     String(data[i][6] || ''),
        content:   String(data[i][7] || ''),
        status:    String(data[i][8] || '미응답')
      });
    }
    return { success: true, data: result };
  } catch (err) {
    safeLog_('❌ getUnreadInquiries 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 문의 팝업 확인 처리 (L열 = '확인')
 */
function markInquiryNotified(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    sheet.getRange(targetRow, 12).setValue('확인');
    return { success: true };
  } catch (err) {
    safeLog_('❌ markInquiryNotified 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 학생용: 자신의 문의 목록 및 응답 확인 (E열=학번[4])
 */
function inquiryReplyKey_(row) {
  if (String(row[8]) !== '응답완료' || !row[9]) return '';
  const time = row[10] instanceof Date ? row[10].toISOString() : String(row[10] || '');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([inquiryKey_(row), String(row[9]), time]), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// M stores the exact reply receipt; an edited answer has a different key.
// The authenticated gateway supplies the identity and holds the script lock.
function markInquiryRepliesSeen(studentId, name, replyKeys) {
  try {
    if (!Array.isArray(replyKeys) || !replyKeys.length || replyKeys.length > 100
        || replyKeys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
      return {success:false, error:'확인할 답변 정보가 올바르지 않습니다.'};
    }
    const sheet = getSpreadsheet_().getSheetByName('inquiries');
    if (!sheet) return inquiryTargetChanged_();
    const rows = sheet.getDataRange().getValues();
    const header = String((rows[0] || [])[12] || '');
    if (header && header !== '학생답변확인키') return {success:false, error:'답변 확인 저장 열을 확인해주세요.'};
    const subject = {studentId:studentId, name:name};
    const targets = [];
    for (const key of [...new Set(replyKeys)]) {
      const matches = [];
      for (let i = 1; i < rows.length; i++) {
        if (ownerMatchesSubject_(rows[i][4], rows[i][5], subject) && inquiryReplyKey_(rows[i]) === key) matches.push(i + 1);
      }
      if (matches.length !== 1) return inquiryTargetChanged_();
      targets.push({row:matches[0], key:key});
    }
    if (!header) sheet.getRange(1, 13).setValue('학생답변확인키');
    targets.forEach(target => sheet.getRange(target.row, 13).setValue(target.key));
    return {success:true};
  } catch (error) {
    safeLog_('답변 확인 저장 실패: ' + error.message);
    return {success:false, error:'답변 확인 상태를 저장하지 못했습니다.'};
  }
}

function getMyInquiries(studentId) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: true, data: [] };

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    const inquiries = [];
    for (let i = 1; i < data.length; i++) {
      if (normalizeId(data[i][4]) === normalizeId(studentId)) { // E열: 학번
        const replyKey = inquiryReplyKey_(data[i]);
        inquiries.push({
          replyKey: replyKey,
          replySeen: !!replyKey && String(data[i][12] || '') === replyKey,
          timestamp: data[i][0] ? String(data[i][0]) : '',
          title:     String(data[i][6] || ''),  // G열
          content:   String(data[i][7] || ''),  // H열
          status:    String(data[i][8] || '미응답'), // I열
          reply:     String(data[i][9] || ''),  // J열
          replyTime: data[i][10] ? String(data[i][10]) : '' // K열
        });
      }
    }

    inquiries.reverse();
    return { success: true, data: inquiries };
  } catch (error) {
    safeLog_('❌ 내 문의 조회 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}
/**
 * caffeine_db 시트 전체를 읽어 카페인 DB 배열 반환
 * 컬럼: A=식품명, B=업체명, C=기준량, D=카페인(mg), E=출처
 * @returns {{ success: boolean, data: Array }}
 */
function getCaffeineDB() {
  try {
    var ss = getSpreadsheet_();
    var ws = ss.getSheetByName('caffeine_db');
    if (!ws) {
      safeLog_('getCaffeineDB: caffeine_db 시트 없음');
      return { success: false, data: [], error: 'caffeine_db 시트를 찾을 수 없습니다.' };
    }

    var lastRow = ws.getLastRow();
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    // A~D열만 읽기 (E열 출처는 불필요)
    // 헤더(1행) 제외, 2행부터
    var rawData = ws.getRange(2, 1, lastRow - 1, 4).getValues();
    // 컬럼 인덱스 (0-based):
    //   0: A열 = 식품명(f)
    //   1: B열 = 업체명(c)
    //   2: C열 = 기준량(s) — '100g', '100ml', '355㎖' 등
    //   3: D열 = 카페인(mg) — 숫자 또는 '39㎎' 문자열

    var result = [];
    for (var i = 0; i < rawData.length; i++) {
      var row = rawData[i];
      var foodName  = row[0] ? String(row[0]).trim() : '';
      var company   = row[1] ? String(row[1]).trim() : '';
      var stdStr    = row[2] ? String(row[2]).trim() : '100g';
      var mgRaw     = row[3];

      // 빈 행 건너뜀
      if (!foodName) continue;

      // 기준량 정규화: ㎖ → ml, ㎎ → mg (특수 단위 문자 처리)
      var stdNorm = stdStr
        .replace(/㎖/g, 'ml')
        .replace(/㎎/g, 'mg')
        .replace(/㎏/g, 'kg')
        .replace(/，/g, ',');

      // 카페인(mg) 파싱: 숫자 또는 '39㎎' 같은 문자열
      var mgVal = 0;
      if (typeof mgRaw === 'number') {
        mgVal = mgRaw;
      } else if (mgRaw) {
        var mgStr = String(mgRaw).replace(/㎎/g, '').replace(/mg/gi, '').trim();
        mgVal = parseFloat(mgStr) || 0;
      }
      mgVal = Math.round(mgVal * 100) / 100; // 소수점 2자리

      // w(식품중량) 필드: 비표준 기준량이면 그 값 자체가 1회 제공량
      // 예: '355ml' → w='355ml' (용량 입력창 기본값으로 사용)
      var stdNumMatch = stdNorm.replace(',','').match(/[\d.]+/);
      var stdNum = stdNumMatch ? parseFloat(stdNumMatch[0]) : 100;
      var wVal = stdNum === 100 ? '' : stdNorm; // 100g/100ml이면 w 비워둠

      result.push({
        f:  foodName,  // 식품명 (카테고리_음료명 형식)
        c:  company,   // 업체명
        s:  stdNorm,   // 기준량 (정규화)
        w:  wVal,      // 식품중량 (비표준 기준량이면 해당 값, 100g/100ml이면 '')
        mg: mgVal      // 기준량당 카페인 mg
      });
    }

    safeLog_('getCaffeineDB: ' + result.length + '건 반환');
    return { success: true, data: result };

  } catch (error) {
    safeLog_('getCaffeineDB 오류: ' + error);
    return { success: false, data: [], error: error.toString() };
  }
}
// ============================================================
// ★ fetchWithRetry & getApiErrorInfo — 오류 코드별 재시도 유틸리티
// ============================================================

/**
 * Gemini API를 지수 백오프로 안전하게 호출
 * @param {string} apiUrl
 * @param {Object} options  - UrlFetchApp.fetch 옵션 (muteHttpExceptions: true 필수)
 * @param {number} maxRetry - 최대 재시도 횟수 (기본 3)
 * @returns {{ response: HTTPResponse|null, errorCode: string|null }}
 */
function fetchWithRetry(apiUrl, options, maxRetry) {
  maxRetry = maxRetry || 3;

  var RETRYABLE = {
    500: 'SERVER_ERROR',
    502: 'SERVER_ERROR',
    503: 'SERVER_ERROR',
    504: 'SERVER_ERROR'
  };

  var lastResponse = null;
  var lastCode     = null;

  for (var attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      var response = UrlFetchApp.fetch(apiUrl, options);
      var code     = response.getResponseCode();
      safeLog_('[fetchWithRetry] 시도 ' + attempt + '/' + maxRetry + ' → HTTP ' + code);

      if (code === 200) {
        return { response: response, errorCode: null }; // ✅ 성공
      }

      lastResponse = response;
      lastCode     = code;

      if (RETRYABLE[code] && attempt < maxRetry) {
        var waitMs = Math.min(Math.pow(2, attempt) * 1000, 20000);

        // 429 Retry-After 헤더 우선 적용
        if (code === 429) {
          try {
            var headers = response.getHeaders();
            if (headers && headers['Retry-After']) {
              waitMs = Math.max(waitMs, Math.min(parseInt(headers['Retry-After']) * 1000, 30000));
            }
          } catch (e) { /* 헤더 없을 수 있음 */ }
        }

        safeLog_('[fetchWithRetry] HTTP ' + code + ' → ' + (waitMs / 1000) + 's 대기 후 재시도...');
        Utilities.sleep(waitMs);
        continue;
      }

      break; // 재시도 불필요한 오류 (401, 403, 400 등)

    } catch (networkErr) {
      safeLog_('[fetchWithRetry] 네트워크 오류 (시도 ' + attempt + '): ' + networkErr);
      if (attempt < maxRetry) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 20000));
      } else {
        return { response: null, errorCode: 'NETWORK_ERROR' };
      }
    }
  }

  // errorCode 결정
  var errorCode = 'UNKNOWN_ERROR';
  if (lastCode) {
    if (RETRYABLE[lastCode])                           errorCode = RETRYABLE[lastCode];
    else if (lastCode === 401 || lastCode === 403)     errorCode = 'AUTH_ERROR';
  }

  safeLog_('[fetchWithRetry] 최종 실패. code=' + lastCode + ', errorCode=' + errorCode);
  return { response: lastResponse, errorCode: errorCode };
}

/**
 * errorCode → 사용자 안내 메시지 (한국어)
 * @param {string} errorCode
 * @returns {{ title: string, desc: string }}
 */
function getApiErrorInfo(errorCode) {
  var map = {
    'RATE_LIMIT':    { title: '요청 한도 초과 (429)',   desc: 'Gemini API 일일 요청 한도에 도달했습니다. 잠시 후 또는 내일 다시 시도해 주세요.' },
    'SERVER_ERROR':  { title: 'AI 서버 오류 (5xx)',     desc: 'Gemini 서버가 일시적으로 응답하지 않습니다. 1~2분 후 다시 시도해 주세요.' },
    'AUTH_ERROR':    { title: 'API 키 오류 (401/403)',  desc: 'API 키가 유효하지 않거나 권한이 없습니다. 관리자에게 문의해 주세요.' },
    'NO_API_KEY':    { title: 'API 키 미설정',           desc: 'Gemini API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.' },
    'NETWORK_ERROR': { title: '네트워크 오류',            desc: '서버와의 통신 중 연결이 끊겼습니다. 인터넷 상태를 확인 후 다시 시도해 주세요.' },
    'INCOMPLETE':    { title: 'AI 응답 미완성',           desc: 'AI 응답이 완성되지 않아 기본 분석으로 대체했습니다.' },
    'UNKNOWN_ERROR': { title: '알 수 없는 오류',          desc: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }
  };
  return map[errorCode] || map['UNKNOWN_ERROR'];
}

// ═══════════════════════════════════════════════════════════════════
// 🏅 교사 수여 뱃지 시스템 — Code.gs 추가 함수
// 시트명: "teacher_awards"
// 컬럼 구조 (A~L열):
//   A: grantedAt    수여 일시 (예: 2026-02-26 14:30)
//   B: grade        학년
//   C: class        반
//   D: number       번호
//   E: studentId    학번
//   F: studentName  학생 이름
//   G: awardId      뱃지 ID (예: manual_1234567890)
//   H: awardName    뱃지 이름
//   I: image        이모지 또는 이미지 URL
//   J: bg           배경색 (#f5f3ff)
//   K: color        글자색 (#7c3aed)
//   L: message      수여 메시지 (선택)
//   M: grantedBy    수여 교사 (선택)
// ═══════════════════════════════════════════════════════════════════

/**
 * 특정 학생에게 부여된 교사 수여 뱃지 목록 반환
 * 학생 앱(index.html)의 checkTeacherAwards()에서 호출
 *
 * @param {string} studentId  학번
 * @returns {{ success: boolean, awards: Array }}
 */
function getTeacherAwardsForStudent(studentId) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);

    const data = sheet.getDataRange().getValues();
    safeLog_('=== getTeacherAwardsForStudent ===');
    safeLog_('요청 학번(원본): "' + studentId + '"');
    safeLog_('시트 전체 행 수: ' + data.length + ' (헤더 포함)');

    if (data.length <= 1) {
      safeLog_('⚠️ 데이터 없음 (헤더만 존재)');
      return { success: true, awards: [] };
    }

    const totalCols = data[0] ? data[0].length : 0;
    const targetId  = normalizeId(studentId);
    safeLog_('헤더 컬럼 수: ' + totalCols);
    safeLog_('헤더: ' + JSON.stringify(data[0]));
    safeLog_('정규화된 학번: "' + targetId + '"');

    // ──────────────────────────────────────────────────────
    // 컬럼 레이아웃 자동 감지
    // 신규(12~13열): A=수여일시, B=학년, C=반, D=번호, E=학번, F=학생이름,
    //                G=awardId,  H=뱃지이름, I=이미지, J=배경색, K=글자색,
    //                L=코멘트,   M=수여교사(13열만 존재)
    // 구버전(~9열): A=수여일시, B=학번, C=awardId, D=뱃지이름 ...
    // ──────────────────────────────────────────────────────
    // ⭐ 헤더 2번째 값(index1)으로 포맷 구분
    //    신규: '학년' / 구버전: 'studentid' 또는 학번 직접
    const hdr1 = String(data[0][1] || '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');

    safeLog_('포맷: ' + (isNewFormat ? '신규(12+열, B=학년)' : '구버전(B=학번)'));

    // 데이터 샘플 로그 (최대 3행)
    for (var si = 1; si < Math.min(4, data.length); si++) {
      var sRow = data[si];
      var sId  = isNewFormat ? normalizeId(sRow[4]) : normalizeId(sRow[1]);
      safeLog_('  ' + si + '행 학번="' + sId + '" | 원본E="' + sRow[4] + '" | A열ts="' + sRow[0] + '"');
    }

    const awards = [];
    for (let i = 1; i < data.length; i++) {
      const row    = data[i];
      const rowSid = isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);

      if (rowSid !== targetId) continue;

      safeLog_('✅ 매칭 행 ' + (i+1) + ': 학번=' + rowSid + ', 뱃지=' + (isNewFormat ? row[7] : row[3]));

      if (isNewFormat) {
        awards.push({
          grantedAt   : _tsToStr_(row[0]),
          grade       : String(row[1]  || ''),
          classNum    : String(row[2]  || ''),
          number      : String(row[3]  || ''),
          studentId   : String(row[4]  || ''),
          studentName : String(row[5]  || ''),
          awardId     : String(row[6]  || ''),
          name        : String(row[7]  || ''),
          image       : String(row[8]  || '🏅'),
          bg          : String(row[9]  || '#f5f3ff'),
          color       : String(row[10] || '#7c3aed'),
          message     : String(row[11] || ''),
          grantedBy   : String(row[12] || ''), // 13열 없으면 빈 문자열
          seenAt      : _tsToStr_(row[13])
        });
      } else {
        // 구버전: B=학번, C=awardId, D=뱃지이름, E=이미지, F=배경색, G=글자색, H=메시지, I=교사
        awards.push({
          grantedAt : _tsToStr_(row[0]),
          studentId : String(row[1] || ''),
          awardId   : String(row[2] || ''),
          name      : String(row[3] || ''),
          image     : String(row[4] || '🏅'),
          bg        : String(row[5] || '#f5f3ff'),
          color     : String(row[6] || '#7c3aed'),
          message   : String(row[7] || ''),
          grantedBy : String(row[8] || ''),
          seenAt    : _tsToStr_(row[9])
        });
      }
    }

    safeLog_('결과: ' + awards.length + '개 뱃지 반환');
    awards.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    return { success: true, awards: awards };

  } catch (err) {
    safeLog_('❌ getTeacherAwardsForStudent 오류: ' + err.message);
    return { success: false, awards: [], error: err.message };
  }
}

/**
 * 학생이 교사 수여 뱃지 알림을 확인한 시각을 시트에 저장한다.
 * 브라우저 localStorage가 삭제되거나 다른 기기에서 로그인해도 재알림하지 않기 위한 서버 상태다.
 *
 * @param {string} studentId
 * @param {{grantedAt:string, awardId:string, name:string}[]} awardKeys
 * @returns {{success:boolean, updated:number}}
 */
function markTeacherAwardsSeen(studentId, studentName, awardKeys) {
  try {
    const keys = Array.isArray(awardKeys) ? awardKeys : [];
    const ss = getSpreadsheet_();
    const targetId = normalizeId(studentId);
    const targetName = String(studentName || '').trim();
    if (!targetId || !targetName || !keys.length) {
      return { success: false, updated: 0, error: '학생 정보 또는 뱃지 확인 항목이 없습니다.' };
    }

    const studentsSheet = ss.getSheetByName('students');
    if (!studentsSheet) return { success: false, updated: 0, error: '학생 명단을 찾을 수 없습니다.' };
    const students = studentsSheet.getDataRange().getValues();
    const validStudent = students.slice(1).some(function(row) {
      const rowId = normalizeId(row[4]);
      const rowName = String(row[3] || '').trim();
      return rowName === targetName && (targetId === rowId || targetId === rowId + '_' + rowName);
    });
    if (!validStudent) return { success: false, updated: 0, error: '로그인 학생 정보가 일치하지 않습니다.' };

    const sheet = _getOrCreateAwardSheet_(ss);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, updated: 0 };

    const totalCols = data[0] ? data[0].length : 0;
    const hdr1 = String(data[0][1] || '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');
    const seenColumn = isNewFormat ? 14 : 10;
    const seenAt = _nowKST_();

    if (!data[0][seenColumn - 1]) {
      sheet.getRange(1, seenColumn).setValue('학생확인일시');
    }

    let updated = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowSid = isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);
      if (rowSid !== targetId) continue;

      const rowAwardId = String((isNewFormat ? row[6] : row[2]) || '');
      const rowName = String((isNewFormat ? row[7] : row[3]) || '');
      const rowGrantedAt = _tsToStr_(row[0]);
      const matched = keys.some(function(key) {
        const keyAwardId = String(key && key.awardId || '');
        const keyName = String(key && key.name || '');
        const keyGrantedAt = String(key && key.grantedAt || '');
        if (keyAwardId && rowAwardId !== keyAwardId) return false;
        if (keyGrantedAt && rowGrantedAt !== keyGrantedAt) return false;
        if (!keyAwardId && keyName && rowName !== keyName) return false;
        return !!(keyAwardId || keyName || keyGrantedAt);
      });

      if (matched && !row[seenColumn - 1]) {
        sheet.getRange(i + 1, seenColumn).setValue(seenAt);
        updated++;
      }
    }

    safeLog_('✅ 학생 뱃지 확인 저장: 학번=' + targetId + ', ' + updated + '건');
    return { success: true, updated: updated };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    safeLog_('❌ markTeacherAwardsSeen 오류: ' + err.message);
    return { success: false, updated: 0, error: err.message };
  }
}

/**
 * 교사 앱(teacher_v3.html)에서 뱃지 수여 시 호출
 * 단일 또는 일괄 수여 모두 처리
 *
 * @param {Object} params
 *   params.studentIds  {string[]}  수여 대상 학번 배열
 *   params.awards      {Object[]}  수여할 뱃지 배열 (name, image, bg, color)
 *   params.message     {string}    수여 메시지 (공통)
 *   params.grantedBy   {string}    수여 교사명 (선택)
 * @returns {{ success: boolean, count: number }}
 */
function grantTeacherAwards(params) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);

    const studentIds = params.studentIds || [];
    const awards     = params.awards     || [];
    const message    = params.message    || '';
    const grantedBy  = params.grantedBy  || '';
    // ⭐ JS에서 전달된 grantedAt 사용 (없으면 서버 시간 폴백)
    // → localStorage와 시트의 grantedAt이 동일해야 삭제 시 매칭 성공
    const grantedAt  = (params.grantedAt && String(params.grantedAt).length >= 10)
                       ? String(params.grantedAt)
                       : _nowKST_();

    if (!studentIds.length || !awards.length) {
      return { success: false, error: '수여 대상 또는 뱃지가 없습니다.' };
    }

    // students 시트에서 학생 정보 조회 (학번 → 학년/반/번호/이름)
    const studentMap = {};
    try {
      const studSheet = ss.getSheetByName('students');
      if (studSheet) {
        const studData = studSheet.getDataRange().getValues();
        for (let i = 1; i < studData.length; i++) {
          const sid = normalizeId(studData[i][4]); // E열: 학번
          if (sid) {
            studentMap[sid] = {
              grade  : String(studData[i][0] || ''), // A: 학년
              cls    : String(studData[i][1] || ''), // B: 반
              number : String(studData[i][2] || ''), // C: 번호
              name   : String(studData[i][3] || '')  // D: 이름
            };
          }
        }
      }
    } catch (mapErr) {
      safeLog_('⚠️ 학생 정보 조회 실패 (계속 진행): ' + mapErr);
    }

    // 중복 수여 방지: 시트에서 기존 수여 내역 읽기 (학번+뱃지ID 조합)
    const existingSet = new Set();
    try {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const existing = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
        existing.forEach(r => {
          const sid = normalizeId(r[4]);
          const aid = String(r[6] || '');
          if (sid && aid) existingSet.add(sid + '|' + aid);
        });
      }
    } catch(e) { safeLog_('⚠️ 중복 체크 조회 실패 (계속 진행): ' + e); }

    const rows = [];
    studentIds.forEach(sid => {
      const normSid = normalizeId(sid);
      const info = studentMap[normSid] || { grade: '', cls: '', number: '', name: '' };
      awards.forEach(a => {
        const awardId = String(a.awardId || '');
        if (existingSet.has(normSid + '|' + awardId)) {
          safeLog_('⏭️ 중복 수여 건너뜀: ' + normSid + ' / ' + awardId);
          return;
        }
        rows.push([
          grantedAt,                       // A: 수여 일시
          String(info.grade),              // B: 학년
          String(info.cls),                // C: 반
          String(info.number),             // D: 번호
          normSid,                         // E: 학번
          String(info.name),               // F: 학생 이름
          awardId,                         // G: 뱃지 ID
          String(a.name     || ''),        // H: 뱃지 이름
          String(a.image    || '🏅'),      // I: 이모지/URL
          String(a.bg       || '#f5f3ff'), // J: 배경색
          String(a.color    || '#7c3aed'), // K: 글자색
          String(message),                 // L: 메시지
          String(grantedBy)                // M: 교사명
        ]);
      });
    });

    // 시트에 일괄 append
    if (rows.length > 0) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      const range = sheet.getRange(lastRow + 1, 1, rows.length, 13);
      range.setValues(rows);
      // ⭐ A열(수여일시)을 텍스트 형식으로 강제 지정 → Sheets 자동 Date 변환 차단
      sheet.getRange(lastRow + 1, 1, rows.length, 1)
           .setNumberFormat('@STRING@');
    }

    safeLog_('✅ 뱃지 수여 완료: ' + studentIds.length + '명 × ' + awards.length + '개 = ' + rows.length + '행');
    return { success: true, count: rows.length, grantedAt: grantedAt };

  } catch (err) {
    safeLog_('❌ grantTeacherAwards 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 특정 학생의 특정 뱃지 취소 (교사 앱용)
 *
 * @param {string} studentId
 * @param {string} grantedAt   수여 일시 (A열 값, 고유 식별자로 활용)
 * @param {string} awardId     뱃지 ID (C열 값)
 * @returns {{ success: boolean }}
 */
function revokeTeacherAward(studentId, grantedAt, awardId) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);
    const data  = sheet.getDataRange().getValues();

    const targetSid  = normalizeId(studentId);
    const targetTs   = String(grantedAt || '').substring(0, 16); // "YYYY-MM-DD HH:mm"
    const targetDate = String(grantedAt || '').substring(0, 10); // "YYYY-MM-DD"
    const aidTarget  = String(awardId || '').trim();

    // ⭐ 포맷 감지: 헤더 B열(index1) 값으로 신규/구버전 판단
    // 신규(12+열): B=학년 → E열(index4)=학번, G열(index6)=awardId
    // 구버전(~9열): B=학번 → B열(index1)=학번, C열(index2)=awardId
    const totalCols = data[0] ? data[0].length : 0;
    const hdr1 = String(data[0] ? (data[0][1] || '') : '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');

    safeLog_('revokeTeacherAward: 학번=' + studentId + ', grantedAt=' + grantedAt + ', awardId=' + awardId);
    safeLog_('포맷: ' + (isNewFormat ? '신규(12+열)' : '구버전') + ', 컬럼수=' + totalCols + ', B헤더="' + hdr1 + '"');

    function getRowSid(row) {
      return isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);
    }
    function getRowAid(row) {
      return isNewFormat ? String(row[6] || '').trim() : String(row[2] || '').trim();
    }

    // ─── 1단계: 학번 + 시간(16자리) + awardId 완전 매칭 ───────────
    for (let i = data.length - 1; i >= 1; i--) {
      const row   = data[i];
      const rowTs = _tsToStr_(row[0]);
      const rowSid = getRowSid(row);
      const rowAid = getRowAid(row);

      if (rowSid !== targetSid) continue;
      if (rowTs.substring(0, 16) !== targetTs) continue;
      if (aidTarget && rowAid !== aidTarget) continue;

      sheet.deleteRow(i + 1);
      safeLog_('✅ 뱃지 취소(완전매칭): 학번=' + studentId + ', ts=' + rowTs + ', aid=' + aidTarget);
      return { success: true };
    }

    // ─── 2단계: 학번 + 날짜(10자리) + awardId 완화 매칭 ─────────
    for (let i = data.length - 1; i >= 1; i--) {
      const row    = data[i];
      const rowTs  = _tsToStr_(row[0]);
      const rowSid = getRowSid(row);
      const rowAid = getRowAid(row);

      if (rowSid !== targetSid) continue;
      if (rowTs.substring(0, 10) !== targetDate) continue;
      if (aidTarget && rowAid !== aidTarget) continue;

      sheet.deleteRow(i + 1);
      safeLog_('✅ 뱃지 취소(날짜+id 매칭): 학번=' + studentId + ', date=' + targetDate);
      return { success: true };
    }

    // ─── 3단계: 학번 + 날짜만 (awardId 무시, 최후 수단) ──────────
    if (aidTarget) {
      for (let i = data.length - 1; i >= 1; i--) {
        const row    = data[i];
        const rowTs  = _tsToStr_(row[0]);
        const rowSid = getRowSid(row);

        if (rowSid !== targetSid) continue;
        if (rowTs.substring(0, 10) !== targetDate) continue;

        sheet.deleteRow(i + 1);
        safeLog_('⚠️ 뱃지 취소(날짜만 매칭): 학번=' + studentId);
        return { success: true };
      }
    }

    safeLog_('❌ revokeTeacherAward 매칭 실패: 학번=' + studentId + ', grantedAt=' + grantedAt + ', awardId=' + awardId + ', isNewFormat=' + isNewFormat + ', totalCols=' + totalCols);
    return { success: false, error: '해당 뱃지 기록을 찾을 수 없습니다.' };

  } catch (err) {
    safeLog_('❌ revokeTeacherAward 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사 앱 초기화용 — teacher_awards 시트 전체를 읽어서
 * { [studentId]: [ award, ... ] } 형태로 반환
 * → 교사 앱 시작 시 GAS 시트 → manualAwards 동기화에 사용
 *
 * @returns {{ success: boolean, byStudent: Object }}
 */
function getAllTeacherAwards() {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);
    const data  = sheet.getDataRange().getValues();

    safeLog_('=== getAllTeacherAwards === 행 수: ' + data.length);
    if (data.length <= 1) return { success: true, byStudent: {} };

    const totalCols = data[0] ? data[0].length : 0;
    const hdr1      = String(data[0][1] || '').toLowerCase();
    const isNew     = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');
    safeLog_('포맷: ' + (isNew ? '신규' : '구버전') + ', 컬럼수=' + totalCols);

    const byStudent = {};
    for (var i = 1; i < data.length; i++) {
      const row = data[i];
      const sid = isNew ? String(normalizeId(row[4])) : String(normalizeId(row[1]));
      if (!sid || sid === '0') continue; // 학번 없는 행 스킵

      const award = isNew ? {
        grantedAt   : _tsToStr_(row[0]),
        grade       : String(row[1]  || ''),
        classNum    : String(row[2]  || ''),
        number      : String(row[3]  || ''),
        studentId   : sid,
        studentName : String(row[5]  || ''),
        awardId     : String(row[6]  || ''),
        name        : String(row[7]  || ''),
        image       : String(row[8]  || '🏅'),
        bg          : String(row[9]  || '#f5f3ff'),
        color       : String(row[10] || '#7c3aed'),
        message     : String(row[11] || ''),
        grantedBy   : String(row[12] || '')
      } : {
        grantedAt   : _tsToStr_(row[0]),
        studentId   : sid,
        awardId     : String(row[2] || ''),
        name        : String(row[3] || ''),
        image       : String(row[4] || '🏅'),
        bg          : String(row[5] || '#f5f3ff'),
        color       : String(row[6] || '#7c3aed'),
        message     : String(row[7] || ''),
        grantedBy   : String(row[8] || '')
      };

      if (!byStudent[sid]) byStudent[sid] = [];
      byStudent[sid].push(award);
    }

    // 학생별 최신순 정렬
    Object.keys(byStudent).forEach(function(sid) {
      byStudent[sid].sort(function(a, b) { return b.grantedAt.localeCompare(a.grantedAt); });
    });

    safeLog_('getAllTeacherAwards 완료: ' + Object.keys(byStudent).length + '명 데이터 반환');
    return { success: true, byStudent: byStudent };

  } catch (err) {
    safeLog_('❌ getAllTeacherAwards 오류: ' + err.message);
    return { success: false, byStudent: {}, error: err.message };
  }
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────

/**
 * teacher_awards 시트 반환 (없으면 자동 생성 + 헤더 설정)
 */
function _getOrCreateAwardSheet_(ss) {
  let sheet = ss.getSheetByName('teacher_awards');
  if (!sheet) {
    sheet = ss.insertSheet('teacher_awards');
    // 헤더 행 작성 (신규 14컬럼 구조)
    sheet.getRange(1, 1, 1, 14).setValues([[
      '수여일시', '학년', '반', '번호', '학번', '학생이름',
      'awardId', '뱃지이름', '이미지', '배경색', '글자색',
      '코멘트', '수여교사', '학생확인일시'
    ]]);
    // 헤더 스타일
    const hdr = sheet.getRange(1, 1, 1, 14);
    hdr.setBackground('#7c3aed');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
    sheet.setFrozenRows(1);
    // 열 너비 설정
    sheet.setColumnWidth(1, 140); // 수여일시
    sheet.setColumnWidth(2, 60);  // 학년
    sheet.setColumnWidth(3, 60);  // 반
    sheet.setColumnWidth(4, 60);  // 번호
    sheet.setColumnWidth(5, 90);  // 학번
    sheet.setColumnWidth(6, 100); // 학생이름
    sheet.setColumnWidth(7, 150); // awardId
    sheet.setColumnWidth(8, 100); // 뱃지이름
    sheet.setColumnWidth(9, 60);  // 이미지
    sheet.setColumnWidth(12, 200); // 코멘트
    sheet.setColumnWidth(13, 100); // 수여교사
    sheet.setColumnWidth(14, 140); // 학생확인일시
    safeLog_('✅ teacher_awards 시트 자동 생성 (신규 14컬럼)');
  } else {
    const awardData = sheet.getDataRange().getValues();
    const hdrVals = awardData[0] || [];
    const header1 = String(hdrVals[1] || '').trim().toLowerCase();
    const isCurrentHeader = header1 === '학년' || header1 === 'grade';
    const isLegacyHeader = hdrVals.length <= 10 && ['studentid', 'student_id', '학번'].includes(header1);
    const isEmptyHeader = hdrVals.every(function(value) { return String(value || '').trim() === ''; });
    if (isLegacyHeader) {
      const migrationLock = LockService.getScriptLock();
      migrationLock.waitLock(10000);
      try {
        const latestData = sheet.getDataRange().getValues();
        const latestHeader = latestData[0] || [];
        const latestHeader1 = String(latestHeader[1] || '').trim().toLowerCase();
        if (latestHeader.length <= 10 && ['studentid', 'student_id', '학번'].includes(latestHeader1)) {
          _migrateLegacyAwardSheet_(sheet, latestData);
          safeLog_('✅ teacher_awards 구버전 시트를 14열 형식으로 변환했습니다.');
        }
      } finally {
        migrationLock.releaseLock();
      }
    } else if (isCurrentHeader && !hdrVals[13]) {
      sheet.getRange(1, 14).setValue('학생확인일시');
    } else if (isEmptyHeader) {
      sheet.getRange(1, 1, 1, 14).setValues([[
        '수여일시', '학년', '반', '번호', '학번', '학생이름',
        'awardId', '뱃지이름', '이미지', '배경색', '글자색',
        '코멘트', '수여교사', '학생확인일시'
      ]]);
    } else if (!isCurrentHeader) {
      throw new Error('teacher_awards 시트의 헤더 형식을 확인할 수 없습니다. 기존 데이터를 보호하기 위해 쓰기를 중단합니다.');
    }
  }
  return sheet;
}

/** 구형 9~10열 뱃지 시트를 현재 14열 형식으로 보존 변환한다. */
function _migrateLegacyAwardSheet_(sheet, legacyData) {
  const source = legacyData || [];
  const migrated = [[
    '수여일시', '학년', '반', '번호', '학번', '학생이름',
    'awardId', '뱃지이름', '이미지', '배경색', '글자색',
    '코멘트', '수여교사', '학생확인일시'
  ]];
  for (let i = 1; i < source.length; i++) {
    const row = source[i];
    migrated.push([
      row[0] || '', '', '', '', row[1] || '', '',
      row[2] || '', row[3] || '', row[4] || '🏅',
      row[5] || '#f5f3ff', row[6] || '#7c3aed',
      row[7] || '', row[8] || '', row[9] || ''
    ]);
  }
  sheet.getRange(1, 1, migrated.length, 14).setValues(migrated);
}

/**
 * 현재 KST 시각을 "YYYY-MM-DD HH:mm" 형식으로 반환
 */
function _nowKST_() {
  var now = new Date();
  var kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  function pad(n) { return String(n).padStart(2, '0'); }
  return kst.getUTCFullYear() + '-' + pad(kst.getUTCMonth() + 1) + '-' + pad(kst.getUTCDate())
       + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes());
}

/**
 * Google Sheets 셀 값(Date 객체 or 문자열)을 "YYYY-MM-DD HH:mm" 문자열로 정규화
 * → Sheets가 날짜형 문자열을 자동으로 Date 객체로 변환하는 문제 해결
 */
function _tsToStr_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    // Date 객체 → KST 기준 "YYYY-MM-DD HH:mm"
    var kst = new Date(val.getTime() + 9 * 60 * 60 * 1000);
    function pad(n) { return String(n).padStart(2, '0'); }
    return kst.getUTCFullYear() + '-' + pad(kst.getUTCMonth() + 1) + '-' + pad(kst.getUTCDate())
         + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes());
  }
  // 문자열이면 앞 16자리만 반환
  return String(val).substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════
// 📊 구글 시트 내보내기 — 학생 모니터링 데이터를 현재 스프레드시트에 새 시트로 저장
// ═══════════════════════════════════════════════════════════════════

/**
 * 교사용 학생 목록 데이터를 현재 스프레드시트에 새 시트로 저장
 *
 * @param {Object} params
 *   params.sheetName   {string}   새 시트 이름 (없으면 자동 생성)
 *   params.rows        {Array[]}  헤더 포함 데이터 배열 (2D)
 * @returns {{ success: boolean, sheetName: string, rowCount: number }}
 */
function exportDataToNewSheet(params) {
  try {
    const ss = getSpreadsheet_();
    const rows = params.rows || [];
    if (rows.length === 0) {
      return { success: false, error: '내보낼 데이터가 없습니다.' };
    }

    // 시트 이름 결정 (중복 시 자동 suffix)
    let baseName = params.sheetName || ('모니터링_' + _nowKST_().substring(0, 10));
    let sheetName = baseName;
    let suffix = 1;
    while (ss.getSheetByName(sheetName)) {
      sheetName = baseName + '_' + suffix;
      suffix++;
    }

    // 새 시트 생성
    const newSheet = ss.insertSheet(sheetName);

    // 데이터 일괄 기록
    const colCount = rows[0].length;
    newSheet.getRange(1, 1, rows.length, colCount).setValues(rows);

    // 헤더 스타일
    const hdr = newSheet.getRange(1, 1, 1, colCount);
    hdr.setBackground('#1e3a5f');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
    newSheet.setFrozenRows(1);

    // 열 너비 자동 조정
    newSheet.autoResizeColumns(1, colCount);

    // 데이터 행 교대 색상
    for (let r = 2; r <= rows.length; r++) {
      if (r % 2 === 0) {
        newSheet.getRange(r, 1, 1, colCount).setBackground('#f8fafc');
      }
    }

    // ⭐ 드롭다운 다중선택 열 적용
    // params.dropdownCols: [ { colIndex: 1기반, values: ['값1','값2',...] }, ... ]
    var dropdownCols = params.dropdownCols || [];
    if (dropdownCols.length > 0 && rows.length > 1) {
      dropdownCols.forEach(function(dc) {
        if (!dc.colIndex || !dc.values || !dc.values.length) return;
        var rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(dc.values, true)
          .setAllowInvalid(true)
          .build();
        // 데이터 행에만 적용 (헤더 제외, 2행부터)
        var dataRange = newSheet.getRange(2, dc.colIndex, rows.length - 1, 1);
        dataRange.setDataValidation(rule);
      });
    }

    safeLog_('✅ exportDataToNewSheet 완료: ' + sheetName + ' (' + (rows.length - 1) + '행)');
    return {
      success   : true,
      sheetName : sheetName,
      rowCount  : rows.length - 1  // 헤더 제외
    };

  } catch (err) {
    safeLog_('❌ exportDataToNewSheet 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 교사→학생 메시지 기능
// 시트: teacher_messages
// 컬럼: A=타임스탬프, B=학번, C=이름, D=제목, E=내용, F=읽음여부, G=읽은시간
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 교사가 특정 학생에게 메시지 발송
 * data: { studentId, studentName, title, content }
 */


/**
 * 교사용: 발송한 전체 메시지 목록 조회
 */


/**
 * 학생용: 자신에게 온 메시지 조회
 * 시트 열: A타임스탬프 B학번 C이름 D제목 E내용 F읽음여부 G읽은시간 H학생답장 I학생답장시간 J학생답장읽음
 */


/**
 * 학생용: 메시지 읽음 처리
 */
function markTeacherMessageRead(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    const now = new Date();
    const ts = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(targetRow, 6, 1, 2).setValues([['읽음', ts]]);
    return { success: true };
  } catch (err) {
    safeLog_('❌ markTeacherMessageRead 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 발송 메시지 삭제
 */
function deleteTeacherMessage(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    sheet.deleteRow(targetRow);
    return { success: true };
  } catch (err) {
    safeLog_('❌ deleteTeacherMessage 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사 발신 메시지 다중 삭제
 * 행 번호가 큰 것부터 삭제해야 인덱스 밀림 방지
 */
function deleteBulkTeacherMessages(targets) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    if (!Array.isArray(targets) || !targets.length) return messageTargetChanged_();
    const keys = new Set();
    const indices = new Set();
    const resolved = [];
    for (const target of targets) {
      if (!target || keys.has(target.messageKey) || indices.has(target.rowIndex)) return messageTargetChanged_();
      const targetRow = resolveTeacherMessageRow_(sheet, target.rowIndex, target.messageKey);
      if (!targetRow) return messageTargetChanged_();
      keys.add(target.messageKey); indices.add(target.rowIndex); resolved.push(targetRow);
    }
    // Verify the entire selection before the first deletion, then delete bottom-up.
    const sorted = resolved.sort((a, b) => b - a);
    sorted.forEach(r => sheet.deleteRow(r));
    return { success: true, deleted: sorted.length };
  } catch (err) {
    safeLog_('❌ deleteBulkTeacherMessages 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 학생용: 교사 메시지에 답장 저장
 * H열: 학생답장, I열: 학생답장시간, J열: 학생답장읽음
 */
function replyToTeacherMessage(rowIndex, replyContent, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    if (typeof replyContent !== 'string' || !replyContent.trim()) return { success: false, error: '답장 내용을 입력하세요.' };
    // Persist millisecond precision and advance monotonically under the gateway
    // lock so even identical replies at the same clock instant get a new key.
    const previousTime = sheet.getRange(targetRow, 9).getValue();
    const previousMillis = previousTime instanceof Date ? previousTime.getTime() : 0;
    const ts = new Date(Math.max(Date.now(), previousMillis + 1));
    sheet.getRange(targetRow, 8, 1, 3).setValues([[replyContent, ts, '미확인']]);
    return { success: true };
  } catch (err) {
    safeLog_('❌ replyToTeacherMessage 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 미확인 학생 답장 목록 조회
 */
function getUnreadStudentReplies() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: true, data: [] };
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const reply = String(rows[i][7] || '');
      const replyRead = String(rows[i][9] || '');
      if (reply && replyRead === '미확인') {
        result.push({
          rowIndex:         i + 1,
          messageKey:       teacherMessageKey_(rows[i]),
          replyKey:         studentReplyKey_(rows[i]),
          timestamp:        rows[i][0] ? (rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') : String(rows[i][0])) : '',
          studentId:        String(rows[i][1] || ''),
          studentName:      String(rows[i][2] || ''),
          title:            String(rows[i][3] || ''),
          studentReply:     reply,
          studentReplyTime: rows[i][8] ? (rows[i][8] instanceof Date ? Utilities.formatDate(rows[i][8], 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') : String(rows[i][8])) : ''
        });
      }
    }
    return { success: true, data: result };
  } catch (err) {
    safeLog_('❌ getUnreadStudentReplies 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 학생 답장 확인 처리
 */
function markStudentReplyRead(rowIndex, expectedKey, expectedReplyKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    const row = sheet.getRange(targetRow, 1, 1, 13).getValues()[0];
    if (!row[7] || studentReplyKey_(row) !== expectedReplyKey) return messageTargetChanged_();
    sheet.getRange(targetRow, 10).setValue('확인');
    return { success: true };
  } catch (err) {
    safeLog_('❌ markStudentReplyRead 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 수면 메모 단어를 Gemini AI로 의미별 카테고리로 분류
 * @param {string[]} words - 분류할 단어 배열
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function analyzeSleepMemoWords(words) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { success: false, error: 'API 키가 설정되지 않았습니다.' };
    if (!words || words.length === 0) return { success: false, error: '분류할 단어가 없습니다.' };

    const modelName = 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const wordListText = words.join(', ');
    const prompt = `다음은 청소년들이 수면 메모에 적은 단어/표현 목록이야. 의미가 비슷한 것끼리 묶어서 5개 이하의 카테고리로 분류해줘.

단어 목록: ${wordListText}

규칙:
1. 카테고리 이름은 짧고 직관적으로 (예: 피로·졸림, 스트레스, 불안·걱정, 기분 좋음, 신체 증상)
2. 모든 단어는 반드시 하나의 카테고리에 포함
3. 반드시 아래 JSON 형식으로만 답해. 다른 설명 없이 JSON만 출력.
4. 카테고리는 5개 이하로 제한

출력 형식 (JSON만):
{"카테고리명1": ["단어1", "단어2"], "카테고리명2": ["단어3"]}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        candidateCount: 1
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());

    if (!json.candidates || !json.candidates[0]) {
      safeLog_('Gemini 응답: ' + JSON.stringify(json));
      return { success: false, error: 'Gemini 응답을 받지 못했습니다.' };
    }

    const text = json.candidates[0].content.parts[0].text.trim();
    safeLog_('Gemini 단어 분류 응답: ' + text);

    // 마크다운 코드블록 안의 JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'JSON 형식 파싱 실패' };

    const categories = JSON.parse(jsonMatch[0]);
    return { success: true, data: categories };

  } catch (err) {
    safeLog_('❌ analyzeSleepMemoWords 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}
