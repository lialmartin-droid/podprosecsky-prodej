/**
 * Podprosečské domácí produkty — sdílený backend
 * Objednávky i produkty jsou uloženy v jedné Google Tabulce.
 */
const CONFIG = Object.freeze({
  NOTIFICATION_EMAIL: 'podprosecskeprodukty@gmail.com',
  ORDERS_SHEET: 'Objednávky',
  PRODUCTS_SHEET: 'Produkty',
  BRAND_NAME: 'Podprosečské domácí produkty',
  TIME_ZONE: 'Europe/Prague',
  SESSION_SECONDS: 21600,
  MAX_ITEMS: 20,
  MAX_QUANTITY_PER_ITEM: 500
});

function setup() {
  const orders = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const products = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatOrdersSheet_(orders);
  formatProductsSheet_(products);
  seedProducts_(products);

  const props = PropertiesService.getScriptProperties();
  let password = props.getProperty('ADMIN_PASSWORD');
  if (!password) {
    password = generatePassword_();
    props.setProperty('ADMIN_PASSWORD', password);
  }

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: 'Administrace připravena – ' + CONFIG.BRAND_NAME,
    body: [
      'Google Apps Script je připravený.',
      '',
      'Heslo do administrace:',
      password,
      '',
      'Heslo si bezpečně uložte. Změnit ho lze funkcí changeAdminPassword().'
    ].join('\n'),
    name: CONFIG.BRAND_NAME
  });
}

/** Před spuštěním změňte hodnotu uvnitř uvozovek. */
function changeAdminPassword() {
  const newPassword = 'SEM_NAPISTE_NOVE_HESLO';
  if (!newPassword || newPassword === 'SEM_NAPISTE_NOVE_HESLO' || newPassword.length < 8) {
    throw new Error('Zadejte nové heslo dlouhé alespoň 8 znaků.');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', newPassword);
  CacheService.getScriptCache().removeAll([]);
  MailApp.sendEmail(CONFIG.NOTIFICATION_EMAIL, 'Heslo administrace změněno', 'Nové heslo bylo úspěšně nastaveno.');
}

function doGet(e) {
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action || 'health', 40);
    if (action === 'products') return jsonpResponse_(e, { ok: true, products: readProducts_() });
    if (action === 'adminData') {
      requireToken_(e.parameter.token || '');
      return jsonpResponse_(e, { ok: true, products: readProducts_(), orders: readOrders_() });
    }
    return jsonpResponse_(e, { ok: true, service: CONFIG.BRAND_NAME, time: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return jsonpResponse_(e, { ok: false, message: error.message || 'Chyba serveru.' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const action = cleanText_(e && e.parameter && e.parameter.action || 'createOrder', 40);
    const payload = JSON.parse(e && e.parameter && e.parameter.payload || '{}');

    if (action === 'login') return login_(payload);
    if (action === 'createOrder') return createOrder_(payload, false);

    const token = cleanText_(e.parameter.token || payload.token || '', 100);
    requireToken_(token);

    if (action === 'saveProduct') return saveProduct_(payload);
    if (action === 'deleteProduct') return deleteProduct_(payload);
    if (action === 'saveOrder') return saveOrder_(payload);
    if (action === 'deleteOrder') return deleteOrder_(payload);
    if (action === 'manualOrder') return createOrder_(payload, true);
    throw new Error('Neznámá operace.');
  } catch (error) {
    console.error(error);
    return htmlResponse_(false, error.message || 'Operaci se nepodařilo dokončit.', '', {});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function login_(payload) {
  const password = cleanText_(payload.password, 200);
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('Nejdříve spusťte funkci setup().');
  if (password !== expected) throw new Error('Nesprávné heslo.');
  const token = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, '1', CONFIG.SESSION_SECONDS);
  return htmlResponse_(true, 'Přihlášení bylo úspěšné.', '', { token: token });
}

function requireToken_(token) {
  if (!token || CacheService.getScriptCache().get('session:' + token) !== '1') {
    throw new Error('Přihlášení vypršelo. Přihlaste se znovu.');
  }
}

function createOrder_(payload, manual) {
  const order = validateOrder_(payload, manual);
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const id = cleanText_(payload.id, 100) || Utilities.getUuid();
  const createdAt = new Date();
  const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');
  sheet.appendRow([
    id, createdAt, order.status, order.name, order.phone, order.pickup,
    itemsText, order.total, order.note, manual ? 'Administrace' : 'Web', JSON.stringify(order.items)
  ]);

  if (!manual) {
    MailApp.sendEmail({
      to: CONFIG.NOTIFICATION_EMAIL,
      subject: `Nová objednávka – ${order.name} – ${order.total} Kč`,
      body: buildTextEmail_(order, id, createdAt),
      htmlBody: buildHtmlEmail_(order, id, createdAt),
      name: CONFIG.BRAND_NAME,
      replyTo: CONFIG.NOTIFICATION_EMAIL
    });
  }
  return htmlResponse_(true, manual ? 'Objednávka byla uložena.' : 'Objednávka byla přijata.', id, {});
}

function saveProduct_(payload) {
  const product = normalizeProduct_(payload.product || payload);
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let row = 0;
  for (let i = 1; i < values.length; i++) if (String(values[i][0]) === String(product.id)) { row = i + 1; break; }
  const record = [[product.id, product.emoji, product.name, product.price, product.unit, product.short, product.detail,
    product.visible, product.soldOut, product.restock, product.leadDays, product.quick.join(', '), new Date()]];
  if (row) sheet.getRange(row, 1, 1, 13).setValues(record); else sheet.getRange(sheet.getLastRow()+1,1,1,13).setValues(record);
  return htmlResponse_(true, 'Produkt byl uložen.', String(product.id), { product: product });
}

function deleteProduct_(payload) {
  const id = cleanText_(payload.id, 100);
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) if (String(values[i][0]) === id) sheet.deleteRow(i + 1);
  return htmlResponse_(true, 'Produkt byl smazán.', id, {});
}

function saveOrder_(payload) {
  const order = validateOrder_(payload.order || payload, true);
  const id = cleanText_((payload.order || payload).id, 100);
  if (!id) throw new Error('Chybí ID objednávky.');
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const values = sheet.getDataRange().getValues();
  let row = 0;
  for (let i = 1; i < values.length; i++) if (String(values[i][0]) === id) { row = i + 1; break; }
  if (!row) throw new Error('Objednávka nebyla nalezena.');
  const created = values[row-1][1] || new Date();
  const source = values[row-1][9] || 'Administrace';
  const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');
  sheet.getRange(row,1,1,11).setValues([[id,created,order.status,order.name,order.phone,order.pickup,itemsText,order.total,order.note,source,JSON.stringify(order.items)]]);
  return htmlResponse_(true, 'Objednávka byla upravena.', id, {});
}

function deleteOrder_(payload) {
  const id = cleanText_(payload.id, 100);
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) if (String(values[i][0]) === id) sheet.deleteRow(i + 1);
  return htmlResponse_(true, 'Objednávka byla smazána.', id, {});
}

function readProducts_() {
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet); seedProducts_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0] !== '').map(r => ({
    id: String(r[0]), emoji: String(r[1] || '📦'), name: String(r[2] || ''), price: Number(r[3] || 0),
    unit: String(r[4] || 'kus'), short: String(r[5] || ''), detail: String(r[6] || ''),
    visible: toBool_(r[7]), soldOut: toBool_(r[8]), restock: formatSheetDate_(r[9]),
    leadDays: Number(r[10] || 0), quick: String(r[11] || '').split(',').map(x => Number(x.trim())).filter(Boolean)
  }));
}

function readOrders_() {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET); formatOrdersSheet_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(r => r[0] !== '').map(r => {
    let items = [];
    try { items = JSON.parse(String(r[10] || '[]')); } catch (_) {}
    return {
      id: String(r[0]), created: formatDateTime_(r[1]), status: String(r[2] || 'Nová'),
      name: String(r[3] || ''), phone: String(r[4] || ''), pickup: formatSheetDate_(r[5]),
      itemsText: String(r[6] || ''), items: Array.isArray(items) ? items : [], total: Number(r[7] || 0),
      note: String(r[8] || ''), source: String(r[9] || '')
    };
  }).reverse();
}

function validateOrder_(payload, manual) {
  const name = cleanText_(payload.name, 100), phone = cleanText_(payload.phone, 40);
  const pickup = cleanText_(payload.pickup, 20), note = cleanText_(payload.note, 500);
  const status = manual ? cleanText_(payload.status || 'Nová', 30) : 'Nová';
  if (name.length < 2) throw new Error('Neplatné jméno.');
  if (!manual && phone.length < 5) throw new Error('Neplatný telefon.');
  if (pickup && !/^\d{4}-\d{2}-\d{2}$/.test(pickup)) throw new Error('Neplatný termín vyzvednutí.');
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > CONFIG.MAX_ITEMS) throw new Error('Neplatné položky.');
  const items = payload.items.map(i => {
    const productId = cleanText_(i.productId, 100), name = cleanText_(i.name, 100);
    const qty = Math.floor(Number(i.qty)), price = Number(i.price);
    if (!productId || !name || !Number.isInteger(qty) || qty < 1 || qty > CONFIG.MAX_QUANTITY_PER_ITEM || !Number.isFinite(price) || price < 0) throw new Error('Neplatná položka.');
    return { productId: productId, name: name, qty: qty, price: price };
  });
  return { name, phone, pickup, note, status, items, total: items.reduce((s,i)=>s+i.qty*i.price,0) };
}

function normalizeProduct_(p) {
  return {
    id: cleanText_(p.id,100) || Utilities.getUuid(), emoji: cleanText_(p.emoji || '📦',10),
    name: cleanText_(p.name,100), price: Math.max(0,Number(p.price)||0), unit: cleanText_(p.unit || 'kus',30),
    short: cleanText_(p.short,300), detail: cleanText_(p.detail,1000), visible: Boolean(p.visible),
    soldOut: Boolean(p.soldOut), restock: cleanText_(p.restock,20), leadDays: Math.max(0,Math.floor(Number(p.leadDays)||0)),
    quick: Array.isArray(p.quick) ? p.quick.map(Number).filter(x=>x>0) : String(p.quick||'').split(',').map(x=>Number(x.trim())).filter(x=>x>0)
  };
}

function getOrCreateSheet_(name) { const ss=SpreadsheetApp.getActiveSpreadsheet(); if(!ss) throw new Error('Skript musí být vytvořený z Google Tabulky.'); return ss.getSheetByName(name)||ss.insertSheet(name); }
function formatOrdersSheet_(s) { const h=['ID objednávky','Vytvořeno','Stav','Jméno','Telefon','Termín vyzvednutí','Položky','Celkem Kč','Poznámka','Zdroj','ItemsJSON']; ensureHeaders_(s,h); s.setFrozenRows(1); }
function formatProductsSheet_(s) { const h=['ID','Emoji','Název','Cena','Jednotka','Krátký popis','Podrobnosti','Viditelný','Vyprodáno','Doplnění','Předstih dní','Rychlá tlačítka','Aktualizováno']; ensureHeaders_(s,h); s.setFrozenRows(1); }
function ensureHeaders_(s,h) { if(s.getLastRow()===0) s.getRange(1,1,1,h.length).setValues([h]); else s.getRange(1,1,1,h.length).setValues([h]); s.getRange(1,1,1,h.length).setFontWeight('bold'); }
function seedProducts_(s) { if(s.getLastRow()>1) return; const now=new Date(); s.getRange(2,1,2,13).setValues([
  ['1','🍯','Květový med',190,'950 g','Smíšený květový med z okolí Lukášova.','Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.',true,false,'',0,'',now],
  ['2','🥚','Čerstvá vejce',7,'kus','Vejce od našich slepic z domácího chovu.','Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.',true,false,'',7,'6, 10, 30',now]
]); }
function cleanText_(v,m) { return String(v==null?'':v).replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,m); }
function toBool_(v) { return v===true || String(v).toLowerCase()==='true' || String(v)==='1'; }
function formatSheetDate_(v) { if(!v) return ''; if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v)) return Utilities.formatDate(v,CONFIG.TIME_ZONE,'yyyy-MM-dd'); return String(v).slice(0,10); }
function formatDateTime_(v) { if(!v) return ''; const d=new Date(v); return isNaN(d)?String(v):Utilities.formatDate(d,CONFIG.TIME_ZONE,'d. M. yyyy HH:mm'); }
function generatePassword_() { return 'PDP-' + Utilities.getUuid().replace(/-/g,'').slice(0,12); }
function jsonpResponse_(e,obj) { const cb=String(e&&e.parameter&&e.parameter.callback||'callback').replace(/[^a-zA-Z0-9_.$]/g,''); return ContentService.createTextOutput(`${cb}(${JSON.stringify(obj)});`).setMimeType(ContentService.MimeType.JAVASCRIPT); }
function htmlResponse_(ok,message,id,extra) { return HtmlService.createHtmlOutput(`<!doctype html><meta charset="utf-8"><script>window.parent.postMessage(${JSON.stringify(Object.assign({type:'PDP_BACKEND_RESULT',ok:ok,message:message,id:id},extra||{}))},'*');<\/script>`); }
function buildTextEmail_(o,id,d) { return ['Nová objednávka','',`Číslo: ${id}`,`Přijata: ${Utilities.formatDate(d,CONFIG.TIME_ZONE,'d. M. yyyy HH:mm')}`,`Jméno: ${o.name}`,`Telefon: ${o.phone}`,`Vyzvednutí: ${o.pickup||'neuvedeno'}`,'','Položky:',...o.items.map(i=>`- ${i.qty}× ${i.name}: ${i.qty*i.price} Kč`),'',`Celkem: ${o.total} Kč`,`Poznámka: ${o.note||'—'}`].join('\n'); }
function buildHtmlEmail_(o,id,d) { const rows=o.items.map(i=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml_(i.qty+'× '+i.name)}</td><td style="text-align:right;font-weight:700">${i.qty*i.price} Kč</td></tr>`).join(''); return `<div style="font-family:Arial;max-width:600px"><h2>${escapeHtml_(CONFIG.BRAND_NAME)}</h2><p><b>Jméno:</b> ${escapeHtml_(o.name)}<br><b>Telefon:</b> ${escapeHtml_(o.phone)}<br><b>Vyzvednutí:</b> ${escapeHtml_(o.pickup||'neuvedeno')}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:22px;text-align:right"><b>Celkem: ${o.total} Kč</b></p><p><b>Poznámka:</b> ${escapeHtml_(o.note||'—')}</p><small>ID: ${escapeHtml_(id)}</small></div>`; }
function escapeHtml_(v) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
