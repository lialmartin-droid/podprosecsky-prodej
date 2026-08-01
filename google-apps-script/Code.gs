/**
 * Podprosečské domácí produkty — objednávkový backend
 *
 * Doporučeno: vytvořte Google Tabulku, otevřete Rozšíření → Apps Script
 * a vložte tento kód do souboru Code.gs.
 */

const CONFIG = Object.freeze({
  NOTIFICATION_EMAIL: 'podprosecskeprodukty@gmail.com',
  SHEET_NAME: 'Objednávky',
  BRAND_NAME: 'Podprosečské domácí produkty',
  TIME_ZONE: 'Europe/Prague',
  MAX_ITEMS: 20,
  MAX_QUANTITY_PER_ITEM: 500
});

/**
 * Spusťte jednou ručně v editoru Apps Script.
 * Připraví list a vyžádá oprávnění pro Tabulky a MailApp.
 */
function setup() {
  const sheet = getOrCreateSheet_();
  formatSheet_(sheet);

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: 'Test propojení – ' + CONFIG.BRAND_NAME,
    body: 'Google Apps Script je připravený. Tato zpráva potvrzuje funkční odesílání e-mailů.',
    name: CONFIG.BRAND_NAME
  });
}

/**
 * Zdravotní kontrola webové aplikace.
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      service: CONFIG.BRAND_NAME,
      time: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Přijme objednávku odeslanou HTML formulářem.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const rawPayload = e && e.parameter ? e.parameter.payload : '';
    if (!rawPayload) {
      throw new Error('Chybí data objednávky.');
    }

    const payload = JSON.parse(rawPayload);
    const order = validateAndNormalizeOrder_(payload);

    const sheet = getOrCreateSheet_();
    formatSheet_(sheet);

    const orderId = Utilities.getUuid();
    const createdAt = new Date();
    const itemText = order.items
      .map(item => `${item.qty}× ${item.name} (${item.qty * item.price} Kč)`)
      .join(', ');

    sheet.appendRow([
      orderId,
      createdAt,
      'Nová',
      order.name,
      order.phone,
      order.pickup,
      itemText,
      order.total,
      order.note,
      order.source
    ]);

    const subject = `Nová objednávka – ${order.name} – ${order.total} Kč`;
    const textBody = buildTextEmail_(order, orderId, createdAt);
    const htmlBody = buildHtmlEmail_(order, orderId, createdAt);

    MailApp.sendEmail({
      to: CONFIG.NOTIFICATION_EMAIL,
      subject,
      body: textBody,
      htmlBody,
      name: CONFIG.BRAND_NAME,
      replyTo: CONFIG.NOTIFICATION_EMAIL
    });

    return htmlResponse_(true, 'Objednávka byla přijata.', orderId);
  } catch (error) {
    console.error(error);
    return htmlResponse_(false, 'Objednávku se nepodařilo uložit.', '');
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function validateAndNormalizeOrder_(payload) {
  const name = cleanText_(payload.name, 100);
  const phone = cleanText_(payload.phone, 40);
  const pickup = cleanText_(payload.pickup, 20);
  const note = cleanText_(payload.note, 500);
  const source = cleanText_(payload.source || 'Web', 40);

  if (name.length < 2) throw new Error('Neplatné jméno.');
  if (phone.length < 5) throw new Error('Neplatný telefon.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup)) throw new Error('Neplatný termín vyzvednutí.');
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > CONFIG.MAX_ITEMS) {
    throw new Error('Neplatné položky.');
  }

  const items = payload.items.map(item => {
    const productId = Number(item.productId);
    const name = cleanText_(item.name, 100);
    const qty = Math.floor(Number(item.qty));
    const price = Number(item.price);

    if (!Number.isFinite(productId) || !name) throw new Error('Neplatný produkt.');
    if (!Number.isInteger(qty) || qty < 1 || qty > CONFIG.MAX_QUANTITY_PER_ITEM) {
      throw new Error('Neplatné množství.');
    }
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      throw new Error('Neplatná cena.');
    }

    return { productId, name, qty, price };
  });

  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  if (!Number.isFinite(total) || total < 0 || total > 1000000) {
    throw new Error('Neplatná celková cena.');
  }

  return { name, phone, pickup, note, source, items, total };
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Skript musí být vytvořený přímo z Google Tabulky.');
  }

  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  }

  return sheet;
}

function formatSheet_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID objednávky',
      'Vytvořeno',
      'Stav',
      'Jméno',
      'Telefon',
      'Termín vyzvednutí',
      'Položky',
      'Celkem Kč',
      'Poznámka',
      'Zdroj'
    ]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  sheet.getRange('B:B').setNumberFormat('dd.MM.yyyy HH:mm:ss');
  sheet.getRange('F:F').setNumberFormat('dd.MM.yyyy');
  sheet.getRange('H:H').setNumberFormat('0 "Kč"');
  sheet.autoResizeColumns(1, 10);
}

function buildTextEmail_(order, orderId, createdAt) {
  const items = order.items
    .map(item => `- ${item.qty}× ${item.name}: ${item.qty * item.price} Kč`)
    .join('\n');

  return [
    'Nová objednávka',
    '',
    `Číslo: ${orderId}`,
    `Přijata: ${Utilities.formatDate(createdAt, CONFIG.TIME_ZONE, 'd. M. yyyy HH:mm')}`,
    `Jméno: ${order.name}`,
    `Telefon: ${order.phone}`,
    `Vyzvednutí: ${formatPickup_(order.pickup)}`,
    '',
    'Položky:',
    items,
    '',
    `Celkem: ${order.total} Kč`,
    `Poznámka: ${order.note || '—'}`
  ].join('\n');
}

function buildHtmlEmail_(order, orderId, createdAt) {
  const rows = order.items.map(item => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml_(item.qty + '× ' + item.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700">${item.qty * item.price} Kč</td>
    </tr>`).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;color:#2a2118">
      <div style="padding:20px;border-radius:16px;background:#fff5d6">
        <div style="font-size:12px;font-weight:700;color:#71895f;text-transform:uppercase;letter-spacing:.12em">Nová objednávka</div>
        <h1 style="margin:8px 0 0;color:#694a2b;font-size:26px">${escapeHtml_(CONFIG.BRAND_NAME)}</h1>
      </div>
      <div style="padding:20px 4px">
        <p><strong>Jméno:</strong> ${escapeHtml_(order.name)}<br>
        <strong>Telefon:</strong> ${escapeHtml_(order.phone)}<br>
        <strong>Vyzvednutí:</strong> ${escapeHtml_(formatPickup_(order.pickup))}<br>
        <strong>Přijata:</strong> ${escapeHtml_(Utilities.formatDate(createdAt, CONFIG.TIME_ZONE, 'd. M. yyyy HH:mm'))}</p>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        <p style="font-size:22px;font-weight:800;text-align:right">Celkem: ${order.total} Kč</p>
        <p><strong>Poznámka:</strong> ${escapeHtml_(order.note || '—')}</p>
        <p style="font-size:12px;color:#777">ID objednávky: ${escapeHtml_(orderId)}</p>
      </div>
    </div>`;
}

function formatPickup_(isoDate) {
  const parts = isoDate.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'd. M. yyyy');
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formulář cílí do skrytého iframe. Odpověď pošle stav rodičovské stránce.
 */
function htmlResponse_(ok, message, orderId) {
  const safeMessage = JSON.stringify(message);
  const safeOrderId = JSON.stringify(orderId);

  return HtmlService.createHtmlOutput(`
    <!doctype html>
    <meta charset="utf-8">
    <script>
      window.parent.postMessage({
        type: 'PDP_ORDER_RESULT',
        ok: ${ok ? 'true' : 'false'},
        message: ${safeMessage},
        orderId: ${safeOrderId}
      }, '*');
    <\/script>
  `);
}
