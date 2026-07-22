'use strict';
/**
 * 회원가입 보안문자.
 * - 기본: 서버가 SVG로 그리는 이미지 보안문자 (외부 서비스/키 불필요 → 누구나 바로 사용).
 * - RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET 환경변수가 있으면 구글 reCAPTCHA v2 로 자동 전환.
 */
const crypto = require('node:crypto');

const SITE = process.env.RECAPTCHA_SITE_KEY || '';
const SECRET = process.env.RECAPTCHA_SECRET || '';
const useRecaptcha = !!(SITE && SECRET);

// 혼동되는 글자(0,O,1,I,L 등) 제외
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(req) {
  let code = '';
  for (let i = 0; i < 5; i++) code += CHARS[crypto.randomInt(0, CHARS.length)];
  req.session.captchaAnswer = code;
  return code;
}
function ensureCode(req) {
  if (!req.session.captchaAnswer) newCode(req);
  return req.session.captchaAnswer;
}

// 코드 문자열을 뒤틀린 SVG 이미지로 렌더링
function renderSvg(code) {
  const W = 160, H = 54;
  const parts = [`<rect width="${W}" height="${H}" fill="#f2f0e9"/>`];
  for (let i = 0; i < 4; i++) {
    parts.push(`<line x1="${crypto.randomInt(0, W)}" y1="${crypto.randomInt(0, H)}" x2="${crypto.randomInt(0, W)}" y2="${crypto.randomInt(0, H)}" stroke="#b9c6da" stroke-width="1"/>`);
  }
  for (let i = 0; i < 26; i++) {
    parts.push(`<circle cx="${crypto.randomInt(0, W)}" cy="${crypto.randomInt(0, H)}" r="1" fill="#c9cfd8"/>`);
  }
  const colors = ['#123f7f', '#1b52a4', '#3f5d86', '#2f3b30'];
  for (let i = 0; i < code.length; i++) {
    const x = 20 + i * 28 + crypto.randomInt(-3, 4);
    const y = 37 + crypto.randomInt(-4, 5);
    const rot = crypto.randomInt(-26, 27);
    const col = colors[crypto.randomInt(0, colors.length)];
    parts.push(`<text x="${x}" y="${y}" font-size="30" font-family="Georgia, serif" font-weight="700" fill="${col}" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

// 템플릿에 보안문자 정보 노출.
// 이미지 캡차의 경우 코드를 요청 단계에서 미리 세션에 확정해 두어,
// 페이지 내 여러 이미지가 동시에 /captcha.svg 를 요청할 때 코드가 어긋나는 것을 방지한다.
function attachCaptcha(req, res, next) {
  if (!useRecaptcha && req.session) ensureCode(req);
  res.locals.captcha = { useRecaptcha, site: SITE };
  next();
}

// 제출된 보안문자 검증
async function verifyCaptcha(req) {
  if (useRecaptcha) {
    const token = req.body['g-recaptcha-response'];
    if (!token) return false;
    try {
      const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: SECRET, response: token }),
      });
      const j = await r.json();
      return !!j.success;
    } catch (_) { return false; }
  }
  const ans = String(req.body.captcha || '').trim().toUpperCase();
  return !!req.session.captchaAnswer && ans === req.session.captchaAnswer;
}

function resetCaptcha(req) { delete req.session.captchaAnswer; }

module.exports = { useRecaptcha, attachCaptcha, verifyCaptcha, resetCaptcha, ensureCode, newCode, renderSvg };
