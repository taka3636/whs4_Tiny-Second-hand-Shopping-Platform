'use strict';
/**
 * Tiny Second-hand Shopping Platform — 메인 서버
 * 실행: node --experimental-sqlite server.js   (또는 npm start)
 */
require('dotenv').config(); // .env 파일의 환경변수 로드 (reCAPTCHA 키 등)
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const { seed } = require('./db');
const { csrfLocals, verifyCsrf } = require('./security');
const { attachCaptcha } = require('./captcha');
const { initChat } = require('./chat');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/product');
const userRoutes = require('./routes/user');
const transferRoutes = require('./routes/transfer');
const reportRoutes = require('./routes/report');
const adminRoutes = require('./routes/admin');
const { router: chatbotRoutes } = require('./routes/chatbot');

// 최초 실행 시 스키마 + 관리자 계정 시드
seed();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// 세션 (HttpOnly, SameSite=Lax). HTTPS 배포 시 secure:true 로 변경 권장.
const sessionMiddleware = session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 6 },
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(csrfLocals);   // csrfToken, currentUser 를 템플릿에 노출
app.use(attachCaptcha); // 회원가입 보안문자 정보 노출
app.use(verifyCsrf);   // 상태변경 요청 CSRF 검증

// 라우트
app.use('/', authRoutes);
app.use('/', productRoutes);
app.use('/', userRoutes);
app.use('/', transferRoutes);
app.use('/', reportRoutes);
app.use('/', chatbotRoutes);
app.use('/admin', adminRoutes);

// 홈
app.get('/', (req, res) => res.render('index'));

// 404
app.use((req, res) => res.status(404).render('error', { message: '페이지를 찾을 수 없습니다.' }));

// 에러 핸들러 (내부 정보 노출 방지)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: '서버 오류가 발생했습니다.' });
});

// 실시간 채팅
initChat(io);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`서버 실행: http://localhost:${PORT}`));
}

module.exports = { app, server, io };
