# 카페인·수면 건강일지

학생용 건강 기록 화면과 교사용 연구 모니터링 화면을 Vercel에서 제공하고, 현재 Google 스프레드시트는 Apps Script 서버를 통해서만 접근하는 프로젝트입니다.

## URLs

- 학생: Vercel 배포 루트 `/`
- 교사: Vercel 배포 경로 `/teacher`
- Apps Script: 공개 화면이 아니라 비공개 데이터 게이트웨이

## Security model

- 학생은 학번과 이름을 확인한 뒤 서명된 `HttpOnly` 세션 쿠키를 받습니다.
- 학생 요청의 학번과 이름은 브라우저 입력을 신뢰하지 않고 서버 세션 값으로 덮어씁니다.
- 수정·삭제·메시지 답장은 Apps Script에서 레코드 소유권을 다시 확인합니다.
- 새 기록 ID는 Apps Script가 발급하고, 소유권 확인과 변경은 스크립트 잠금 안에서 처리합니다.
- 교사 비밀번호는 서버 환경에 scrypt salt/hash로만 저장됩니다.
- 로그인 API는 서버 내 요청 제한을 적용하며, 운영 환경에서는 Vercel Firewall 제한도 함께 사용합니다.
- `/api/health`는 Apps Script 연결 여부만 확인하고 시트 데이터는 반환하지 않습니다.
- Apps Script URL, 현재 시트 ID, 공유 비밀값, 교사 비밀번호, 학생 기록은 공개 번들에 포함되지 않습니다.

## Local commands

```text
npm test
npm run test:apps-script
npm run security:public
npm run build:apps-script
npm run verify
```

환경 변수 이름은 [.env.example](.env.example), 배포 순서와 롤백 방법은 [docs/deployment-checklist.md](docs/deployment-checklist.md)를 참고하세요. 현재 챌린지와 뱃지 기능은 원본 그대로 보존하며, 세부 규칙 변경은 연결 안정화 후 별도 작업으로 진행합니다.
