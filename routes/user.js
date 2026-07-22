'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { validators, requireLogin } = require('../security');

const router = express.Router();

/* 마이페이지 (소개글 및 비밀번호 업데이트) */
router.get('/mypage', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('mypage', { me, error: null, notice: null });
});

router.post('/mypage/profile', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { username, display_name, bio } = req.body;
  const fail = (msg) => res.status(400).render('mypage', { me, error: msg, notice: null });

  if (!validators.username(username || '')) return fail('아이디는 영문/숫자/밑줄 3~20자여야 합니다.');
  if (!validators.displayName(display_name || '')) return fail('계정명은 1~20자여야 합니다.');
  if (!validators.bio(bio || '')) return fail('소개글은 300자 이하여야 합니다.');

  // 아이디를 바꾸는 경우 중복 검사(본인 제외)
  if (username !== me.username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(username, me.id);
    if (dup) return fail('이미 사용 중인 아이디입니다.');
  }

  db.prepare('UPDATE users SET username = ?, display_name = ?, bio = ? WHERE id = ?')
    .run(username, display_name.trim(), bio || '', me.id);
  // 세션의 로그인 정보도 갱신 → 변경한 아이디로 바로 로그인 상태 유지/재로그인 가능
  req.session.user.username = username;
  req.session.user.display_name = display_name.trim();
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
  res.render('mypage', { me: updated, error: null, notice: '프로필이 업데이트되었습니다.' });
});

router.post('/mypage/password', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { current_password, new_password, new_password2 } = req.body;
  const fail = (msg) => res.status(400).render('mypage', { me, error: msg, notice: null });

  if (!bcrypt.compareSync(current_password || '', me.password_hash)) return fail('현재 비밀번호가 올바르지 않습니다.');
  if (!validators.password(new_password)) return fail('새 비밀번호는 8자 이상이어야 합니다.');
  if (new_password !== new_password2) return fail('새 비밀번호 확인이 일치하지 않습니다.');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), me.id);
  res.render('mypage', { me, error: null, notice: '비밀번호가 변경되었습니다.' });
});

/* 쪽지함: 내가 참여한 1:1 채팅방 목록 */
router.get('/messages', requireLogin, (req, res) => {
  const myId = req.session.user.id;
  // 내 id가 포함된 dm 방들의 마지막 메시지 (LIKE 패턴은 JS로 구성)
  const p1 = `dm:${myId}:%`;
  const p2 = `dm:%:${myId}`;
  const rooms = db.prepare(
    `SELECT room, MAX(id) AS last_id FROM messages
     WHERE room LIKE 'dm:%' AND (room LIKE ? OR room LIKE ?)
     GROUP BY room ORDER BY last_id DESC`
  ).all(p1, p2);

  const convos = [];
  for (const r of rooms) {
    const parts = r.room.split(':'); // dm, a, b
    const a = Number(parts[1]), b = Number(parts[2]);
    const otherId = a === myId ? b : a;
    const other = db.prepare('SELECT id, display_name, username, is_admin FROM users WHERE id = ?').get(otherId);
    if (!other || other.is_admin) continue; // 삭제되었거나 관리자 계정은 제외
    const last = db.prepare('SELECT content, created_at FROM messages WHERE id = ?').get(r.last_id);
    convos.push({ other, last });
  }
  res.render('messages', { convos });
});

/* 사용자 프로필 조회 */
router.get('/users/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).render('error', { message: '잘못된 사용자입니다.' });
  const user = db.prepare('SELECT id, username, display_name, bio, status, is_admin, created_at FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).render('error', { message: '존재하지 않는 사용자입니다.' });
  // 관리자 계정은 일반 사용자에게 비노출 (존재 자체를 숨김)
  if (user.is_admin && !req.session.user.is_admin) {
    return res.status(404).render('error', { message: '존재하지 않는 사용자입니다.' });
  }
  const products = db.prepare('SELECT id, name, price, image FROM products WHERE seller_id = ? AND is_blocked = 0 ORDER BY id DESC').all(id);
  res.render('profile', { user, products });
});

module.exports = router;
