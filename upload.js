'use strict';
/** 상품 이미지 업로드 (jpg/png만 허용) */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');

const UP_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.jpeg') ext = '.jpg';
    // 파일명은 서버에서 무작위 생성 (경로 조작·덮어쓰기 방지)
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

// 확장자 + MIME 이중 검사 → jpg/png만 통과
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const okJpg = file.mimetype === 'image/jpeg' && (ext === '.jpg' || ext === '.jpeg');
  const okPng = file.mimetype === 'image/png' && ext === '.png';
  if (okJpg || okPng) return cb(null, true);
  const err = new Error('INVALID_IMAGE_TYPE');
  err.code = 'INVALID_IMAGE_TYPE';
  cb(err);
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }, // 3MB
});

// 업로드 오류를 폼 에러 메시지로 변환하는 래퍼
function uploadImage(field) {
  return (req, res, next) => {
    multerUpload.single(field)(req, res, (err) => {
      if (err) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE'
          ? '이미지는 3MB 이하만 업로드할 수 있습니다.'
          : '이미지는 jpg 또는 png 형식만 업로드할 수 있습니다.';
      }
      next();
    });
  };
}

function removeImage(filename) {
  if (!filename) return;
  fs.unlink(path.join(UP_DIR, filename), () => {});
}

module.exports = { uploadImage, removeImage, UP_DIR };
