# Blue Market — 중고거래 플랫폼 (Secure Coding 과제)

Node.js로 만든 간단한 중고거래 플랫폼입니다. 회원가입·상품 거래·실시간 채팅·송금·신고·관리자 기능을
제공하며, 기본적인 시큐어 코딩을 적용했습니다. 디자인은 블루보틀 톤(미니멀·화이트·코발트 블루).

---

## 1. 실행 요구 사항

- **Node.js 22.5 이상** (필수). 이 프로젝트는 SQLite를 Node 내장 모듈 `node:sqlite`로 사용하기 때문에
  낮은 버전(18·20 등)에서는 실행되지 않습니다.
  - 버전 확인: `node -v`
  - nvm 사용 시(권장): 저장소에 `.nvmrc`가 있으므로 프로젝트 폴더에서 `nvm install && nvm use`
- 그 외 데이터베이스·서버 프로그램 설치는 필요 없습니다. (SQLite 파일은 첫 실행 시 자동 생성)

## 2. 설치 및 실행

```bash
cd app
npm install      # 의존성 설치 (node_modules 는 저장소에 없으므로 반드시 실행)
npm start        # 서버 실행
# → 브라우저에서 http://localhost:3000
```

- 첫 실행 시 데이터베이스(`market.db`)와 관리자 계정이 자동으로 생성됩니다.
- **초기 관리자 계정**: 아이디 `admin` / 비밀번호 `Admin!2345`
  (환경변수 `ADMIN_USER`, `ADMIN_PASS`로 바꿀 수 있음)

## 3. 구현 기능

| 코드 | 요구사항 | 구현 내용 |
| --- | --- | --- |
| N1 | 회원 가입/사용자 관리 | 회원가입(이미지 보안문자)·로그인·로그아웃, 프로필 조회, 마이페이지(아이디·계정명·소개글·비밀번호 수정) |
| N2 | 상품 등록/조회 | 상품 등록·수정·삭제·목록·상세, 내 상품 관리, 이미지 업로드(jpg/png만) |
| N3 | 사용자 간 소통 | 실시간 전체 채팅(홈 하단), 1:1 채팅, 쪽지함(대화 목록) |
| N4 | 악성 유저/상품 차단 | 신고(상품 ID·사용자명), 누적 신고 시 상품 자동 차단·사용자 자동 휴면 |
| N5 | 유저 간 송금 | 지갑 잔액·충전·송금(잔액 검증·트랜잭션 정합성)·거래 내역 |
| N6 | 상품 검색 | 상품명 키워드 검색(비회원 포함) |
| N7 | 관리자 관리 | 관리자 페이지에서 사용자(휴면·삭제)·상품(삭제·차단해제·ID 변경)·신고 관리, 관리자 계정 비노출 |

부가: 규칙기반 상담 챗봇(우하단 위젯), 우측 슬라이드 로그인/회원가입, 블루보틀 톤 UI.

## 4. 기술 스택

- Node.js(≥22.5) + Express 4
- Socket.IO (실시간 채팅)
- SQLite (Node 내장 `node:sqlite`)
- EJS (템플릿)
- bcryptjs(비밀번호 해시), express-session, express-rate-limit, multer(이미지 업로드), dotenv(.env)

## 5. 환경변수 (선택)

키를 설정하지 않아도 기본값으로 모두 동작합니다. 필요할 때만 `.env` 파일에 지정하세요.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | 3000 | 서버 포트 |
| `DB_PATH` | `./market.db` | SQLite 파일 경로 |
| `SESSION_SECRET` | (랜덤) | 세션 서명 키. 고정하려면 지정 |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `Admin!2345` | 초기 관리자 계정 |
| `PRODUCT_THRESHOLD` / `USER_THRESHOLD` | 3 / 3 | 상품 차단·사용자 휴면 신고 임계치 |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET` | (없음) | 설정하면 회원가입 보안문자가 구글 reCAPTCHA로 전환 |

- **보안문자**: 기본은 서버가 그려주는 이미지 보안문자라 별도 설정이 필요 없습니다.
  구글 reCAPTCHA를 쓰려면 위 두 키를 `.env`에 넣으면 됩니다(`.env.example` 참고). `.env`는 저장소에 포함되지 않습니다.

## 6. 폴더 구조

```
app/
├─ server.js         # 진입점 (Express + Socket.IO + 세션 + 미들웨어)
├─ db.js             # DB 스키마·시드 (node:sqlite)
├─ security.js       # 입력값 검증, CSRF, 접근 제어
├─ captcha.js        # 회원가입 이미지 보안문자 / reCAPTCHA
├─ upload.js         # 상품 이미지 업로드(jpg/png 검증)
├─ moderation.js     # 신고 누적 임계치 자동 조치
├─ chat.js           # 실시간 채팅(전체/1:1)
├─ routes/           # auth, user, product, transfer, report, admin, chatbot
├─ views/            # EJS 템플릿 + partials
├─ public/           # css(블루보틀 톤), uploads(상품 이미지)
└─ test/             # 자동 테스트 (run.js: HTTP, chat.js: 소켓)
```

## 7. 테스트

```bash
npm test                                   # HTTP 통합 테스트 (43건)
node --experimental-sqlite test/chat.js    # 실시간 채팅 테스트 (5건)
```
(테스트에 필요한 `socket.io-client`는 `npm install` 시 함께 설치됩니다.)

## 8. 적용한 시큐어 코딩 (요약)

- 비밀번호 bcrypt 해시 저장, 로그인 계정 열거 방지, 로그인 시 세션 재생성
- 세션 쿠키 HttpOnly·SameSite, 모든 상태변경 요청 CSRF 토큰 검증
- 서버측 입력값 검증, SQL 파라미터 바인딩, 출력 이스케이프(XSS 방지)
- 접근 제어(로그인/관리자/소유자), 신고·로그인 rate limit
- 이미지 업로드 확장자·용량 제한, 송금 트랜잭션 정합성, 공통 에러 화면으로 내부정보 비노출
