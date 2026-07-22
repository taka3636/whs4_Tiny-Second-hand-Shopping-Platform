'use strict';
/* HTTP 통합 테스트 (외부 라이브러리 없이 fetch 사용) */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// 샌드박스 마운트 FS는 SQLite 락을 지원하지 않아 로컬 디스크(tmp)에 테스트 DB 생성
process.env.DB_PATH = path.join(os.tmpdir(), 'market_test.db');
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'Admin!2345';
process.env.PRODUCT_THRESHOLD = '3';
process.env.USER_THRESHOLD = '3';
try { fs.unlinkSync(process.env.DB_PATH); } catch (_) {}

const { server } = require('../server');

let PASS = 0, FAIL = 0;
function ok(cond, msg) { if (cond) { PASS++; console.log('  ✓ ' + msg); } else { FAIL++; console.log('  ✗ ' + msg); } }

function makeJar() { return { cookie: '' }; }
function applyCookies(jar, res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) { const p = c.split(';')[0]; if (p.startsWith('sid=')) jar.cookie = p; }
}
let BASE;
async function req(jar, method, pathname, form) {
  const headers = {};
  if (jar.cookie) headers.cookie = jar.cookie;
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(BASE + pathname, { method, headers, body, redirect: 'manual' });
  applyCookies(jar, res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}
const csrfOf = (html) => { const m = html.match(/name="_csrf" value="([^"]+)"/); return m ? m[1] : null; };
async function getCsrf(jar, pathname) { const r = await req(jar, 'GET', pathname); return csrfOf(r.text); }
// 이미지(SVG) 보안문자에서 코드 추출 (+ 세션에 코드 설정)
async function getCaptcha(jar) {
  const r = await req(jar, 'GET', '/captcha.svg');
  return [...r.text.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join('');
}
// 보안문자를 포함한 회원가입
async function doRegister(jar, fields) {
  const g = await req(jar, 'GET', '/register');
  const cap = await getCaptcha(jar);
  return req(jar, 'POST', '/register', { _csrf: csrfOf(g.text), captcha: cap, ...fields });
}

async function main() {
  await new Promise((r) => server.listen(0, r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  console.log('테스트 서버:', BASE, '\n');

  // ---- 인증/유저 ----
  console.log('[인증/유저]');
  const A = makeJar();
  let t, r;
  r = await doRegister(A, { username: 'alice', display_name: '앨리스', password: 'password123', password2: 'password123' });
  ok(r.status === 302 && r.location === '/products', '회원가입 성공 후 리다이렉트');

  // 중복 아이디
  const dupJar = makeJar();
  r = await doRegister(dupJar, { username: 'alice', display_name: '중복', password: 'password123', password2: 'password123' });
  ok(r.status === 400 && /이미 사용/.test(r.text), '아이디 중복 방지');

  // 약한 비밀번호 검증
  const wJar = makeJar();
  r = await doRegister(wJar, { username: 'weakpw', display_name: '약함', password: '123', password2: '123' });
  ok(r.status === 400, '짧은 비밀번호 거부');

  // 보안문자 오답 거부 (세션에 코드 설정 후 6자리 오답 제출 → 5자리 코드와 절대 불일치)
  const capJar = makeJar();
  const cg = await req(capJar, 'GET', '/register');
  await getCaptcha(capJar);
  r = await req(capJar, 'POST', '/register', { _csrf: csrfOf(cg.text), captcha: 'XXXXXX', username: 'capuser', display_name: '캡', password: 'password123', password2: 'password123' });
  ok(r.status === 400 && /보안문자/.test(r.text), '이미지 보안문자 오답 시 가입 거부');

  // 로그인 필요 리다이렉트
  const guest = makeJar();
  r = await req(guest, 'GET', '/mypage');
  ok(r.status === 302 && r.location === '/login', '비로그인 마이페이지 접근 시 로그인으로');

  // CSRF 없는 POST 거부
  r = await req(A, 'POST', '/products/new', { name: 'x', description: 'y', price: '1' });
  ok(r.status === 403, 'CSRF 토큰 없는 요청 거부');

  // 마이페이지 수정
  t = await getCsrf(A, '/mypage');
  r = await req(A, 'POST', '/mypage/profile', { _csrf: t, username: 'alice', display_name: '앨리스2', bio: '안녕하세요' });
  ok(r.status === 200 && /업데이트되었습니다/.test(r.text), '프로필(소개글) 수정');

  // 비밀번호 변경(현재 비번 틀림 → 실패)
  t = await getCsrf(A, '/mypage');
  r = await req(A, 'POST', '/mypage/password', { _csrf: t, current_password: 'wrong', new_password: 'newpass123', new_password2: 'newpass123' });
  ok(r.status === 400, '현재 비밀번호 불일치 시 변경 거부');

  // ---- 상품/검색 ----
  console.log('\n[상품/검색]');
  t = await getCsrf(A, '/products/new');
  r = await req(A, 'POST', '/products/new', { _csrf: t, name: '자전거', description: '가벼운 로드 자전거', price: '50000' });
  ok(r.status === 302 && /^\/products\/\d+$/.test(r.location), '상품 등록 성공');
  const pid = Number(r.location.split('/').pop());

  r = await req(A, 'POST', '/products/new', { _csrf: t, name: '책상', description: '원목 책상', price: 'abc' });
  ok(r.status === 400, '가격 형식 검증(문자 거부)');

  r = await req(guest, 'GET', '/products');
  ok(r.status === 200 && /자전거/.test(r.text), '누구나 상품 목록 조회');

  r = await req(guest, 'GET', '/products?q=' + encodeURIComponent('자전거'));
  ok(/자전거/.test(r.text), '상품명 검색 결과 노출');
  r = await req(guest, 'GET', '/products?q=' + encodeURIComponent('없는상품xyz'));
  ok(!/자전거/.test(r.text), '검색 미일치 시 결과 없음');

  r = await req(guest, 'GET', '/products/' + pid);
  ok(r.status === 200 && /자전거/.test(r.text), '상품 상세 조회');

  // ---- 송금 ----
  console.log('\n[송금]');
  const B = makeJar();
  await doRegister(B, { username: 'bob', display_name: '밥', password: 'password123', password2: 'password123' });

  // 잔액 부족 송금
  t = await getCsrf(A, '/wallet');
  r = await req(A, 'POST', '/wallet/send', { _csrf: t, to_username: 'bob', amount: '1000' });
  ok(/잔액이 부족/.test(r.text), '잔액 부족 시 송금 거부');

  // 충전
  t = await getCsrf(A, '/wallet');
  r = await req(A, 'POST', '/wallet/charge', { _csrf: t, amount: '10000' });
  ok(/10,000원이 충전/.test(r.text), '잔액 충전');

  // 자기 자신 송금 금지
  t = await getCsrf(A, '/wallet');
  r = await req(A, 'POST', '/wallet/send', { _csrf: t, to_username: 'alice', amount: '100' });
  ok(/자기 자신/.test(r.text), '자기 자신 송금 금지');

  // 정상 송금
  t = await getCsrf(A, '/wallet');
  r = await req(A, 'POST', '/wallet/send', { _csrf: t, to_username: 'bob', amount: '3000' });
  ok(/밥.*3,000원을 보냈/.test(r.text), '정상 송금 성공');
  r = await req(A, 'GET', '/wallet');
  ok(/7,000원/.test(r.text), '송금 후 잔액 차감 정합성(10000-3000=7000)');
  r = await req(B, 'GET', '/wallet');
  ok(/3,000원/.test(r.text), '수취인 잔액 증가');

  // ---- 신고 & 자동 차단 ----
  console.log('\n[신고/자동차단]');
  const reps = [];
  for (const name of ['rep1', 'rep2', 'rep3']) {
    const j = makeJar();
    await doRegister(j, { username: name, display_name: name.toUpperCase(), password: 'password123', password2: 'password123' });
    reps.push(j);
  }
  for (let i = 0; i < reps.length; i++) {
    const c = await getCsrf(reps[i], '/report');
    r = await req(reps[i], 'POST', '/report', { _csrf: c, type: 'product', target: String(pid), reason: '허위 매물 신고합니다' });
  }
  ok(/자동 조치/.test(r.text), '임계치(3회) 초과 시 상품 자동 차단 안내');
  r = await req(guest, 'GET', '/products/' + pid);
  ok(r.status === 404, '차단된 상품은 상세에서 404');
  r = await req(guest, 'GET', '/products');
  ok(!/자전거/.test(r.text), '차단된 상품은 목록에서 숨김');

  // 중복 신고 방지
  let c = await getCsrf(reps[0], '/report');
  r = await req(reps[0], 'POST', '/report', { _csrf: c, type: 'product', target: String(pid), reason: '중복 신고 테스트입니다' });
  ok(/이미 신고/.test(r.text), '중복 신고 방지');

  // ---- 관리자/접근제어 ----
  console.log('\n[관리자/접근제어]');
  r = await req(A, 'GET', '/admin');
  ok(r.status === 403, '일반 사용자 관리자 페이지 접근 차단(403)');

  const AD = makeJar(); t = await getCsrf(AD, '/login');
  r = await req(AD, 'POST', '/login', { _csrf: t, username: 'admin', password: 'Admin!2345' });
  ok(r.status === 302, '관리자 로그인');
  r = await req(AD, 'GET', '/admin');
  ok(r.status === 200 && /관리자 페이지/.test(r.text), '관리자 페이지 접근');

  // 관리자: bob 휴면 처리 → bob 로그인 차단
  const bob = require('../db').db.prepare("SELECT id FROM users WHERE username='bob'").get();
  t = await getCsrf(AD, '/admin');
  r = await req(AD, 'POST', '/admin/users/' + bob.id + '/suspend', { _csrf: t });
  ok(r.status === 302, '관리자가 사용자 휴면 처리');
  const bJar = makeJar(); t = await getCsrf(bJar, '/login');
  r = await req(bJar, 'POST', '/login', { _csrf: t, username: 'bob', password: 'password123' });
  ok(r.status === 403 && /휴면/.test(r.text), '휴면 계정 로그인 차단');

  // ---- 체크리스트 수정 검증 (N1/N3/N4/N7) ----
  console.log('\n[체크리스트 수정 검증]');
  const dbref = require('../db').db;

  // N1: 아이디(로그인 ID) 변경 → 새 아이디로 로그인
  t = await getCsrf(A, '/mypage');
  r = await req(A, 'POST', '/mypage/profile', { _csrf: t, username: 'alice2', display_name: '앨리스', bio: '소개' });
  ok(r.status === 200 && /업데이트/.test(r.text), 'N1 아이디 변경 성공');
  const A2 = makeJar(); t = await getCsrf(A2, '/login');
  r = await req(A2, 'POST', '/login', { _csrf: t, username: 'alice2', password: 'password123' });
  ok(r.status === 302, 'N1 변경한 아이디로 로그인 성공');

  // N3: 쪽지함 페이지 로드 + 받은 대화 표시
  r = await req(A2, 'GET', '/messages');
  ok(r.status === 200 && /쪽지함/.test(r.text), 'N3 쪽지함(1:1 채팅 목록) 페이지 로드');
  const a2id = dbref.prepare("SELECT id FROM users WHERE username='alice2'").get().id;
  const bId = dbref.prepare("SELECT id FROM users WHERE username='bob'").get().id;
  const room = 'dm:' + Math.min(a2id, bId) + ':' + Math.max(a2id, bId);
  dbref.prepare('INSERT INTO messages (room, sender_id, content) VALUES (?, ?, ?)').run(room, bId, '상품 문의드립니다');
  r = await req(A2, 'GET', '/messages');
  ok(r.status === 200 && /상품 문의드립니다/.test(r.text) && /밥/.test(r.text), 'N3 쪽지함에 받은 대화가 표시됨');

  // N4: 사용자 신고 3회 → 자동 휴면
  const vic = makeJar();
  await doRegister(vic, { username: 'victimx', display_name: '빅텀', password: 'password123', password2: 'password123' });
  const vId = dbref.prepare("SELECT id FROM users WHERE username='victimx'").get().id;
  for (const name of ['urep1', 'urep2', 'urep3']) {
    const j = makeJar();
    await doRegister(j, { username: name, display_name: name, password: 'password123', password2: 'password123' });
    const cc = await getCsrf(j, '/report');
    r = await req(j, 'POST', '/report', { _csrf: cc, type: 'user', target: 'victimx', reason: '악성 사용자 신고합니다' });
  }
  ok(/자동 조치/.test(r.text), 'N4 사용자 신고 임계치 초과 자동 조치 안내');
  ok(dbref.prepare('SELECT status FROM users WHERE id=?').get(vId).status === 'suspended', 'N4 사용자 자동 휴면 처리');

  // N7: 관리자 사용자 삭제 (연관 데이터: 신고 대상) → FK 오류 없이 삭제
  t = await getCsrf(AD, '/admin');
  r = await req(AD, 'POST', '/admin/users/' + vId + '/delete', { _csrf: t });
  ok(r.status === 302, 'N7 관리자 사용자 삭제 성공(연관 데이터 정리)');
  ok(!dbref.prepare('SELECT id FROM users WHERE id=?').get(vId), 'N7 삭제 후 사용자 없음');

  // ---- 관리자 계정 비노출 ----
  console.log('\n[관리자 비노출]');
  const adminId = dbref.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  r = await req(A2, 'GET', '/users/' + adminId);
  ok(r.status === 404, '일반 사용자는 관리자 프로필을 볼 수 없음(404)');
  r = await req(AD, 'GET', '/users/' + adminId);
  ok(r.status === 200, '관리자 본인은 관리자 프로필 접근 가능');

  // ---- 상품 이미지 업로드 (jpg/png만) ----
  console.log('\n[상품 이미지 업로드]');
  async function postForm(jar, pathname, fields, file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('image', new Blob([file.buf], { type: file.type }), file.name);
    const res = await fetch(BASE + pathname, { method: 'POST', headers: { cookie: jar.cookie }, body: fd, redirect: 'manual' });
    applyCookies(jar, res);
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  let cP = await getCsrf(A2, '/products/new');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  let ri = await postForm(A2, '/products/new', { _csrf: cP, name: '이미지상품', description: '설명', price: '1000' }, { buf: png, type: 'image/png', name: 'p.png' });
  ok(ri.status === 302 && /^\/products\/\d+$/.test(ri.location || ''), 'PNG 이미지 상품 등록 성공');
  cP = await getCsrf(A2, '/products/new');
  ri = await postForm(A2, '/products/new', { _csrf: cP, name: '악성파일', description: '설명', price: '1000' }, { buf: Buffer.from('hello'), type: 'text/plain', name: 'evil.txt' });
  ok(ri.status === 400 && /jpg 또는 png/.test(ri.text), 'jpg/png 아닌 파일 업로드 거부');

  // ---- 상담 챗봇 ----
  console.log('\n[챗봇]');
  {
    const tok = await getCsrf(A2, '/products');
    let rc = await fetch(BASE + '/chatbot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': tok, cookie: A2.cookie }, body: JSON.stringify({ message: '송금은 어떻게 하나요?' }) });
    const jc = await rc.json();
    ok(rc.status === 200 && /송금|지갑/.test(jc.reply), '챗봇 응답(송금 안내)');
    rc = await fetch(BASE + '/chatbot', { method: 'POST', headers: { 'content-type': 'application/json', cookie: A2.cookie }, body: JSON.stringify({ message: 'x' }) });
    ok(rc.status === 403, '챗봇 CSRF 토큰 없으면 거부');
  }

  console.log(`\n결과: ${PASS} passed, ${FAIL} failed`);
  server.close();
  process.exit(FAIL === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
