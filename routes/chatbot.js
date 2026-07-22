'use strict';
/** 규칙기반 상담 챗봇 (외부 LLM/키 불필요) */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, legacyHeaders: false, standardHeaders: true });

function answer(msg) {
  const m = String(msg || '').toLowerCase();
  const has = (...ws) => ws.some((w) => m.includes(w));

  if (has('안녕', '하이', 'hello', 'hi', '반가')) return '안녕하세요! Blue Market 상담 봇이에요. 가입, 상품 등록, 검색, 송금, 신고, 채팅 등 무엇이든 물어보세요.';
  if (has('회원가입', '가입', 'register', '보안문자')) return '회원가입은 상단 "회원가입"에서 아이디(영문/숫자/_ 3~20자)·계정명·비밀번호(8자 이상)를 입력하고 보안문자를 맞히면 완료돼요.';
  if (has('로그인', 'login')) return '로그인은 상단 "로그인"에서 아이디와 비밀번호로 하실 수 있어요.';
  if (has('비밀번호', 'password', '비번')) return '비밀번호는 마이페이지 > 비밀번호 변경에서 현재 비밀번호 확인 후 바꿀 수 있어요.';
  if (has('아이디', '계정명', '닉네임')) return '아이디(로그인 ID)와 계정명(표시 이름)은 마이페이지에서 수정할 수 있고, 변경한 아이디로 바로 로그인됩니다.';
  if (has('상품 등록', '판매', '올리', '등록', '팔')) return '상품 등록은 상단 "판매하기"에서 상품명·설명·가격과 이미지를 올리면 돼요. 등록한 상품은 "내 상품"에서 수정·삭제할 수 있어요.';
  if (has('이미지', '사진', '업로드', 'jpg', 'png')) return '상품 이미지는 jpg 또는 png 형식만, 3MB 이하로 업로드할 수 있어요.';
  if (has('검색', '찾')) return '상품 검색은 상품 페이지 상단 검색창에 상품명을 입력하면 됩니다. 비회원도 검색할 수 있어요.';
  if (has('송금', '충전', '지갑', '결제', '구매', '이체', '돈', '금액')) return '지갑에서 잔액을 충전하고 다른 사용자에게 송금할 수 있어요. 상품 상세의 "구매하기"로 판매자에게 바로 송금되며, 잔액이 부족하면 송금이 거부됩니다. 거래 내역도 지갑에서 확인돼요.';
  if (has('신고', '차단', '휴면', '악성', '불량')) return '상품·사용자 신고는 신고 페이지에서 사유와 함께 접수해요. 누적 신고가 기준을 넘으면 상품은 자동 차단, 사용자는 자동 휴면 처리됩니다.';
  if (has('채팅', '쪽지', '대화', '메시지', 'dm')) return '전체 채팅은 홈 화면 하단에서, 1:1 채팅은 상대 프로필이나 상품 상세에서 시작할 수 있고 "쪽지함"에서 대화 목록을 볼 수 있어요.';
  if (has('관리자', 'admin')) return '관리자 기능은 관리자 계정만 사용할 수 있어요. 일반 문의는 신고 페이지나 이 상담 봇을 이용해 주세요.';
  if (has('고마', '감사', 'thank', '땡큐')) return '도움이 되었다니 기뻐요! 또 궁금한 점이 있으면 언제든 물어보세요.';
  return '죄송해요, 정확히 이해하지 못했어요. 가입 · 로그인 · 상품 등록 · 검색 · 송금 · 신고 · 채팅 중 어떤 것이 궁금하신가요?';
}

router.post('/chatbot', limiter, (req, res) => {
  const message = req.body && req.body.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 500) {
    return res.status(400).json({ reply: '메시지를 확인해 주세요. (1~500자)' });
  }
  res.json({ reply: answer(message) });
});

module.exports = { router, answer };
