'use strict';
/**
 * 시큐어 코딩 공통 유틸: 입력값 검증, CSRF 토큰, 접근 제어 미들웨어
 */
const crypto = require('node:crypto');

/* ---------------- 입력값 검증 ---------------- */
const RE_USERNAME = /^[a-zA-Z0-9_]{3,20}$/;          // 아이디: 영문/숫자/_ 3~20
const RE_DISPLAY = /^[\S ]{1,20}$/;                   // 계정명: 1~20

const validators = {
  username: (v) => typeof v === 'string' && RE_USERNAME.test(v),
  password: (v) => typeof v === 'string' && v.length >= 8 && v.length <= 100,
  displayName: (v) => typeof v === 'string' && RE_DISPLAY.test(v.trim()) && v.trim().length >= 1,
  bio: (v) => typeof v === 'string' && v.length <= 300,
  productName: (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60,
  productDesc: (v) => typeof v === 'string' && v.length <= 1000,
  // 가격: 0 이상 정수, 1억 이하
  price: (v) => /^\d{1,9}$/.test(String(v)) && Number(v) >= 0 && Number(v) <= 100000000,
  amount: (v) => /^\d{1,9}$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 100000000,
  reason: (v) => typeof v === 'string' && v.trim().length >= 5 && v.trim().length <= 300,
  reportType: (v) => v === 'user' || v === 'product',
  message: (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 500,
};

/* ---------------- CSRF ---------------- */
function ensureCsrf(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

// 모든 요청에 csrf 토큰을 템플릿 변수로 노출
function csrfLocals(req, res, next) {
  res.locals.csrfToken = ensureCsrf(req);
  res.locals.currentUser = req.session.user || null;
  next();
}

function tokenMatches(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  return !!sent && sent === req.session.csrfToken;
}

// 상태 변경(POST 등) 요청에 대해 CSRF 검증
function verifyCsrf(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // multipart(파일 업로드)는 본문이 아직 파싱 전이므로 라우트에서 csrfCheck 로 검증
    if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
    if (!tokenMatches(req)) {
      return res.status(403).render('error', { message: '잘못된 요청입니다 (CSRF 토큰 불일치).' });
    }
  }
  next();
}

// 멀티파트 파싱(multer) 이후 라우트에서 직접 호출하는 CSRF 검증 미들웨어
function csrfCheck(req, res, next) {
  if (!tokenMatches(req)) {
    return res.status(403).render('error', { message: '잘못된 요청입니다 (CSRF 토큰 불일치).' });
  }
  next();
}

/* ---------------- 접근 제어 ---------------- */
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!req.session.user.is_admin) {
    return res.status(403).render('error', { message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

/* HTML 이스케이프 (클라이언트로 내려보내는 텍스트 방어용) */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  validators, ensureCsrf, csrfLocals, verifyCsrf, csrfCheck,
  requireLogin, requireAdmin, escapeHtml,
};
