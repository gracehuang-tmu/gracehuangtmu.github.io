/**
 * 飲料團購點餐：Google Apps Script 後端
 * 1. 到 https://script.google.com 建立新專案，把這整份貼上。
 * 2. 上方選單選函式 setup，按「執行」，依提示授權。
 *    執行紀錄會顯示「試算表網址」與「團主密碼」。
 * 3. 右上「部署」→「新增部署作業」→ 類型「網頁應用程式」
 *    執行身分：我；誰可以存取：所有人 → 部署，複製網址。
 * 這份檔案沒有任何密碼，團主密碼存在指令碼屬性中。
 */

const MAX_ITEMS = 30;
const SITE_URL = 'https://gracehuang-lab.com/drink/';

function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('飲料團購訂單');
    const sh = ss.getSheets()[0];
    sh.setName('orders');
    sh.appendRow(['訂單ID', '姓名', '明細', '杯數', '金額', '更新時間', 'items_json', 'token_hash']);
    sh.setFrozenRows(1);
    sh.hideColumns(7, 2);
    ss.insertSheet('config').getRange('A1').setValue(JSON.stringify({ open: true, note: '' }));
    p.setProperty('SHEET_ID', ss.getId());
  }
  const ss2 = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  if (!ss2.getSheetByName('menus')) { const m = ss2.insertSheet('menus'); m.appendRow(['商家', 'menu_json', '更新時間', 'image_ids']); m.setFrozenRows(1); }
  if (!p.getProperty('ADMIN_KEY')) {
    p.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  }
  imageFolder();
  Logger.log('試算表網址：' + SpreadsheetApp.openById(p.getProperty('SHEET_ID')).getUrl());
  Logger.log('團主密碼：' + p.getProperty('ADMIN_KEY'));
  Logger.log('團主邀請連結（私訊給團主，點開即登入）：' + SITE_URL + '#key=' + p.getProperty('ADMIN_KEY'));
}

function doGet() {
  return out({ ok: true, msg: 'drink order api' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad_json' }); }
  const p = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  const isAdmin = typeof req.key === 'string' && req.key.length > 0 && req.key === p.getProperty('ADMIN_KEY');
  const action = String(req.action || '');

  if (action === 'state') {
    const cfg = getConfig(ss);
    const info = cfg.shop ? getShop(ss, cfg.shop) : null;
    return out({ ok: true, now: Date.now(), config: cfg, orders: listOrders(ss), shops: listShops(ss), menu: info ? info.menu : null, images: info ? info.images : [] });
  }
  if (action === 'getShop') return out({ ok: true, shop: getShop(ss, clip(req.shop, 30)) });
  if (action === 'image') {
    // 只回傳登記在菜單表裡的圖片，避免讀到雲端硬碟其他檔案
    const id = String(req.id || '');
    if (!/^[\w-]{10,100}$/.test(id) || allImageIds(ss).indexOf(id) < 0) return out({ ok: false, error: 'not_found' });
    const blob = DriveApp.getFileById(id).getBlob();
    return out({ ok: true, data: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) });
  }
  if (action === 'adminCheck') return out({ ok: isAdmin });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === 'save') {
      const cfg = getConfig(ss);
      if (!isOpenNow(cfg) && !isAdmin) return out({ ok: false, error: Date.now() < (cfg.openAt || 0) ? 'not_yet' : 'closed' });
      const id = String(req.id || '');
      const token = String(req.token || '');
      if (!/^[a-z0-9]{8,32}$/.test(id) || token.length < 16 || token.length > 64) return out({ ok: false, error: 'bad_id' });
      const sh = ss.getSheetByName('orders');
      const row = findRow(sh, id);
      const hash = sha(token);
      if (row && sh.getRange(row, 8).getValue() !== hash && !isAdmin) return out({ ok: false, error: 'forbidden' });
      const items = cleanItems(req.items);
      if (!items.length) { if (row) sh.deleteRow(row); return out({ ok: true }); }
      const name = clip(req.name, 20) || '（未具名）';
      const cups = items.reduce((a, x) => a + x.qty, 0);
      const total = items.reduce((a, x) => a + x.qty * x.unit, 0);
      const desc = items.map(x => x.name + ' ×' + x.qty + ' ' + spec(x) + (x.note ? '｜' + x.note : '')).join('\n');
      const vals = [id, safe(name), safe(desc), cups, total, new Date(), JSON.stringify(items), row ? sh.getRange(row, 8).getValue() : hash];
      if (row) sh.getRange(row, 1, 1, 8).setValues([vals]); else sh.appendRow(vals);
      return out({ ok: true });
    }
    if (!isAdmin) return out({ ok: false, error: 'not_admin' });
    if (action === 'config') {
      const cfg = getConfig(ss);
      if (typeof req.open === 'boolean') cfg.open = req.open;
      if (req.note !== undefined) cfg.note = clip(req.note, 80);
      if (req.shop !== undefined) cfg.shop = clip(req.shop, 30);
      if (req.openAt !== undefined) cfg.openAt = toTime(req.openAt);
      if (req.closeAt !== undefined) cfg.closeAt = toTime(req.closeAt);
      if (cfg.openAt && cfg.closeAt && cfg.closeAt <= cfg.openAt) return out({ ok: false, error: 'bad_time' });
      ss.getSheetByName('config').getRange('A1').setValue(JSON.stringify(cfg));
      return out({ ok: true });
    }
    if (action === 'saveMenu') {
      const shop = clip(req.shop, 30);
      const menu = req.menu && Array.isArray(req.menu.categories) ? req.menu : { categories: [] };
      const json = JSON.stringify(menu);
      if (!shop || json.length > 45000) return out({ ok: false, error: 'bad_menu' });
      const sh = menuSheet(ss);
      const row = findRow(sh, shop);
      const old = row ? parseIds(sh.getRange(row, 4).getValue()) : [];
      const keep = Array.isArray(req.keepImages) ? req.keepImages.map(String).filter(id => old.indexOf(id) >= 0) : [];
      const uploads = Array.isArray(req.newImages) ? req.newImages.slice(0, 6 - keep.length) : [];
      const added = [];
      for (const d of uploads) {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(d));
        if (!m || m[2].length > 3500000) return out({ ok: false, error: 'bad_image' });
        const f = imageFolder().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], shop + '-' + Date.now() + '.jpg'));
        added.push(f.getId());
      }
      old.filter(id => keep.indexOf(id) < 0).forEach(trashFile);
      const ids = keep.concat(added);
      const vals = [safe(shop), json, new Date(), JSON.stringify(ids)];
      if (row) sh.getRange(row, 1, 1, 4).setValues([vals]); else sh.appendRow(vals);
      return out({ ok: true, images: ids });
    }
    if (action === 'deleteMenu') {
      const sh = menuSheet(ss);
      const row = findRow(sh, clip(req.shop, 30));
      if (row) { parseIds(sh.getRange(row, 4).getValue()).forEach(trashFile); sh.deleteRow(row); }
      return out({ ok: true });
    }
    if (action === 'delete') {
      const sh = ss.getSheetByName('orders');
      const row = findRow(sh, String(req.id || ''));
      if (row) sh.deleteRow(row);
      return out({ ok: true });
    }
    if (action === 'clear') {
      const sh = ss.getSheetByName('orders');
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
      return out({ ok: true });
    }
    return out({ ok: false, error: 'unknown_action' });
  } finally {
    lock.releaseLock();
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function getConfig(ss) {
  try { const c = JSON.parse(ss.getSheetByName('config').getRange('A1').getValue()); return { open: c.open !== false, note: clip(c.note, 80), shop: clip(c.shop, 30), openAt: toTime(c.openAt), closeAt: toTime(c.closeAt) }; }
  catch (e) { return { open: true, note: '', shop: '', openAt: null, closeAt: null }; }
}
// 開放條件：團主未手動關閉，且現在介於開放時間與截團時間之間（未設定的那一端不限制）
function isOpenNow(cfg) {
  const now = Date.now();
  return cfg.open && (!cfg.openAt || now >= cfg.openAt) && (!cfg.closeAt || now < cfg.closeAt);
}
function toTime(v) { const n = Math.round(Number(v)); return n > 1.5e12 && n < 4e12 ? n : null; }
function listOrders(ss) {
  const sh = ss.getSheetByName('orders');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 7).getValues().map(r => {
    let items = [];
    try { items = JSON.parse(r[6]); } catch (e) {}
    return { id: String(r[0]), name: String(r[1]).replace(/^'/, ''), items: items, updatedAt: r[5] };
  });
}
function menuSheet(ss) {
  let m = ss.getSheetByName('menus');
  if (!m) { m = ss.insertSheet('menus'); m.appendRow(['商家', 'menu_json', '更新時間', 'image_ids']); m.setFrozenRows(1); }
  return m;
}
function listShops(ss) {
  const sh = menuSheet(ss), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0]).replace(/^'/, '')).filter(String);
}
function getShop(ss, shop) {
  if (!shop) return null;
  const sh = menuSheet(ss), row = findRow(sh, shop);
  if (!row) return null;
  const v = sh.getRange(row, 1, 1, 4).getValues()[0];
  let menu = null; try { menu = JSON.parse(v[1]); } catch (e) {}
  return { name: shop, menu: menu, images: parseIds(v[3]) };
}
function parseIds(v) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
function allImageIds(ss) {
  const sh = menuSheet(ss), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return [].concat.apply([], sh.getRange(2, 4, n, 1).getValues().map(r => parseIds(r[0])));
}
function imageFolder() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('飲料團購菜單照片');
  p.setProperty('FOLDER_ID', f.getId());
  return f;
}
function trashFile(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
function findRow(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).replace(/^'/, '') === id.replace(/^'/, '')) return i + 2;
  return 0;
}
function clip(v, n) { return (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, n) : ''; }
function safe(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function sha(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function spec(x) { return [x.variant, x.size === '單一' ? '' : x.size, x.ice, x.sugar, x.tops.length ? '加' + x.tops.join('、') : ''].filter(String).join('／'); }
function cleanItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_ITEMS).filter(x => x && typeof x.name === 'string').map(x => ({
    k: clip(x.k, 20), cat: clip(x.cat, 20), name: clip(x.name, 40), size: clip(x.size, 16), variant: clip(x.variant, 16),
    ice: clip(x.ice, 8), sugar: clip(x.sugar, 8),
    tops: Array.isArray(x.tops) ? x.tops.map(t => clip(t, 16)).filter(String).slice(0, 10) : [],
    qty: Math.max(1, Math.min(20, Math.round(Number(x.qty)) || 1)),
    note: clip(x.note, 40),
    unit: Math.max(0, Math.min(9999, Math.round(Number(x.unit)) || 0))
  })).filter(x => x.name);
}
