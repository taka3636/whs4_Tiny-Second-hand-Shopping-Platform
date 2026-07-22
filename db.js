'use strict';
/**
 * DB 초기화 (node:sqlite 내장 모듈 사용)
 * 실행 시 반드시 --experimental-sqlite 플래그 필요.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'market.db');
const db = new DatabaseSync(DB_PATH);

// 외래키 활성화
db.exec('PRAGMA foreign_keys = ON;');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,          -- 사용자 아이디 (로그인용)
      display_name  TEXT    NOT NULL,                 -- 사용자 계정명
      password_hash TEXT    NOT NULL,                 -- 비밀번호(해시)
      bio           TEXT    NOT NULL DEFAULT '',      -- 소개글
      balance       INTEGER NOT NULL DEFAULT 0,       -- 지갑 잔액
      is_admin      INTEGER NOT NULL DEFAULT 0,       -- 관리자 여부
      status        TEXT    NOT NULL DEFAULT 'active',-- active | suspended(휴면)
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,                  -- 상품명
      description  TEXT    NOT NULL DEFAULT '',       -- 상품설명
      price        INTEGER NOT NULL,                  -- 가격
      seller_id    INTEGER NOT NULL,                  -- 판매자 아이디
      image        TEXT    NOT NULL DEFAULT '',        -- 상품 이미지 파일명
      is_blocked   INTEGER NOT NULL DEFAULT 0,        -- 신고 누적 차단 여부
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id  INTEGER NOT NULL,                  -- 신고자 아이디
      target_type  TEXT    NOT NULL,                  -- 'user' | 'product'
      target_id    INTEGER NOT NULL,                  -- 타겟 아이디
      reason       TEXT    NOT NULL,                  -- 신고 사유
      status       TEXT    NOT NULL DEFAULT 'open',   -- open | resolved
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id    INTEGER NOT NULL,                  -- 보낸 사람
      receiver_id  INTEGER NOT NULL,                  -- 받는 사람
      amount       INTEGER NOT NULL,                  -- 금액
      memo         TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      room         TEXT    NOT NULL,                  -- 'global' 또는 'dm:<min>:<max>'
      sender_id    INTEGER NOT NULL,
      content      TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
  `);

  // 기존 DB 마이그레이션: products.image 컬럼이 없으면 추가
  try { db.exec("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''"); } catch (_) {}
}

/** 관리자 계정 등 초기 데이터 시드 */
function seed() {
  init();
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'Admin!2345';
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!exists) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare(
      `INSERT INTO users (username, display_name, password_hash, bio, balance, is_admin)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run(adminUser, '관리자', hash, '플랫폼 관리자 계정', 0);
    console.log(`[seed] 관리자 계정 생성: ${adminUser} / ${adminPass}`);
  } else {
    console.log('[seed] 관리자 계정이 이미 존재합니다.');
  }
}

init();

module.exports = { db, init, seed, DB_PATH };

// `node --experimental-sqlite db.js --seed` 로 직접 실행 시 시드
if (require.main === module && process.argv.includes('--seed')) {
  seed();
}
