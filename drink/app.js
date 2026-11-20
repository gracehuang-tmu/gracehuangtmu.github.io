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


// ---------- 文字菜單格式（團主可手寫或請 AI 從照片轉換） ----------
const AI_PROMPT = `請把我附上的飲料店菜單照片，轉成下面的純文字格式。只輸出轉換結果，不要其他說明。

格式規則：
# 分類名稱 分類說明(可省略)
品名 M價格 L價格          ← 有兩種尺寸，例：珍珠奶茶 M50 L60
品名 價格                 ← 只有一種價格，例：仙草凍奶 60
品名 L價格 (紅茶/綠茶)     ← 可選茶底且同價，用括號列出
品名 +口味A價格 +口味B價格  ← 不同口味不同價，例：冬瓜綿綿 +鮮奶60 +檸檬45
品名 L價格 [新品]          ← 有標註時用中括號；限定月份寫 [11-03月]
看不清楚的品項在最後加 [待確認]

最後三行列出菜單上的選項（沒有就省略）：
冰塊: 正常冰 少冰 微冰 去冰 溫 熱
甜度: 正常糖 少糖 半糖 微糖 無糖
加料: 珍珠5 椰果10 奶蓋15

使用繁體中文，價格只寫數字。`;

function parseMenuText(text) {
  const cats = [], errors = []; let cur = null, ice = [], sugar = [], tops = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/　/g, ' ').trim();
    if (!line || line.startsWith('//')) return;
    let m;
    if ((m = /^#+\s*(\S+)\s*(.*)$/.exec(line))) { cur = { c: m[1], sub: m[2].trim(), items: [] }; cats.push(cur); return; }
    if ((m = /^(冰塊|甜度|加料)\s*[:：]\s*(.*)$/.exec(line))) {
      const toks = m[2].split(/[\s,、，]+/).filter(Boolean);
      if (m[1] === '冰塊') ice = toks; else if (m[1] === '甜度') sugar = toks;
      else tops = toks.map(t => { const k = /^(.+?)\+?(\d+)$/.exec(t); return k ? [k[1].replace(/\+$/, ''), +k[2]] : null; }).filter(Boolean);
      return;
    }
    let tag = '', months = null, variants = [];
    let rest = line.replace(/[\[【]([^\]】]+)[\]】]/g, (_, t) => { tag = tag ? tag + '、' + t : t; const mm = /(\d{1,2})\s*-\s*(\d{1,2})\s*月/.exec(t); if (mm) months = [+mm[1], +mm[2]]; return ' '; });
    rest = rest.replace(/[\(（]([^\)）]+)[\)）]/g, (_, t) => { variants = t.split(/[\/／、,，]/).map(x => x.trim()).filter(Boolean); return ' '; });
    const toks = rest.split(/\s+/).filter(Boolean);
    const name = [], sizes = [], pv = [];
    for (const t of toks) {
      let k;
      if ((k = /^\+(.+?)(\d+)$/.exec(t))) pv.push(['+' + k[1], +k[2]]);
      else if ((k = /^([A-Za-z]{1,3}|[中大小特超]杯?|[中大小])?[\$＄]?(\d{2,4})元?$/.exec(t)) && (name.length || sizes.length)) sizes.push([k[1] ? k[1].toUpperCase() : '單一', +k[2]]);
      else if (!sizes.length && !pv.length) name.push(t);
    }
    if (!name.length || (!sizes.length && !pv.length)) { errors.push(`第 ${i + 1} 行看不懂：${line}`); return; }
    if (sizes.length > 1) sizes.forEach(s => { if (s[0] === '單一') s[0] = 'L'; });
    if (!cur) { cur = { c: '菜單', sub: '', items: [] }; cats.push(cur); }
    cur.items.push({ n: name.join(' '), tag, months, sizes: pv.length ? [] : sizes, variants, pv });
  });
  return { menu: { categories: cats.filter(c => c.items.length), ice, sugar, tops }, errors };
}
function menuToText(m) {
  if (!m || !m.categories?.length) return '';
  const out = [];
  m.categories.forEach(g => {
    out.push(`# ${g.c}${g.sub ? ' ' + g.sub : ''}`);
    g.items.forEach(it => {
      const p = it.pv?.length ? it.pv.map(x => (x[0].startsWith('+') ? '' : '+') + x[0] + x[1]).join(' ')
        : it.sizes.map(x => (x[0] === '單一' ? '' : x[0]) + x[1]).join(' ');
      out.push(`${it.n} ${p}${it.variants?.length ? ' (' + it.variants.join('/') + ')' : ''}${it.tag ? ' [' + it.tag + ']' : ''}`);
    });
    out.push('');
  });
  if (m.ice?.length) out.push('冰塊: ' + m.ice.join(' '));
  if (m.sugar?.length) out.push('甜度: ' + m.sugar.join(' '));
  if (m.tops?.length) out.push('加料: ' + m.tops.map(t => t[0] + t[1]).join(' '));
  return out.join('\n').trim();
}

const EMPTY_MENU = { shop: '', categories: [], ice: DEF_ICE, sugar: DEF_SUGAR, tops: [] };
let MENU = EMPTY_MENU, DEFAULT_MENU = null, shops = [], images = [], menuKey = '';
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
function applyMenu(raw, imgs) {
  const key = JSON.stringify([raw, imgs]);
  if (key === menuKey) return;
  menuKey = key;
  MENU = normMenu(raw) || { ...EMPTY_MENU, ...(raw && typeof raw === 'object' ? { ice: strs(raw.ice, 8, 10).length ? strs(raw.ice, 8, 10) : DEF_ICE, sugar: strs(raw.sugar, 8, 10).length ? strs(raw.sugar, 8, 10) : DEF_SUGAR, tops: pairs(raw.tops, '') } : {}) };
  images = imgs || [];
  renderMenu(); renderGallery();
}
function renderTitle() { const n = shopName(); $('title').textContent = n ? n + '・團購點餐' : '飲料團購點餐'; document.title = $('title').textContent; }
function renderMenu() {
  renderTitle();
  $('catnav').innerHTML = MENU.categories.map((g, i) => `<a href="#" data-c="${i}">${esc(g.c)}</a>`).join('');
  $('menu').innerHTML = MENU.categories.map((g, gi) => `<section class="cat" id="cat${gi}"><h2>${esc(g.c)}</h2>${g.sub ? `<p class="sub">${esc(g.sub)}</p>` : '<div style="height:8px"></div>'}` + g.items.map((it, ii) => {
    const off = !inSeason(it.months);
    return `<div class="item ${off ? 'off' : ''}" data-g="${gi}" data-i="${ii}" role="button" tabindex="${off ? -1 : 0}"><div><span class="n">${esc(it.n)}</span>${it.tag ? `<span class="tag">${esc(it.tag)}${off ? '・非供應期' : ''}</span>` : ''}</div><div class="p">${esc(priceLabel(it))}${off ? '' : '<span class="tt-icon">add_circle</span>'}</div></div>`;
  }).join('') + '</section>').join('');
  const free = !MENU.categories.length;
  $('freeBox').classList.toggle('hide', !free);
  $('catnav').classList.toggle('hide', free);
  $('otherLink').classList.toggle('hide', free);
  $('freeHint').textContent = images.length ? '這家店請看上方菜單照片，自行填寫品項與價格。' : '這家店還沒有菜單，請直接填寫品項與價格。';
  $('menuFoot').textContent = free ? '' : (MENU.tops.length ? '加料：' + MENU.tops.map(t => `${t[0]} +${t[1]}`).join('、') + '。' : '') + '價格以店家為準。';
}
$('catnav').addEventListener('click', e => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); $('cat' + a.dataset.c)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('menu').addEventListener('click', e => { const el = e.target.closest('.item'); if (!el || el.classList.contains('off')) return; openSheet(+el.dataset.g, +el.dataset.i); });
$('menu').addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const el = e.target.closest('.item'); if (!el || el.classList.contains('off')) return; e.preventDefault(); openSheet(+el.dataset.g, +el.dataset.i); });

// ---------- 菜單照片 ----------
const imgCache = new Map();
async function loadImage(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  const pr = api('image', { id }).then(r => r.ok && /^data:image\//.test(r.data) ? r.data : null).catch(() => null);
  imgCache.set(id, pr); const v = await pr; if (!v) imgCache.delete(id); return v;
}
function renderGallery() {
  $('gallery').classList.toggle('hide', !images.length);
  $('thumbs').innerHTML = images.map((id, i) => `<div class="thumb" data-i="${i}"><span class="tt-icon">image</span></div>`).join('');
  images.forEach(async (id, i) => { const src = await loadImage(id); const el = $('thumbs').querySelector(`[data-i="${i}"]`); if (src && el && images[i] === id) { el.innerHTML = ''; const im = new Image(); im.alt = '菜單照片 ' + (i + 1); im.src = src; el.append(im); } });
}
let lbList = [], lbIdx = 0;
async function openLightbox(list, i) { lbList = list; lbIdx = i; $('lightbox').classList.add('show'); await showLb(); }
async function showLb() { $('lbImg').removeAttribute('src'); const v = lbList[lbIdx]; const src = v?.startsWith('data:') ? v : await loadImage(v); if (src) $('lbImg').src = src; $('lbPrev').classList.toggle('hide', lbList.length < 2); $('lbNext').classList.toggle('hide', lbList.length < 2); }
$('thumbs').addEventListener('click', e => { const t = e.target.closest('.thumb'); if (t) openLightbox(images, +t.dataset.i); });
$('lbClose').onclick = () => $('lightbox').classList.remove('show');
$('lbPrev').onclick = () => { lbIdx = (lbIdx - 1 + lbList.length) % lbList.length; showLb(); };
$('lbNext').onclick = () => { lbIdx = (lbIdx + 1) % lbList.length; showLb(); };
$('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('lightbox').classList.remove('show'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('lightbox').classList.remove('show'); $('sheetBg').classList.remove('show'); } });

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
function openCustom() {
  const pick = (arr, want) => arr.includes(want) ? want : arr[Math.floor(arr.length / 2)] || arr[0];
  sel = { custom: true, cat: '自行填寫', name: '', price: '', sizes: [], pv: null, v: null, size: '', variant: '', ice: pick(MENU.ice, '少冰'), sugar: pick(MENU.sugar, '半糖'), tops: [], qty: 1, note: '' };
  drawSheet(); $('sheetBg').classList.add('show'); setTimeout(() => $('cName')?.focus(), 50);
}
$('freeBtn').onclick = openCustom;
$('otherBtn').onclick = e => { e.preventDefault(); openCustom(); };
function readCustom() { if (sel?.custom && $('cName')) { sel.name = $('cName').value.trim().slice(0, 40); sel.price = $('cPrice').value; } }
function unitPrice(s) {
  if (s.custom) { const n = Math.round(+s.price); return n > 0 && n < 10000 ? n : 0; }
  const base = s.pv ? (s.pv.find(x => x[0] === s.variant) || s.pv[0])[1] : (s.sizes.find(x => x[0] === s.size) || s.sizes[0])[1];
  return base + s.tops.reduce((a, t) => a + ((MENU.tops.find(x => x[0] === t) || [0, 0])[1]), 0);
}
function chips(key, opts, multi) {
  return `<div class="chips" data-k="${key}">` + opts.map(([v, lab]) => { const on = multi ? sel[key].includes(v) : sel[key] === v; return `<button data-v="${esc(v)}" class="${on ? 'on' : ''}">${esc(lab)}</button>`; }).join('') + '</div>';
}
function drawSheet() {
  const s = sel;
  $('sheet').innerHTML = (s.custom ? `<h3>填寫飲料</h3>
  <div class="grp"><label class="t" for="cName">品項名稱</label><input id="cName" maxlength="40" value="${esc(s.name)}" placeholder="例：珍珠奶茶"></div>
  <div class="grp"><label class="t">尺寸</label>${chips('size', [['', '不指定'], ['M', 'M／中杯'], ['L', 'L／大杯']])}</div>
  <div class="grp"><label class="t" for="cPrice">單價（含加料）</label><input id="cPrice" type="number" inputmode="numeric" min="1" max="9999" value="${esc(s.price)}" placeholder="看菜單照片填寫"></div>`
  : `<h3>${esc(s.name)}</h3><div class="muted">${esc(s.cat)}</div>`) + `
  ${s.sizes.length > 1 ? `<div class="grp"><label class="t">尺寸</label>${chips('size', s.sizes.map(x => [x[0], `${x[0]} $${x[1]}`]))}</div>` : ''}
  ${s.pv ? `<div class="grp"><label class="t">口味</label>${chips('variant', s.pv.map(x => [x[0], `${x[0]} $${x[1]}`]))}</div>` : ''}
  ${s.v ? `<div class="grp"><label class="t">茶底／口味</label>${chips('variant', s.v.map(x => [x, x]))}</div>` : ''}
  ${MENU.ice.length ? `<div class="grp"><label class="t">冰塊</label>${chips('ice', MENU.ice.map(x => [x, x]))}</div>` : ''}
  ${MENU.sugar.length ? `<div class="grp"><label class="t">甜度</label>${chips('sugar', MENU.sugar.map(x => [x, x]))}</div>` : ''}
  ${MENU.tops.length && !s.custom ? `<div class="grp"><label class="t">加料（可複選）</label>${chips('tops', MENU.tops.map(x => [x[0], `${x[0]} +${x[1]}`]), true)}</div>` : ''}
  <div class="grp"><label class="t">備註</label><input id="sNote" maxlength="40" value="${esc(s.note)}" placeholder="${s.custom ? '加料或其他需求，例：加珍珠' : '選填'}"></div>
  <div class="grp"><label class="t">杯數</label><div class="qty"><button data-q="-1" aria-label="減少"><span class="tt-icon">remove</span></button><b>${s.qty}</b><button data-q="1" aria-label="增加"><span class="tt-icon">add</span></button></div></div>
  ${!open ? `<p class="muted" style="margin-top:16px">${phase() === 'notyet' ? '還沒到開放時間：' + esc(fmt(openAt)) : '已截團，無法再點餐。'}</p>` : ''}
  <div class="sheet-foot"><button class="btn ghost" id="sCancel">取消</button><button class="btn" id="sAdd" ${open ? '' : 'disabled'}>加入 $${unitPrice(s) * s.qty}</button></div>`;
}
$('sheet').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const ck = b.parentElement.dataset.k;
  readCustom();
  if (ck) { sel.note = $('sNote').value; const v = b.dataset.v; if (ck === 'tops') sel.tops = sel.tops.includes(v) ? sel.tops.filter(x => x !== v) : [...sel.tops, v]; else sel[ck] = v; drawSheet(); return; }
  if (b.dataset.q) { sel.note = $('sNote').value; sel.qty = Math.max(1, Math.min(20, sel.qty + (+b.dataset.q))); drawSheet(); return; }
  if (b.id === 'sCancel') { $('sheetBg').classList.remove('show'); return; }
  if (b.id === 'sAdd') {
    if (!$('nick').value.trim()) { $('sheetBg').classList.remove('show'); note('請先在上方輸入你的名字'); $('nick').focus(); return; }
    sel.note = $('sNote').value.trim();
    if (sel.custom && !sel.name) { $('cName').focus(); return; }
    if (sel.custom && !unitPrice(sel)) { $('cPrice').focus(); return; }
    const s = sel;
    myItems = [...myItems, { k: rnd(8), cat: s.cat, name: s.name, size: s.pv ? '' : s.size, variant: s.variant || '', ice: MENU.ice.length ? s.ice : '', sugar: MENU.sugar.length ? s.sugar : '', tops: s.tops, qty: s.qty, note: s.note, unit: unitPrice(s) }];
    $('sheetBg').classList.remove('show'); save(); renderMine();
  }
});
$('sheet').addEventListener('input', e => { if (e.target.id === 'cPrice' || e.target.id === 'cName') { readCustom(); const b = $('sAdd'); if (b) b.textContent = '加入 $' + unitPrice(sel) * sel.qty; } });
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
      shops = strs(r.shops, 30, 200);
      applyMenu(cfgShop ? (r.menu || { categories: [] }) : DEFAULT_MENU, cfgShop ? strs(r.images, 100, 6) : []);
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
  renderShopSelect();
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
  adminDo('config', { shop: $('cfgShop').value, note: $('cfgNote').value.trim(), openAt: oa, closeAt: ca }, '已儲存');
};
$('cfgToggle').onclick = () => adminDo('config', { open: !manualOpen }, manualOpen ? '已暫停點餐' : '已恢復點餐');
$('cfgClear').onclick = () => $('clearConfirm').classList.remove('hide');
$('clearNo').onclick = () => $('clearConfirm').classList.add('hide');
$('clearYes').onclick = () => { $('clearConfirm').classList.add('hide'); adminDo('clear', {}, '已清空'); };
$('byPerson').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) adminDo('delete', { id: b.dataset.del }, '已刪除'); });

// ---------- 團主：商家與菜單 ----------
function renderShopSelect() {
  const el = $('cfgShop'); if (document.activeElement === el) return;
  const list = [...new Set([...shops, ...(cfgShop ? [cfgShop] : [])])];
  el.innerHTML = `<option value="">（初始菜單）</option>` + list.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  el.value = cfgShop;
  $('shopEdit').disabled = !cfgShop;
}
$('cfgShop').onchange = () => { $('shopEdit').disabled = !$('cfgShop').value; adminDo('config', { shop: $('cfgShop').value }, '已切換今日商家'); };
let ed = null;
function edThumbs() {
  const all = [...ed.keep.map(id => ({ id })), ...ed.add.map(d => ({ d }))];
  $('seThumbs').innerHTML = all.map((x, i) => `<div class="thumb" data-i="${i}">${x.d ? `<img src="${x.d}" alt="">` : '<span class="tt-icon">image</span>'}<button class="rm" data-rm="${i}" aria-label="移除"><span class="tt-icon">close</span></button></div>`).join('');
  ed.keep.forEach(async (id, i) => { const src = await loadImage(id); const el = $('seThumbs').querySelector(`[data-i="${i}"]`); if (src && el && ed?.keep[i] === id) { const im = new Image(); im.src = src; el.prepend(im); el.querySelector('.tt-icon:not(.rm .tt-icon)')?.remove(); } });
}
function edPreview() {
  const t = $('seText').value.trim();
  if (!t) { $('sePreview').textContent = '沒有填寫：同事會看照片自行填寫品項。'; return null; }
  const r = parseMenuText(t);
  const n = r.menu.categories.reduce((a, g) => a + g.items.length, 0);
  $('sePreview').innerHTML = `辨識到 ${r.menu.categories.length} 個分類、${n} 個品項` + (r.errors.length ? `<br>${r.errors.slice(0, 5).map(esc).join('<br>')}${r.errors.length > 5 ? `<br>…還有 ${r.errors.length - 5} 行` : ''}` : '');
  return r;
}
async function openEditor(name) {
  ed = { orig: name || '', keep: [], add: [] };
  $('seTitle').textContent = name ? '編輯商家' : '新增商家';
  $('seName').value = name || ''; $('seName').readOnly = !!name;
  $('seText').value = ''; $('seMsg').textContent = ''; $('seDelete').classList.toggle('hide', !name); $('seDelete').textContent = '刪除這家';
  $('seUse').checked = true; $('seAdv').open = false;
  $('shopEditor').classList.remove('hide'); $('shopEditor').scrollIntoView({ block: 'start' });
  edThumbs(); edPreview();
  if (name) {
    $('seMsg').textContent = '載入中…';
    try {
      const r = await api('getShop', { shop: name });
      if (r.ok && r.shop) { ed.keep = strs(r.shop.images, 100, 6); $('seText').value = menuToText(normMenu(r.shop.menu)); if ($('seText').value) $('seAdv').open = true; edThumbs(); edPreview(); }
      $('seMsg').textContent = '';
    } catch { $('seMsg').textContent = '載入失敗，請重試'; }
  }
}
$('shopNew').onclick = e => { e.preventDefault(); openEditor(''); };
$('shopEdit').onclick = () => { if (cfgShop) openEditor(cfgShop); };
$('seCancel').onclick = () => { ed = null; $('shopEditor').classList.add('hide'); };
$('seText').addEventListener('input', edPreview);
$('seThumbs').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { const i = +rm.dataset.rm; if (i < ed.keep.length) ed.keep.splice(i, 1); else ed.add.splice(i - ed.keep.length, 1); edThumbs(); return; }
  const t = e.target.closest('.thumb'); if (t) openLightbox([...ed.keep, ...ed.add], +t.dataset.i);
});
function compress(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(); };
    im.src = url;
  });
}
$('seFile').onchange = async () => {
  const files = [...$('seFile').files]; $('seFile').value = '';
  for (const f of files) {
    if (ed.keep.length + ed.add.length >= 6) { $('seMsg').textContent = '最多 6 張'; break; }
    try { ed.add.push(await compress(f)); } catch { $('seMsg').textContent = '有照片無法讀取，請換成 JPG 或 PNG'; }
  }
  edThumbs();
};
$('seCopyPrompt').onclick = async () => { try { await navigator.clipboard.writeText(AI_PROMPT); $('sePromptMsg').textContent = '已複製'; } catch { $('sePromptMsg').textContent = '無法複製'; } setTimeout(() => $('sePromptMsg').textContent = '', 2500); };
$('seSave').onclick = async () => {
  const shop = $('seName').value.trim().slice(0, 30);
  if (!shop) { $('seName').focus(); $('seMsg').textContent = '請填商家名稱'; return; }
  if (!ed.orig && shops.includes(shop)) { $('seMsg').textContent = '已有同名商家，請從選單選它再按「編輯」'; return; }
  const r = edPreview();
  if (r && r.errors.length) { $('seAdv').open = true; $('seMsg').textContent = '點選式菜單有看不懂的行，請修正或刪除後再儲存'; return; }
  if (!r && !ed.keep.length && !ed.add.length) { $('seMsg').textContent = '請至少上傳一張菜單照片'; return; }
  $('seSave').disabled = true; $('seMsg').textContent = '儲存中…（照片上傳需要一點時間）';
  try {
    const res = await api('saveMenu', { shop, menu: r ? r.menu : { categories: [] }, keepImages: ed.keep, newImages: ed.add });
    if (!res.ok) throw res.error;
    if ($('seUse').checked) await api('config', { shop });
    ed = null; $('shopEditor').classList.add('hide'); $('adminMsg').textContent = '已儲存商家：' + shop; menuKey = '';
    await refresh();
  } catch (err) { $('seMsg').textContent = err === 'bad_image' ? '照片太大或格式不支援' : err === 'not_admin' ? '團主登入已失效，請重新登入' : '儲存失敗，請再試一次'; }
  $('seSave').disabled = false;
};
$('seDelete').onclick = async () => {
  if ($('seDelete').textContent !== '確定刪除？') { $('seDelete').textContent = '確定刪除？'; return; }
  try { await api('deleteMenu', { shop: ed.orig }); if (cfgShop === ed.orig) await api('config', { shop: '' }); } catch {}
  ed = null; $('shopEditor').classList.add('hide'); menuKey = ''; refresh();
};

// ---------- 啟動 ----------
(async () => {
  $('nick').value = ls('nick') || ''; myNick = $('nick').value;
  try { const c = JSON.parse(ls('cart') || '[]'); myItems = itemsOf({ items: c }); } catch {}
  try { DEFAULT_MENU = await (await fetch('menu.json', { cache: 'no-cache' })).json(); } catch {}
  applyMenu(DEFAULT_MENU, []);
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
