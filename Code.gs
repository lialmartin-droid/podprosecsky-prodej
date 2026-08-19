/**
 * Podprosečské domácí produkty — sdílený backend V3.2.0
 * Produkty, objednávky a plánování dostupnosti vajec jsou uloženy v jedné Google Tabulce.
 */
const CONFIG = Object.freeze({
  NOTIFICATION_EMAIL: 'podprosecskeprodukty@gmail.com',
  ORDERS_SHEET: 'Objednávky',
  PRODUCTS_SHEET: 'Produkty',
  SETTINGS_SHEET: 'Nastavení',
  WATCHLIST_SHEET: 'Hlídací pes',
  VISITS_SHEET: 'Návštěvnost',
  NOTIFICATION_QUEUE_SHEET: 'E-mail fronta',
  BRAND_NAME: 'Podprosečské domácí produkty',
  TIME_ZONE: 'Europe/Prague',
  SESSION_SECONDS: 21600,
  MAX_ITEMS: 20,
  MAX_QUANTITY_PER_ITEM: 500,
  ORDER_STATUSES: Object.freeze(['Nová', 'Připravuji', 'Připraveno', 'Vyzvednuto', 'Zrušeno']),
  EGG_PRODUCT_ID: '2',
  DEFAULT_EGG_STOCK: 0,
  DEFAULT_EGG_DAILY_PRODUCTION: 10,
  DEFAULT_EGG_SAFETY_RESERVE: 0,
  DEFAULT_EGG_PLANNING_DAYS: 60,
  MAX_IMAGE_BYTES: 1600000,
  PRODUCT_IMAGES_FOLDER: 'Podprosecske_produkty_obrazky',
  PUBLIC_CACHE_SECONDS: 60,
  PUBLIC_CATALOG_CACHE_SECONDS: 21600,
  VISIT_STATS_CACHE_SECONDS: 60
});

function setup() {
  const orders = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const products = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  const settings = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  const watchlist = getOrCreateSheet_(CONFIG.WATCHLIST_SHEET);
  const visits = getOrCreateSheet_(CONFIG.VISITS_SHEET);
  const notificationQueue = getOrCreateSheet_(CONFIG.NOTIFICATION_QUEUE_SHEET);

  formatOrdersSheet_(orders);
  ensureOrderNumbers_(orders);
  formatProductsSheet_(products);
  formatSettingsSheet_(settings);
  formatWatchlistSheet_(watchlist);
  formatVisitsSheet_(visits);
  formatOrderNotificationQueueSheet_(notificationQueue);
  seedProducts_(products);
  repairDefaultProductSettings_(products);
  seedEggSettings_(settings);
  normalizeEggStockDateSetting_(settings);
  ensurePickupReminderTrigger_();
  ensureOrderNotificationQueueTrigger_(true);

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


function productPreorderMap_() {
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  seedProducts_(sheet);
  const map = {};
  sheet.getDataRange().getValues().slice(1).forEach(row => {
    if (row[0] === '') return;
    map[String(row[0])] = toBool_(row[13]);
  });
  return map;
}

function itemPartStatus_(order, productId, preorderMap) {
  if (!order || !order.splitOrder) return String(order && order.status || 'Nová');
  return (preorderMap || {})[String(productId)]
    ? String(order.preorderStatus || 'Nová')
    : String(order.regularStatus || order.status || 'Nová');
}

function itemPickupDate_(order, productId, preorderMap) {
  if (order && order.splitOrder && (preorderMap || {})[String(productId)]) {
    return order.preorderPickup || order.pickup || todayKey_();
  }
  return order && order.pickup || todayKey_();
}

function reservationMapFromOrders_(orders, preorderMap) {
  const map = {};
  (orders || []).forEach(order => {
    (order.items || []).forEach(item => {
      const id = String(item.productId || '');
      if (!id || !isReservingStatus_(itemPartStatus_(order, id, preorderMap))) return;
      map[id] = (map[id] || 0) + Math.max(0, Number(item.qty) || 0);
    });
  });
  return map;
}

function publicPayloadCacheKey_() {
  return 'public-payload-v311';
}

function publicCatalogCacheKey_() {
  return 'public-catalog-v310';
}

function publicReservationIndexPropertyKey_() {
  return 'PUBLIC_RESERVATION_INDEX_V310';
}

function invalidatePublicPayloadCache_() {
  try { CacheService.getScriptCache().remove(publicPayloadCacheKey_()); } catch (error) { console.error('Vymazání veřejné cache selhalo.', error); }
}

function invalidatePublicCatalogCache_() {
  try { CacheService.getScriptCache().remove(publicCatalogCacheKey_()); } catch (error) { console.error('Vymazání cache katalogu selhalo.', error); }
  invalidatePublicPayloadCache_();
}

function invalidatePublicReservationIndex_() {
  try { PropertiesService.getScriptProperties().deleteProperty(publicReservationIndexPropertyKey_()); }
  catch (error) { console.error('Vymazání rychlého indexu rezervací selhalo.', error); }
  invalidatePublicPayloadCache_();
}

function visitStatsCacheKey_() {
  return 'visit-stats-v280';
}

function invalidateVisitStatsCache_() {
  try { CacheService.getScriptCache().remove(visitStatsCacheKey_()); } catch (error) { console.error('Vymazání cache návštěvnosti selhalo.', error); }
}

function refreshPublicPayloadCache_() {
  invalidatePublicPayloadCache_();
  try { buildPublicPayload_(); } catch (error) { console.error('Předehřátí veřejné nabídky selhalo.', error); }
}

function publicSheetRowsFast_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Chybí list ${sheetName}. Spusťte jednou funkci setup().`);
  const values = sheet.getDataRange().getValues();
  return values.length > 1 ? values.slice(1) : [];
}

function settingsMapFromRowsFast_(rows) {
  const map = {};
  (rows || []).forEach(row => {
    if (row[0] !== '') map[String(row[0])] = row[1];
  });
  return map;
}

function eggSettingsFromMapFast_(values) {
  const today = todayKey_();
  const dailyProduction = safeInteger_(values.EGG_DAILY_PRODUCTION, CONFIG.DEFAULT_EGG_DAILY_PRODUCTION);
  const storedStock = safeInteger_(values.EGG_STOCK, CONFIG.DEFAULT_EGG_STOCK);
  const storedDate = normalizeDateKey_(values.EGG_STOCK_DATE, today);
  const elapsedDays = Math.max(0, daysBetweenKeys_(storedDate, today));
  const accruedEggs = elapsedDays * Math.max(0, dailyProduction);

  return {
    baseStock: Math.max(0, storedStock),
    baseDate: storedDate,
    elapsedDays: elapsedDays,
    accruedEggs: accruedEggs,
    currentStock: Math.max(0, storedStock + accruedEggs),
    stockDate: today,
    dailyProduction: Math.max(0, dailyProduction),
    safetyReserve: Math.max(0, safeInteger_(values.EGG_SAFETY_RESERVE, CONFIG.DEFAULT_EGG_SAFETY_RESERVE)),
    planningDays: Math.min(365, Math.max(7, safeInteger_(values.EGG_PLANNING_DAYS, CONFIG.DEFAULT_EGG_PLANNING_DAYS)))
  };
}

function publicBusinessSettingsFromMapFast_(map) {
  return {
    bannerEnabled: toBool_(map.BANNER_ENABLED),
    bannerStyle: cleanText_(map.BANNER_STYLE || 'yellow', 20),
    bannerTitle: restoreSheetText_(map.BANNER_TITLE || ''),
    bannerText: restoreSheetText_(map.BANNER_TEXT || ''),
    bannerFrom: normalizeDateKey_(map.BANNER_FROM, ''),
    bannerTo: normalizeDateKey_(map.BANNER_TO, ''),
    ordersPaused: toBool_(map.ORDERS_PAUSED),
    pauseFrom: normalizeDateKey_(map.PAUSE_FROM, ''),
    pauseTo: normalizeDateKey_(map.PAUSE_TO, ''),
    pauseMessage: restoreSheetText_(map.PAUSE_MESSAGE || ''),
    dailyOrderLimit: Math.max(0, safeInteger_(map.DAILY_ORDER_LIMIT, 0))
  };
}

function publicProductsFromRowsFast_(rows) {
  return (rows || []).filter(row => row[0] !== '').map(row => ({
    id: String(row[0]),
    emoji: restoreSheetText_(row[1] || '📦'),
    name: restoreSheetText_(row[2] || ''),
    price: Number(row[3] || 0),
    unit: restoreSheetText_(row[4] || 'kus'),
    short: restoreSheetText_(row[5] || ''),
    detail: restoreSheetText_(row[6] || ''),
    visible: toBool_(row[7]),
    soldOut: toBool_(row[8]),
    restock: formatSheetDate_(row[9]),
    leadDays: String(row[0]) === CONFIG.EGG_PRODUCT_ID ? 0 : Number(row[10] || 0),
    quick: quickButtonsForProduct_(row[0], row[1], row[2], row[11]),
    preorder: toBool_(row[13]),
    preorderDate: formatSheetDate_(row[14]) || formatSheetDate_(row[9]),
    capacity: Number(row[15] || 0),
    emailGroup: normalizeEmailGroup_(row[16], row[2]),
    emailText: restoreSheetText_(row[17] || ''),
    image: restoreSheetText_(row[18] || ''),
    stock: Math.max(0, Number(row[19] || 0)),
    stockUnit: restoreSheetText_(row[20] || 'ks'),
    soldOutText: restoreSheetText_(row[21] || 'Momentálně vyprodáno')
  }));
}

function readPublicCatalogFast_() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(publicCatalogCacheKey_());
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.version === 'v310' && Array.isArray(parsed.products) && parsed.settingsMap) return parsed;
    }
  } catch (error) {
    console.error('Načtení rychlé cache katalogu selhalo.', error);
  }

  // Veřejné čtení nic neopravuje ani neformátuje. Každý list se načte právě jednou.
  const productRows = publicSheetRowsFast_(CONFIG.PRODUCTS_SHEET);
  const settingsRows = publicSheetRowsFast_(CONFIG.SETTINGS_SHEET);
  const products = publicProductsFromRowsFast_(productRows);
  const settingsMap = settingsMapFromRowsFast_(settingsRows);
  const preorderMap = {};
  products.forEach(product => { preorderMap[String(product.id)] = Boolean(product.preorder); });

  const catalog = {
    version: 'v310',
    products: products,
    settingsMap: settingsMap,
    preorderMap: preorderMap
  };
  try {
    cache.put(publicCatalogCacheKey_(), JSON.stringify(catalog), CONFIG.PUBLIC_CATALOG_CACHE_SECONDS);
  } catch (error) {
    console.error('Uložení rychlé cache katalogu selhalo.', error);
  }
  return catalog;
}

function availabilityOrderFromSheetRowFast_(row) {
  let items = [];
  try { items = JSON.parse(String(row[10] || '[]')); } catch (_) {}
  const status = String(row[2] || 'Nová');
  const splitOrder = toBool_(row[13]);
  return {
    id: String(row[0] || ''),
    status: status,
    pickup: formatSheetDate_(row[5]),
    items: Array.isArray(items) ? items : [],
    splitOrder: splitOrder,
    preorderPickup: formatSheetDate_(row[14]),
    regularStatus: String(row[15] || status || 'Nová'),
    preorderStatus: String(row[16] || 'Nová')
  };
}

function reservationContributionFast_(order, preorderMap) {
  const contribution = { totals: {}, eggsByDate: {} };
  (order && order.items || []).forEach(item => {
    const id = String(item.productId || '');
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    if (!id || !qty || !isReservingStatus_(itemPartStatus_(order, id, preorderMap))) return;

    contribution.totals[id] = (contribution.totals[id] || 0) + qty;
    if (id === CONFIG.EGG_PRODUCT_ID) {
      const pickup = itemPickupDate_(order, id, preorderMap) || todayKey_();
      contribution.eggsByDate[pickup] = (contribution.eggsByDate[pickup] || 0) + qty;
    }
  });
  return contribution;
}

function applyCountMapDeltaFast_(target, delta, multiplier) {
  Object.keys(delta || {}).forEach(key => {
    const next = Math.max(0, Math.floor(Number(target[key] || 0) + multiplier * Number(delta[key] || 0)));
    if (next > 0) target[key] = next;
    else delete target[key];
  });
}

function normalizeCountMapFast_(source) {
  const result = {};
  Object.keys(source || {}).forEach(key => {
    const value = Math.max(0, Math.floor(Number(source[key]) || 0));
    if (value > 0) result[String(key)] = value;
  });
  return result;
}

function normalizeReservationIndexFast_(value) {
  if (!value || value.version !== 'v310') return null;
  return {
    version: 'v310',
    totals: normalizeCountMapFast_(value.totals),
    eggsByDate: normalizeCountMapFast_(value.eggsByDate),
    updatedAt: String(value.updatedAt || '')
  };
}

function buildReservationIndexFast_(orders, preorderMap) {
  const index = { version: 'v310', totals: {}, eggsByDate: {}, updatedAt: new Date().toISOString() };
  (orders || []).forEach(order => {
    const contribution = reservationContributionFast_(order, preorderMap);
    applyCountMapDeltaFast_(index.totals, contribution.totals, 1);
    applyCountMapDeltaFast_(index.eggsByDate, contribution.eggsByDate, 1);
  });
  return index;
}

function writePublicReservationIndexFast_(index) {
  const normalized = normalizeReservationIndexFast_(index);
  if (!normalized) throw new Error('Neplatný rychlý index rezervací.');
  normalized.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(publicReservationIndexPropertyKey_(), JSON.stringify(normalized));
  return normalized;
}

function readPublicReservationIndexFast_(preorderMap) {
  const properties = PropertiesService.getScriptProperties();
  try {
    const raw = properties.getProperty(publicReservationIndexPropertyKey_());
    if (raw) {
      const parsed = normalizeReservationIndexFast_(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch (error) {
    console.error('Načtení rychlého indexu rezervací selhalo.', error);
  }

  // Jednorázová migrace po nasazení. Další veřejná načtení už list Objednávky vůbec nečtou.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const secondRaw = properties.getProperty(publicReservationIndexPropertyKey_());
    if (secondRaw) {
      try {
        const secondParsed = normalizeReservationIndexFast_(JSON.parse(secondRaw));
        if (secondParsed) return secondParsed;
      } catch (parseError) {
        console.error('Rychlý index rezervací je poškozený a vytvoří se znovu.', parseError);
      }
    }
    const orders = publicSheetRowsFast_(CONFIG.ORDERS_SHEET)
      .filter(row => row[0] !== '')
      .map(availabilityOrderFromSheetRowFast_);
    return writePublicReservationIndexFast_(buildReservationIndexFast_(orders, preorderMap || {}));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function updatePublicReservationIndexFast_(oldOrder, newOrder, preorderMap) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(publicReservationIndexPropertyKey_());
    if (!raw) return false;
    const index = normalizeReservationIndexFast_(JSON.parse(raw));
    if (!index) throw new Error('Index má starou verzi.');
    const parts = preorderMap || readPublicCatalogFast_().preorderMap || {};
    const before = reservationContributionFast_(oldOrder, parts);
    const after = reservationContributionFast_(newOrder, parts);
    applyCountMapDeltaFast_(index.totals, before.totals, -1);
    applyCountMapDeltaFast_(index.eggsByDate, before.eggsByDate, -1);
    applyCountMapDeltaFast_(index.totals, after.totals, 1);
    applyCountMapDeltaFast_(index.eggsByDate, after.eggsByDate, 1);
    writePublicReservationIndexFast_(index);
    invalidatePublicPayloadCache_();
    return true;
  } catch (error) {
    console.error('Aktualizace rychlého indexu rezervací selhala.', error);
    invalidatePublicReservationIndex_();
    return false;
  }
}

function buildEggAvailabilityFromIndexFast_(settings, index) {
  const today = todayKey_();
  const horizonEnd = addDaysKey_(today, settings.planningDays);
  const reservations = {};
  let calculationEnd = horizonEnd;

  Object.keys(index && index.eggsByDate || {}).forEach(sourceDate => {
    const qty = Math.max(0, Math.floor(Number(index.eggsByDate[sourceDate]) || 0));
    if (!qty) return;
    const pickup = sourceDate < today ? today : sourceDate;
    reservations[pickup] = (reservations[pickup] || 0) + qty;
    if (pickup > calculationEnd) calculationEnd = pickup;
  });

  const totalDays = Math.max(0, daysBetweenKeys_(today, calculationEnd));
  const rows = [];
  let projectedStock = settings.currentStock;
  for (let indexDay = 0; indexDay <= totalDays; indexDay++) {
    const date = addDaysKey_(today, indexDay);
    if (indexDay > 0) projectedStock += settings.dailyProduction;
    const reserved = reservations[date] || 0;
    projectedStock -= reserved;
    rows.push({ date: date, reserved: reserved, projectedStock: projectedStock, maxAdditional: 0 });
  }

  let suffixMinimum = Infinity;
  for (let indexDay = rows.length - 1; indexDay >= 0; indexDay--) {
    suffixMinimum = Math.min(suffixMinimum, rows[indexDay].projectedStock);
    rows[indexDay].maxAdditional = Math.max(0, Math.floor(suffixMinimum - settings.safetyReserve));
  }

  return {
    settings: settings,
    horizonStart: today,
    horizonEnd: horizonEnd,
    days: rows.filter(row => row.date <= horizonEnd)
  };
}

function publicProductsWithAvailabilityFast_(baseProducts, reservationIndex, eggAvailability) {
  const eggToday = eggAvailability && eggAvailability.days && eggAvailability.days.length
    ? eggAvailability.days[0]
    : null;
  return (baseProducts || []).map(product => {
    const id = String(product.id || '');
    const reserved = Math.max(0, Number(reservationIndex && reservationIndex.totals && reservationIndex.totals[id] || 0));
    return Object.assign({}, product, {
      reserved: reserved,
      availableStock: id === CONFIG.EGG_PRODUCT_ID
        ? Math.max(0, Math.floor(Number(eggToday && eggToday.maxAdditional || 0)))
        : Math.max(0, Math.floor(Number(product.stock || 0) - reserved))
    });
  });
}

function buildPublicPayload_() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(publicPayloadCacheKey_());
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.ok && parsed.version === '3.1.1' && Array.isArray(parsed.products)) return parsed;
    }
  } catch (error) {
    console.error('Načtení veřejné cache selhalo.', error);
  }

  const catalog = readPublicCatalogFast_();
  const reservationIndex = readPublicReservationIndexFast_(catalog.preorderMap);
  const eggSettings = eggSettingsFromMapFast_(catalog.settingsMap);
  const availability = buildEggAvailabilityFromIndexFast_(eggSettings, reservationIndex);
  const payload = {
    ok: true,
    version: '3.1.1',
    products: publicProductsWithAvailabilityFast_(catalog.products, reservationIndex, availability),
    availability: availability,
    settings: publicBusinessSettingsFromMapFast_(catalog.settingsMap),
    generatedAt: new Date().toISOString()
  };

  try {
    cache.put(publicPayloadCacheKey_(), JSON.stringify(payload), CONFIG.PUBLIC_CACHE_SECONDS);
  } catch (error) {
    console.error('Uložení veřejné cache selhalo.', error);
  }
  return payload;
}

/** Spusťte jednou po nasazení V3.1.1, aby byl rychlý index připravený ještě před první návštěvou. */
function setupFastPublicOfferV311() {
  return withMutationLock_(() => {
    invalidatePublicCatalogCache_();
    invalidatePublicReservationIndex_();
    const catalog = readPublicCatalogFast_();
    const orders = publicSheetRowsFast_(CONFIG.ORDERS_SHEET)
      .filter(row => row[0] !== '')
      .map(availabilityOrderFromSheetRowFast_);
    writePublicReservationIndexFast_(buildReservationIndexFast_(orders, catalog.preorderMap));
    invalidatePublicPayloadCache_();
    const payload = buildPublicPayload_();
    const egg = (payload.products || []).find(product => String(product.id) === CONFIG.EGG_PRODUCT_ID);
    return `Rychlá nabídka je připravená. Aktuálně dostupné množství vajec: ${Math.max(0, Number(egg && egg.availableStock || 0))} ks.`;
  }, 20000);
}

function buildAdminPayload_() {
  // Admin při otevření čte list Objednávky jen jednou. Produkty a nastavení
  // sdílí s rychlou veřejnou cache, která se po každé změně automaticky zneplatní.
  const catalog = readPublicCatalogFast_();
  const orders = readOrdersAdminFast_();
  const preorderMap = catalog.preorderMap || {};
  const reservations = reservationMapFromOrders_(orders, preorderMap);
  const eggSettings = eggSettingsFromMapFast_(catalog.settingsMap || {});
  const availability = buildEggAvailability_('', orders, preorderMap, eggSettings);
  return {
    ok: true,
    version: '3.2.0',
    products: readProductsFast_(reservations, availability, catalog.products),
    orders: orders,
    eggSettings: availability.settings,
    eggAvailability: availability,
    businessSettings: publicBusinessSettingsFromMapFast_(catalog.settingsMap || {}),
    generatedAt: new Date().toISOString()
  };
}

function buildAdminPlanningPayload_() {
  const catalog = readPublicCatalogFast_();
  const orders = readOrdersAdminFast_();
  const preorderMap = catalog.preorderMap || {};
  const reservations = reservationMapFromOrders_(orders, preorderMap);
  const eggSettings = eggSettingsFromMapFast_(catalog.settingsMap || {});
  const availability = buildEggAvailability_('', orders, preorderMap, eggSettings);
  return {
    ok: true,
    version: '3.2.0',
    products: readProductsFast_(reservations, availability, catalog.products),
    eggSettings: availability.settings,
    eggAvailability: availability,
    generatedAt: new Date().toISOString()
  };
}

function readOrdersAdminFast_() {
  return publicSheetRowsFast_(CONFIG.ORDERS_SHEET)
    .filter(row => row[0] !== '')
    .map(orderFromSheetRow_)
    .reverse();
}

function readProductsFast_(reservationMap, eggAvailability, suppliedProducts) {
  const products = Array.isArray(suppliedProducts)
    ? suppliedProducts
    : readPublicCatalogFast_().products;
  const eggToday = eggAvailability && eggAvailability.days && eggAvailability.days.length
    ? eggAvailability.days[0]
    : null;

  return products.map(source => {
    const product = Object.assign({}, source || {});
    const id = String(product.id || '');
    const reserved = Math.max(0, Number((reservationMap || {})[id] || 0));
    const stock = Math.max(0, Number(product.stock || 0));
    return Object.assign(product, {
      reserved: reserved,
      availableStock: id === CONFIG.EGG_PRODUCT_ID
        // U vajec musí být stejná kapacita jako v plánu: budoucí rezervace kryje i snáška
        // do jejich termínu. Prosté odečtení všech rezervací od dnešního skladu bylo zbytečně přísné.
        ? Math.max(0, Math.floor(Number(eggToday && eggToday.maxAdditional || 0)))
        : Math.max(0, Math.floor(stock - reserved))
    });
  });
}

function doGet(e) {
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action || 'health', 40);

    if (action === 'products') {
      return jsonpResponse_(e, buildPublicPayload_());
    }

    if (action === 'availability') {
      return jsonpResponse_(e, {
        ok: true,
        availability: publicEggAvailability_()
      });
    }

    if (action === 'trackVisit') {
      return jsonpResponse_(e, trackVisitFromRequest_(e));
    }

    if (action === 'adminData') {
      requireToken_(e.parameter.token || '');
      return jsonpResponse_(e, buildAdminPayload_());
    }

    if (action === 'adminPlanningData') {
      requireToken_(e.parameter.token || '');
      return jsonpResponse_(e, buildAdminPlanningPayload_());
    }

    return jsonpResponse_(e, {
      ok: true,
      service: CONFIG.BRAND_NAME,
      version: '3.2.0',
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    return jsonpResponse_(e, { ok: false, message: error.message || 'Chyba serveru.' });
  }
}

function withMutationLock_(callback, timeoutMs) {
  const lock = LockService.getScriptLock();
  const timeout = Math.max(1000, Number(timeoutMs || 10000));
  try {
    lock.waitLock(timeout);
    return callback();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doPost(e) {
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action || 'createOrder', 40);
    const payload = JSON.parse(e && e.parameter && e.parameter.payload || '{}');

    // Veřejné operace nesmí čekat na administrativní upload, e-maily ani jiné pomalé akce.
    if (action === 'login') return login_(payload);
    if (action === 'createOrder') return createOrder_(payload, false);
    if (action === 'subscribeStock') return withMutationLock_(() => subscribeStock_(payload), 10000);

    const token = cleanText_(e.parameter.token || payload.token || '', 100);
    requireToken_(token);

    // Čtení a upload obrázků nepotřebují globální tabulkový zámek.
    if (action === 'uploadProductImage') return uploadProductImage_(payload);
    if (action === 'listProductImages') return listProductImages_();
    if (action === 'deleteProductImage') return deleteProductImage_(payload);

    // Krátké mutace tabulky serializujeme, ale zámek se nedrží přes veřejné objednávky.
    if (action === 'saveProduct') return withMutationLock_(() => saveProduct_(payload), 10000);
    if (action === 'deleteProduct') return withMutationLock_(() => deleteProduct_(payload), 10000);
    if (action === 'saveOrder') return saveOrder_(payload, true);
    if (action === 'deleteOrder') return withMutationLock_(() => deleteOrder_(payload), 10000);
    if (action === 'manualOrder') return createOrder_(payload, true);
    if (action === 'saveEggSettings') return withMutationLock_(() => saveEggSettings_(payload), 10000);
    if (action === 'saveBusinessSettings') return withMutationLock_(() => saveBusinessSettings_(payload), 10000);
    if (action === 'resendReadyEmail') return resendReadyEmail_(payload);
    if (action === 'sendPickupReminder') return sendPickupReminder_(payload);
    if (action === 'setVisitExclusion') return withMutationLock_(() => setVisitExclusion_(payload), 10000);

    // Volitelné rozšíření V2.6+ (sklad obalů a přesné návštěvy).
    const extensionResult = typeof handleV26Action_ === 'function' ? handleV26Action_(action, payload) : null;
    if (extensionResult) return extensionResult;

    throw new Error('Neznámá operace.');
  } catch (error) {
    console.error(error);
    return htmlResponse_(false, friendlyBackendError_(error), '', {});
  }
}

function friendlyBackendError_(error) {
  const message = String(error && error.message || 'Operaci se nepodařilo dokončit.');
  if (/timed out while waiting for lock|časový limit zámku|lock/i.test(message)) {
    return 'Server právě dokončuje jinou změnu. Objednávku prosím odešlete znovu za několik sekund.';
  }
  if (/spreadsheet|tabulk|service spreadsheets/i.test(message)) {
    return 'Google Tabulka byla dočasně nedostupná. Objednávku zkuste znovu za několik sekund.';
  }
  return message;
}

function trackVisitFromRequest_(e) {
  return trackVisit_({
    visitorId: e && e.parameter && (e.parameter.visitorId || e.parameter.visitor || ''),
    source: e && e.parameter && (e.parameter.source || e.parameter.src || ''),
    path: e && e.parameter && (e.parameter.path || '/'),
    title: e && e.parameter && (e.parameter.title || '')
  });
}

function normalizeVisitSource_(value) {
  const source = cleanText_(value || '', 40).toLowerCase();
  if (['qr', 'qrcode', 'qrkod', 'qr-kod'].includes(source)) return 'QR kód';
  return 'Přímý odkaz';
}

function formatVisitsSheet_(sheet) {
  const headers = ['Čas', 'Den', 'Návštěvník ID', 'Zdroj', 'Cesta', 'Titulek'];
  ensureHeaders_(sheet, headers);
}

function trackVisit_(payload) {
  const visitorId = String(payload && payload.visitorId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || Utilities.getUuid().replace(/-/g, '');
  if (isVisitorExcluded_(visitorId)) {
    return { ok: true, tracked: false, excluded: true };
  }

  const source = normalizeVisitSource_(payload && payload.source || '');
  const path = cleanText_(payload && payload.path || '/', 200);
  const title = cleanText_(payload && payload.title || '', 150);

  const sheet = getOrCreateSheet_(CONFIG.VISITS_SHEET);
  formatVisitsSheet_(sheet);
  sheet.appendRow([new Date(), todayKey_(), safeSheetText_(visitorId), safeSheetText_(source), safeSheetText_(path), safeSheetText_(title)]);
  invalidateVisitStatsCache_();

  return { ok: true, tracked: true };
}


function excludedVisitorIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty('EXCLUDED_VISITOR_IDS') || '[]';
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function isVisitorExcluded_(visitorId) {
  return excludedVisitorIds_().indexOf(String(visitorId || '')) !== -1;
}

function removeVisitsForVisitor_(visitorId) {
  const id = String(visitorId || '');
  if (!id) return 0;
  const sheet = getOrCreateSheet_(CONFIG.VISITS_SHEET);
  formatVisitsSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let removed = 0;
  for (let row = values.length; row >= 2; row--) {
    if (String(values[row - 1][2] || '') === id) {
      sheet.deleteRow(row);
      removed++;
    }
  }
  return removed;
}

function setVisitExclusion_(payload) {
  const visitorId = String(payload && payload.visitorId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  if (!visitorId) throw new Error('Zařízení se nepodařilo identifikovat.');

  const excluded = toBool_(payload && payload.excluded);
  const props = PropertiesService.getScriptProperties();
  const ids = excludedVisitorIds_();
  const set = new Set(ids);
  if (excluded) set.add(visitorId);
  else set.delete(visitorId);
  props.setProperty('EXCLUDED_VISITOR_IDS', JSON.stringify(Array.from(set).slice(-100)));

  let removed = 0;
  if (excluded && toBool_(payload && payload.removeExisting)) {
    removed = removeVisitsForVisitor_(visitorId);
  }
  invalidateVisitStatsCache_();

  return htmlResponse_(true,
    excluded ? 'Zařízení bylo vyloučeno z návštěvnosti.' : 'Zařízení se bude znovu započítávat.',
    '',
    { excluded: excluded, removed: removed, visitStats: buildVisitStats_() }
  );
}

function readVisits_() {
  const sheet = getOrCreateSheet_(CONFIG.VISITS_SHEET);
  formatVisitsSheet_(sheet);
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[0] !== '')
    .map(row => ({
      at: formatFulfilledTimestamp_(row[0]),
      day: normalizeDateKey_(row[1], formatSheetDate_(row[0]) || todayKey_()),
      visitorId: restoreSheetText_(row[2] || ''),
      source: restoreSheetText_(row[3] || 'Přímý odkaz'),
      path: restoreSheetText_(row[4] || '/'),
      title: restoreSheetText_(row[5] || '')
    }));
}

function buildVisitStats_() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(visitStatsCacheKey_());
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error('Načtení cache návštěvnosti selhalo.', error);
  }

  const result = calculateVisitStats_();
  try {
    cache.put(visitStatsCacheKey_(), JSON.stringify(result), CONFIG.VISIT_STATS_CACHE_SECONDS);
  } catch (error) {
    console.error('Uložení cache návštěvnosti selhalo.', error);
  }
  return result;
}

function calculateVisitStats_() {
  return calculateVisitStatsFromVisits_(readVisits_());
}

function calculateVisitStatsFromVisits_(suppliedVisits) {
  const visits = Array.isArray(suppliedVisits) ? suppliedVisits : [];
  const today = todayKey_();
  const start30 = addDaysKey_(today, -29);
  const start14 = addDaysKey_(today, -13);
  const inRange = (day, start, end) => day && day >= start && day <= end;
  const uniqueCount = items => new Set((items || []).map(item => String(item.visitorId || '')).filter(Boolean)).size;

  const todayVisits = visits.filter(item => item.day === today);
  const last30 = visits.filter(item => inRange(item.day, start30, today));
  const bySourceLabels = ['QR kód', 'Přímý odkaz'];
  const bySource = bySourceLabels.map(label => {
    const all = visits.filter(item => item.source === label);
    const all30 = last30.filter(item => item.source === label);
    const allToday = todayVisits.filter(item => item.source === label);
    return {
      source: label,
      total: all.length,
      unique: uniqueCount(all),
      last30: all30.length,
      uniqueLast30: uniqueCount(all30),
      today: allToday.length,
      uniqueToday: uniqueCount(allToday)
    };
  });

  const daily = [];
  for (let i = 0; i < 14; i++) {
    const day = addDaysKey_(start14, i);
    const rows = visits.filter(item => item.day === day);
    daily.push({
      day: day,
      visits: rows.length,
      unique: uniqueCount(rows)
    });
  }

  return {
    totalVisits: visits.length,
    uniqueVisitors: uniqueCount(visits),
    todayVisits: todayVisits.length,
    uniqueToday: uniqueCount(todayVisits),
    last30Visits: last30.length,
    uniqueLast30: uniqueCount(last30),
    bySource: bySource,
    daily: daily
  };
}


/**
 * JEDNORÁZOVÉ POVOLENÍ GALERIE
 *
 * V horním seznamu funkcí vyberte povolitGaleriiObrazku,
 * klikněte na Spustit a potvrďte přístup ke Google Disku.
 */
function povolitGaleriiObrazku() {
  const folder = getProductImagesFolder_();
  Logger.log('Galerie je připravena: ' + folder.getName());
}

function getProductImagesFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.PRODUCT_IMAGES_FOLDER);
  if (folders.hasNext()) return folders.next();

  const folder = DriveApp.createFolder(CONFIG.PRODUCT_IMAGES_FOLDER);
  folder.setDescription('Produktové fotografie pro Podprosečské domácí produkty.');
  return folder;
}

function uploadProductImage_(payload) {
  const dataUrl = String(payload && payload.dataUrl || '');
  const originalName = cleanText_(payload && payload.fileName || 'produkt.jpg', 120);

  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Vyberte obrázek JPG, PNG nebo WEBP.');

  const mimeType = match[1];
  const bytes = Utilities.base64Decode(match[2]);
  if (!bytes.length) throw new Error('Obrázek je prázdný.');
  if (bytes.length > CONFIG.MAX_IMAGE_BYTES) {
    throw new Error('Obrázek je po zmenšení stále příliš velký. Zvolte menší fotografii.');
  }

  const extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
  const baseName = originalName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 55) || 'produkt';

  const stamp = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss');
  const fileName = baseName + '-' + stamp + '.' + extension;
  const file = getProductImagesFolder_().createFile(
    Utilities.newBlob(bytes, mimeType, fileName)
  );

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return htmlResponse_(true, 'Obrázek byl nahrán do galerie.', '', {
    image: publicDriveImageUrl_(file.getId()),
    fileId: file.getId(),
    fileName: fileName
  });
}

function listProductImages_() {
  const files = getProductImagesFolder_().getFiles();
  const images = [];

  while (files.hasNext()) {
    const file = files.next();
    const mimeType = String(file.getMimeType() || '');
    if (mimeType.indexOf('image/') !== 0) continue;

    images.push({
      id: file.getId(),
      name: file.getName(),
      image: publicDriveImageUrl_(file.getId()),
      created: file.getDateCreated().toISOString()
    });
  }

  images.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return htmlResponse_(true, '', '', { images: images.slice(0, 100) });
}

function deleteProductImage_(payload) {
  const fileId = cleanText_(payload && payload.fileId, 200);
  if (!fileId) throw new Error('Chybí identifikátor obrázku.');

  const file = DriveApp.getFileById(fileId);
  file.setTrashed(true);
  return htmlResponse_(true, 'Obrázek byl přesunut do koše.');
}

function publicDriveImageUrl_(fileId) {
  return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w1600';
}


function login_(payload) {
  const password = cleanText_(payload.password, 200);
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('Nejdříve spusťte funkci setup().');
  if (password !== expected) throw new Error('Nesprávné heslo.');

  const token = Utilities.getUuid().replace(/-/g, '');
  const sessionVersion = getSessionVersion_();
  CacheService.getScriptCache().put('session:' + token, sessionVersion, CONFIG.SESSION_SECONDS);
  let adminData = null;
  try {
    // Přihlášení i první aktuální data vracíme jedním požadavkem.
    adminData = buildAdminPayload_();
  } catch (error) {
    // Platné přihlášení nesmí selhat jen proto, že byla tabulka na okamžik pomalá.
    console.error('První administrativní data se nepodařilo připojit k přihlášení.', error);
  }
  return htmlResponse_(true, 'Přihlášení bylo úspěšné.', '', {
    token:token,
    adminData:adminData
  });
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

function findOrderByRequestId_(sheet, requestId) {
  const id = String(requestId || '');
  if (!id || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 27).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][26] || '') === id) return orderFromSheetRow_(values[i]);
  }
  return null;
}

function createOrder_(payload, manual) {
  const requestId = cleanText_(payload && payload.requestId || '', 100)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 100);

  const lock = LockService.getScriptLock();
  let order;
  let id;
  let createdAt;
  let orderNumber;
  let sheet;
  let savedOrder;

  try {
    // Zámek chrání pouze validaci dostupnosti + zápis. E-maily se posílají až po jeho uvolnění.
    lock.waitLock(20000);

    sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    formatOrdersSheet_(sheet);

    if (requestId) {
      const existing = findOrderByRequestId_(sheet, requestId);
      if (existing) {
        if (!manual && typeof linkOrderToVisitorV27_ === 'function') {
          try {
            linkOrderToVisitorV27_(payload, existing);
          } catch (visitorError) {
            console.error('Dodatečné propojení návštěvníka s objednávkou selhalo.', visitorError);
          }
        }
        return htmlResponse_(true, 'Objednávka už byla přijata. Nevytváříme ji podruhé.', existing.id, {
          orderNumber: existing.orderNumber,
          order: manual ? existing : undefined,
          duplicatePrevented: true
        });
      }
    }

    order = validateOrder_(payload, manual);
    validatePickupRules_(order, '');
    if (!manual) validateBusinessRules_(order);

    const stockDeltas = fulfilledStockDeltas_(null, order);
    id = Utilities.getUuid();
    createdAt = new Date();
    orderNumber = nextOrderNumber_(createdAt);
    const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');
    let stockAdjusted = false;

    const fulfilledAt = !order.splitOrder && isFulfilledStatus_(order.status) ? createdAt : '';
    const regularFulfilledAt = order.splitOrder && isFulfilledStatus_(order.regularStatus) ? createdAt : '';
    const preorderFulfilledAt = order.splitOrder && isFulfilledStatus_(order.preorderStatus) ? createdAt : '';

    try {
      applyProductStockDeltas_(stockDeltas);
      stockAdjusted = true;

      const orderRow = [
        id, createdAt, order.status, safeSheetText_(order.name), safeSheetText_(order.phone), order.pickup,
        safeSheetText_(itemsText), order.total, safeSheetText_(order.note), manual ? 'Administrace' : 'Web', JSON.stringify(order.items), safeSheetText_(order.email),
        safeSheetText_(order.contactMethod), order.splitOrder, order.preorderPickup, order.regularStatus, order.preorderStatus,
        orderNumber, '', '', JSON.stringify([]), '', JSON.stringify([{type:'created', at:createdAt.toISOString(), text:'Objednávka vytvořena'}]),
        fulfilledAt, regularFulfilledAt, preorderFulfilledAt, requestId
      ];
      sheet.appendRow(orderRow);
      savedOrder = orderFromSheetRow_(orderRow);

      // Visitor ID posílá zákaznická stránka. Uložíme ho mimo list Objednávky,
      // takže kvůli propojení návštěvnosti neměníme stabilní strukturu objednávek.
      if (!manual && typeof linkOrderToVisitorV27_ === 'function') {
        try {
          linkOrderToVisitorV27_(payload, {
            id:id,
            orderNumber:orderNumber,
            name:order.name,
            createdAt:createdAt
          });
        } catch (visitorError) {
          // Objednávka je důležitější než statistika. Chyba propojení ji nesmí zrušit.
          console.error('Propojení návštěvníka s objednávkou selhalo.', visitorError);
        }
      }

      // Pokud už rychlý index existuje, přidáme rezervaci bez dalšího čtení tabulky.
      try { updatePublicReservationIndexFast_(null, order); }
      catch (indexError) {
        console.error('Rychlý index po vytvoření objednávky nebyl aktualizován.', indexError);
        invalidatePublicReservationIndex_();
      }
    } catch (error) {
      if (stockAdjusted) {
        try { reverseProductStockDeltas_(stockDeltas); } catch (rollbackError) { console.error('Vrácení skladu selhalo.', rollbackError); }
      }
      throw error;
    }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  // Po objednávce pouze zneplatníme veřejnou cache. Další načtení si ji sestaví z aktuálních dat.
  // Tím zákazník nečeká na zbytečný druhý přepočet celé nabídky.
  invalidatePublicPayloadCache_();

  let emailWarning = '';
  if (!manual) {
    try {
      MailApp.sendEmail({
        to: CONFIG.NOTIFICATION_EMAIL,
        subject: `Nová objednávka ${orderNumber} – ${order.name} – ${order.total} Kč`,
        body: buildTextEmail_(order, orderNumber, createdAt),
        htmlBody: buildHtmlEmail_(order, orderNumber, createdAt),
        name: CONFIG.BRAND_NAME,
        replyTo: order.email || CONFIG.NOTIFICATION_EMAIL
      });
    } catch (emailError) {
      console.error('Objednávka byla uložena, ale upozornění pro prodejce se nepodařilo odeslat.', emailError);
      emailWarning += ' Objednávka je uložená, ale upozorňovací e-mail se nepodařilo odeslat.';
    }

    try {
      MailApp.sendEmail({
        to: order.email,
        subject: `Potvrzení přijetí objednávky – ${CONFIG.BRAND_NAME}`,
        body: buildCustomerTextEmail_(order, orderNumber),
        htmlBody: buildCustomerHtmlEmail_(order, orderNumber),
        name: CONFIG.BRAND_NAME,
        replyTo: CONFIG.NOTIFICATION_EMAIL
      });
    } catch (customerEmailError) {
      console.error('Objednávka byla uložena, ale potvrzení zákazníkovi se nepodařilo odeslat.', customerEmailError);
      emailWarning += ' Potvrzovací e-mail zákazníkovi se nepodařilo odeslat.';
    }
  }

  return htmlResponse_(true, (manual ? 'Objednávka byla uložena.' : 'Objednávka byla přijata.') + emailWarning, id, {
    orderNumber:orderNumber,
    order:manual ? savedOrder : undefined
  });
}

function saveProduct_(payload) {
  const product = normalizeProduct_(payload.product || payload);
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let row = 0;
  let oldProduct = null;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(product.id)) {
      row = i + 1;
      oldProduct = productFromSheetRow_(values[i]);
      break;
    }
  }

  const record = [[
    product.id, safeSheetText_(product.emoji), safeSheetText_(product.name), product.price, safeSheetText_(product.unit),
    safeSheetText_(product.short), safeSheetText_(product.detail), product.visible, product.soldOut,
    product.restock, product.leadDays, product.quick.join(', '), new Date(), product.preorder, product.preorderDate, product.capacity,
    product.emailGroup, safeSheetText_(product.emailText), safeSheetText_(product.image),
    product.stock, safeSheetText_(product.stockUnit), safeSheetText_(product.soldOutText)
  ]];

  if (row) sheet.getRange(row, 1, 1, 22).setValues(record);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 22).setValues(record);

  const becameAvailable = product.visible && !product.soldOut && (!oldProduct || !oldProduct.visible || oldProduct.soldOut);
  if (becameAvailable) notifyStockWatchers_(product);
  invalidatePublicCatalogCache_();
  // Změna příznaku předobjednávky může přesunout položku mezi částmi objednávky.
  invalidatePublicReservationIndex_();

  return htmlResponse_(true, 'Produkt byl uložen.', String(product.id), { product: product });
}

function deleteProduct_(payload) {
  const id = cleanIdentifier_(payload.id, 'ID produktu');
  if (id === CONFIG.EGG_PRODUCT_ID) {
    throw new Error('Produkt Vejce nelze smazat, protože je navázaný na rezervační systém. Můžete ho pouze skrýt.');
  }
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === id) sheet.deleteRow(i + 1);
  }
  invalidatePublicCatalogCache_();
  invalidatePublicReservationIndex_();
  return htmlResponse_(true, 'Produkt byl smazán.', id, {});
}

function recordOrderNotification_(id, type, at, text) {
  return withMutationLock_(() => {
    const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    formatOrdersSheet_(sheet);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]) !== String(id)) continue;

      const communication = parseJsonArray_(values[i][20]);
      const timeline = parseJsonArray_(values[i][22]);
      if (!communication.some(item => item && item.type === type && String(item.at || '') === String(at || ''))) {
        communication.push({type:type, at:at, text:text});
      }
      if (type === 'cancelled') {
        timeline.push({type:'email', at:at, text:'Zákazníkovi odeslán e-mail o zrušení objednávky'});
      }

      if (type === 'ready-regular') sheet.getRange(i + 1, 19).setValue(at);
      if (type === 'ready-preorder') sheet.getRange(i + 1, 20).setValue(at);
      sheet.getRange(i + 1, 21).setValue(JSON.stringify(communication));
      sheet.getRange(i + 1, 23).setValue(JSON.stringify(timeline));
      return true;
    }
    return false;
  }, 10000);
}

function saveOrder_(payload, skipPublicRefresh) {
  const lock = LockService.getScriptLock();
  let result = null;

  try {
    lock.waitLock(20000);

    const submitted = payload.order || payload;
    const order = validateOrder_(submitted, true);
    const id = cleanIdentifier_(submitted.id, 'ID objednávky');

    const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    formatOrdersSheet_(sheet);
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
    const oldOrderRow = values[row - 1].slice(0, 27);
    const created = values[row - 1][1] || new Date();
    const source = values[row - 1][9] || 'Administrace';
    const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');
    const orderNumber = oldOrder.orderNumber || nextOrderNumber_(created);
    const communication = Array.isArray(oldOrder.communication) ? oldOrder.communication.slice() : [];
    const timeline = Array.isArray(oldOrder.timeline) ? oldOrder.timeline.slice() : [];

    const oldRegularStatus = oldOrder.splitOrder ? oldOrder.regularStatus : oldOrder.status;
    const newRegularStatus = order.splitOrder ? order.regularStatus : order.status;
    const oldPreorderStatus = oldOrder.splitOrder ? oldOrder.preorderStatus : 'Zrušeno';
    const newPreorderStatus = order.splitOrder ? order.preorderStatus : 'Zrušeno';

    let fulfilledAt = oldOrder.fulfilledAt || '';
    let regularFulfilledAt = oldOrder.regularFulfilledAt || '';
    let preorderFulfilledAt = oldOrder.preorderFulfilledAt || '';

    if (!order.splitOrder) {
      if (newRegularStatus === 'Vyzvednuto' && oldRegularStatus !== 'Vyzvednuto') fulfilledAt = new Date();
      if (newRegularStatus !== 'Vyzvednuto' && oldRegularStatus === 'Vyzvednuto') fulfilledAt = '';
      regularFulfilledAt = '';
      preorderFulfilledAt = '';
    } else {
      fulfilledAt = '';
      if (newRegularStatus === 'Vyzvednuto' && oldRegularStatus !== 'Vyzvednuto') regularFulfilledAt = new Date();
      if (newRegularStatus !== 'Vyzvednuto' && oldRegularStatus === 'Vyzvednuto') regularFulfilledAt = '';
      if (newPreorderStatus === 'Vyzvednuto' && oldPreorderStatus !== 'Vyzvednuto') preorderFulfilledAt = new Date();
      if (newPreorderStatus !== 'Vyzvednuto' && oldPreorderStatus === 'Vyzvednuto') preorderFulfilledAt = '';
    }

    if (newRegularStatus !== oldRegularStatus) {
      timeline.push({type:'status', at:new Date().toISOString(), text:'Stav dostupné části: ' + newRegularStatus});
    }
    if (order.splitOrder && newPreorderStatus !== oldPreorderStatus) {
      timeline.push({type:'status', at:new Date().toISOString(), text:'Stav předobjednané části: ' + newPreorderStatus});
    }

    const regularBecameReady = newRegularStatus === 'Připraveno' && oldRegularStatus !== 'Připraveno' && !oldOrder.readyEmailRegularAt;
    const preorderBecameReady = order.splitOrder && newPreorderStatus === 'Připraveno' && oldPreorderStatus !== 'Připraveno' && !oldOrder.readyEmailPreorderAt;
    const oldAggregateStatus = aggregateOrderStatus_(oldOrder);
    const newAggregateStatus = aggregateOrderStatus_(order);
    const cancellationAlreadySent = communication.some(item => item && item.type === 'cancelled');
    const cancellationBecameFinal = newAggregateStatus === 'Zrušeno' && oldAggregateStatus !== 'Zrušeno' && !cancellationAlreadySent;

    // Pouhá změna Nová/Připravuji/Připraveno nemění rezervaci ani termín.
    // Drahý přepočet dostupnosti proto spouštíme jen tehdy, když se plán opravdu změnil.
    const planningChanged = orderPlanningSignatureV290_(oldOrder) !== orderPlanningSignatureV290_(order);
    if (planningChanged) validatePickupRules_(order, id);
    const packagingPlan = Object.prototype.hasOwnProperty.call(payload || {}, 'packagingSelection')
      ? (typeof preparePackagingOrderUpdateV290_ === 'function'
        ? preparePackagingOrderUpdateV290_(id, Object.assign({}, order, {id:id, orderNumber:orderNumber}), payload.packagingSelection)
        : (() => { throw new Error('Doplněk skladu obalů je zastaralý. Nahrajte také nový Code_V2_6_ADDON.gs.'); })())
      : null;
    const stockDeltas = fulfilledStockDeltas_(oldOrder, order);
    const hasStockDeltas = Object.keys(stockDeltas).some(key => Number(stockDeltas[key] || 0) !== 0);
    let stockChangesApplied = false;
    let orderChangesApplied = false;
    let packagingResult = null;

    try {
      if (hasStockDeltas) {
        applyProductStockDeltas_(stockDeltas);
        stockChangesApplied = true;
      }

      sheet.getRange(row, 1, 1, 27).setValues([[
        id, created, order.status, safeSheetText_(order.name), safeSheetText_(order.phone), order.pickup,
        safeSheetText_(itemsText), order.total, safeSheetText_(order.note), source, JSON.stringify(order.items), safeSheetText_(order.email),
        safeSheetText_(order.contactMethod || oldOrder.contactMethod || 'SMS'), order.splitOrder, order.preorderPickup,
        order.regularStatus, order.preorderStatus, orderNumber, oldOrder.readyEmailRegularAt || '', oldOrder.readyEmailPreorderAt || '',
        JSON.stringify(communication), safeSheetText_(submitted.internalNote || oldOrder.internalNote || ''), JSON.stringify(timeline),
        fulfilledAt, regularFulfilledAt, preorderFulfilledAt, oldOrder.requestId || ''
      ]]);
      orderChangesApplied = true;

      if (packagingPlan) {
        packagingResult = commitPackagingOrderUpdateV290_(packagingPlan, orderNumber);
      }
    } catch (error) {
      if (orderChangesApplied) {
        try { sheet.getRange(row, 1, 1, 27).setValues([oldOrderRow]); }
        catch (rollbackError) { console.error('Vrácení objednávky po chybě obalů selhalo.', rollbackError); }
      }
      if (stockChangesApplied) {
        try { reverseProductStockDeltas_(stockDeltas); } catch (rollbackError) { console.error('Vrácení skladu po chybě selhalo.', rollbackError); }
      }
      throw error;
    }

    if (planningChanged) {
      try { updatePublicReservationIndexFast_(oldOrder, order); }
      catch (indexError) {
        console.error('Rychlý index po úpravě objednávky nebyl aktualizován.', indexError);
        invalidatePublicReservationIndex_();
      }
    }

    result = {
      id:id,
      order:order,
      orderNumber:orderNumber,
      contactMethod:String(order.contactMethod || oldOrder.contactMethod || 'SMS'),
      regularBecameReady:regularBecameReady,
      preorderBecameReady:preorderBecameReady,
      cancellationBecameFinal:cancellationBecameFinal,
      packaging:packagingResult
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  // Zákaznická nabídka se po změně načte z čerstvých dat, ale administrace na přepočet nečeká.
  if (skipPublicRefresh) invalidatePublicPayloadCache_();
  else refreshPublicPayloadCache_();

  // Pomalé odeslání e-mailu proběhne až na pozadí. Administrace čeká jen na rychlé zařazení úlohy do fronty.
  const notificationJobs = [];
  if (result.contactMethod === 'E-mail' && result.regularBecameReady) {
    notificationJobs.push({type:'ready-regular', part:'regular'});
  }
  if (result.contactMethod === 'E-mail' && result.preorderBecameReady) {
    notificationJobs.push({type:'ready-preorder', part:'preorder'});
  }
  if (result.cancellationBecameFinal) {
    notificationJobs.push({type:'cancelled', part:''});
  }

  let queuedCount = 0;
  let queueWarning = '';
  if (notificationJobs.length) {
    try {
      queuedCount = enqueueOrderNotifications_(result.id, notificationJobs);
    } catch (error) {
      console.error('E-mail se nepodařilo zařadit do fronty.', error);
      queueWarning = ' E-mail se nepodařilo zařadit k odeslání.';
    }
  }

  return htmlResponse_(true, 'Objednávka byla upravena.' + (queuedCount ? ' E-mail se odešle na pozadí.' : '') + queueWarning, result.id, {
    order: Object.assign({}, result.order, {
      id: result.id,
      orderNumber: result.orderNumber
    }),
    orderNumber: result.orderNumber,
    notificationsQueued: queuedCount,
    packaging: result.packaging
  });
}

function deleteOrder_(payload) {
  const id = cleanIdentifier_(payload.id, 'ID objednávky');
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const values = sheet.getDataRange().getValues();
  const affectedYears = {};
  const deletedOrders = [];
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) !== id) continue;
    deletedOrders.push(orderFromSheetRow_(values[i]));
    const year = orderNumberYear_(values[i][17], values[i][1]);
    if (year) affectedYears[year] = true;
    sheet.deleteRow(i + 1);
  }
  Object.keys(affectedYears).forEach(year => syncOrderCounterForYear_(sheet, year));
  deletedOrders.forEach(order => {
    try { updatePublicReservationIndexFast_(order, null); }
    catch (indexError) {
      console.error('Rychlý index po smazání objednávky nebyl aktualizován.', indexError);
      invalidatePublicReservationIndex_();
    }
  });
  invalidatePublicPayloadCache_();
  return htmlResponse_(true, 'Objednávka byla smazána.', id, {});
}

function saveEggSettings_(payload) {
  const source = payload.settings || payload;
  const currentStock = clampInteger_(source.currentStock, 0, 100000, 'Aktuální sklad');
  const dailyProduction = clampInteger_(source.dailyProduction, 0, 10000, 'Denní snáška');
  const safetyReserve = clampInteger_(source.safetyReserve, 0, 100000, 'Bezpečnostní rezerva');
  const planningDays = clampInteger_(source.planningDays, 7, 365, 'Délka plánování');

  const saved = {
    baseStock:currentStock,
    baseDate:todayKey_(),
    elapsedDays:0,
    accruedEggs:0,
    currentStock: currentStock,
    stockDate: todayKey_(),
    dailyProduction: dailyProduction,
    safetyReserve: safetyReserve,
    planningDays: planningDays
  };
  writeEggSettings_(saved);

  return htmlResponse_(true, 'Nastavení vajec bylo uloženo.', '', {
    eggSettings:saved
  });
}

function validatePickupRules_(order, excludeOrderId) {
  if (!isReservingStatus_(order.status)) return;

  const today = todayKey_();
  const regularActive = isReservingStatus_(order.splitOrder ? order.regularStatus : order.status);
  const preorderActive = isReservingStatus_(order.splitOrder ? order.preorderStatus : order.status);
  if (regularActive && order.pickup && order.pickup < today) {
    throw new Error('Termín prvního vyzvednutí nemůže být v minulosti.');
  }
  if (order.splitOrder && preorderActive && order.preorderPickup && order.preorderPickup < today) {
    throw new Error('Termín předobjednané části nemůže být v minulosti.');
  }

  const productMap = {};
  readProductsBase_().forEach(product => { productMap[String(product.id)] = product; });

  let minimum = today;
  order.items.forEach(item => {
    if (String(item.productId) === CONFIG.EGG_PRODUCT_ID) return;
    const product = productMap[String(item.productId)];
    if (!product) return;
    const leadMinimum = addDaysKey_(today, Number(product.leadDays || 0));
    if (leadMinimum > minimum) minimum = leadMinimum;
    const preorderDate = product.preorderDate || product.restock;
    if (product.preorder && order.splitOrder) {
      if (!preorderActive) return;
      if (!order.preorderPickup) throw new Error('Chybí termín předobjednané části.');
      if (preorderDate && order.preorderPickup < preorderDate) {
        throw new Error(`Předobjednanou část lze vyzvednout nejdříve ${formatDateForMessage_(preorderDate)}.`);
      }
      return;
    }
    if (!regularActive) return;
    if (product.preorder && preorderDate && preorderDate > minimum) minimum = preorderDate;
  });

  if (regularActive && minimum > today) {
    if (!order.pickup) throw new Error('Vyberte termín vyzvednutí.');
    if (order.pickup < minimum) {
      throw new Error(`Nejbližší možný termín vyzvednutí ostatních produktů je ${formatDateForMessage_(minimum)}.`);
    }
  }

  validateEggAvailability_(order, excludeOrderId);
}

function validateEggAvailability_(order, excludeOrderId) {
  const eggQty = eggQtyFromItems_(order.items);
  const eggStatus = order.splitOrder ? order.regularStatus : order.status;
  if (!eggQty || !isReservingStatus_(eggStatus)) return;
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

function buildEggAvailability_(excludeOrderId, suppliedOrders, suppliedPreorderMap, suppliedSettings) {
  const settings = suppliedSettings || readEggSettings_();
  const today = todayKey_();
  const horizonEnd = addDaysKey_(today, settings.planningDays);
  const reservations = {};
  let calculationEnd = horizonEnd;
  const orders = Array.isArray(suppliedOrders) ? suppliedOrders : readOrdersForAvailability_();
  const preorderMap = suppliedPreorderMap || productPreorderMap_();

  orders.forEach(order => {
    if (excludeOrderId && String(order.id) === String(excludeOrderId)) return;
    const eggStatus = itemPartStatus_(order, CONFIG.EGG_PRODUCT_ID, preorderMap);
    if (!isReservingStatus_(eggStatus)) return;

    const qty = eggQtyFromItems_(order.items);
    if (!qty) return;

    let pickup = itemPickupDate_(order, CONFIG.EGG_PRODUCT_ID, preorderMap);
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
  const storedDate = normalizeDateKey_(values.EGG_STOCK_DATE, today);
  const elapsedDays = Math.max(0, daysBetweenKeys_(storedDate, today));
  const accruedEggs = elapsedDays * Math.max(0, dailyProduction);

  return {
    baseStock: Math.max(0, storedStock),
    baseDate: storedDate,
    elapsedDays: elapsedDays,
    accruedEggs: accruedEggs,
    currentStock: Math.max(0, storedStock + accruedEggs),
    stockDate: today,
    dailyProduction: Math.max(0, dailyProduction),
    safetyReserve: Math.max(0, safeInteger_(values.EGG_SAFETY_RESERVE, CONFIG.DEFAULT_EGG_SAFETY_RESERVE)),
    planningDays: Math.min(365, Math.max(7, safeInteger_(values.EGG_PLANNING_DAYS, CONFIG.DEFAULT_EGG_PLANNING_DAYS)))
  };
}

function writeEggSettings_(settings) {
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  formatSettingsSheet_(sheet);
  setSettingsBatch_(sheet, [
    {key:'EGG_STOCK', value:settings.currentStock, description:'Aktuální fyzický počet vajec skladem'},
    {key:'EGG_STOCK_DATE', value:settings.stockDate, description:'Datum, ke kterému platí aktuální sklad', text:true},
    {key:'EGG_DAILY_PRODUCTION', value:settings.dailyProduction, description:'Předpokládaný počet nových vajec za den'},
    {key:'EGG_SAFETY_RESERVE', value:settings.safetyReserve, description:'Počet vajec, který se zákazníkům nenabízí'},
    {key:'EGG_PLANNING_DAYS', value:settings.planningDays, description:'Kolik dní dopředu lze plánovat'}
  ]);
  invalidatePublicCatalogCache_();
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

function readProductsBase_() {
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  seedProducts_(sheet);
  repairDefaultProductSettings_(sheet);
  const rows = sheet.getDataRange().getValues().slice(1);

  return rows.filter(row => row[0] !== '').map(row => ({
    id: String(row[0]),
    emoji: restoreSheetText_(row[1] || '📦'),
    name: restoreSheetText_(row[2] || ''),
    price: Number(row[3] || 0),
    unit: restoreSheetText_(row[4] || 'kus'),
    short: restoreSheetText_(row[5] || ''),
    detail: restoreSheetText_(row[6] || ''),
    visible: toBool_(row[7]),
    soldOut: toBool_(row[8]),
    restock: formatSheetDate_(row[9]),
    leadDays: String(row[0]) === CONFIG.EGG_PRODUCT_ID ? 0 : Number(row[10] || 0),
    quick: quickButtonsForProduct_(row[0], row[1], row[2], row[11]),
    preorder: toBool_(row[13]),
    preorderDate: formatSheetDate_(row[14]) || formatSheetDate_(row[9]),
    capacity: Number(row[15] || 0),
    emailGroup: normalizeEmailGroup_(row[16], row[2]),
    emailText: restoreSheetText_(row[17] || ''),
    image: restoreSheetText_(row[18] || ''),
    stock: Math.max(0, Number(row[19] || 0)),
    stockUnit: restoreSheetText_(row[20] || 'ks'),
    soldOutText: restoreSheetText_(row[21] || 'Momentálně vyprodáno')
  }));
}

function readProducts_() {
  const products = readProductsBase_();
  const orders = readOrdersForAvailability_();
  const preorderMap = {};
  products.forEach(product => preorderMap[String(product.id)] = Boolean(product.preorder));
  const reservations = reservationMapFromOrders_(orders, preorderMap);
  const eggAvailability = buildEggAvailability_('', orders, preorderMap);
  const eggToday = eggAvailability && eggAvailability.days && eggAvailability.days.length
    ? eggAvailability.days[0]
    : null;

  return products.map(product => {
    const reserved = Math.max(0, Number(reservations[String(product.id)] || 0));
    return Object.assign({}, product, {
      reserved: reserved,
      availableStock: String(product.id) === CONFIG.EGG_PRODUCT_ID
        ? Math.max(0, Math.floor(Number(eggToday && eggToday.maxAdditional || 0)))
        : Math.max(0, Math.floor(Number(product.stock || 0) - reserved))
    });
  });
}

function readOrders_() {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  ensureOrderNumbers_(sheet);
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

function statusTimelineTimestamp_(timeline, expectedText) {
  const match = (timeline || []).slice().reverse().find(item =>
    item && item.type === 'status' && String(item.text || '') === expectedText
  );
  return match && match.at ? String(match.at) : '';
}

function formatFulfilledTimestamp_(value) {
  if (!value) return '';
  const date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date)) return String(value);
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function partFulfilledTimestamp_(rowValue, timeline, status, expectedText) {
  if (String(status || '') !== 'Vyzvednuto') return '';
  const source = rowValue || statusTimelineTimestamp_(timeline, expectedText);
  return formatFulfilledTimestamp_(source);
}

function orderFromSheetRow_(row) {
  let items = [];
  try { items = JSON.parse(String(row[10] || '[]')); } catch (_) {}
  const timeline = parseJsonArray_(row[22]);
  const status = String(row[2] || 'Nová');
  const splitOrder = toBool_(row[13]);
  const regularStatus = String(row[15] || status || 'Nová');
  const preorderStatus = String(row[16] || 'Nová');

  return {
    id: String(row[0] || ''),
    created: formatDateTime_(row[1]),
    status: status,
    name: restoreSheetText_(row[3] || ''),
    phone: restoreSheetText_(row[4] || ''),
    email: restoreSheetText_(row[11] || ''),
    pickup: formatSheetDate_(row[5]),
    itemsText: restoreSheetText_(row[6] || ''),
    items: Array.isArray(items) ? items : [],
    total: Number(row[7] || 0),
    note: restoreSheetText_(row[8] || ''),
    source: restoreSheetText_(row[9] || ''),
    contactMethod: restoreSheetText_(row[12] || 'SMS') || 'SMS',
    splitOrder: splitOrder,
    preorderPickup: formatSheetDate_(row[14]),
    regularStatus: regularStatus,
    preorderStatus: preorderStatus,
    orderNumber: String(row[17] || row[0] || ''),
    readyEmailRegularAt: String(row[18] || ''),
    readyEmailPreorderAt: String(row[19] || ''),
    communication: parseJsonArray_(row[20]),
    internalNote: restoreSheetText_(row[21] || ''),
    timeline: timeline,
    fulfilledAt: partFulfilledTimestamp_(row[23], timeline, status, 'Stav dostupné části: Vyzvednuto'),
    regularFulfilledAt: partFulfilledTimestamp_(row[24], timeline, regularStatus, 'Stav dostupné části: Vyzvednuto'),
    preorderFulfilledAt: partFulfilledTimestamp_(row[25], timeline, preorderStatus, 'Stav předobjednané části: Vyzvednuto'),
    requestId: String(row[26] || '')
  };
}

function validateOrder_(payload, manual) {
  const name = cleanText_(payload.name, 100);
  const phone = cleanText_(payload.phone, 40);
  const email = cleanText_(payload.email, 254).toLowerCase();
  const pickup = cleanText_(payload.pickup, 20);
  const note = cleanText_(payload.note, 500);
  const status = manual ? cleanText_(payload.status || 'Nová', 30) : 'Nová';
  const contactMethod = cleanText_(payload.contactMethod || 'SMS', 20);
  const splitOrder = toBool_(payload.splitOrder);
  const preorderPickup = cleanText_(payload.preorderPickup, 20);
  const regularStatus = manual ? cleanText_(payload.regularStatus || status, 30) : 'Nová';
  const preorderStatus = manual ? cleanText_(payload.preorderStatus || 'Nová', 30) : 'Nová';

  if (name.length < 2) throw new Error('Neplatné jméno.');
  if (!manual && phone.length < 5) throw new Error('Neplatný telefon.');
  if (!manual && !isValidEmail_(email)) throw new Error('Zadejte platnou e-mailovou adresu.');
  if (manual && email && !isValidEmail_(email)) throw new Error('E-mailová adresa není platná.');
  if (!CONFIG.ORDER_STATUSES.includes(status) || !CONFIG.ORDER_STATUSES.includes(regularStatus) || !CONFIG.ORDER_STATUSES.includes(preorderStatus)) throw new Error('Neplatný stav objednávky.');
  if (!['SMS', 'E-mail'].includes(contactMethod)) throw new Error('Neplatný způsob kontaktu.');
  if (preorderPickup && !isValidDateKey_(preorderPickup)) throw new Error('Neplatný termín předobjednávky.');
  if (pickup && !isValidDateKey_(pickup)) throw new Error('Neplatný termín vyzvednutí.');
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > CONFIG.MAX_ITEMS) {
    throw new Error('Neplatné položky.');
  }

  const productMap = {};
  readProductsBase_().forEach(product => { productMap[String(product.id)] = product; });

  const itemTotals = {};
  payload.items.forEach(item => {
    const productId = cleanIdentifier_(item.productId, 'ID produktu');
    const qty = Math.floor(Number(item.qty));
    const product = productMap[productId];
    if (!product) throw new Error('Objednaný produkt už neexistuje. Obnovte stránku a zkuste to znovu.');
    if (!manual && (!product.visible || (product.soldOut && !product.preorder))) {
      throw new Error(`Produkt ${product.name} nyní není možné objednat.`);
    }
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Neplatné množství položky.');

    itemTotals[productId] = (itemTotals[productId] || 0) + qty;
    if (itemTotals[productId] > CONFIG.MAX_QUANTITY_PER_ITEM) {
      throw new Error(`U jednoho produktu lze objednat nejvýše ${CONFIG.MAX_QUANTITY_PER_ITEM} kusů.`);
    }
  });

  const items = Object.keys(itemTotals).map(productId => {
    const product = productMap[productId];
    const priceValue = Number(product.price);
    if (!product.name || !Number.isFinite(priceValue) || priceValue < 0) throw new Error('Neplatná položka.');
    return {
      productId: productId,
      name: product.name,
      qty: itemTotals[productId],
      price: priceValue,
      emailGroup: product.emailGroup,
      emailText: product.emailText || ''
    };
  });

  return {
    name: name,
    phone: phone,
    email: email,
    pickup: pickup,
    note: note,
    status: splitOrder ? aggregateSplitStatus_(regularStatus, preorderStatus) : status,
    items: items,
    total: items.reduce((sum, item) => sum + item.qty * item.price, 0),
    contactMethod: contactMethod,
    splitOrder: splitOrder,
    preorderPickup: preorderPickup,
    regularStatus: splitOrder ? regularStatus : status,
    preorderStatus: splitOrder ? preorderStatus : status
  };
}

function normalizeProduct_(product) {
  const id = product.id ? cleanIdentifier_(product.id, 'ID produktu') : Utilities.getUuid();
  const emoji = cleanText_(product.emoji || '📦', 10);
  const name = cleanText_(product.name, 100);
  const unit = cleanText_(product.unit || 'kus', 30);
  const restock = cleanText_(product.restock, 20);
  const preorder = toBool_(product.preorder);
  const preorderDate = cleanText_(product.preorderDate || product.restock, 20);
  const price = Number(product.price);
  const emailGroup = normalizeEmailGroup_(product.emailGroup, name);
  const emailText = cleanText_(product.emailText, 120);
  const image = cleanText_(product.image, 500);
  const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
  const stockUnit = cleanText_(product.stockUnit || 'ks', 30);
  const soldOutText = cleanText_(product.soldOutText || 'Momentálně vyprodáno', 40) === 'Vyprodáno'
    ? 'Vyprodáno'
    : 'Momentálně vyprodáno';

  if (!name) throw new Error('Vyplňte název produktu.');
  if (!unit) throw new Error('Vyplňte jednotku produktu.');
  if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new Error('Cena produktu není platná.');
  if (restock && !isValidDateKey_(restock)) throw new Error('Datum doplnění produktu není platné.');
  if (preorderDate && !isValidDateKey_(preorderDate)) throw new Error('Datum naskladnění předobjednávky není platné.');
  if (preorder && !preorderDate) throw new Error('U předobjednávky vyplňte předpokládané datum naskladnění.');
  if (emailGroup === 'VLASTNI' && !emailText) throw new Error('U vlastního textu e-mailu vyplňte vlastní označení.');

  return {
    id: id,
    emoji: emoji,
    name: name,
    price: price,
    unit: unit,
    short: cleanText_(product.short, 300),
    detail: cleanText_(product.detail, 1000),
    visible: toBool_(product.visible),
    soldOut: toBool_(product.soldOut),
    preorder: preorder,
    preorderDate: preorderDate,
    restock: restock || preorderDate,
    leadDays: String(id) === CONFIG.EGG_PRODUCT_ID ? 0 : Math.min(365, Math.max(0, Math.floor(Number(product.leadDays) || 0))),
    quick: quickButtonsForProduct_(id, emoji, name, product.quick),
    capacity: Math.max(0, Math.floor(Number(product.capacity) || 0)),
    emailGroup: emailGroup,
    emailText: emailGroup === 'VLASTNI' ? emailText : '',
    image: image,
    stock: stock,
    stockUnit: stockUnit,
    soldOutText: soldOutText
  };
}

function eggQtyFromItems_(items) {
  return (items || [])
    .filter(item => String(item.productId) === CONFIG.EGG_PRODUCT_ID)
    .reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.qty) || 0)), 0);
}

function aggregateSplitStatus_(regularStatus, preorderStatus) {
  const statuses = [String(regularStatus || 'Nová'), String(preorderStatus || 'Nová')];
  if (statuses.every(value => value === 'Zrušeno')) return 'Zrušeno';
  if (statuses.every(value => ['Vyzvednuto', 'Zrušeno'].includes(value))) return 'Vyzvednuto';
  if (statuses.some(value => value === 'Připraveno')) return 'Připraveno';
  if (statuses.some(value => value === 'Připravuji' || value === 'Vyzvednuto')) return 'Připravuji';
  return 'Nová';
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

function formatWatchlistSheet_(sheet) {
  const headers = ['Produkt ID', 'Produkt', 'E-mail', 'Vytvořeno', 'Upozorněno'];
  ensureHeaders_(sheet, headers);
}

function subscribeStock_(payload) {
  const productId = cleanIdentifier_(payload.productId, 'ID produktu');
  const email = cleanText_(payload.email, 254).toLowerCase();
  if (!isValidEmail_(email)) throw new Error('Zadejte platnou e-mailovou adresu.');
  const product = readProducts_().find(item => String(item.id) === productId);
  if (!product) throw new Error('Produkt nebyl nalezen.');
  if (product.visible && !product.soldOut) throw new Error('Produkt je již skladem a lze ho objednat.');
  const sheet = getOrCreateSheet_(CONFIG.WATCHLIST_SHEET);
  formatWatchlistSheet_(sheet);
  const rows = sheet.getDataRange().getValues();
  const exists = rows.slice(1).some(row => String(row[0]) === productId && String(row[2]).toLowerCase() === email && !row[4]);
  if (!exists) sheet.appendRow([productId, safeSheetText_(product.name), safeSheetText_(email), new Date(), '']);
  return htmlResponse_(true, 'Hlídací pes byl zapnutý.', productId, {});
}

function notifyStockWatchers_(product) {
  const sheet = getOrCreateSheet_(CONFIG.WATCHLIST_SHEET);
  formatWatchlistSheet_(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(product.id) || rows[i][4]) continue;
    const email = restoreSheetText_(rows[i][2] || '');
    if (!isValidEmail_(email)) continue;
    try {
      MailApp.sendEmail({
        to: email,
        subject: `${product.name} je znovu skladem – ${CONFIG.BRAND_NAME}`,
        body: `Dobrý den,\n\nprodukt ${product.name} je znovu skladem a můžete si ho objednat na našem objednávkovém webu.\n\nTento e-mail posíláme jednorázově na základě zapnutého hlídacího psa.\n\nS přáním krásného dne\n\nMartin Dvořák\n${CONFIG.BRAND_NAME}\nPoctivé produkty od našich včel, slepiček a ze zahrádky.`,
        name: CONFIG.BRAND_NAME,
        replyTo: CONFIG.NOTIFICATION_EMAIL
      });
      sheet.getRange(i + 1, 5).setValue(new Date());
    } catch (error) { console.error('Hlídací pes – e-mail se nepodařilo odeslat', error); }
  }
}

function productFromSheetRow_(row) {
  return { id: String(row[0] || ''), visible: toBool_(row[7]), soldOut: toBool_(row[8]) };
}

function formatOrdersSheet_(sheet) {
  const headers = ['Interní ID', 'Vytvořeno', 'Stav', 'Jméno', 'Telefon', 'Termín vyzvednutí', 'Položky', 'Celkem Kč', 'Poznámka', 'Zdroj', 'ItemsJSON', 'E-mail', 'Kontakt před vyzvednutím', 'Rozdělená objednávka', 'Termín předobjednávky', 'Stav dostupné části', 'Stav předobjednávky', 'Číslo objednávky', 'E-mail připraveno 1', 'E-mail připraveno 2', 'Komunikace JSON', 'Interní poznámka', 'Časová osa JSON', 'Skutečně vyzvednuto', 'Vyzvednuta dostupná část', 'Vyzvednuta předobjednaná část', 'Request ID'];
  ensureHeaders_(sheet, headers);
}


function ensureOrderNumbers_(sheet) {
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][17]) continue;
    const created = values[i][1] instanceof Date ? values[i][1] : new Date();
    values[i][17] = nextOrderNumber_(created);
    changed = true;
  }
  if (changed) sheet.getRange(2, 1, values.length, 18).setValues(values);
}

function formatProductsSheet_(sheet) {
  const headers = ['ID', 'Emoji', 'Název', 'Cena', 'Jednotka', 'Krátký popis', 'Podrobnosti', 'Viditelný', 'Vyprodáno', 'Doplnění', 'Předstih dní', 'Rychlá tlačítka', 'Aktualizováno', 'Předobjednávka', 'Datum předobjednávky', 'Plánované množství', 'Text e-mailu', 'Vlastní označení', 'Fotografie produktu', 'Sklad', 'Jednotka skladu', 'Text při vyprodání'];
  ensureHeaders_(sheet, headers);
}

function formatSettingsSheet_(sheet) {
  const headers = ['Klíč', 'Hodnota', 'Popis'];
  ensureHeaders_(sheet, headers);
}

const PDP_HEADER_CACHE_V290_ = {};

function ensureHeaders_(sheet, headers) {
  const sheetKey = `${sheet.getSheetId()}:${headers.join('|')}`;
  if (PDP_HEADER_CACHE_V290_[sheetKey]) return;

  const range = sheet.getRange(1, 1, 1, headers.length);
  const current = range.getValues()[0];
  const differs = headers.some((header, index) => String(current[index] || '') !== String(header));
  if (differs) {
    range.setValues([headers]);
    range.setFontWeight('bold');
  }
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  PDP_HEADER_CACHE_V290_[sheetKey] = true;
}

function seedProducts_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const now = new Date();
  sheet.getRange(2, 1, 2, 22).setValues([
    ['1', '🍯', 'Květový med', 190, '950 g', 'Smíšený květový med z okolí Lukášova.', 'Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.', true, false, '', 0, '', now, false, '', 0, 'VCELICKY', '', 'assets/images/products/med-real.webp', 0, 'sklenic', 'Momentálně vyprodáno'],
    ['2', '🥚', 'Čerstvá vejce', 7, 'kus', 'Vejce od našich slepic z domácího chovu.', 'Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.', true, false, '', 0, '6, 10, 30', now, false, '', 0, 'SLEPICKY', '', 'assets/images/products/vajicka-real.webp', 0, 'ks', 'Momentálně vyprodáno']
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


function publicBusinessSettings_() {
  const map = readSettingsMap_(getOrCreateSheet_(CONFIG.SETTINGS_SHEET));
  return {
    bannerEnabled: toBool_(map.BANNER_ENABLED),
    bannerStyle: cleanText_(map.BANNER_STYLE || 'yellow', 20),
    bannerTitle: restoreSheetText_(map.BANNER_TITLE || ''),
    bannerText: restoreSheetText_(map.BANNER_TEXT || ''),
    bannerFrom: normalizeDateKey_(map.BANNER_FROM, ''),
    bannerTo: normalizeDateKey_(map.BANNER_TO, ''),
    ordersPaused: toBool_(map.ORDERS_PAUSED),
    pauseFrom: normalizeDateKey_(map.PAUSE_FROM, ''),
    pauseTo: normalizeDateKey_(map.PAUSE_TO, ''),
    pauseMessage: restoreSheetText_(map.PAUSE_MESSAGE || ''),
    dailyOrderLimit: Math.max(0, safeInteger_(map.DAILY_ORDER_LIMIT, 0))
  };
}

function saveBusinessSettings_(payload) {
  const settings = payload.settings || payload;
  const pauseFrom = normalizeDateKey_(settings.pauseFrom, '');
  const pauseTo = normalizeDateKey_(settings.pauseTo, '');
  if (toBool_(settings.ordersPaused) && (!pauseFrom || !pauseTo)) throw new Error('Vyplňte začátek i konec blokace vyzvednutí.');
  if (pauseFrom && pauseTo && pauseFrom > pauseTo) throw new Error('Konec blokace nesmí být před jejím začátkem.');
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  formatSettingsSheet_(sheet);
  const saved = {
    bannerEnabled:toBool_(settings.bannerEnabled),
    bannerStyle:cleanText_(settings.bannerStyle || 'yellow', 20),
    bannerTitle:cleanText_(settings.bannerTitle, 150),
    bannerText:cleanText_(settings.bannerText, 800),
    bannerFrom:normalizeDateKey_(settings.bannerFrom, ''),
    bannerTo:normalizeDateKey_(settings.bannerTo, ''),
    ordersPaused:toBool_(settings.ordersPaused),
    pauseFrom:pauseFrom,
    pauseTo:pauseTo,
    pauseMessage:cleanText_(settings.pauseMessage, 800),
    dailyOrderLimit:Math.max(0, Math.floor(Number(settings.dailyOrderLimit) || 0))
  };
  setSettingsBatch_(sheet, [
    {key:'BANNER_ENABLED', value:saved.bannerEnabled, description:'Zobrazit informační banner'},
    {key:'BANNER_STYLE', value:saved.bannerStyle, description:'Barva banneru', text:true},
    {key:'BANNER_TITLE', value:saved.bannerTitle, description:'Nadpis banneru', text:true},
    {key:'BANNER_TEXT', value:saved.bannerText, description:'Text banneru', text:true},
    {key:'BANNER_FROM', value:saved.bannerFrom, description:'Banner zobrazit od', text:true},
    {key:'BANNER_TO', value:saved.bannerTo, description:'Banner zobrazit do', text:true},
    {key:'ORDERS_PAUSED', value:saved.ordersPaused, description:'Zablokovat vyzvednutí v období'},
    {key:'PAUSE_FROM', value:saved.pauseFrom, description:'Blokace vyzvednutí od', text:true},
    {key:'PAUSE_TO', value:saved.pauseTo, description:'Blokace vyzvednutí do', text:true},
    {key:'PAUSE_MESSAGE', value:saved.pauseMessage, description:'Upozornění při blokaci vyzvednutí', text:true},
    {key:'DAILY_ORDER_LIMIT', value:saved.dailyOrderLimit, description:'Maximum objednávek na den'}
  ]);
  invalidatePublicCatalogCache_();
  return htmlResponse_(true, 'Nastavení webu bylo uloženo.', '', { settings:saved });
}


function availableProductStock_(productId, physicalStock) {
  const orders = readOrdersForAvailability_();
  const preorderMap = productPreorderMap_();
  const reserved = Number(reservationMapFromOrders_(orders, preorderMap)[String(productId)] || 0);

  if (String(productId) === CONFIG.EGG_PRODUCT_ID) {
    const settings = readEggSettings_();
    return Math.max(0, Math.floor(settings.currentStock - reserved - settings.safetyReserve));
  }

  return Math.max(0, Math.floor(Number(physicalStock || 0) - reserved));
}

function fulfilledProductQuantities_(order, preorderMap) {
  const result = {};
  const productParts = preorderMap || productPreorderMap_();
  (order && order.items || []).forEach(item => {
    const id = String(item.productId || '');
    if (!id || !isFulfilledStatus_(itemPartStatus_(order, id, productParts))) return;
    result[id] = (result[id] || 0) + Math.max(0, Math.floor(Number(item.qty) || 0));
  });
  return result;
}

function orderHasFulfilledPart_(order) {
  if (!order) return false;
  if (!order.splitOrder) return isFulfilledStatus_(order.status);
  return isFulfilledStatus_(order.regularStatus) || isFulfilledStatus_(order.preorderStatus);
}

function orderPlanningSignatureV290_(order) {
  const statusGroup = status => {
    if (String(status || '') === 'Vyzvednuto') return 'picked-up';
    if (String(status || '') === 'Zrušeno') return 'cancelled';
    return 'active';
  };
  const items = (order && order.items || [])
    .map(item => ({
      productId:String(item.productId || ''),
      qty:Math.max(0, Math.floor(Number(item.qty || 0)))
    }))
    .filter(item => item.productId && item.qty > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const split = Boolean(order && order.splitOrder);
  return JSON.stringify({
    splitOrder:split,
    pickup:String(order && order.pickup || ''),
    preorderPickup:split ? String(order && order.preorderPickup || '') : '',
    regularState:statusGroup(split ? order.regularStatus : order && order.status),
    preorderState:split ? statusGroup(order.preorderStatus) : '',
    items:items
  });
}

function fulfilledStockDeltas_(oldOrder, newOrder) {
  // Nejčastější změna Nová/Připravuji/Připraveno vůbec nehýbe fyzickým skladem.
  // V tom případě nemusíme znovu číst produkty ani mapu předobjednávek.
  if (!orderHasFulfilledPart_(oldOrder) && !orderHasFulfilledPart_(newOrder)) return {};
  const preorderMap = productPreorderMap_();
  const before = fulfilledProductQuantities_(oldOrder, preorderMap);
  const after = fulfilledProductQuantities_(newOrder, preorderMap);
  const ids = {};
  Object.keys(before).forEach(id => ids[id] = true);
  Object.keys(after).forEach(id => ids[id] = true);
  const deltas = {};
  Object.keys(ids).forEach(id => deltas[id] = Number(after[id] || 0) - Number(before[id] || 0));
  return deltas;
}

function applyProductStockDeltas_(deltas) {
  const sheet = getOrCreateSheet_(CONFIG.PRODUCTS_SHEET);
  formatProductsSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let productCatalogChanged = false;

  Object.keys(deltas || {}).forEach(id => {
    const delta = Number(deltas[id] || 0);
    if (!delta) return;

    if (String(id) === CONFIG.EGG_PRODUCT_ID) {
      if (delta > 0) ensureEggStockCanBeReduced_(delta);
      adjustEggStock_(-delta);
      return;
    }

    for (let row = 1; row < values.length; row++) {
      if (String(values[row][0]) !== String(id)) continue;
      const current = Math.max(0, Math.floor(Number(values[row][19] || 0)));
      const next = current - delta;
      if (next < 0) throw new Error(`U produktu ${restoreSheetText_(values[row][2] || 'Produkt')} není dostatek fyzických kusů skladem.`);
      sheet.getRange(row + 1, 20).setValue(next);
      values[row][19] = next;
      productCatalogChanged = true;
      break;
    }
  });

  if (productCatalogChanged) invalidatePublicCatalogCache_();
}

function reverseProductStockDeltas_(deltas) {
  const reversed = {};
  Object.keys(deltas || {}).forEach(id => reversed[id] = -Number(deltas[id] || 0));
  applyProductStockDeltas_(reversed);
}

function aggregateOrderStatus_(order) {
  return order && order.splitOrder
    ? aggregateSplitStatus_(order.regularStatus, order.preorderStatus)
    : String(order && order.status || 'Nová');
}

function formatOrderNotificationQueueSheet_(sheet) {
  const headers = ['ID fronty', 'Vytvořeno', 'Typ', 'Objednávka ID', 'Část', 'Stav', 'Pokusy', 'Chyba', 'Aktualizováno'];
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function setupFastOrderNotifications() {
  const sheet = getOrCreateSheet_(CONFIG.NOTIFICATION_QUEUE_SHEET);
  formatOrderNotificationQueueSheet_(sheet);
  ensureOrderNotificationQueueTrigger_(true);
  return 'Hotovo. Změny objednávek se ukládají hned a e-maily se odesílají na pozadí přibližně do jedné minuty.';
}

function orderNotificationQueueTriggerHandler() {
  processOrderNotificationQueue_();
}

function ensureOrderNotificationQueueTrigger_(forceCheck) {
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = 'ORDER_NOTIFICATION_QUEUE_TRIGGER_READY';
  if (!forceCheck && properties.getProperty(propertyKey) === '1') return;

  const handler = 'orderNotificationQueueTriggerHandler';
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  properties.setProperty(propertyKey, '1');
}

function enqueueOrderNotifications_(orderId, jobs) {
  const validJobs = (jobs || []).filter(job => job && job.type);
  if (!validJobs.length) return 0;

  const count = withMutationLock_(() => {
    const sheet = getOrCreateSheet_(CONFIG.NOTIFICATION_QUEUE_SHEET);
    formatOrderNotificationQueueSheet_(sheet);
    const now = new Date();
    const rows = validJobs.map(job => [
      Utilities.getUuid(), now, String(job.type), String(orderId), String(job.part || ''), 'Čeká', 0, '', now
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
    return rows.length;
  }, 10000);

  // Po prvním ručním nastavení je to pouze rychlá kontrola jedné vlastnosti skriptu.
  ensureOrderNotificationQueueTrigger_(false);
  return count;
}

function claimNextOrderNotificationJob_() {
  return withMutationLock_(() => {
    const sheet = getOrCreateSheet_(CONFIG.NOTIFICATION_QUEUE_SHEET);
    formatOrderNotificationQueueSheet_(sheet);
    if (sheet.getLastRow() < 2) return null;

    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
    const now = new Date();
    for (let i = 0; i < values.length; i++) {
      const state = String(values[i][5] || '');
      const attempts = Math.max(0, Math.floor(Number(values[i][6] || 0)));
      const updatedAt = values[i][8] instanceof Date ? values[i][8].getTime() : new Date(values[i][8] || 0).getTime();
      const staleSending = state === 'Odesílám' && (!updatedAt || now.getTime() - updatedAt > 10 * 60 * 1000);
      if ((state !== 'Čeká' && !staleSending) || attempts >= 3) continue;

      const nextAttempts = attempts + 1;
      sheet.getRange(i + 2, 6, 1, 4).setValues([['Odesílám', nextAttempts, '', now]]);
      return {
        queueId: String(values[i][0] || ''),
        row: i + 2,
        type: String(values[i][2] || ''),
        orderId: String(values[i][3] || ''),
        part: String(values[i][4] || ''),
        attempts: nextAttempts
      };
    }
    return null;
  }, 10000);
}

function finishOrderNotificationJob_(job, state, errorText) {
  return withMutationLock_(() => {
    const sheet = getOrCreateSheet_(CONFIG.NOTIFICATION_QUEUE_SHEET);
    if (sheet.getLastRow() < 2) return;
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) !== String(job.queueId)) continue;
      sheet.getRange(i + 2, 6, 1, 4).setValues([[
        state, Number(job.attempts || 0), cleanText_(errorText || '', 500), new Date()
      ]]);
      return;
    }
  }, 10000);
}

function findOrderForNotification_(id) {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return orderFromSheetRow_(values[i]);
  }
  return null;
}

function processOrderNotificationJob_(job) {
  const order = findOrderForNotification_(job.orderId);
  if (!order) return 'Přeskočeno';

  if (job.type === 'ready-regular' || job.type === 'ready-preorder') {
    const part = job.type === 'ready-preorder' ? 'preorder' : 'regular';
    const alreadySent = part === 'preorder' ? order.readyEmailPreorderAt : order.readyEmailRegularAt;
    const currentStatus = part === 'preorder'
      ? order.preorderStatus
      : (order.splitOrder ? order.regularStatus : order.status);
    if (alreadySent || currentStatus !== 'Připraveno' || !isValidEmail_(order.email)) return 'Přeskočeno';

    sendReadyEmail_(order, part);
    const at = new Date().toISOString();
    const text = part === 'preorder'
      ? 'E-mail o připravené předobjednané části'
      : 'E-mail o připravené objednávce';
    if (!recordOrderNotification_(order.id, job.type, at, text)) throw new Error('Objednávku po odeslání e-mailu nelze zapsat.');
    return 'Hotovo';
  }

  if (job.type === 'cancelled') {
    const alreadySent = (order.communication || []).some(item => item && item.type === 'cancelled');
    if (alreadySent || aggregateOrderStatus_(order) !== 'Zrušeno' || !isValidEmail_(order.email)) return 'Přeskočeno';

    sendCancellationEmail_(order);
    const at = new Date().toISOString();
    if (!recordOrderNotification_(order.id, 'cancelled', at, 'E-mail o zrušení objednávky')) {
      throw new Error('Objednávku po odeslání e-mailu nelze zapsat.');
    }
    return 'Hotovo';
  }

  return 'Přeskočeno';
}

function processOrderNotificationQueue_() {
  for (let processed = 0; processed < 5; processed++) {
    const job = claimNextOrderNotificationJob_();
    if (!job) return;

    try {
      const state = processOrderNotificationJob_(job);
      finishOrderNotificationJob_(job, state, '');
    } catch (error) {
      console.error('Odeslání e-mailu z fronty selhalo.', error);
      const retryState = job.attempts < 3 ? 'Čeká' : 'Chyba';
      finishOrderNotificationJob_(job, retryState, error && error.message || 'Neznámá chyba');
      return;
    }
  }
}


function pickupReminderTriggerHandler() {
  sendAutomaticPickupReminders_();
}

function setupPickupReminderAutomation() {
  ensurePickupReminderTrigger_();
  return 'Automatické připomínky jsou nastavené. Kontrola proběhne každý den ráno.';
}

function ensurePickupReminderTrigger_() {
  const handler = 'pickupReminderTriggerHandler';
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (exists) return;
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone(CONFIG.TIME_ZONE)
    .create();
}

function activePickupPartsForDate_(order, dateKey) {
  const result = [];
  if (!order || !dateKey) return result;
  if (!order.splitOrder) {
    if (reminderOpenStatus_(order.status) && order.pickup === dateKey) result.push({key:'regular', label:'objednávka', date:order.pickup});
    return result;
  }
  if (reminderOpenStatus_(order.regularStatus) && order.pickup === dateKey) result.push({key:'regular', label:'první část objednávky', date:order.pickup});
  if (reminderOpenStatus_(order.preorderStatus) && order.preorderPickup === dateKey) result.push({key:'preorder', label:'předobjednaná část objednávky', date:order.preorderPickup});
  return result;
}

function automaticReminderAlreadySent_(order, part) {
  const expectedType = 'pickup-reminder-auto-' + part.key;
  return (order.communication || []).some(item => item && item.type === expectedType && String(item.date || '') === String(part.date || ''));
}

function buildTomorrowPickupText_(order, part) {
  const greeting = firstNameVocative_(order.name);
  const number = order.orderNumber || order.id || '';
  return [
    `Dobrý den${greeting ? ', ' + greeting : ''},`, '',
    `připomínáme, že zítra ${formatCustomerPickupDate_(part.date)} máte naplánované vyzvednutí ${part.label}${number ? ' č. ' + number : ''}.`, '',
    'Adresa vyzvednutí:', 'Pod Prosečí 102/2', 'Jablonec nad Nisou', '',
    'Pokud se Vám termín nehodí, odpovězte na tento e-mail nebo nás kontaktujte na telefonu +420 732 687 040.', '',
    'S přáním krásného dne', '', 'Martin Dvořák', CONFIG.BRAND_NAME
  ].join('\n');
}

function buildSellerTomorrowAlert_(order, part, customerEmailSent, customerEmailError) {
  const number = order.orderNumber || order.id || '';
  const sms = `Dobrý den, připomínáme, že zítra ${formatCustomerPickupDate_(part.date)} máte naplánované vyzvednutí objednávky${number ? ' č. ' + number : ''}. Podprosečské domácí produkty`;
  return [
    `Zítra je naplánované vyzvednutí: ${part.label}.`,
    `Objednávka: ${number}`,
    `Zákazník: ${order.name}`,
    `Telefon: ${order.phone || 'neuveden'}`,
    `E-mail: ${order.email || 'neuveden'}`,
    `Termín: ${formatCustomerPickupDate_(part.date)}`,
    `Zvolený kontakt: ${order.contactMethod || 'SMS'}`,
    '',
    customerEmailSent
      ? 'Zákazníkovi byl připomínkový e-mail odeslán automaticky.'
      : (customerEmailError ? 'Automatický e-mail zákazníkovi se nepodařilo odeslat. Kontaktujte ho prosím ručně.' : 'Zákazník zvolil SMS. SMS je potřeba odeslat ručně.'),
    ...(customerEmailSent ? [] : ['', 'Text SMS:', sms])
  ].join('\n');
}

function sendAutomaticPickupReminders_() {
  const tomorrow = addDaysKey_(todayKey_(), 1);
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  let customerEmails = 0;
  let sellerAlerts = 0;

  for (let i = 1; i < values.length; i++) {
    const order = orderFromSheetRow_(values[i]);
    const parts = activePickupPartsForDate_(order, tomorrow);
    if (!parts.length) continue;

    let changed = false;
    const communication = Array.isArray(order.communication) ? order.communication.slice() : [];
    const timeline = Array.isArray(order.timeline) ? order.timeline.slice() : [];

    parts.forEach(part => {
      if (automaticReminderAlreadySent_(Object.assign({}, order, {communication}), part)) return;

      let customerEmailSent = false;
      let customerEmailError = '';
      if (String(order.contactMethod || 'SMS') === 'E-mail' && isValidEmail_(order.email)) {
        const text = buildTomorrowPickupText_(order, part);
        try {
          MailApp.sendEmail({
            to: order.email,
            subject: `Připomenutí: zítra vyzvednutí objednávky ${order.orderNumber || ''} – ${CONFIG.BRAND_NAME}`,
            body: text,
            htmlBody: '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6;color:#2b241f">' + text.split('\n').map(line => line ? '<p style="margin:8px 0">' + escapeHtml_(line) + '</p>' : '<br>').join('') + '</div>',
            name: CONFIG.BRAND_NAME,
            replyTo: CONFIG.NOTIFICATION_EMAIL
          });
          customerEmailSent = true;
          customerEmails++;
        } catch (error) {
          customerEmailError = String(error && error.message || 'neznámá chyba');
          console.error('Automatická připomínka zákazníkovi se nepodařila odeslat.', error);
        }
      }

      MailApp.sendEmail({
        to: CONFIG.NOTIFICATION_EMAIL,
        subject: `Zítra vyzvednutí ${order.orderNumber || ''} – ${order.name}`,
        body: buildSellerTomorrowAlert_(order, part, customerEmailSent, customerEmailError),
        name: CONFIG.BRAND_NAME,
        replyTo: order.email || CONFIG.NOTIFICATION_EMAIL
      });
      sellerAlerts++;

      const now = new Date().toISOString();
      communication.push({type:'pickup-reminder-auto-' + part.key, date:part.date, at:now, text:customerEmailSent ? 'Automatická připomínka zákazníkovi + upozornění prodejci' : 'Upozornění prodejci k ruční SMS připomínce'});
      timeline.push({type:'reminder', at:now, text:`Připomínka den před vyzvednutím: ${part.label}`});
      changed = true;
    });

    if (changed) {
      sheet.getRange(i + 1, 21).setValue(JSON.stringify(communication));
      sheet.getRange(i + 1, 23).setValue(JSON.stringify(timeline));
    }
  }
  return {customerEmails: customerEmails, sellerAlerts: sellerAlerts, date: tomorrow};
}

function activePickupDates_(order) {
  const dates = [];
  if (!order) return dates;
  if (!order.splitOrder) {
    if (isReservingStatus_(order.status) && order.pickup) dates.push(order.pickup);
  } else {
    if (isReservingStatus_(order.regularStatus) && order.pickup) dates.push(order.pickup);
    if (isReservingStatus_(order.preorderStatus) && order.preorderPickup) dates.push(order.preorderPickup);
  }
  return Array.from(new Set(dates));
}

function reminderOpenStatus_(status) {
  return !['Vyzvednuto', 'Zrušeno'].includes(String(status || 'Nová'));
}

function overduePickupParts_(order) {
  const today = todayKey_();
  const result = [];
  if (!order) return result;

  if (!order.splitOrder) {
    if (reminderOpenStatus_(order.status) && order.pickup && order.pickup < today) {
      result.push({label:'objednávka', date:order.pickup});
    }
    return result;
  }

  if (reminderOpenStatus_(order.regularStatus) && order.pickup && order.pickup < today) {
    result.push({label:'první část objednávky', date:order.pickup});
  }
  if (reminderOpenStatus_(order.preorderStatus) && order.preorderPickup && order.preorderPickup < today) {
    result.push({label:'předobjednaná část objednávky', date:order.preorderPickup});
  }
  return result;
}

function buildPickupReminderText_(order, parts) {
  const greeting = firstNameVocative_(order.name);
  const number = order.orderNumber || order.id || '';
  const lines = (parts || []).map(part => `- ${part.label}: původní termín ${formatCustomerPickupDate_(part.date)}`);
  return [
    `Dobrý den${greeting ? ', ' + greeting : ''},`, '',
    `připomínáme vyzvednutí Vaší objednávky${number ? ' č. ' + number : ''}.`, '',
    ...lines, '',
    'Prosíme, ozvěte se nám, kdy si objednávku můžete vyzvednout. Pokud ji již nechcete, dejte nám prosím vědět, abychom mohli produkty nabídnout dalším zákazníkům.', '',
    'Adresa vyzvednutí:',
    'Pod Prosečí 102/2',
    'Jablonec nad Nisou', '',
    'Telefon: +420 732 687 040', '',
    'S přáním krásného dne', '',
    'Martin Dvořák',
    CONFIG.BRAND_NAME
  ].join('\n');
}

function sendPickupReminder_(payload) {
  const id = cleanIdentifier_(payload.id, 'ID objednávky');
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== id) continue;
    const order = orderFromSheetRow_(values[i]);
    if (!isValidEmail_(order.email)) throw new Error('Objednávka nemá platný e-mail. Použijte SMS připomínku.');
    const parts = overduePickupParts_(order);
    if (!parts.length) throw new Error('Objednávka už není po termínu nebo byla vyzvednuta.');

    const text = buildPickupReminderText_(order, parts);
    MailApp.sendEmail({
      to: order.email,
      subject: `Připomenutí vyzvednutí objednávky ${order.orderNumber || ''} – ${CONFIG.BRAND_NAME}`,
      body: text,
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6;color:#2b241f">' +
        text.split('\n').map(line => line ? '<p style="margin:8px 0">' + escapeHtml_(line) + '</p>' : '<br>').join('') + '</div>',
      name: CONFIG.BRAND_NAME,
      replyTo: CONFIG.NOTIFICATION_EMAIL
    });

    const now = new Date().toISOString();
    const communication = Array.isArray(order.communication) ? order.communication.slice() : [];
    const timeline = Array.isArray(order.timeline) ? order.timeline.slice() : [];
    communication.push({type:'pickup-reminder', at:now, text:'Odeslán e-mail s připomenutím vyzvednutí'});
    timeline.push({type:'email', at:now, text:'Zákazníkovi odesláno připomenutí vyzvednutí'});
    sheet.getRange(i + 1, 21).setValue(JSON.stringify(communication));
    sheet.getRange(i + 1, 23).setValue(JSON.stringify(timeline));
    order.communication = communication;
    order.timeline = timeline;
    return htmlResponse_(true, 'Připomínka byla odeslána e-mailem.', id, {order:order});
  }
  throw new Error('Objednávka nebyla nalezena.');
}

function sendCancellationEmail_(order) {
  if (!order || !isValidEmail_(order.email)) return;
  const number = order.orderNumber || order.id || '';
  MailApp.sendEmail({
    to: order.email,
    subject: `Objednávka ${number} byla zrušena – ${CONFIG.BRAND_NAME}`,
    body: `Dobrý den,

Vaše objednávka ${number ? 'č. ' + number + ' ' : ''}byla zrušena.

Pokud jste o zrušení nežádali nebo si přejete vytvořit novou objednávku, odpovězte na tento e-mail.

S přáním krásného dne

Martin Dvořák
${CONFIG.BRAND_NAME}`,
    htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2d3329">
      <h2 style="color:#315d42">Objednávka byla zrušena</h2>
      <p>Dobrý den,</p>
      <p>Vaše objednávka ${number ? '<strong>č. ' + escapeHtml_(number) + '</strong> ' : ''}byla zrušena.</p>
      <p>Pokud jste o zrušení nežádali nebo si přejete vytvořit novou objednávku, odpovězte na tento e-mail.</p>
      <p>S přáním krásného dne</p>
      <p><strong>Martin Dvořák<br>${escapeHtml_(CONFIG.BRAND_NAME)}</strong></p>
    </div>`,
    name: CONFIG.BRAND_NAME,
    replyTo: CONFIG.NOTIFICATION_EMAIL
  });
}

function reservedProductQuantity_(productId) {
  const orders = readOrdersForAvailability_();
  const preorderMap = productPreorderMap_();
  return Math.max(0, Number(reservationMapFromOrders_(orders, preorderMap)[String(productId)] || 0));
}

function validateBusinessRules_(order) {
  const settings = publicBusinessSettings_();
  if (settings.ordersPaused && settings.pauseFrom && settings.pauseTo) {
    const blockedDates = [order.pickup];
    if (order.splitOrder && order.preorderPickup) blockedDates.push(order.preorderPickup);
    if (blockedDates.some(date => date && date >= settings.pauseFrom && date <= settings.pauseTo)) {
      const firstAfter = addDaysKey_(settings.pauseTo, 1);
      throw new Error(settings.pauseMessage || `V zadaném období nebude možné objednávku vyzvednout. Zvolte termín nejdříve ${formatDateForMessage_(firstAfter)}.`);
    }
  }

  const existingOrders = readOrdersForAvailability_();

  if (settings.dailyOrderLimit > 0) {
    const requestedDates = activePickupDates_(order);
    requestedDates.forEach(date => {
      const count = existingOrders.filter(item => activePickupDates_(item).includes(date)).length;
      if (count >= settings.dailyOrderLimit) {
        throw new Error(`Termín ${formatDateForMessage_(date)} je již plně obsazený. Vyberte jiný termín.`);
      }
    });
  }

  const productList = readProductsBase_();
  const products = {};
  const preorderMap = {};
  productList.forEach(product => {
    products[String(product.id)] = product;
    preorderMap[String(product.id)] = Boolean(product.preorder);
  });
  const reservations = reservationMapFromOrders_(existingOrders, preorderMap);

  order.items.forEach(item => {
    const product = products[String(item.productId)];
    if (!product) return;

    const reserved = Math.max(0, Number(reservations[String(item.productId)] || 0));

    if (String(product.id) !== CONFIG.EGG_PRODUCT_ID && !product.preorder) {
      const available = Math.max(0, Math.floor(Number(product.stock || 0) - reserved));
      if (item.qty > available) {
        throw new Error(`U produktu ${product.name} je nyní skladem pouze ${available} ${product.stockUnit || product.unit}.`);
      }
    }

    if (product.capacity && reserved + item.qty > product.capacity) {
      throw new Error(`U produktu ${product.name} zbývá k rezervaci pouze ${Math.max(0, product.capacity - reserved)} ${product.unit}.`);
    }
  });
}

function normalizeEggStockDateSetting_(sheet) {
  const values = readSettingsMap_(sheet);
  const today = todayKey_();
  const normalized = normalizeDateKey_(values.EGG_STOCK_DATE, today);
  setTextSetting_(sheet, 'EGG_STOCK_DATE', normalized, 'Datum, ke kterému platí aktuální sklad');
}

function readSettingsMap_(sheet) {
  const map = {};
  const rows = sheet.getDataRange().getValues().slice(1);
  rows.forEach(row => {
    if (row[0] !== '') map[String(row[0])] = row[1];
  });
  return map;
}

/** Uloží více nastavení jedním čtením a jedním dávkovým zápisem. */
function setSettingsBatch_(sheet, entries) {
  const source = Array.isArray(entries) ? entries.filter(item => item && item.key) : [];
  if (!source.length) return;

  const lastRow = sheet.getLastRow();
  const existingRange = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 3) : null;
  const rows = existingRange ? existingRange.getValues() : [];
  const formats = existingRange ? existingRange.getNumberFormats() : [];
  const rowByKey = {};
  rows.forEach((row, index) => {
    if (row[0] !== '') rowByKey[String(row[0])] = index;
  });

  source.forEach(item => {
    const key = String(item.key);
    let index = Object.prototype.hasOwnProperty.call(rowByKey, key) ? rowByKey[key] : -1;
    if (index < 0) {
      index = rows.length;
      rowByKey[key] = index;
      rows.push([key, '', '']);
      formats.push(['General', 'General', 'General']);
    }
    rows[index][0] = key;
    rows[index][1] = item.text ? String(item.value == null ? '' : item.value) : item.value;
    rows[index][2] = String(item.description || '');
    if (item.text) formats[index][1] = '@';
  });

  const target = sheet.getRange(2, 1, rows.length, 3);
  // Textový formát musí být nastavený před hodnotami, jinak by Sheets mohl
  // řetězec 2026-08-19 převést na datum a později změnit jeho význam.
  target.setNumberFormats(formats);
  target.setValues(rows);
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

function setTextSetting_(sheet, key, value, description) {
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) === key) {
      const valueCell = sheet.getRange(row + 1, 2);
      valueCell.setNumberFormat('@');
      valueCell.setValue(String(value));
      sheet.getRange(row + 1, 3).setValue(description);
      return;
    }
  }
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setValue(key);
  const valueCell = sheet.getRange(targetRow, 2);
  valueCell.setNumberFormat('@');
  valueCell.setValue(String(value));
  sheet.getRange(targetRow, 3).setValue(description);
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

function normalizeDateKey_(value, fallback) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!isNaN(parsed)) return Utilities.formatDate(parsed, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  return fallback;
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

function cleanIdentifier_(value, label) {
  const id = cleanText_(value, 100);
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    throw new Error((label || 'ID') + ' není platné.');
  }
  return id;
}

function isValidDateKey_(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = parseDateKey_(text);
  return !isNaN(date.getTime()) && Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd') === text;
}

function safeSheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function restoreSheetText_(value) {
  return String(value == null ? '' : value).replace(/^'(?=[=+\-@])/, '');
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
  const requested = String(e && e.parameter && e.parameter.callback || 'callback');
  const callback = requested.replace(/[^a-zA-Z0-9_.$]/g, '') || 'callback';
  const json = JSON.stringify(object)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return ContentService.createTextOutput(`${callback}(${json});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function htmlResponse_(ok, message, id, extra) {
  const result = Object.assign({
    type: 'PDP_BACKEND_RESULT',
    ok: ok,
    message: message,
    id: id
  }, extra || {});

  const resultJson = JSON.stringify(result)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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
    `E-mail: ${order.email || 'neuveden'}`,
    `Vyzvednutí: ${order.pickup || 'neuvedeno'}`,
    `Kontakt před vyzvednutím: ${order.contactMethod}`,
    `Rozdělit objednávku: ${order.splitOrder ? 'ANO' : 'NE'}`,
    ...(order.splitOrder ? [`Předobjednaná část: ${order.preorderPickup || 'bude upřesněno'}`] : []),
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
  return `<div style="font-family:Arial;max-width:600px"><h2>${escapeHtml_(CONFIG.BRAND_NAME)}</h2><p><b>Jméno:</b> ${escapeHtml_(order.name)}<br><b>Telefon:</b> ${escapeHtml_(order.phone)}<br><b>E-mail:</b> ${escapeHtml_(order.email || 'neuveden')}<br><b>Vyzvednutí:</b> ${escapeHtml_(order.pickup || 'neuvedeno')}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:22px;text-align:right"><b>Celkem: ${order.total} Kč</b></p><p><b>Poznámka:</b> ${escapeHtml_(order.note || '—')}</p><small>ID: ${escapeHtml_(id)}</small></div>`;
}


function parseJsonArray_(value) {
  try { const x = JSON.parse(String(value || '[]')); return Array.isArray(x) ? x : []; } catch (_) { return []; }
}

const ORDER_COUNTER_SYNC_VERSION_ = 'v291-20260817';

function orderNumberYear_(orderNumber, createdAt) {
  const match = String(orderNumber || '').match(/^PP-(\d{4})-\d+$/);
  if (match) return match[1];

  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy');
}

function orderCounterSyncKey_(year) {
  return `ORDER_COUNTER_SYNC_${ORDER_COUNTER_SYNC_VERSION_}_${year}`;
}

function syncOrderCounterForYear_(sheet, year, properties) {
  const normalizedYear = String(year || '');
  if (!/^\d{4}$/.test(normalizedYear)) return 0;

  let highest = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const numbers = sheet.getRange(2, 18, lastRow - 1, 1).getDisplayValues();
    const pattern = new RegExp(`^PP-${normalizedYear}-(\\d+)$`);
    numbers.forEach(row => {
      const match = String(row[0] || '').match(pattern);
      if (match) highest = Math.max(highest, Number(match[1]) || 0);
    });
  }

  const props = properties || PropertiesService.getScriptProperties();
  props.setProperty('ORDER_COUNTER_' + normalizedYear, String(highest));
  props.setProperty(orderCounterSyncKey_(normalizedYear), '1');
  return highest;
}

function nextOrderNumber_(date) {
  const year = Utilities.formatDate(date || new Date(), CONFIG.TIME_ZONE, 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'ORDER_COUNTER_' + year;
  if (props.getProperty(orderCounterSyncKey_(year)) !== '1') {
    const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    syncOrderCounterForYear_(sheet, year, props);
  }
  const next = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(next));
  return 'PP-' + year + '-' + String(next).padStart(4, '0');
}

function readyItems_(order, part) {
  if (!order.splitOrder) return order.items || [];
  const products = readProducts_();
  const byId = {}; products.forEach(p => byId[String(p.id)] = p);
  return (order.items || []).filter(item => {
    const p = byId[String(item.productId)] || {};
    const isPre = Boolean(p.preorder);
    return part === 'preorder' ? isPre : !isPre;
  });
}

function readyAnimalPhrase_(order, part) {
  return customerAnimalPhrase_(Object.assign({}, order, {items: readyItems_(order, part)}));
}

function readyWorkMessage_(order, part) {
  const subject = readyAnimalPhrase_(order, part);
  const verb = /farmáři/i.test(subject) ? 'dokončili' : 'dokončily';
  return `${subject} ${verb} práci.`;
}

function buildReadyTextEmail_(order, part) {
  const greeting = firstNameVocative_(order.name);
  const date = part === 'preorder' ? order.preorderPickup : order.pickup;
  const partText = order.splitOrder ? (part === 'preorder' ? 'Předobjednaná část Vaší objednávky' : 'První část Vaší objednávky') : 'Vaše objednávka';
  return [
    `Dobrý den${greeting ? ', ' + greeting : ''},`, '',
    readyWorkMessage_(order, part), '',
    `${partText} je připravena k vyzvednutí.`, '',
    'Prosíme o její vyzvednutí dne', '', formatCustomerPickupDate_(date), '',
    'na adrese', '', 'Pod Prosečí 102/2', 'Jablonec nad Nisou', '',
    'Pokud se Vám termín nehodí, odpovězte na tento e-mail nebo nás kontaktujte na telefonním čísle +420 732 687 040.', '',
    'Děkujeme za Vaši důvěru a těšíme se na Vás.', '', 'S přáním krásného dne', '', 'Martin Dvořák', CONFIG.BRAND_NAME, 'Poctivé produkty od našich včel, slepiček a ze zahrádky.', '', `Číslo objednávky: ${order.orderNumber}`
  ].join('\n');
}

function buildReadyHtmlEmail_(order, part) {
  return '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.6;color:#2b241f">' +
    buildReadyTextEmail_(order, part).split('\n').map(line => line ? '<p style="margin:8px 0">'+escapeHtml_(line)+'</p>' : '<br>').join('') + '</div>';
}

function sendReadyEmail_(order, part) {
  MailApp.sendEmail({to:order.email, subject:'📦 Vaše objednávka je připravena k vyzvednutí – ' + order.orderNumber,
    body:buildReadyTextEmail_(order, part), htmlBody:buildReadyHtmlEmail_(order, part), name:CONFIG.BRAND_NAME, replyTo:CONFIG.NOTIFICATION_EMAIL});
}

function resendReadyEmail_(payload) {
  const id = cleanIdentifier_(payload.id, 'ID objednávky');
  const part = payload.part === 'preorder' ? 'preorder' : 'regular';
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET); formatOrdersSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) if (String(values[i][0])===id) {
    const order=orderFromSheetRow_(values[i]);
    if (!order.email) throw new Error('Objednávka nemá e-mail.');
    sendReadyEmail_(order, part);
    const comm=order.communication || []; comm.push({type:'ready-'+part+'-resend',at:new Date().toISOString(),text:'E-mail o připravené objednávce odeslán znovu'});
    sheet.getRange(i+1,21).setValue(JSON.stringify(comm));
    order.communication = comm;
    return htmlResponse_(true,'E-mail byl odeslán znovu.',id,{order:order});
  }
  throw new Error('Objednávka nebyla nalezena.');
}

function isValidEmail_(value) {
  const email = String(value || '').trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function firstNameVocative_(fullName) {
  const first = cleanText_(String(fullName || '').trim().split(/\s+/)[0], 50);
  if (!first) return '';
  const lower = first.toLocaleLowerCase('cs-CZ');
  const known = {
    martin:'Martine', petr:'Petře', pavel:'Pavle', jan:'Jane', tomáš:'Tomáši', lukáš:'Lukáši',
    michal:'Michale', jiří:'Jiří', josef:'Josefe', david:'Davide', ondřej:'Ondřeji',
    jakub:'Jakube', marek:'Marku', radek:'Radku', roman:'Romane', milan:'Milane',
    eva:'Evo', jana:'Jano', hana:'Hano', anna:'Anno', lucie:'Lucie', petra:'Petro',
    veronika:'Veroniko', kateřina:'Kateřino', martina:'Martino', monika:'Moniko',
    lenka:'Lenko', alena:'Aleno', marie:'Marie', tereza:'Terezo', barbora:'Barboro'
  };
  if (known[lower]) return known[lower];
  if (/[aá]$/.test(lower)) return first.slice(0, -1) + 'o';
  if (/ek$/.test(lower)) return first.slice(0, -2) + 'ku';
  if (/el$/.test(lower)) return first + 'i';
  if (/r$/.test(lower)) return first + 'e';
  return first;
}

function normalizeEmailGroup_(value, productName) {
  const group = String(value || '').trim().toUpperCase();
  if (['SLEPICKY', 'VCELICKY', 'FARMARI', 'VLASTNI'].includes(group)) return group;
  const name = String(productName || '').toLocaleLowerCase('cs-CZ');
  if (name.includes('vejce')) return 'SLEPICKY';
  if (/med|včel|propolis|vosk/i.test(name)) return 'VCELICKY';
  return 'FARMARI';
}

function emailSubjectForItem_(item, productMap) {
  const product = productMap && productMap[String(item.productId)];
  const group = normalizeEmailGroup_(item.emailGroup || (product && product.emailGroup), item.name || (product && product.name));
  if (group === 'SLEPICKY') return 'naše slepičky';
  if (group === 'VCELICKY') return 'naše včeličky';
  if (group === 'VLASTNI') return cleanText_(item.emailText || (product && product.emailText), 120) || 'podprosečští farmáři';
  return 'podprosečští farmáři';
}

function customerAnimalPhrase_(order) {
  const productMap = {};
  readProducts_().forEach(product => { productMap[String(product.id)] = product; });
  const subjects = [];
  (order.items || []).forEach(item => {
    const subject = emailSubjectForItem_(item, productMap);
    if (subject && subjects.indexOf(subject) === -1) subjects.push(subject);
  });
  if (!subjects.length) return 'podprosečští farmáři';
  if (subjects.length === 1) return subjects[0];
  if (subjects.length === 2) return subjects[0] + ' a ' + subjects[1];
  return subjects.slice(0, -1).join(', ') + ' a ' + subjects[subjects.length - 1];
}

function customerReadyWorkMessage_(order) {
  const subject = customerAnimalPhrase_(order);
  const verb = /farmáři/i.test(subject) ? 'dokončili' : 'dokončily';
  return `${subject} ${verb} práci.`;
}

function customerWorkMessage_(order) {
  return `${customerAnimalPhrase_(order)} na Vaší objednávce usilovně pracují. Den před vyzvednutím Vás budeme kontaktovat formou ${order.contactMethod === 'E-mail' ? 'e-mailu' : 'SMS'}.`;
}

function splitOrderMessage_(order) {
  if (!order.splitOrder) return '';
  return `Vaši objednávku jsme rozdělili na dvě vyzvednutí. Dostupné produkty připravíme na ${formatCustomerPickupDate_(order.pickup)} a předobjednané produkty po naskladnění, předpokládaně ${formatCustomerPickupDate_(order.preorderPickup)}.`;
}

function buildCustomerTextEmail_(order, id) {
  const greeting = firstNameVocative_(order.name);
  return [
    `Dobrý den${greeting ? ', ' + greeting : ''},`,
    '',
    customerWorkMessage_(order),
    ...(order.splitOrder ? ['', splitOrderMessage_(order)] : []),
    '',
    'Přehled objednávky:',
    ...order.items.map(item => `- ${item.qty}× ${item.name}: ${item.qty * item.price} Kč`),
    '',
    `Celkem: ${order.total} Kč`,
    `Termín vyzvednutí: ${formatCustomerPickupDate_(order.pickup)}`,
    ...(order.splitOrder ? [`Termín předobjednané části: ${formatCustomerPickupDate_(order.preorderPickup)}`] : []),
    `Způsob kontaktu před vyzvednutím: ${order.contactMethod}`,
    `Číslo objednávky: ${id}`,
    '',
    'Děkujeme za Vaši objednávku.',
    '',
    'S přáním krásného dne',
    '',
    'Martin Dvořák',
    CONFIG.BRAND_NAME,
    'Poctivé produkty od našich včel, slepiček a ze zahrádky.'
  ].join('\n');
}

function buildCustomerHtmlEmail_(order, id) {
  const greeting = firstNameVocative_(order.name);
  const rows = order.items.map(item => `<tr><td style="padding:9px 0;border-bottom:1px solid #eadfce">${escapeHtml_(item.qty + '× ' + item.name)}</td><td style="padding:9px 0;border-bottom:1px solid #eadfce;text-align:right;font-weight:700">${item.qty * item.price} Kč</td></tr>`).join('');
  const split = order.splitOrder ? `<p style="padding:16px;background:#eef7ff;border-radius:12px"><b>${escapeHtml_(splitOrderMessage_(order))}</b></p>` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#2b241f;line-height:1.55"><div style="background:#f3b72e;padding:22px 26px;border-radius:18px 18px 0 0"><h1 style="font-size:24px;margin:0">${escapeHtml_(CONFIG.BRAND_NAME)}</h1></div><div style="padding:26px;border:1px solid #eadfce;border-top:0;border-radius:0 0 18px 18px"><p>Dobrý den${greeting ? ', <b>' + escapeHtml_(greeting) + '</b>' : ''},</p><p style="padding:16px;background:#fff8e5;border-radius:12px"><b>${escapeHtml_(customerWorkMessage_(order))}</b></p>${split}<table style="width:100%;border-collapse:collapse;margin-top:18px">${rows}</table><p style="font-size:22px;text-align:right"><b>Celkem: ${order.total} Kč</b></p><p><b>Termín vyzvednutí:</b> ${escapeHtml_(formatCustomerPickupDate_(order.pickup))}${order.splitOrder ? `<br><b>Termín předobjednané části:</b> ${escapeHtml_(formatCustomerPickupDate_(order.preorderPickup))}` : ''}<br><b>Kontakt před vyzvednutím:</b> ${escapeHtml_(order.contactMethod)}<br><b>Číslo objednávky:</b> ${escapeHtml_(id)}</p><p style="margin-top:28px">Děkujeme za Vaši objednávku.</p><p style="margin-top:24px">S přáním krásného dne<br><b>Martin Dvořák</b><br>${escapeHtml_(CONFIG.BRAND_NAME)}<br><i>Poctivé produkty od našich včel, slepiček a ze zahrádky.</i></p></div></div>`;
}

function formatCustomerPickupDate_(dateKey) {
  if (!dateKey || !isValidDateKey_(dateKey)) return 'bude upřesněn';
  const parts = String(dateKey).split('-').map(Number);
  return `${parts[2]}. ${parts[1]}. ${parts[0]}`;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
