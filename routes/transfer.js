'use strict';
const express = require('express');
const { db } = require('../db');
const { validators, requireLogin } = require('../security');

const router = express.Router();

function renderWallet(res, me, opts = {}) {
  const history = db.prepare(
    `SELECT t.*, s.display_name AS sender_name, r.display_name AS receiver_name
     FROM transfers t
     JOIN users s ON s.id = t.sender_id
     JOIN users r ON r.id = t.receiver_id
     WHERE t.sender_id = ? OR t.receiver_id = ?
     ORDER BY t.id DESC LIMIT 50`
  ).all(me.id, me.id);
  res.render('wallet', {
    me, history,
    error: opts.error || null,
    notice: opts.notice || null,
    prefill: opts.prefill || { to: '', amount: '' },
  });
}

/* 지갑: 잔액 조회 + 거래 내역 */
router.get('/wallet', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const prefill = {
    to: typeof req.query.to === 'string' ? req.query.to.slice(0, 20) : '',
    amount: /^\d{1,9}$/.test(String(req.query.amount)) ? String(req.query.amount) : '',
  };
  renderWallet(res, me, { prefill });
});

/* 잔액 충전 (간단 구현: 가상 충전) */
router.post('/wallet/charge', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { amount } = req.body;
  if (!validators.amount(amount)) return renderWallet(res, me, { error: '충전 금액은 1 이상의 정수여야 합니다.' });
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(Number(amount), me.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
  renderWallet(res, updated, { notice: `${Number(amount).toLocaleString()}원이 충전되었습니다.` });
});

/* 송금 (다른 사용자에게 이체) — 잔액 검증 + 트랜잭션 정합성 */
router.post('/wallet/send', requireLogin, (req, res) => {
  const meRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { to_username, amount, memo } = req.body;

  if (!validators.amount(amount)) return renderWallet(res, meRow, { error: '송금 금액은 1 이상의 정수여야 합니다.' });
  if (typeof to_username !== 'string' || !to_username.trim()) return renderWallet(res, meRow, { error: '받는 사람 아이디를 입력하세요.' });
  if (memo && String(memo).length > 100) return renderWallet(res, meRow, { error: '메모는 100자 이하여야 합니다.' });

  const receiver = db.prepare('SELECT * FROM users WHERE username = ?').get(to_username.trim());
  if (!receiver) return renderWallet(res, meRow, { error: '받는 사람을 찾을 수 없습니다.' });
  if (receiver.id === meRow.id) return renderWallet(res, meRow, { error: '자기 자신에게는 송금할 수 없습니다.' });

  const amt = Number(amount);
  try {
    db.exec('BEGIN IMMEDIATE');
    // 최신 잔액 재확인 (동시성 방어)
    const sender = db.prepare('SELECT balance FROM users WHERE id = ?').get(meRow.id);
    if (sender.balance < amt) {
      db.exec('ROLLBACK');
      return renderWallet(res, db.prepare('SELECT * FROM users WHERE id = ?').get(meRow.id),
        { error: '잔액이 부족합니다.' });
    }
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amt, meRow.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, receiver.id);
    db.prepare('INSERT INTO transfers (sender_id, receiver_id, amount, memo) VALUES (?, ?, ?, ?)')
      .run(meRow.id, receiver.id, amt, (memo || '').trim());
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(meRow.id);
  renderWallet(res, updated, { notice: `${receiver.display_name}님에게 ${amt.toLocaleString()}원을 보냈습니다.` });
});

module.exports = router;
