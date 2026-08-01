/**
 * Podprosečské domácí produkty — sdílený backend V12
 * Produkty, objednávky a plánování dostupnosti vajec jsou uloženy v jedné Google Tabulce.
 */
const CONFIG = Object.freeze({
  NOTIFICATION_EMAIL: 'podprosecskeprodukty@gmail.com',
  ORDERS_SHEET: 'Objednávky',
  PRODUCTS_SHEET: 'Produkty',
  SETTINGS_SHEET: 'Nastavení',
  BRAND_NAME: 'Podprosečské domácí produkty',
  TIME_ZONE: 'Europe/Prague',
  SESSION_SECONDS: 21600,
  MAX_ITEMS: 20,
  MAX_QUANTITY_PER_ITEM: 500,
  EGG_PRODUCT_ID: '2',
  DEFAULT_EGG_STOCK: 0,
  DEFAULT_EGG_DAILY_PRODUCTION: 10,
  DEFAULT_EGG_SAFETY_RESERVE: 0,
  DEFAULT_EGG_PLANNING_DAYS: 60
});

function setup() {
  const orders = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const products = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  const settings = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);

  formatOrdersSheet_(orders);
  formatProductsSheet_(products);
  formatSettingsSheet_(settings);
  seedProducts_(products);
  repairDefaultProductSettings_(products);
  seedEggSettings_(settings);

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
      'Heslo si bezpečně uložte. Změnit ho lze funkcí changeAdminPassword().',
      '',
      'V administraci nyní najdete také záložku Vejce, kde nastavíte aktuální sklad a denní snášku.'
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

  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD', newPassword);
  props.setProperty('SESSION_VERSION', Utilities.getUuid());

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: 'Heslo administrace změněno',
    body: 'Nové heslo bylo úspěšně nastaveno. Všechna předchozí přihlášení byla odhlášena.',
    name: CONFIG.BRAND_NAME
  });
}

function doGet(e) {
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action || 'health', 40);

    if (action === 'products') {
      return jsonpResponse_(e, {
        ok: true,
        products: readProducts_(),
        availability: publicEggAvailability_()
      });
    }

    if (action === 'availability') {
      return jsonpResponse_(e, {
        ok: true,
        availability: publicEggAvailability_()
      });
    }

    if (action === 'adminData') {
      requireToken_(e.parameter.token || '');
      const availability = buildEggAvailability_('');
      return jsonpResponse_(e, {
        ok: true,
        products: readProducts_(),
        orders: readOrders_(),
        eggSettings: availability.settings,
        eggAvailability: availability
      });
    }

    return jsonpResponse_(e, {
      ok: true,
      service: CONFIG.BRAND_NAME,
      version: '12',
      time: new Date().toISOString()
    });
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
    if (action === 'saveEggSettings') return saveEggSettings_(payload);

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
  const sessionVersion = getSessionVersion_();
  CacheService.getScriptCache().put('session:' + token, sessionVersion, CONFIG.SESSION_SECONDS);
  return htmlResponse_(true, 'Přihlášení bylo úspěšné.', '', { token: token });
}

function requireToken_(token) {
  const cachedVersion = token ? CacheService.getScriptCache().get('session:' + token) : '';
  if (!cachedVersion || cachedVersion !== getSessionVersion_()) {
    throw new Error('Přihlášení vypršelo. Přihlaste se znovu.');
  }
}

function getSessionVersion_() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty('SESSION_VERSION');
  if (!version) {
    version = Utilities.getUuid();
    props.setProperty('SESSION_VERSION', version);
  }
  return version;
}

function createOrder_(payload, manual) {
  const order = validateOrder_(payload, manual);
  validatePickupRules_(order, '');

  const fulfilledQty = isFulfilledStatus_(order.status) ? eggQtyFromItems_(order.items) : 0;
  if (fulfilledQty > 0) ensureEggStockCanBeReduced_(fulfilledQty);

  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const id = cleanText_(payload.id, 100) || Utilities.getUuid();
  const createdAt = new Date();
  const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');

  sheet.appendRow([
    id, createdAt, order.status, order.name, order.phone, order.pickup,
    itemsText, order.total, order.note, manual ? 'Administrace' : 'Web', JSON.stringify(order.items)
  ]);

  if (fulfilledQty > 0) adjustEggStock_(-fulfilledQty);

  let emailWarning = '';
  if (!manual) {
    try {
      MailApp.sendEmail({
        to: CONFIG.NOTIFICATION_EMAIL,
        subject: `Nová objednávka – ${order.name} – ${order.total} Kč`,
        body: buildTextEmail_(order, id, createdAt),
        htmlBody: buildHtmlEmail_(order, id, createdAt),
        name: CONFIG.BRAND_NAME,
        replyTo: CONFIG.NOTIFICATION_EMAIL
      });
    } catch (emailError) {
      console.error('Objednávka byla uložena, ale e-mail se nepodařilo odeslat.', emailError);
      emailWarning = ' Objednávka je uložená, ale upozorňovací e-mail se nepodařilo odeslat.';
    }
  }

  return htmlResponse_(true, (manual ? 'Objednávka byla uložena.' : 'Objednávka byla přijata.') + emailWarning, id, {});
}

function saveProduct_(payload) {
  const product = normalizeProduct_(payload.product || payload);
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let row = 0;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(product.id)) {
      row = i + 1;
      break;
    }
  }

  const record = [[
    product.id, product.emoji, product.name, product.price, product.unit,
    product.short, product.detail, product.visible, product.soldOut,
    product.restock, product.leadDays, product.quick.join(', '), new Date()
  ]];

  if (row) sheet.getRange(row, 1, 1, 13).setValues(record);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 13).setValues(record);

  return htmlResponse_(true, 'Produkt byl uložen.', String(product.id), { product: product });
}

function deleteProduct_(payload) {
  const id = cleanText_(payload.id, 100);
  if (id === CONFIG.EGG_PRODUCT_ID) {
    throw new Error('Produkt Vejce nelze smazat, protože je navázaný na rezervační systém. Můžete ho pouze skrýt.');
  }
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === id) sheet.deleteRow(i + 1);
  }
  return htmlResponse_(true, 'Produkt byl smazán.', id, {});
}

function saveOrder_(payload) {
  const submitted = payload.order || payload;
  const order = validateOrder_(submitted, true);
  const id = cleanText_(submitted.id, 100);
  if (!id) throw new Error('Chybí ID objednávky.');

  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const values = sheet.getDataRange().getValues();
  let row = 0;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id) {
      row = i + 1;
      break;
    }
  }

  if (!row) throw new Error('Objednávka nebyla nalezena.');

  const oldOrder = orderFromSheetRow_(values[row - 1]);
  const oldFulfilled = isFulfilledStatus_(oldOrder.status) ? eggQtyFromItems_(oldOrder.items) : 0;
  const newFulfilled = isFulfilledStatus_(order.status) ? eggQtyFromItems_(order.items) : 0;
  const fulfilledDelta = newFulfilled - oldFulfilled;

  // Pokud se vyzvednutá objednávka vrací mezi aktivní, nejprve vrátíme vejce do skladu,
  // aby se dostupnost nové rezervace počítala ze správného fyzického stavu.
  if (fulfilledDelta < 0) adjustEggStock_(-fulfilledDelta);

  try {
    validatePickupRules_(order, id);
    if (fulfilledDelta > 0) {
      ensureEggStockCanBeReduced_(fulfilledDelta);
      adjustEggStock_(-fulfilledDelta);
    }
  } catch (error) {
    if (fulfilledDelta < 0) adjustEggStock_(fulfilledDelta);
    throw error;
  }

  const created = values[row - 1][1] || new Date();
  const source = values[row - 1][9] || 'Administrace';
  const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');

  sheet.getRange(row, 1, 1, 11).setValues([[
    id, created, order.status, order.name, order.phone, order.pickup,
    itemsText, order.total, order.note, source, JSON.stringify(order.items)
  ]]);

  return htmlResponse_(true, 'Objednávka byla upravena.', id, {});
}

function deleteOrder_(payload) {
  const id = cleanText_(payload.id, 100);
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === id) sheet.deleteRow(i + 1);
  }
  return htmlResponse_(true, 'Objednávka byla smazána.', id, {});
}

function saveEggSettings_(payload) {
  const source = payload.settings || payload;
  const currentStock = clampInteger_(source.currentStock, 0, 100000, 'Aktuální sklad');
  const dailyProduction = clampInteger_(source.dailyProduction, 0, 10000, 'Denní snáška');
  const safetyReserve = clampInteger_(source.safetyReserve, 0, 100000, 'Bezpečnostní rezerva');
  const planningDays = clampInteger_(source.planningDays, 7, 365, 'Délka plánování');

  writeEggSettings_({
    currentStock: currentStock,
    stockDate: todayKey_(),
    dailyProduction: dailyProduction,
    safetyReserve: safetyReserve,
    planningDays: planningDays
  });

  return htmlResponse_(true, 'Nastavení vajec bylo uloženo.', '', {
    eggSettings: readEggSettings_()
  });
}

function validatePickupRules_(order, excludeOrderId) {
  if (!isReservingStatus_(order.status)) return;

  const today = todayKey_();
  if (order.pickup && order.pickup < today) {
    throw new Error('Termín vyzvednutí nemůže být v minulosti.');
  }

  const productMap = {};
  readProducts_().forEach(product => { productMap[String(product.id)] = product; });

  let requiredLeadDays = 0;
  order.items.forEach(item => {
    if (String(item.productId) === CONFIG.EGG_PRODUCT_ID) return;
    const product = productMap[String(item.productId)];
    if (product) requiredLeadDays = Math.max(requiredLeadDays, Number(product.leadDays || 0));
  });

  if (requiredLeadDays > 0) {
    if (!order.pickup) throw new Error('Vyberte termín vyzvednutí.');
    const minimum = addDaysKey_(today, requiredLeadDays);
    if (order.pickup < minimum) {
      throw new Error(`Nejbližší možný termín vyzvednutí ostatních produktů je ${formatDateForMessage_(minimum)}.`);
    }
  }

  validateEggAvailability_(order, excludeOrderId);
}

function validateEggAvailability_(order, excludeOrderId) {
  const eggQty = eggQtyFromItems_(order.items);
  if (!eggQty || !isReservingStatus_(order.status)) return;
  if (!order.pickup) throw new Error('Vyberte termín vyzvednutí vajec.');

  const plan = buildEggAvailability_(excludeOrderId || '');
  const selected = plan.days.find(day => day.date === order.pickup);

  if (!selected) {
    throw new Error(`Vejce lze nyní rezervovat nejvýše do ${formatDateForMessage_(plan.horizonEnd)}.`);
  }

  if (selected.maxAdditional < eggQty) {
    const earliest = plan.days.find(day => day.date >= todayKey_() && day.maxAdditional >= eggQty);
    if (earliest) {
      throw new Error(`Pro ${eggQty} vajec je nejbližší možný termín ${formatDateForMessage_(earliest.date)}.`);
    }
    throw new Error(`Požadovaných ${eggQty} vajec nelze při současné snášce zajistit během následujících ${plan.settings.planningDays} dní.`);
  }
}

function publicEggAvailability_() {
  const plan = buildEggAvailability_('');
  return {
    eggProductId: CONFIG.EGG_PRODUCT_ID,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    planningDays: plan.settings.planningDays,
    days: plan.days.map(day => ({
      date: day.date,
      maxAdditional: day.maxAdditional
    }))
  };
}

function buildEggAvailability_(excludeOrderId) {
  const settings = readEggSettings_();
  const today = todayKey_();
  const horizonEnd = addDaysKey_(today, settings.planningDays);
  const reservations = {};
  let calculationEnd = horizonEnd;

  readOrdersForAvailability_().forEach(order => {
    if (excludeOrderId && String(order.id) === String(excludeOrderId)) return;
    if (!isReservingStatus_(order.status)) return;

    const qty = eggQtyFromItems_(order.items);
    if (!qty) return;

    let pickup = order.pickup || today;
    if (pickup < today) pickup = today;
    reservations[pickup] = (reservations[pickup] || 0) + qty;
    if (pickup > calculationEnd) calculationEnd = pickup;
  });

  const totalDays = Math.max(0, daysBetweenKeys_(today, calculationEnd));
  const rows = [];
  let projectedStock = settings.currentStock;

  for (let index = 0; index <= totalDays; index++) {
    const date = addDaysKey_(today, index);
    if (index > 0) projectedStock += settings.dailyProduction;
    const reserved = reservations[date] || 0;
    projectedStock -= reserved;
    rows.push({
      date: date,
      reserved: reserved,
      projectedStock: projectedStock,
      maxAdditional: 0
    });
  }

  let suffixMinimum = Infinity;
  for (let index = rows.length - 1; index >= 0; index--) {
    suffixMinimum = Math.min(suffixMinimum, rows[index].projectedStock);
    rows[index].maxAdditional = Math.max(0, Math.floor(suffixMinimum - settings.safetyReserve));
  }

  return {
    settings: settings,
    horizonStart: today,
    horizonEnd: horizonEnd,
    days: rows.filter(row => row.date <= horizonEnd)
  };
}

function readEggSettings_() {
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  formatSettingsSheet_(sheet);
  seedEggSettings_(sheet);
  const values = readSettingsMap_(sheet);
  const today = todayKey_();

  const dailyProduction = safeInteger_(values.EGG_DAILY_PRODUCTION, CONFIG.DEFAULT_EGG_DAILY_PRODUCTION);
  const storedStock = safeInteger_(values.EGG_STOCK, CONFIG.DEFAULT_EGG_STOCK);
  const storedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(values.EGG_STOCK_DATE || ''))
    ? String(values.EGG_STOCK_DATE)
    : today;
  const elapsedDays = Math.max(0, daysBetweenKeys_(storedDate, today));

  return {
    currentStock: Math.max(0, storedStock + elapsedDays * dailyProduction),
    stockDate: today,
    dailyProduction: Math.max(0, dailyProduction),
    safetyReserve: Math.max(0, safeInteger_(values.EGG_SAFETY_RESERVE, CONFIG.DEFAULT_EGG_SAFETY_RESERVE)),
    planningDays: Math.min(365, Math.max(7, safeInteger_(values.EGG_PLANNING_DAYS, CONFIG.DEFAULT_EGG_PLANNING_DAYS)))
  };
}

function writeEggSettings_(settings) {
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  formatSettingsSheet_(sheet);
  setSetting_(sheet, 'EGG_STOCK', settings.currentStock, 'Aktuální fyzický počet vajec skladem');
  setSetting_(sheet, 'EGG_STOCK_DATE', settings.stockDate, 'Datum, ke kterému platí aktuální sklad');
  setSetting_(sheet, 'EGG_DAILY_PRODUCTION', settings.dailyProduction, 'Předpokládaný počet nových vajec za den');
  setSetting_(sheet, 'EGG_SAFETY_RESERVE', settings.safetyReserve, 'Počet vajec, který se zákazníkům nenabízí');
  setSetting_(sheet, 'EGG_PLANNING_DAYS', settings.planningDays, 'Kolik dní dopředu lze plánovat');
}

function adjustEggStock_(delta) {
  const settings = readEggSettings_();
  const nextStock = settings.currentStock + Number(delta || 0);
  if (nextStock < 0) throw new Error('Aktuální sklad vajec by klesl pod nulu. Nejprve upravte sklad v záložce Vejce.');
  settings.currentStock = Math.floor(nextStock);
  settings.stockDate = todayKey_();
  writeEggSettings_(settings);
}

function ensureEggStockCanBeReduced_(quantity) {
  const settings = readEggSettings_();
  if (settings.currentStock < quantity) {
    throw new Error(`Fyzicky je skladem pouze ${settings.currentStock} vajec. Nejprve upravte sklad nebo stav objednávky.`);
  }
}

function readProducts_() {
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  seedProducts_(sheet);
  repairDefaultProductSettings_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);

  return rows.filter(row => row[0] !== '').map(row => ({
    id: String(row[0]),
    emoji: String(row[1] || '📦'),
    name: String(row[2] || ''),
    price: Number(row[3] || 0),
    unit: String(row[4] || 'kus'),
    short: String(row[5] || ''),
    detail: String(row[6] || ''),
    visible: toBool_(row[7]),
    soldOut: toBool_(row[8]),
    restock: formatSheetDate_(row[9]),
    leadDays: String(row[0]) === CONFIG.EGG_PRODUCT_ID ? 0 : Number(row[10] || 0),
    quick: quickButtonsForProduct_(row[0], row[1], row[2], row[11])
  }));
}

function readOrders_() {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.filter(row => row[0] !== '').map(orderFromSheetRow_).reverse();
}

function readOrdersForAvailability_() {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[0] !== '')
    .map(orderFromSheetRow_);
}

function orderFromSheetRow_(row) {
  let items = [];
  try { items = JSON.parse(String(row[10] || '[]')); } catch (_) {}

  return {
    id: String(row[0] || ''),
    created: formatDateTime_(row[1]),
    status: String(row[2] || 'Nová'),
    name: String(row[3] || ''),
    phone: String(row[4] || ''),
    pickup: formatSheetDate_(row[5]),
    itemsText: String(row[6] || ''),
    items: Array.isArray(items) ? items : [],
    total: Number(row[7] || 0),
    note: String(row[8] || ''),
    source: String(row[9] || '')
  };
}

function validateOrder_(payload, manual) {
  const name = cleanText_(payload.name, 100);
  const phone = cleanText_(payload.phone, 40);
  const pickup = cleanText_(payload.pickup, 20);
  const note = cleanText_(payload.note, 500);
  const status = manual ? cleanText_(payload.status || 'Nová', 30) : 'Nová';

  if (name.length < 2) throw new Error('Neplatné jméno.');
  if (!manual && phone.length < 5) throw new Error('Neplatný telefon.');
  if (pickup && !/^\d{4}-\d{2}-\d{2}$/.test(pickup)) throw new Error('Neplatný termín vyzvednutí.');
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > CONFIG.MAX_ITEMS) {
    throw new Error('Neplatné položky.');
  }

  const productMap = {};
  readProducts_().forEach(product => { productMap[String(product.id)] = product; });

  const items = payload.items.map(item => {
    const productId = cleanText_(item.productId, 100);
    const submittedName = cleanText_(item.name, 100);
    const qty = Math.floor(Number(item.qty));
    const submittedPrice = Number(item.price);
    const product = productMap[productId];
    if (!product) throw new Error('Objednaný produkt už neexistuje. Obnovte stránku a zkuste to znovu.');
    if (!manual && (!product.visible || product.soldOut)) {
      throw new Error(`Produkt ${product.name} nyní není možné objednat.`);
    }

    const nameValue = product.name;
    const priceValue = Number(product.price);

    if (!productId || !nameValue || !Number.isInteger(qty) || qty < 1 || qty > CONFIG.MAX_QUANTITY_PER_ITEM || !Number.isFinite(priceValue) || priceValue < 0) {
      throw new Error('Neplatná položka.');
    }

    return { productId: productId, name: nameValue, qty: qty, price: priceValue };
  });

  return {
    name: name,
    phone: phone,
    pickup: pickup,
    note: note,
    status: status,
    items: items,
    total: items.reduce((sum, item) => sum + item.qty * item.price, 0)
  };
}

function normalizeProduct_(product) {
  const id = cleanText_(product.id, 100) || Utilities.getUuid();
  const emoji = cleanText_(product.emoji || '📦', 10);
  const name = cleanText_(product.name, 100);

  return {
    id: id,
    emoji: emoji,
    name: name,
    price: Math.max(0, Number(product.price) || 0),
    unit: cleanText_(product.unit || 'kus', 30),
    short: cleanText_(product.short, 300),
    detail: cleanText_(product.detail, 1000),
    visible: Boolean(product.visible),
    soldOut: Boolean(product.soldOut),
    restock: cleanText_(product.restock, 20),
    leadDays: String(id) === CONFIG.EGG_PRODUCT_ID ? 0 : Math.max(0, Math.floor(Number(product.leadDays) || 0)),
    quick: quickButtonsForProduct_(id, emoji, name, product.quick)
  };
}

function eggQtyFromItems_(items) {
  return (items || [])
    .filter(item => String(item.productId) === CONFIG.EGG_PRODUCT_ID)
    .reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.qty) || 0)), 0);
}

function isReservingStatus_(status) {
  return !['Vyzvednuto', 'Zrušeno'].includes(String(status || 'Nová'));
}

function isFulfilledStatus_(status) {
  return String(status || '') === 'Vyzvednuto';
}

function getOrCreateSheet_(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Skript musí být vytvořený z Google Tabulky.');
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function formatOrdersSheet_(sheet) {
  const headers = ['ID objednávky', 'Vytvořeno', 'Stav', 'Jméno', 'Telefon', 'Termín vyzvednutí', 'Položky', 'Celkem Kč', 'Poznámka', 'Zdroj', 'ItemsJSON'];
  ensureHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
}

function formatProductsSheet_(sheet) {
  const headers = ['ID', 'Emoji', 'Název', 'Cena', 'Jednotka', 'Krátký popis', 'Podrobnosti', 'Viditelný', 'Vyprodáno', 'Doplnění', 'Předstih dní', 'Rychlá tlačítka', 'Aktualizováno'];
  ensureHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
}

function formatSettingsSheet_(sheet) {
  const headers = ['Klíč', 'Hodnota', 'Popis'];
  ensureHeaders_(sheet, headers);
  sheet.setFrozenRows(1);
}

function ensureHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function seedProducts_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const now = new Date();
  sheet.getRange(2, 1, 2, 13).setValues([
    ['1', '🍯', 'Květový med', 190, '950 g', 'Smíšený květový med z okolí Lukášova.', 'Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.', true, false, '', 0, '', now],
    ['2', '🥚', 'Čerstvá vejce', 7, 'kus', 'Vejce od našich slepic z domácího chovu.', 'Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.', true, false, '', 0, '6, 10, 30', now]
  ]);
}

function repairDefaultProductSettings_(sheet) {
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) !== CONFIG.EGG_PRODUCT_ID) continue;

    const leadDays = Number(values[row][10] || 0);
    const quick = String(values[row][11] || '').replace(/\s+/g, '');
    if (leadDays === 0 && quick === '6,10,30') return;

    sheet.getRange(row + 1, 11, 1, 3).setValues([[0, '6, 10, 30', new Date()]]);
    return;
  }
}

function quickButtonsForProduct_(id, emoji, name, value) {
  if (String(id) === CONFIG.EGG_PRODUCT_ID) return [6, 10, 30];
  const text = `${emoji || ''} ${name || ''}`.toLocaleLowerCase('cs-CZ');
  if (text.indexOf('🥚') !== -1 || text.indexOf('vejce') !== -1) return [6, 10, 30];
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source.map(item => Number(String(item).trim())).filter(item => Number.isFinite(item) && item > 0);
}

function seedEggSettings_(sheet) {
  const today = todayKey_();
  setSettingIfMissing_(sheet, 'EGG_STOCK', CONFIG.DEFAULT_EGG_STOCK, 'Aktuální fyzický počet vajec skladem');
  setSettingIfMissing_(sheet, 'EGG_STOCK_DATE', today, 'Datum, ke kterému platí aktuální sklad');
  setSettingIfMissing_(sheet, 'EGG_DAILY_PRODUCTION', CONFIG.DEFAULT_EGG_DAILY_PRODUCTION, 'Předpokládaný počet nových vajec za den');
  setSettingIfMissing_(sheet, 'EGG_SAFETY_RESERVE', CONFIG.DEFAULT_EGG_SAFETY_RESERVE, 'Počet vajec, který se zákazníkům nenabízí');
  setSettingIfMissing_(sheet, 'EGG_PLANNING_DAYS', CONFIG.DEFAULT_EGG_PLANNING_DAYS, 'Kolik dní dopředu lze plánovat');
}

function readSettingsMap_(sheet) {
  const map = {};
  const rows = sheet.getDataRange().getValues().slice(1);
  rows.forEach(row => {
    if (row[0] !== '') map[String(row[0])] = row[1];
  });
  return map;
}

function setSettingIfMissing_(sheet, key, value, description) {
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) === key) return;
  }
  sheet.appendRow([key, value, description]);
}

function setSetting_(sheet, key, value, description) {
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) === key) {
      sheet.getRange(row + 1, 2, 1, 2).setValues([[value, description]]);
      return;
    }
  }
  sheet.appendRow([key, value, description]);
}

function clampInteger_(value, minimum, maximum, label) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} musí být celé číslo od ${minimum} do ${maximum}.`);
  }
  return number;
}

function safeInteger_(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function todayKey_() {
  return Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function parseDateKey_(value) {
  return new Date(String(value) + 'T12:00:00');
}

function addDaysKey_(value, days) {
  const date = parseDateKey_(value);
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function daysBetweenKeys_(from, to) {
  return Math.round((parseDateKey_(to).getTime() - parseDateKey_(from).getTime()) / 86400000);
}

function formatDateForMessage_(value) {
  return Utilities.formatDate(parseDateKey_(value), CONFIG.TIME_ZONE, 'd. M. yyyy');
}

function cleanText_(value, maximumLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function toBool_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function formatSheetDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }
  return String(value).slice(0, 10);
}

function formatDateTime_(value) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date) ? String(value) : Utilities.formatDate(date, CONFIG.TIME_ZONE, 'd. M. yyyy HH:mm');
}

function generatePassword_() {
  return 'PDP-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function jsonpResponse_(e, object) {
  const callback = String(e && e.parameter && e.parameter.callback || 'callback').replace(/[^a-zA-Z0-9_.$]/g, '');
  return ContentService.createTextOutput(`${callback}(${JSON.stringify(object)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function htmlResponse_(ok, message, id, extra) {
  const result = Object.assign({
    type: 'PDP_BACKEND_RESULT',
    ok: ok,
    message: message,
    id: id
  }, extra || {});

  const resultJson = JSON.stringify(result).replace(/</g, '\u003c');
  const html = `<!doctype html>
<html lang="cs">
<head><meta charset="utf-8"><title>Výsledek</title></head>
<body>
<script>
(function () {
  const result = ${resultJson};
  function sendResult() {
    try { window.parent.postMessage(result, '*'); } catch (error) {}
    try { window.top.postMessage(result, '*'); } catch (error) {}
  }
  sendResult();
  setTimeout(sendResult, 100);
  setTimeout(sendResult, 500);
})();
<\/script>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function buildTextEmail_(order, id, createdAt) {
  return [
    'Nová objednávka',
    '',
    `Číslo: ${id}`,
    `Přijata: ${Utilities.formatDate(createdAt, CONFIG.TIME_ZONE, 'd. M. yyyy HH:mm')}`,
    `Jméno: ${order.name}`,
    `Telefon: ${order.phone}`,
    `Vyzvednutí: ${order.pickup || 'neuvedeno'}`,
    '',
    'Položky:',
    ...order.items.map(item => `- ${item.qty}× ${item.name}: ${item.qty * item.price} Kč`),
    '',
    `Celkem: ${order.total} Kč`,
    `Poznámka: ${order.note || '—'}`
  ].join('\n');
}

function buildHtmlEmail_(order, id) {
  const rows = order.items.map(item => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml_(item.qty + '× ' + item.name)}</td><td style="text-align:right;font-weight:700">${item.qty * item.price} Kč</td></tr>`).join('');
  return `<div style="font-family:Arial;max-width:600px"><h2>${escapeHtml_(CONFIG.BRAND_NAME)}</h2><p><b>Jméno:</b> ${escapeHtml_(order.name)}<br><b>Telefon:</b> ${escapeHtml_(order.phone)}<br><b>Vyzvednutí:</b> ${escapeHtml_(order.pickup || 'neuvedeno')}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:22px;text-align:right"><b>Celkem: ${order.total} Kč</b></p><p><b>Poznámka:</b> ${escapeHtml_(order.note || '—')}</p><small>ID: ${escapeHtml_(id)}</small></div>`;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
