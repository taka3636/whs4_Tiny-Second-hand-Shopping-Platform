'use strict';
/** 실시간 채팅: 전체 채팅 + 1:1 개인 채팅 (Socket.IO) */
const { db } = require('./db');
const { validators } = require('./security');

function dmRoom(a, b) {
  const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n);
  return `dm:${x}:${y}`;
}

function recentMessages(room, limit = 50) {
  const rows = db.prepare(
    `SELECT m.content, m.created_at, u.id AS sender_id, u.display_name AS sender_name
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.room = ? ORDER BY m.id DESC LIMIT ?`
  ).all(room, limit);
  return rows.reverse();
}

function initChat(io) {
  io.on('connection', (socket) => {
    const sess = socket.request.session;
    const user = sess && sess.user;

    // 전체 채팅방 입장 + 최근 기록 전송
    socket.join('global');
    socket.emit('global:history', recentMessages('global'));

    const lastSent = { t: 0 };
    function floodOk() {
      const now = Date.now();
      if (now - lastSent.t < 300) return false; // 초당 3건 제한
      lastSent.t = now;
      return true;
    }

    // 전체 채팅 메시지
    socket.on('global:send', (payload) => {
      if (!user) return socket.emit('chat:error', '로그인이 필요합니다.');
      const content = payload && payload.content;
      if (!validators.message(content) || !floodOk()) return;
      db.prepare('INSERT INTO messages (room, sender_id, content) VALUES (?, ?, ?)')
        .run('global', user.id, content.trim());
      io.to('global').emit('global:message', {
        sender_id: user.id, sender_name: user.display_name,
        content: content.trim(), created_at: new Date().toISOString(),
      });
    });

    // 1:1 채팅 입장
    socket.on('dm:join', (payload) => {
      if (!user) return socket.emit('chat:error', '로그인이 필요합니다.');
      const other = Number(payload && payload.userId);
      if (!Number.isInteger(other) || other === user.id) return;
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(other);
      if (!target) return socket.emit('chat:error', '상대방을 찾을 수 없습니다.');
      const room = dmRoom(user.id, other);
      socket.join(room);
      socket.emit('dm:history', { room, messages: recentMessages(room) });
    });

    // 1:1 채팅 메시지
    socket.on('dm:send', (payload) => {
      if (!user) return socket.emit('chat:error', '로그인이 필요합니다.');
      const other = Number(payload && payload.userId);
      const content = payload && payload.content;
      if (!Number.isInteger(other) || other === user.id) return;
      if (!validators.message(content) || !floodOk()) return;
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(other);
      if (!target) return;
      const room = dmRoom(user.id, other);
      socket.join(room);
      db.prepare('INSERT INTO messages (room, sender_id, content) VALUES (?, ?, ?)')
        .run(room, user.id, content.trim());
      io.to(room).emit('dm:message', {
        room, sender_id: user.id, sender_name: user.display_name,
        content: content.trim(), created_at: new Date().toISOString(),
      });
    });
  });
}

module.exports = { initChat, dmRoom };
