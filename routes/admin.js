'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../security');

const router = express.Router();
router.use(requireAdmin); // 모든 /admin 경로는 관리자 전용

/* 관리자 대시보드: 전체 사용자 · 상품 · 신고 */
router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, balance, is_admin, status FROM users ORDER BY id').all();
  const products = db.prepare(
    `SELECT p.id, p.name, p.price, p.is_blocked, u.username AS seller
     FROM products p JOIN users u ON u.id = p.seller_id ORDER BY p.id DESC`
  ).all();
  const reports = db.prepare(
    `SELECT r.*, u.username AS reporter FROM reports r
     JOIN users u ON u.id = r.reporter_id ORDER BY r.id DESC`
  ).all();
  res.render('admin', { users, products, reports });
});

/* 사용자 휴면(정지) / 해제 */
router.post('/users/:id/suspend', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).render('error', { message: '존재하지 않는 사용자입니다.' });
  if (u.is_admin) return res.status(400).render('error', { message: '관리자 계정은 정지할 수 없습니다.' });
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(id);
  res.redirect('/admin');
});

router.post('/users/:id/activate', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  res.redirect('/admin');
});

/* 사용자 삭제 (관련 상품도 함께 정리) */
router.post('/users/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).render('error', { message: '존재하지 않는 사용자입니다.' });
  if (u.is_admin) return res.status(400).render('error', { message: '관리자 계정은 삭제할 수 없습니다.' });
  try {
    db.exec('BEGIN');
    // 외래키 제약 때문에 연관 데이터를 먼저 정리
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(id);
    db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(id);
    db.prepare("DELETE FROM reports WHERE target_type = 'user' AND target_id = ?").run(id);
    db.prepare('DELETE FROM transfers WHERE sender_id = ? OR receiver_id = ?').run(id, id);
    db.prepare('DELETE FROM products WHERE seller_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  res.redirect('/admin');
});

/* 상품 삭제 / 차단 해제 */
router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin');
});

router.post('/products/:id/unblock', (req, res) => {
  db.prepare('UPDATE products SET is_blocked = 0 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin');
});

/* 상품 ID 변경 (관리자) */
router.post('/products/:id/changeid', (req, res) => {
  const id = Number(req.params.id);
  const newId = Number(req.body.new_id);
  if (!Number.isInteger(newId) || newId <= 0) {
    return res.status(400).render('error', { message: '새 상품 ID는 1 이상의 정수여야 합니다.' });
  }
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).render('error', { message: '존재하지 않는 상품입니다.' });
  if (newId !== id && db.prepare('SELECT id FROM products WHERE id = ?').get(newId)) {
    return res.status(400).render('error', { message: '이미 사용 중인 상품 ID입니다.' });
  }
  try {
    db.exec('BEGIN');
    db.prepare('UPDATE products SET id = ? WHERE id = ?').run(newId, id);
    // 상품 신고 기록의 대상 ID도 함께 갱신
    db.prepare("UPDATE reports SET target_id = ? WHERE target_type = 'product' AND target_id = ?").run(newId, id);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  res.redirect('/admin');
});

/* 신고 처리 완료 */
router.post('/reports/:id/resolve', (req, res) => {
  db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(Number(req.params.id));
  res.redirect('/admin');
});

module.exports = router;
