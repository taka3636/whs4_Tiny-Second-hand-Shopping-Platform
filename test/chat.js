'use strict';
/* Socket.IO 채팅 테스트 (전체 채팅 + 1:1). socket.io-client 필요(테스트 전용) */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.DB_PATH = path.join(os.tmpdir(), 'chat_test.db');
process.env.SESSION_SECRET = 'test';
try { fs.unlinkSync(process.env.DB_PATH); } catch (_) {}

const { server } = require('../server');
const { db } = require('../db');
const { io: ioc } = require('socket.io-client');

let PASS = 0, FAIL = 0;
const ok = (c, m) => { if (c) { PASS++; console.log('  ✓ ' + m); } else { FAIL++; console.log('  ✗ ' + m); } };

function jar() { return { cookie: '' }; }
function ac(j, res) { const l = res.headers.getSetCookie ? res.headers.getSetCookie() : []; for (const c of l) { const p = c.split(';')[0]; if (p.startsWith('sid=')) j.cookie = p; } }
let BASE;
async function rq(j, m, p, f) { const h = {}; if (j.cookie) h.cookie = j.cookie; let b; if (f) { h['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(f).toString(); } const r = await fetch(BASE + p, { method: m, headers: h, body: b, redirect: 'manual' }); ac(j, r); return { status: r.status, text: await r.text() }; }
const csrf = (h) => { const m = h.match(/name="_csrf" value="([^"]+)"/); return m ? m[1] : null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(name) {
  const j = jar();
  const g = await rq(j, 'GET', '/register');
  const cap = await rq(j, 'GET', '/captcha.svg');
  const code = [...cap.text.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join('');
  await rq(j, 'POST', '/register', { _csrf: csrf(g.text), captcha: code, username: name, display_name: name, password: 'password123', password2: 'password123' });
  return j;
}
function connect(cookie) {
  return ioc(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket', 'polling'] });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  console.log('[채팅]');

  const A = await register('chatuserA');
  const B = await register('chatuserB');
  const aId = db.prepare("SELECT id FROM users WHERE username='chatuserA'").get().id;
  const bId = db.prepare("SELECT id FROM users WHERE username='chatuserB'").get().id;

  const sA = connect(A.cookie);
  const sB = connect(B.cookie);
  await Promise.all([
    new Promise((r) => sA.on('connect', r)),
    new Promise((r) => sB.on('connect', r)),
  ]);
  ok(true, '두 사용자 소켓 연결');

  // 전체 채팅: A가 보내면 B가 수신
  const gotGlobal = new Promise((res) => sB.on('global:message', res));
  await wait(100);
  sA.emit('global:send', { content: '안녕하세요 전체 채팅' });
  const gm = await Promise.race([gotGlobal, wait(2000).then(() => null)]);
  ok(gm && gm.content === '안녕하세요 전체 채팅' && gm.sender_id === aId, '전체 채팅 브로드캐스트 수신');

  // 전체 채팅 DB 저장 확인
  await wait(100);
  ok(db.prepare("SELECT COUNT(*) c FROM messages WHERE room='global'").get().c >= 1, '전체 채팅 메시지 DB 저장');

  // 1:1 채팅: B가 join, A가 dm:send → B 수신
  sB.emit('dm:join', { userId: aId });
  await wait(150);
  const gotDm = new Promise((res) => sB.on('dm:message', res));
  await wait(350); // flood 가드(300ms) 회피
  sA.emit('dm:send', { userId: bId, content: '1대1 비밀 메시지' });
  const dm = await Promise.race([gotDm, wait(2000).then(() => null)]);
  ok(dm && dm.content === '1대1 비밀 메시지' && dm.sender_id === aId, '1:1 채팅 상대 수신');

  // 비로그인 소켓은 전송 불가
  const anon = ioc(BASE, { transports: ['websocket', 'polling'] });
  await new Promise((r) => anon.on('connect', r));
  const gotErr = new Promise((res) => anon.on('chat:error', res));
  anon.emit('global:send', { content: '비로그인 시도' });
  const err = await Promise.race([gotErr, wait(1500).then(() => null)]);
  ok(!!err, '비로그인 사용자 채팅 전송 차단');

  sA.close(); sB.close(); anon.close();
  console.log(`\n결과: ${PASS} passed, ${FAIL} failed`);
  server.close();
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
