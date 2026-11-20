// 飲料團購點餐：前端（GitHub Pages）＋ Google Apps Script 後端
const API = (window.ORDER_API || '').trim();
const DEF_ICE = ['正常冰', '少冰', '微冰', '去冰', '溫', '熱'];
const DEF_SUGAR = ['正常糖', '少糖', '半糖', '微糖', '無糖'];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const str = (v, n) => (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, n) : '';
const pairs = (a, dl) => Array.isArray(a) ? a.filter(p => Array.isArray(p) && p.length >= 2).map(p => [str(p[0], 16) || dl, Math.round(+p[1])]).filter(p => p[0] && p[1] > 0 && p[1] < 10000).slice(0, 8) : [];
const strs = (a, n, max) => Array.isArray(a) ? a.map(x => str(x, n)).filter(Boolean).slice(0, max) : [];

function normMenu(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.categories)) return null;
  const categories = m.categories.slice(0, 40).map(g => ({
    c: str(g?.c, 20) || '其他', sub: str(g?.sub, 40),
    items: (Array.isArray(g?.items) ? g.items : []).slice(0, 100).map(it => {
      const n = str(it?.n, 40), sizes = pairs(it?.sizes, '單一'), pv = pairs(it?.pv, '');
      if (!n || (!sizes.length && !pv.length)) return null;
      let months = null;
      if (Array.isArray(it.months) && it.months.length === 2) { const a = Math.round(+it.months[0]), b = Math.round(+it.months[1]); if (a >= 1 && a <= 12 && b >= 1 && b <= 12) months = [a, b]; }
      return { n, tag: str(it.tag, 20), months, sizes: pv.length ? [] : sizes, variants: strs(it.variants, 12, 8), pv };
    }).filter(Boolean)
  })).filter(g => g.items.length);
  if (!categories.length) return null;
  const ice = strs(m.ice, 8, 10), sugar = strs(m.sugar, 8, 10);
  return { shop: str(m.shop, 30), categories, ice: ice.length ? ice : DEF_ICE, sugar: sugar.length ? sugar : DEF_SUGAR, tops: pairs(m.tops, '').slice(0, 12) };
}

let MENU = { shop: '', categories: [], ice: DEF_ICE, sugar: DEF_SUGAR, tops: [] };
let open = true, cfgShop = '', cfgNote = '', manualOpen = true, openAt = null, closeAt = null, skew = 0, myItems = [], myNick = '', allOrders = [], adminKey = '';
let saving = Promise.resolve();

// 每位同事一組隨機 ID 與憑證，存在自己瀏覽器；只有本人能改自己的訂單
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } }
function rnd(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); }
let myId = ls('drink_id'); if (!/^[a-z0-9]{8,32}$/.test(myId || '')) { myId = rnd(16); ls('drink_id', myId); }
let myToken = ls('drink_token'); if (!myToken || myToken.length < 16) { myToken = rnd(32); ls('drink_token', myToken); }
adminKey = ls('drink_admin') || '';

async function api(action, payload = {}) {
  if (!API) throw new Error('no_api');
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, key: adminKey || undefined, ...payload }) });
  return r.json();
}

function setStatus(t, icon, cls) { const el = $('status'); el.className = 'status' + (cls ? ' ' + cls : ''); el.innerHTML = (icon ? `<span class="tt-icon">${icon}</span>` : '') + esc(t); el.title = t; }
function note(t) { const n = $('notice'); if (!t) { n.classList.add('hide'); return; } n.textContent = t; n.classList.remove('hide'); }
function inSeason(m) { if (!m) return true; const now = new Date().getMonth() + 1; const [a, b] = m; return a <= b ? (now >= a && now <= b) : (now >= a || now <= b); }
function priceLabel(it) {
  if (it.pv.length) return `$${Math.min(...it.pv.map(x => x[1]))}起`;
  if (it.sizes.length === 1) return (it.sizes[0][0] === '單一' ? '' : it.sizes[0][0] + ' ') + '$' + it.sizes[0][1];
  return it.sizes.map(x => `${x[0]} $${x[1]}`).join('／');
}

// ---------- 菜單 ----------
const shopName = () => cfgShop || MENU.shop;
function renderTitle() { const n = shopName(); $('title').textContent = n ? n + '・團購點餐' : '飲料團購點餐'; document.title = $('title').textContent; }
function renderMenu() {
  renderTitle();
  $('catnav').innerHTML = MENU.categories.map((g, i) => `<a href="#" data-c="${i}">${esc(g.c)}</a>`).join('');
  $('menu').innerHTML = MENU.categories.map((g, gi) => `<section class="cat" id="cat${gi}"><h2>${esc(g.c)}</h2>${g.sub ? `<p class="sub">${esc(g.sub)}</p>` : '<div style="height:8px"></div>'}` + g.items.map((it, ii) => {
    const off = !inSeason(it.months);
    return `<div class="item ${off ? 'off' : ''}" data-g="${gi}" data-i="${ii}" role="button" tabindex="${off ? -1 : 0}"><div><span class="n">${esc(it.n)}</span>${it.tag ? `<span class="tag">${esc(it.tag)}${off ? '・非供應期' : ''}</span>` : ''}</div><div class="p">${esc(priceLabel(it))}${off ? '' : '<span class="tt-icon">add_circle</span>'}</div></div>`;
  }).join('') + '</section>').join('');
  $('menuFoot').textContent = (MENU.tops.length ? '加料：' + MENU.tops.map(t => `${t[0]} +${t[1]}`).join('、') + '。' : '') + '菜單由圖片辨識，價格以店家為準。';
}
$('catnav').addEventListener('click', e => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); $('cat' + a.dataset.c)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('menu').addEventListener('click', e => { const el = e.target.closest('.item'); if (!el || el.classList.contains('off')) return; openSheet(+el.dataset.g, +el.dataset.i); });
$('menu').addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const el = e.target.closest('.item'); if (!el || el.classList.contains('off')) return; e.preventDefault(); openSheet(+el.dataset.g, +el.dataset.i); });

// ---------- 選項視窗 ----------
let sel = null;
function openSheet(gi, ii) {
  const g = MENU.categories[gi], it = g?.items[ii]; if (!it) return;
  const pick = (arr, want) => arr.includes(want) ? want : arr[Math.floor(arr.length / 2)] || arr[0];
  sel = { cat: g.c, name: it.n, sizes: it.sizes, pv: it.pv.length ? it.pv : null, v: it.variants.length ? it.variants : null,
    size: it.sizes.length ? it.sizes[it.sizes.length - 1][0] : null, variant: it.pv.length ? it.pv[0][0] : (it.variants[0] || null),
    ice: pick(MENU.ice, '少冰'), sugar: pick(MENU.sugar, '半糖'), tops: [], qty: 1, note: '' };
  drawSheet(); $('sheetBg').classList.add('show');
}
function unitPrice(s) {
  const base = s.pv ? (s.pv.find(x => x[0] === s.variant) || s.pv[0])[1] : (s.sizes.find(x => x[0] === s.size) || s.sizes[0])[1];
  return base + s.tops.reduce((a, t) => a + ((MENU.tops.find(x => x[0] === t) || [0, 0])[1]), 0);
}
function chips(key, opts, multi) {
  return `<div class="chips" data-k="${key}">` + opts.map(([v, lab]) => { const on = multi ? sel[key].includes(v) : sel[key] === v; return `<button data-v="${esc(v)}" class="${on ? 'on' : ''}">${esc(lab)}</button>`; }).join('') + '</div>';
}
function drawSheet() {
  const s = sel;
  $('sheet').innerHTML = `<h3>${esc(s.name)}</h3><div class="muted">${esc(s.cat)}</div>
  ${s.sizes.length > 1 ? `<div class="grp"><label class="t">尺寸</label>${chips('size', s.sizes.map(x => [x[0], `${x[0]} $${x[1]}`]))}</div>` : ''}
  ${s.pv ? `<div class="grp"><label class="t">口味</label>${chips('variant', s.pv.map(x => [x[0], `${x[0]} $${x[1]}`]))}</div>` : ''}
  ${s.v ? `<div class="grp"><label class="t">茶底／口味</label>${chips('variant', s.v.map(x => [x, x]))}</div>` : ''}
  ${MENU.ice.length ? `<div class="grp"><label class="t">冰塊</label>${chips('ice', MENU.ice.map(x => [x, x]))}</div>` : ''}
  ${MENU.sugar.length ? `<div class="grp"><label class="t">甜度</label>${chips('sugar', MENU.sugar.map(x => [x, x]))}</div>` : ''}
  ${MENU.tops.length ? `<div class="grp"><label class="t">加料（可複選）</label>${chips('tops', MENU.tops.map(x => [x[0], `${x[0]} +${x[1]}`]), true)}</div>` : ''}
  <div class="grp"><label class="t">備註</label><input id="sNote" maxlength="40" value="${esc(s.note)}" placeholder="選填"></div>
  <div class="grp"><label class="t">杯數</label><div class="qty"><button data-q="-1" aria-label="減少"><span class="tt-icon">remove</span></button><b>${s.qty}</b><button data-q="1" aria-label="增加"><span class="tt-icon">add</span></button></div></div>
  ${!open ? `<p class="muted" style="margin-top:16px">${phase() === 'notyet' ? '還沒到開放時間：' + esc(fmt(openAt)) : '已截團，無法再點餐。'}</p>` : ''}
  <div class="sheet-foot"><button class="btn ghost" id="sCancel">取消</button><button class="btn" id="sAdd" ${open ? '' : 'disabled'}>加入 $${unitPrice(s) * s.qty}</button></div>`;
}
$('sheet').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const ck = b.parentElement.dataset.k;
  if (ck) { sel.note = $('sNote').value; const v = b.dataset.v; if (ck === 'tops') sel.tops = sel.tops.includes(v) ? sel.tops.filter(x => x !== v) : [...sel.tops, v]; else sel[ck] = v; drawSheet(); return; }
  if (b.dataset.q) { sel.note = $('sNote').value; sel.qty = Math.max(1, Math.min(20, sel.qty + (+b.dataset.q))); drawSheet(); return; }
  if (b.id === 'sCancel') { $('sheetBg').classList.remove('show'); return; }
  if (b.id === 'sAdd') {
    if (!$('nick').value.trim()) { $('sheetBg').classList.remove('show'); note('請先在上方輸入你的名字'); $('nick').focus(); return; }
    sel.note = $('sNote').value.trim();
    const s = sel;
    myItems = [...myItems, { k: rnd(8), cat: s.cat, name: s.name, size: s.pv ? '' : s.size, variant: s.variant || '', ice: MENU.ice.length ? s.ice : '', sugar: MENU.sugar.length ? s.sugar : '', tops: s.tops, qty: s.qty, note: s.note, unit: unitPrice(s) }];
    $('sheetBg').classList.remove('show'); save(); renderMine();
  }
});
$('sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') $('sheetBg').classList.remove('show'); });

// ---------- 訂單呈現 ----------
const spec = x => [x.variant, x.size === '單一' ? '' : x.size, x.ice, x.sugar, Array.isArray(x.tops) && x.tops.length ? '加' + x.tops.join('、') : ''].filter(Boolean).map(String).join('／');
const itemsOf = d => Array.isArray(d?.items) ? d.items.filter(x => x && typeof x.name === 'string') : [];
const sumOf = arr => arr.reduce((a, x) => a + (+x.unit || 0) * (+x.qty || 0), 0);
const cupsOf = arr => arr.reduce((a, x) => a + (+x.qty || 0), 0);
let saveState = '', pending = 0;

function renderMine() {
  $('cbCount').textContent = cupsOf(myItems) + ' 杯'; $('cbSum').textContent = '$' + sumOf(myItems);
  $('mine').innerHTML = myItems.length
    ? myItems.map(x => `<div class="line"><div><div>${esc(x.name)} ×${+x.qty}</div><div class="d">${esc(spec(x))}${x.note ? '｜' + esc(x.note) : ''}</div></div><div class="amt">$${(+x.unit) * (+x.qty)}<br>${open ? `<button class="x" data-k="${esc(x.k)}">刪除</button>` : ''}</div></div>`).join('')
      + `<div class="tot"><span>${esc(myNick || '我')} 小計</span><span>$${sumOf(myItems)}</span></div><p class="muted ${saveState.startsWith('已送出') ? 'ok' : ''}" style="margin:16px 0 0">${esc(saveState)}</p>`
    : '<p class="muted empty">還沒點任何飲料，到「點餐」挑一杯吧。</p>';
}
$('mine').addEventListener('click', e => { const b = e.target.closest('.x'); if (!b) return; myItems = myItems.filter(x => x.k !== b.dataset.k); save(); renderMine(); });

function renderAll() {
  const people = allOrders.map(o => ({ id: str(o.id, 40), name: str(o.name, 20) || '（未具名）', items: itemsOf(o) })).filter(p => p.items.length);
  const m = new Map();
  people.forEach(p => p.items.forEach(x => { const key = x.name + '｜' + spec(x) + (x.note ? '｜' + x.note : ''); m.set(key, (m.get(key) || 0) + (+x.qty || 0)); }));
  const total = people.reduce((a, p) => a + sumOf(p.items), 0), cups = people.reduce((a, p) => a + cupsOf(p.items), 0);
  const lines = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant')).map(([k, q]) => `${k} ×${q}`);
  $('merged').textContent = lines.length ? (shopName() ? '【' + shopName() + '】\n' : '') + lines.join('\n') + `\n\n共 ${cups} 杯，總計 $${total}（${people.length} 人）` : '目前還沒有訂單';
  $('byPerson').innerHTML = people.length
    ? people.map(p => `<div class="line" style="display:block"><div class="row" style="justify-content:space-between"><b>${esc(p.name)}${p.id === myId ? '（我）' : ''}</b><span class="amt">$${sumOf(p.items)}${adminKey ? ` <button class="x" data-del="${esc(p.id)}">刪除</button>` : ''}</span></div>${p.items.map(x => `<div class="d">・${esc(x.name)} ×${+x.qty}　${esc(spec(x))}${x.note ? '｜' + esc(x.note) : ''}</div>`).join('')}</div>`).join('')
      + `<div class="tot"><span>合計 ${cups} 杯</span><span>$${total}</span></div>`
    : '<p class="muted empty">目前還沒有訂單</p>';
}
$('copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('merged').textContent); $('copyMsg').textContent = '已複製'; } catch { $('copyMsg').textContent = '無法自動複製，請長按上方文字選取'; } setTimeout(() => $('copyMsg').textContent = '', 2500); });

// ---------- 分頁 ----------
function show(v) { ['Menu', 'Mine', 'All'].forEach(n => { $('v' + n).classList.toggle('hide', n !== v); $('tab' + n).setAttribute('aria-selected', String(n === v)); }); $('cartbar').classList.toggle('hide', v !== 'Menu'); window.scrollTo(0, 0); if (v === 'All') refresh(); }
$('tabMenu').onclick = () => show('Menu'); $('tabMine').onclick = () => show('Mine'); $('tabAll').onclick = () => show('All'); $('cbGo').onclick = () => show('Mine');

// ---------- 儲存 ----------
let nickTimer = null;
$('nick').addEventListener('input', () => { myNick = $('nick').value.trim(); note(''); ls('nick', myNick); clearTimeout(nickTimer); nickTimer = setTimeout(() => { if (myItems.length) save(); }, 1000); });
function save() {
  ls('cart', JSON.stringify(myItems));
  if (!API) { saveState = '尚未連上後端，訂單只存在這台裝置。'; renderMine(); return; }
  saveState = '送出中…'; renderMine();
  const items = myItems.slice();
  pending++;
  saving = saving.then(async () => {
    try {
      const r = await api('save', { id: myId, token: myToken, name: myNick || $('nick').value.trim(), items });
      if (r.ok) { saveState = items.length ? '已送出，團主可在「全部彙整」看到，之後仍可修改。' : '已取消訂單。'; ls('submitted', items.length ? '1' : '0'); note(''); }
      else if (r.error === 'closed') { saveState = '已截團，這次修改沒有送出。'; }
      else if (r.error === 'not_yet') { saveState = '還沒到開放時間，這次沒有送出。'; }
      else if (r.error === 'forbidden') { saveState = '無法修改這筆訂單，請聯絡團主。'; }
      else saveState = '送出失敗，請稍後再試。';
    } catch { saveState = '連線失敗，請檢查網路後再改一次訂單。'; }
    pending--; renderMine(); refresh();
  });
}

// ---------- 讀取狀態 ----------
let refreshing = false;
function showNoteLine() {
  let el = $('noteLine');
  if (!el) { el = document.createElement('p'); el.id = 'noteLine'; el.className = 'note-line'; $('vMenu').prepend(el); }
  el.textContent = cfgNote ? '團主備註：' + cfgNote : ''; el.classList.toggle('hide', !cfgNote);
}
async function refresh() {
  if (!API || refreshing) return;
  refreshing = true;
  try {
    const r = await api('state');
    if (r.ok) {
      manualOpen = r.config?.open !== false; cfgNote = str(r.config?.note, 80); cfgShop = str(r.config?.shop, 30);
      openAt = +r.config?.openAt || null; closeAt = +r.config?.closeAt || null;
      if (+r.now) skew = +r.now - Date.now();
      recompute();
      allOrders = Array.isArray(r.orders) ? r.orders : [];
      const mine = allOrders.find(o => str(o.id, 40) === myId);
      if (!mine && !pending && myItems.length && ls('submitted') === '1') { myItems = []; ls('cart', '[]'); ls('submitted', '0'); saveState = ''; }
      if (mine && !myItems.length && !pending) { myItems = itemsOf(mine); if (!$('nick').value) { $('nick').value = str(mine.name, 20); myNick = $('nick').value; } }
      renderCfg(); renderAll(); renderMine();
    }
  } catch { setStatus('無法連線', 'cloud_off'); }
  refreshing = false;
}
$('refresh').onclick = refresh;
const nowS = () => Date.now() + skew;
function fmt(t) {
  const d = new Date(t), today = new Date(nowS());
  const hm = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === today.toDateString() ? '今天 ' + hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function left(ms) {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `剩 ${m} 分鐘`;
  const h = Math.floor(m / 60), r = m % 60;
  return h < 24 ? `剩 ${h} 小時${r ? ' ' + r + ' 分' : ''}` : `剩 ${Math.floor(h / 24)} 天`;
}
function phase() {
  const n = nowS();
  if (!manualOpen) return 'closed';
  if (openAt && n < openAt) return 'notyet';
  if (closeAt && n >= closeAt) return 'closed';
  return 'open';
}
function recompute() {
  const was = open; open = phase() === 'open';
  renderCfg();
  if (was !== open) { renderMine(); if ($('sheetBg').classList.contains('show')) drawSheet(); }
}
function renderDeadline() {
  let el = $('deadline');
  if (!el) { el = document.createElement('div'); el.id = 'deadline'; el.className = 'deadline'; $('vMenu').prepend(el); }
  const ph = phase(), n = nowS();
  let icon, main, sub = '';
  if (ph === 'notyet') { icon = 'schedule'; main = `${fmt(openAt)} 開放訂購`; sub = closeAt ? `截團：${fmt(closeAt)}` : ''; }
  else if (ph === 'closed') { icon = 'block'; main = '已截團'; sub = closeAt && n >= closeAt ? `截團時間：${fmt(closeAt)}` : '團主已暫停點餐'; }
  else if (closeAt) { icon = 'timer'; main = `${fmt(closeAt)} 截團`; sub = left(closeAt - n); }
  else { el.classList.add('hide'); return; }
  el.classList.remove('hide');
  el.innerHTML = `<span class="tt-icon">${icon}</span><div><b>${esc(main)}</b>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</div>`;
}
function toLocalInput(t) { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function fromLocalInput(v) { if (!v) return null; const t = new Date(v).getTime(); return isNaN(t) ? null : t; }
function renderCfg() {
  const ph = phase();
  if (ph === 'open') setStatus('點餐中', 'check_circle', 'open');
  else if (ph === 'notyet') setStatus('尚未開放', 'schedule');
  else setStatus('已截團', 'block');
  renderDeadline();
  renderTitle();
  if (document.activeElement !== $('cfgShop')) $('cfgShop').value = cfgShop;
  if (document.activeElement !== $('cfgOpenAt')) $('cfgOpenAt').value = toLocalInput(openAt);
  if (document.activeElement !== $('cfgCloseAt')) $('cfgCloseAt').value = toLocalInput(closeAt);
  showNoteLine();
  $('cfgToggle').textContent = manualOpen ? '暫停點餐' : '恢復點餐';
  if (document.activeElement !== $('cfgNote')) $('cfgNote').value = cfgNote;
}

// ---------- 團主 ----------
function renderAdmin() { const on = !!adminKey; $('adminBox').classList.toggle('hide', !on); $('loginBox').classList.toggle('hide', on); $('loginForm').classList.add('hide'); $('adminBtn').classList.toggle('on', on); renderAll(); }
$('adminBtn').onclick = () => { show('All'); if (adminKey) { $('adminBox').scrollIntoView({ block: 'start' }); } else { $('loginForm').classList.remove('hide'); $('loginForm').scrollIntoView({ block: 'center' }); $('adminKey').focus(); } };
$('loginLink').onclick = e => { e.preventDefault(); $('loginForm').classList.remove('hide'); $('adminKey').focus(); };
$('adminKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
$('loginBtn').onclick = async () => {
  const k = $('adminKey').value.trim(); if (!k) return;
  const prev = adminKey; adminKey = k;
  if (!API) { adminKey = prev; $('loginMsg').textContent = '後端尚未啟用，請先完成團主使用說明的「第一次設定」。'; return; }
  try { const r = await api('adminCheck'); if (r.ok) { ls('drink_admin', k); $('adminKey').value = ''; renderAdmin(); return; } adminKey = prev; $('loginMsg').textContent = '密碼錯誤'; return; } catch {}
  adminKey = prev; $('loginMsg').textContent = '無法連線，請稍後再試';
};
$('adminOut').onclick = () => { adminKey = ''; ls('drink_admin', null); renderAdmin(); };
async function adminDo(action, payload, msg) {
  try { const r = await api(action, payload); $('adminMsg').textContent = r.ok ? msg : (r.error === 'bad_time' ? '截團時間要晚於開放時間' : '操作失敗（' + (r.error || '') + '）'); } catch { $('adminMsg').textContent = '連線失敗'; }
  setTimeout(() => $('adminMsg').textContent = '', 3000); refresh();
}
$('cfgSave').onclick = () => {
  const oa = fromLocalInput($('cfgOpenAt').value), ca = fromLocalInput($('cfgCloseAt').value);
  if (oa && ca && ca <= oa) { $('adminMsg').textContent = '截團時間要晚於開放時間'; return; }
  adminDo('config', { shop: $('cfgShop').value.trim(), note: $('cfgNote').value.trim(), openAt: oa, closeAt: ca }, '已儲存');
};
$('cfgToggle').onclick = () => adminDo('config', { open: !manualOpen }, manualOpen ? '已暫停點餐' : '已恢復點餐');
$('cfgClear').onclick = () => $('clearConfirm').classList.remove('hide');
$('clearNo').onclick = () => $('clearConfirm').classList.add('hide');
$('clearYes').onclick = () => { $('clearConfirm').classList.add('hide'); adminDo('clear', {}, '已清空'); };
$('byPerson').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) adminDo('delete', { id: b.dataset.del }, '已刪除'); });

// ---------- 啟動 ----------
(async () => {
  $('nick').value = ls('nick') || ''; myNick = $('nick').value;
  try { const c = JSON.parse(ls('cart') || '[]'); myItems = itemsOf({ items: c }); } catch {}
  try { MENU = normMenu(await (await fetch('menu.json', { cache: 'no-cache' })).json()) || MENU; } catch { note('菜單載入失敗，請重新整理頁面。'); }
  renderMenu(); renderMine(); renderAll(); renderAdmin();
  if (!API) {
    setStatus('尚未開放', 'schedule');
    const n = $('notice'); n.classList.remove('hide');
    n.innerHTML = '<div>點餐系統尚未啟用，暫時只能瀏覽菜單。<br>團主請依 <a href="setup.html">團主使用說明</a> 完成第一次設定。</div>';
    return;
  }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  setInterval(recompute, 15000);
})();
