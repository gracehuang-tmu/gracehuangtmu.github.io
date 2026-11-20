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
  if (!p.getProperty('ADMIN_KEY')) {
    p.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  }
  Logger.log('試算表網址：' + SpreadsheetApp.openById(p.getProperty('SHEET_ID')).getUrl());
  Logger.log('團主密碼：' + p.getProperty('ADMIN_KEY'));
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

  if (action === 'state') return out({ ok: true, config: getConfig(ss), orders: listOrders(ss) });
  if (action === 'adminCheck') return out({ ok: isAdmin });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === 'save') {
      const cfg = getConfig(ss);
      if (!cfg.open && !isAdmin) return out({ ok: false, error: 'closed' });
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
      ss.getSheetByName('config').getRange('A1').setValue(JSON.stringify(cfg));
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
  try { const c = JSON.parse(ss.getSheetByName('config').getRange('A1').getValue()); return { open: c.open !== false, note: clip(c.note, 80) }; }
  catch (e) { return { open: true, note: '' }; }
}
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
function findRow(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
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
