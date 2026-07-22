'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { validators } = require('../security');
const { verifyCaptcha, resetCaptcha, ensureCode, newCode, renderSvg, useRecaptcha } = require('../captcha');

const router = express.Router();

/* 이미지 보안문자 (SVG). reCAPTCHA 사용 시엔 미제공 */
router.get('/captcha.svg', (req, res) => {
  if (useRecaptcha) return res.status(404).end();
  const code = req.query.new ? newCode(req) : ensureCode(req);
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(renderSvg(code));
});

// 로그인/회원가입 브루트포스 완화
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
});

function sessionUser(row) {
  return { id: row.id, username: row.username, display_name: row.display_name, is_admin: !!row.is_admin };
}

/* 회원가입 */
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { error: null, form: {} });
});

router.post('/register', authLimiter, async (req, res) => {
  const { username, display_name, password, password2 } = req.body;
  const form = { username, display_name };
  const fail = (msg) => res.status(400).render('register', { error: msg, form });

  if (!validators.username(username)) return fail('아이디는 영문/숫자/밑줄 3~20자여야 합니다.');
  if (!validators.displayName(display_name || '')) return fail('계정명은 1~20자여야 합니다.');
  if (!validators.password(password)) return fail('비밀번호는 8자 이상이어야 합니다.');
  if (password !== password2) return fail('비밀번호 확인이 일치하지 않습니다.');
  if (!(await verifyCaptcha(req))) return fail('보안문자가 올바르지 않습니다.');

  const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (dup) return fail('이미 사용 중인 아이디입니다.');
  resetCaptcha(req);

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, bio, balance)
     VALUES (?, ?, ?, '', 0)`
  ).run(username, display_name.trim(), hash);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.user = sessionUser(row);
  res.redirect('/products');
});

/* 로그인 */
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, form: {} });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  const fail = () => res.status(401).render('login', { error: '아이디 또는 비밀번호가 올바르지 않습니다.', form: { username } });

  if (typeof username !== 'string' || typeof password !== 'string') return fail();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // 사용자 존재 여부와 무관하게 동일 응답 (계정 열거 방지)
  if (!row) { bcrypt.compareSync(password, '$2a$10$abcdefghijklmnopqrstuv'); return fail(); }
  if (!bcrypt.compareSync(password, row.password_hash)) return fail();
  if (row.status === 'suspended') {
    return res.status(403).render('login', { error: '휴면(정지) 처리된 계정입니다. 관리자에게 문의하세요.', form: { username } });
  }

  req.session.regenerate((err) => {           // 세션 고정 공격 방지
    if (err) return fail();
    req.session.user = sessionUser(row);
    res.redirect('/products');
  });
});

/* 로그아웃 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
