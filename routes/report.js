'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { validators, requireLogin } = require('../security');
const { applyThreshold } = require('../moderation');

const router = express.Router();

const reportLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, legacyHeaders: false, standardHeaders: true });

/* 신고 페이지 */
router.get('/report', requireLogin, (req, res) => {
  const type = validators.reportType(req.query.type) ? req.query.type : 'product';
  const target = req.query.target != null ? String(req.query.target).slice(0, 40) : '';
  res.render('report', { error: null, notice: null, form: { type, target } });
});

router.post('/report', requireLogin, reportLimiter, (req, res) => {
  const { type, target, reason } = req.body;
  const form = { type, target, reason };
  const fail = (msg) => res.status(400).render('report', { error: msg, notice: null, form });

  if (!validators.reportType(type)) return fail('신고 대상 유형이 올바르지 않습니다.');
  if (!validators.reason(reason || '')) return fail('신고 사유는 5~300자로 작성해야 합니다.');

  // 대상 확인: 상품은 상품 ID(숫자), 사용자는 사용자명(username)
  let targetId;
  if (type === 'product') {
    targetId = Number(target);
    if (!Number.isInteger(targetId) || targetId <= 0) return fail('상품 ID가 올바르지 않습니다.');
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(targetId);
    if (!p) return fail('신고 대상 상품이 존재하지 않습니다.');
  } else {
    const uname = String(target || '').trim();
    const u = db.prepare('SELECT id, is_admin FROM users WHERE username = ?').get(uname);
    if (!u) return fail('해당 사용자명을 찾을 수 없습니다.');
    if (u.is_admin) return fail('신고할 수 없는 사용자입니다.');
    targetId = u.id;
    if (targetId === req.session.user.id) return fail('자기 자신은 신고할 수 없습니다.');
  }

  // 중복 신고 방지 (동일 신고자-대상 1회)
  const dup = db.prepare(
    'SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?'
  ).get(req.session.user.id, type, targetId);
  if (dup) return fail('이미 신고한 대상입니다.');

  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, type, targetId, reason.trim());

  const acted = applyThreshold(type, targetId);
  const notice = acted
    ? '신고가 접수되었습니다. 누적 신고 기준을 초과하여 대상이 자동 조치되었습니다.'
    : '신고가 접수되었습니다.';
  res.render('report', { error: null, notice, form: { type: 'product', target: '' } });
});

module.exports = router;
