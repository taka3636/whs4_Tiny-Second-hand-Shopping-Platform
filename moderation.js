'use strict';
/** 신고 누적 임계치에 따른 자동 조치 */
const { db } = require('./db');

const PRODUCT_THRESHOLD = Number(process.env.PRODUCT_THRESHOLD || 3); // 서로 다른 신고자 수
const USER_THRESHOLD = Number(process.env.USER_THRESHOLD || 3);

// 서로 다른 신고자 수 (중복 신고는 1회로 계산되므로 사실상 전체 신고 수)
function distinctReporters(type, targetId) {
  return db.prepare(
    'SELECT COUNT(DISTINCT reporter_id) AS c FROM reports WHERE target_type = ? AND target_id = ?'
  ).get(type, targetId).c;
}

/**
 * 임계치 초과 시 자동 조치.
 * - product: is_blocked = 1 (전체 목록/상세에서 숨김 = 차단)
 * - user:    status = 'suspended' (휴면계정 전환, 로그인 차단)
 * @returns {boolean} 조치가 발생했으면 true
 */
function applyThreshold(type, targetId) {
  const count = distinctReporters(type, targetId);
  if (type === 'product' && count >= PRODUCT_THRESHOLD) {
    const p = db.prepare('SELECT is_blocked FROM products WHERE id = ?').get(targetId);
    if (p && !p.is_blocked) {
      db.prepare('UPDATE products SET is_blocked = 1 WHERE id = ?').run(targetId);
      return true;
    }
  }
  if (type === 'user' && count >= USER_THRESHOLD) {
    const u = db.prepare('SELECT status, is_admin FROM users WHERE id = ?').get(targetId);
    if (u && !u.is_admin && u.status !== 'suspended') {
      db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(targetId);
      return true;
    }
  }
  return false;
}

module.exports = { applyThreshold, distinctReporters, PRODUCT_THRESHOLD, USER_THRESHOLD };
