# 기록담

학생과 교사가 생활기록부를 안전하게 공유하고, 수정 이력을 관리하는 웹 서비스입니다.

## 주요 기능

- 학생 이름·코드 로그인 및 학생/교사 권한 분리
- 학생 본인 기록만 조회, 교사는 전체 기록 조회
- 반·번호·이름·과목·내용 검색과 내용 복사
- 생활기록부 편집, 수정 이력 비교, 버전 되돌리기
- 나이스 바이트 수(`2 * LENB - LEN`) 계산
- 학생 명단과 과목 관리
- 학생 명단 및 과목별 기록의 엑셀 가져오기·내보내기·샘플 저장

## 로컬 실행

```bash
npm install
npx convex dev
npm run dev
```

`.env.local`의 `NEXT_PUBLIC_CONVEX_URL`이 Convex 배포 주소를 가리켜야 합니다.

## 운영 배포

Vercel 빌드 명령은 Convex 함수 배포와 Next.js 빌드를 함께 수행하도록 설정합니다.

```bash
npx convex deploy --cmd "npm run build"
```
