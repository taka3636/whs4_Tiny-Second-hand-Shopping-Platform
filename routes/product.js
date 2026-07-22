'use strict';
const express = require('express');
const { db } = require('../db');
const { validators, requireLogin, csrfCheck } = require('../security');
const { uploadImage, removeImage } = require('../upload');

const router = express.Router();

/* 전체 상품 조회 + 검색 (+ 채팅). 목록은 이름만 노출 */
router.get('/products', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  let products;
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    products = db.prepare(
      `SELECT id, name, price, image FROM products
       WHERE is_blocked = 0 AND name LIKE ? ESCAPE '\\'
       ORDER BY id DESC`
    ).all(like);
  } else {
    products = db.prepare('SELECT id, name, price, image FROM products WHERE is_blocked = 0 ORDER BY id DESC').all();
  }
  res.render('products', { products, q });
});

/* 새 상품 등록 (이미지 업로드) */
router.get('/products/new', requireLogin, (req, res) => {
  res.render('product_new', { error: null, form: {} });
});

router.post('/products/new', requireLogin, uploadImage('image'), csrfCheck, (req, res) => {
  const { name, description, price } = req.body;
  const form = { name, description, price };
  const fail = (msg) => { if (req.file) removeImage(req.file.filename); return res.status(400).render('product_new', { error: msg, form }); };

  if (req.uploadError) return fail(req.uploadError);
  if (!validators.productName(name || '')) return fail('상품명은 1~60자여야 합니다.');
  if (!validators.productDesc(description || '')) return fail('상품설명은 1000자 이하여야 합니다.');
  if (!validators.price(price)) return fail('가격은 0 이상의 정수여야 합니다.');

  const image = req.file ? req.file.filename : '';
  const info = db.prepare(
    'INSERT INTO products (name, description, price, seller_id, image) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), (description || '').trim(), Number(price), req.session.user.id, image);
  res.redirect('/products/' + info.lastInsertRowid);
});

/* 내가 등록한 상품 관리 */
router.get('/my/products', requireLogin, (req, res) => {
  const products = db.prepare('SELECT id, name, price, image, is_blocked FROM products WHERE seller_id = ? ORDER BY id DESC')
    .all(req.session.user.id);
  res.render('my_products', { products });
});

/* 상품 수정 (소유자 또는 관리자) */
router.get('/products/:id/edit', requireLogin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) return res.status(404).render('error', { message: '존재하지 않는 상품입니다.' });
  const me = req.session.user;
  if (product.seller_id !== me.id && !me.is_admin) {
    return res.status(403).render('error', { message: '본인 상품만 수정할 수 있습니다.' });
  }
  res.render('product_edit', { error: null, product });
});

router.post('/products/:id/edit', requireLogin, uploadImage('image'), csrfCheck, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) return res.status(404).render('error', { message: '존재하지 않는 상품입니다.' });
  const me = req.session.user;
  if (product.seller_id !== me.id && !me.is_admin) {
    return res.status(403).render('error', { message: '본인 상품만 수정할 수 있습니다.' });
  }
  const { name, description, price, remove_image } = req.body;
  const fail = (msg) => { if (req.file) removeImage(req.file.filename); return res.status(400).render('product_edit', { error: msg, product: { ...product, name, description, price } }); };

  if (req.uploadError) return fail(req.uploadError);
  if (!validators.productName(name || '')) return fail('상품명은 1~60자여야 합니다.');
  if (!validators.productDesc(description || '')) return fail('상품설명은 1000자 이하여야 합니다.');
  if (!validators.price(price)) return fail('가격은 0 이상의 정수여야 합니다.');

  let image = product.image;
  if (req.file) { removeImage(product.image); image = req.file.filename; }       // 새 이미지 교체
  else if (remove_image === '1') { removeImage(product.image); image = ''; }       // 이미지 삭제

  db.prepare('UPDATE products SET name = ?, description = ?, price = ?, image = ? WHERE id = ?')
    .run(name.trim(), (description || '').trim(), Number(price), image, product.id);
  res.redirect('/products/' + product.id);
});

/* 상품 상세 조회 */
router.get('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).render('error', { message: '잘못된 상품입니다.' });
  const product = db.prepare(
    `SELECT p.*, u.display_name AS seller_name, u.username AS seller_username, u.is_admin AS seller_is_admin
     FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id = ?`
  ).get(id);
  if (!product || product.is_blocked) {
    return res.status(404).render('error', { message: '존재하지 않거나 차단된 상품입니다.' });
  }
  res.render('product_detail', { product });
});

/* 상품 삭제 (소유자 또는 관리자) */
router.post('/products/:id/delete', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).render('error', { message: '존재하지 않는 상품입니다.' });
  const me = req.session.user;
  if (product.seller_id !== me.id && !me.is_admin) {
    return res.status(403).render('error', { message: '본인 상품만 삭제할 수 있습니다.' });
  }
  removeImage(product.image);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.redirect('/my/products');
});

module.exports = router;
