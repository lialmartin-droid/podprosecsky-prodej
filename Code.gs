/**
 * Podprosečské domácí produkty — sdílený backend V3.7.0
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
  ALBUM_SHEET: 'Fotoalbum',
  LOYALTY_CUSTOMERS_SHEET: 'Věrnostní zákazníci',
  LOYALTY_REWARDS_SHEET: 'Věrnostní odměny',
  LOYALTY_LEDGER_SHEET: 'Věrnostní pohyby',
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
  DEFAULT_LOYALTY_EGGS_REQUIRED: 100,
  DEFAULT_LOYALTY_DISCOUNT_CZK: 20,
  LOYALTY_START_DATE: '2026-08-27',
  ORDER_COLUMN_COUNT: 33,
  MAX_IMAGE_BYTES: 1600000,
  PRODUCT_IMAGES_FOLDER: 'Podprosecske_produkty_obrazky',
  ALBUM_IMAGES_FOLDER: 'Podprosecske_fotoalbum',
  MAX_ALBUM_PHOTOS: 80,
  CUSTOMER_ACCESS_CODE_SECONDS: 600,
  CUSTOMER_ACCESS_SESSION_SECONDS: 21600,
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
  const album = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  const loyaltyCustomers = getOrCreateSheet_(CONFIG.LOYALTY_CUSTOMERS_SHEET);
  const loyaltyRewards = getOrCreateSheet_(CONFIG.LOYALTY_REWARDS_SHEET);
  const loyaltyLedger = getOrCreateSheet_(CONFIG.LOYALTY_LEDGER_SHEET);

  formatOrdersSheet_(orders);
  ensureOrderNumbers_(orders);
  formatProductsSheet_(products);
  formatSettingsSheet_(settings);
  formatWatchlistSheet_(watchlist);
  formatVisitsSheet_(visits);
  formatOrderNotificationQueueSheet_(notificationQueue);
  formatAlbumSheet_(album);
  formatLoyaltyCustomersSheet_(loyaltyCustomers);
  formatLoyaltyRewardsSheet_(loyaltyRewards);
  formatLoyaltyLedgerSheet_(loyaltyLedger);
  seedProducts_(products);
  repairDefaultProductSettings_(products);
  seedEggSettings_(settings);
  seedLoyaltySettings_(settings);
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
      'V administraci nyní najdete také záložku Vejce, kde nastavíte aktuální sklad a denní snášku.',
      'V záložce Věrnostní slevy nastavíte počet vajec potřebný pro odměnu a výši slevy.'
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
    if (isTestOrder_(order)) return;
    (order.items || []).forEach(item => {
      const id = String(item.productId || '');
      if (!id || !isReservingStatus_(itemPartStatus_(order, id, preorderMap))) return;
      map[id] = (map[id] || 0) + Math.max(0, Number(item.qty) || 0);
    });
  });
  return map;
}

function publicPayloadCacheKey_() {
  return 'public-payload-v350';
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
    dailyOrderLimit: Math.max(0, safeInteger_(map.DAILY_ORDER_LIMIT, 0)),
    loyalty: loyaltySettingsFromMap_(map)
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
    orderNumber: String(row[17] || ''),
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
  if (isTestOrder_(order)) return contribution;
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
      if (parsed && parsed.ok && parsed.version === '3.5.0' && Array.isArray(parsed.products)) return parsed;
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
    version: '3.5.0',
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
    version: '3.6.4',
    products: readProductsFast_(reservations, availability, catalog.products),
    orders: orders,
    eggSettings: availability.settings,
    eggAvailability: availability,
    businessSettings: publicBusinessSettingsFromMapFast_(catalog.settingsMap || {}),
    album: readAlbumPhotos_(true),
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
    version: '3.6.4',
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

function assignOrdersToCustomerEmail_(payload) {
  const email = normalizeLoyaltyEmail_(payload && payload.email);
  if (!isValidEmail_(email)) throw new Error('Zadejte platný e-mail zákazníka.');

  const requestedIds = Array.isArray(payload && payload.orderIds)
    ? payload.orderIds.map(id => cleanText_(id, 100)).filter(Boolean)
    : [];
  const ids = Array.from(new Set(requestedIds)).slice(0, 200);
  if (!ids.length) throw new Error('Vyberte alespoň jednu objednávku.');

  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  if (sheet.getLastRow() < 2) throw new Error('Nejsou uložené žádné objednávky.');

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.ORDER_COLUMN_COUNT).getValues();
  const wanted = new Set(ids);
  const now = new Date().toISOString();
  let changed = 0;

  values.forEach(row => {
    const id = String(row[0] || '');
    if (!wanted.has(id)) return;
    const previousEmail = normalizeLoyaltyEmail_(row[11]);
    if (previousEmail === email) return;
    row[11] = safeSheetText_(email);
    const timeline = parseJsonArray_(row[22]);
    timeline.push({
      type:'customer',
      at:now,
      text:'Objednávka přiřazena k zákazníkovi podle e-mailu: ' + email
    });
    row[22] = JSON.stringify(timeline);
    changed++;
  });

  if (!changed) {
    return htmlResponse_(true, 'Vybrané objednávky už jsou přiřazené k tomuto e-mailu.', '', {
      kind:'customerOrdersAssigned',
      assignedCount:0,
      orders:readOrdersAdminFast_()
    });
  }

  sheet.getRange(2, 1, values.length, CONFIG.ORDER_COLUMN_COUNT).setValues(values);
  return htmlResponse_(true, changed === 1
    ? 'Objednávka byla přiřazena k zákazníkovi.'
    : changed + ' objednávek bylo přiřazeno k zákazníkovi.', '', {
    kind:'customerOrdersAssigned',
    assignedCount:changed,
    orders:readOrdersAdminFast_()
  });
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

    if (action === 'album') {
      return jsonpResponse_(e, { ok:true, version:'3.5.0', album:publicAlbumPhotos_() });
    }

    if (action === 'loyaltyInfo') {
      const catalog = readPublicCatalogFast_();
      return jsonpResponse_(e, { ok:true, version:'3.5.0', loyalty:loyaltySettingsFromMap_(catalog.settingsMap || {}) });
    }

    if (action === 'trackVisit') {
      return jsonpResponse_(e, trackVisitFromRequest_(e));
    }

    if (action === 'orderReceipt') {
      return jsonpResponse_(e, orderReceiptResponse_(e && e.parameter && e.parameter.requestId || ''));
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
      version: '3.5.0',
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
    if (action === 'loyaltyStatus') return loyaltyStatusResponse_(payload);
    if (action === 'joinLoyalty') throw new Error('Registrace je nyní dostupná na zabezpečené stránce Věrnost a objednávky. Obnovte prosím hlavní stránku.');
    if (action === 'requestCustomerAccess') return requestCustomerAccess_(payload);
    if (action === 'verifyCustomerAccess') return verifyCustomerAccess_(payload);
    if (action === 'customerAccountData') return customerAccountData_(payload);
    if (action === 'joinCustomerAccountLoyalty') return withMutationLock_(() => joinCustomerAccountLoyalty_(payload), 15000);

    const token = cleanText_(e.parameter.token || payload.token || '', 100);
    requireToken_(token);

    // Čtení a upload obrázků nepotřebují globální tabulkový zámek.
    if (action === 'uploadProductImage') return uploadProductImage_(payload);
    if (action === 'listProductImages') return listProductImages_();
    if (action === 'deleteProductImage') return deleteProductImage_(payload);
    if (action === 'uploadAlbumPhoto') return uploadAlbumPhoto_(payload);
    if (action === 'getAlbumData') return getAlbumData_();
    if (action === 'getFeedData') return htmlResponse_(true, '', '', {feedData:feedData_()});
    if (action === 'saveFeedSettings') return withMutationLock_(() => saveFeedSettings_(payload), 10000);
    if (action === 'saveFeedPurchase') return withMutationLock_(() => saveFeedPurchase_(payload), 10000);
    if (action === 'deleteFeedPurchase') return withMutationLock_(() => deleteFeedPurchase_(payload), 10000);

    // Krátké mutace tabulky serializujeme, ale zámek se nedrží přes veřejné objednávky.
    if (action === 'saveProduct') return withMutationLock_(() => saveProduct_(payload), 10000);
    if (action === 'deleteProduct') return withMutationLock_(() => deleteProduct_(payload), 10000);
    if (action === 'saveAlbumPhoto') return withMutationLock_(() => saveAlbumPhoto_(payload), 10000);
    if (action === 'saveAlbumOrder') return withMutationLock_(() => saveAlbumOrder_(payload), 10000);
    if (action === 'deleteAlbumPhoto') return withMutationLock_(() => deleteAlbumPhoto_(payload), 10000);
    if (action === 'saveOrder') return saveOrder_(payload, true);
    if (action === 'deleteOrder') return withMutationLock_(() => deleteOrder_(payload), 10000);
    if (action === 'manualOrder') return createOrder_(payload, true);
    if (action === 'saveEggSettings') return withMutationLock_(() => saveEggSettings_(payload), 10000);
    if (action === 'saveBusinessSettings') return withMutationLock_(() => saveBusinessSettings_(payload), 10000);
    if (action === 'resendReadyEmail') return resendReadyEmail_(payload);
    if (action === 'sendPickupReminder') return sendPickupReminder_(payload);
    if (action === 'setVisitExclusion') return withMutationLock_(() => setVisitExclusion_(payload), 10000);
    if (action === 'getLoyaltyData') return getLoyaltyAdminData_();
    if (action === 'saveLoyaltySettings') return withMutationLock_(() => saveLoyaltySettings_(payload), 20000);
    if (action === 'adjustLoyaltyCustomer') return withMutationLock_(() => adjustLoyaltyCustomer_(payload), 20000);
    if (action === 'setLoyaltyCustomerActive') return withMutationLock_(() => setLoyaltyCustomerActive_(payload), 15000);
    if (action === 'assignOrdersToCustomerEmail') return withMutationLock_(() => assignOrdersToCustomerEmail_(payload), 20000);
    if (action === 'markBankPayment') return withMutationLock_(() => markBankPayment_(payload), 20000);

    // Volitelné rozšíření V2.6+ (sklad obalů a přesné návštěvy).
    if (['savePackagingSelection', 'consumePackagingForOrder'].includes(action)) {
      const packagingOrder = readOrdersAdminFast_().find(order => String(order.id) === String(payload.orderId));
      if (isTestOrder_(packagingOrder)) return htmlResponse_(true, 'TEST: obaly se neodečítají.', payload.orderId, {consumed:{}});
    }
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
  const productFolder = getProductImagesFolder_();
  const albumFolder = getAlbumImagesFolder_();
  const albumSheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(albumSheet);
  Logger.log('Galerie jsou připravené: ' + productFolder.getName() + ', ' + albumFolder.getName());
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

function getAlbumImagesFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.ALBUM_IMAGES_FOLDER);
  if (folders.hasNext()) return folders.next();

  const folder = DriveApp.createFolder(CONFIG.ALBUM_IMAGES_FOLDER);
  folder.setDescription('Veřejné fotoalbum Podprosečských domácích produktů.');
  return folder;
}

function formatAlbumSheet_(sheet) {
  const headers = ['ID / soubor', 'Název', 'Popisek', 'Adresa obrázku', 'Viditelná', 'Pořadí', 'Vytvořeno', 'Aktualizováno', 'Název souboru'];
  ensureHeaders_(sheet, headers);
}

function albumPhotoFromRow_(row) {
  const created = row[6] instanceof Date && !isNaN(row[6]) ? row[6].toISOString() : String(row[6] || '');
  const updated = row[7] instanceof Date && !isNaN(row[7]) ? row[7].toISOString() : String(row[7] || '');
  return {
    id:String(row[0] || ''),
    fileId:String(row[0] || ''),
    title:restoreSheetText_(row[1] || ''),
    caption:restoreSheetText_(row[2] || ''),
    image:restoreSheetText_(row[3] || ''),
    visible:toBool_(row[4]),
    sortOrder:Number(row[5] || 0),
    created:created,
    updated:updated,
    fileName:restoreSheetText_(row[8] || '')
  };
}

function readAlbumPhotos_(includeHidden) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(CONFIG.ALBUM_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const photos = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues()
    .map(albumPhotoFromRow_)
    .filter(photo => photo.id && photo.image)
    .filter(photo => includeHidden || photo.visible);

  photos.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.created).localeCompare(String(b.created)));
  return photos.slice(0, CONFIG.MAX_ALBUM_PHOTOS);
}

function publicAlbumPhotos_() {
  return readAlbumPhotos_(false).map(photo => ({
    id:photo.id,
    title:photo.title,
    caption:photo.caption,
    image:photo.image
  }));
}

function getAlbumData_() {
  const sheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(sheet);
  return htmlResponse_(true, '', '', { album:readAlbumPhotos_(true) });
}

function uploadAlbumPhoto_(payload) {
  const existing = readAlbumPhotos_(true);
  if (existing.length >= CONFIG.MAX_ALBUM_PHOTOS) {
    throw new Error('Fotoalbum může obsahovat nejvýše ' + CONFIG.MAX_ALBUM_PHOTOS + ' fotografií. Nejprve některou smažte.');
  }

  const dataUrl = String(payload && payload.dataUrl || '');
  const originalName = cleanText_(payload && payload.fileName || 'fotografie.jpg', 120);
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Vyberte obrázek JPG, PNG nebo WEBP.');

  const mimeType = match[1];
  const bytes = Utilities.base64Decode(match[2]);
  if (!bytes.length) throw new Error('Fotografie je prázdná.');
  if (bytes.length > CONFIG.MAX_IMAGE_BYTES) {
    throw new Error('Fotografie je po zmenšení stále příliš velká. Zvolte menší fotografii.');
  }

  const extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
  const baseName = originalName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 55) || 'fotografie';
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss');
  const fileName = 'album-' + baseName + '-' + stamp + '.' + extension;
  const file = getAlbumImagesFolder_().createFile(Utilities.newBlob(bytes, mimeType, fileName));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const title = cleanText_(payload && payload.title || originalName.replace(/\.[^.]+$/, ''), 100) || 'Fotografie';
  const caption = cleanText_(payload && payload.caption || '', 350);
  const nextSort = existing.reduce((maximum, photo) => Math.max(maximum, Number(photo.sortOrder || 0)), 0) + 10;
  const now = new Date();
  const image = publicDriveImageUrl_(file.getId());
  const sheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(sheet);
  sheet.appendRow([
    file.getId(), safeSheetText_(title), safeSheetText_(caption), safeSheetText_(image),
    true, nextSort, now, now, safeSheetText_(fileName)
  ]);
  invalidatePublicPayloadCache_();

  const photo = {
    id:file.getId(), fileId:file.getId(), title:title, caption:caption, image:image,
    visible:true, sortOrder:nextSort, created:now.toISOString(), updated:now.toISOString(), fileName:fileName
  };
  return htmlResponse_(true, 'Fotografie byla přidána do alba.', file.getId(), { photo:photo, album:readAlbumPhotos_(true) });
}

function findAlbumPhotoRow_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let index = 0; index < values.length; index++) {
    if (String(values[index][0] || '') === String(id)) return index + 2;
  }
  return 0;
}

function saveAlbumPhoto_(payload) {
  const source = payload && payload.photo || payload || {};
  const id = cleanText_(source.id || source.fileId || '', 200);
  if (!id) throw new Error('Chybí identifikátor fotografie.');

  const sheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(sheet);
  const rowNumber = findAlbumPhotoRow_(sheet, id);
  if (!rowNumber) throw new Error('Fotografie už v albu není.');
  const row = sheet.getRange(rowNumber, 1, 1, 9).getValues()[0];
  const current = albumPhotoFromRow_(row);
  const title = cleanText_(source.title, 100) || 'Fotografie';
  const caption = cleanText_(source.caption, 350);
  const visible = source.visible === undefined ? current.visible : toBool_(source.visible);
  const sortOrder = Number.isFinite(Number(source.sortOrder)) ? Number(source.sortOrder) : current.sortOrder;

  sheet.getRange(rowNumber, 2, 1, 7).setValues([[
    safeSheetText_(title), safeSheetText_(caption), safeSheetText_(current.image), visible,
    sortOrder, row[6] || new Date(), new Date()
  ]]);
  invalidatePublicPayloadCache_();
  return htmlResponse_(true, 'Fotografie byla uložena.', id, { album:readAlbumPhotos_(true) });
}

function saveAlbumOrder_(payload) {
  const requestedIds = Array.isArray(payload && payload.ids) ? payload.ids.map(value => cleanText_(value, 200)).filter(Boolean) : [];
  const sheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(sheet);
  if (sheet.getLastRow() < 2) return htmlResponse_(true, 'Pořadí je uložené.', '', { album:[] });

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  const knownIds = values.map(row => String(row[0] || '')).filter(Boolean);
  const orderedIds = requestedIds.filter((id, index) => knownIds.includes(id) && requestedIds.indexOf(id) === index);
  knownIds.forEach(id => { if (!orderedIds.includes(id)) orderedIds.push(id); });
  const rank = {};
  orderedIds.forEach((id, index) => { rank[id] = (index + 1) * 10; });
  sheet.getRange(2, 6, values.length, 1).setValues(values.map(row => [rank[String(row[0] || '')] || 9990]));
  invalidatePublicPayloadCache_();
  return htmlResponse_(true, 'Pořadí fotografií je uložené.', '', { album:readAlbumPhotos_(true) });
}

function deleteAlbumPhoto_(payload) {
  const id = cleanText_(payload && (payload.id || payload.fileId) || '', 200);
  if (!id) throw new Error('Chybí identifikátor fotografie.');
  const sheet = getOrCreateSheet_(CONFIG.ALBUM_SHEET);
  formatAlbumSheet_(sheet);
  const rowNumber = findAlbumPhotoRow_(sheet, id);
  if (!rowNumber) throw new Error('Fotografie už v albu není.');

  sheet.deleteRow(rowNumber);
  try { DriveApp.getFileById(id).setTrashed(true); }
  catch (error) { console.error('Fotografii se nepodařilo přesunout do koše Disku.', error); }
  invalidatePublicPayloadCache_();
  return htmlResponse_(true, 'Fotografie byla smazána z alba.', id, { album:readAlbumPhotos_(true) });
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
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.ORDER_COLUMN_COUNT).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][26] || '') === id) return orderFromSheetRow_(values[i]);
  }
  return null;
}

function orderPayment_(order) {
  if (!order) return null;
  const isTest = isTestOrder_(order);
  const entry = (order.timeline || []).filter(e => e.type === 'payment').slice(-1)[0] || {};
  const total = Math.round(Number(order.total || 0) * 100) / 100;
  const digits = String(order.orderNumber || '').replace(/\D/g, '');
  const vs = isTest ? '9' + digits.replace(/^0+/, '').padStart(9, '0') : digits;
  const paymentMessage = isTest ? String(order.orderNumber || '').toUpperCase() : 'OBJEDNAVKA ' + vs;
  const method = entry.method || 'pickup';
  const paid = Boolean(entry.paid);
  const spd = method === 'qr' && !paid && total > 0 && /^\d{1,10}$/.test(vs)
    ? 'SPD*1.0*ACC:CZ6055000000000000987466*AM:' + total.toFixed(2) + '*CC:CZK*X-VS:' + vs + '*MSG:' + paymentMessage : '';
  return {method:method, paid:paid, paidAmount:entry.amount, emailSent:Boolean(entry.emailSent), account:'987466/5500', iban:'CZ6055000000000000987466', amount:total, vs:vs, spd:spd, message:paymentMessage, isTest:isTest};
}

function markBankPayment_(payload) {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((row, i) => i > 0 && String(row[0]) === String(payload.id));
  if (index < 1) throw new Error('Objednávka nebyla nalezena.');
  const order = orderFromSheetRow_(rows[index]);
  const isTest = isTestOrder_(order);
  if (Number(payload.expectedTotal) !== Number(order.total)) throw new Error('Cena objednávky se mezitím změnila. Obnovte objednávky a zkontrolujte přijatou částku.');
  if (order.status === 'Zrušeno') throw new Error('Objednávka je zrušená. Přijetí platby zkontrolujte ručně.');
  const timeline = order.timeline;
  let entry = timeline.filter(e => e.type === 'payment' && e.paid).slice(-1)[0];
  if (!entry) {
    entry = {type:'payment', method:'qr', paid:true, amount:order.total, emailSent:false, at:new Date().toISOString(), text:(isTest ? 'TEST – simulace přijetí platby: ' : 'Zaplaceno převodem: ') + order.total + ' Kč'};
    timeline.push(entry);
    sheet.getRange(index + 1, 23).setValue(JSON.stringify(timeline));
  }
  let message = isTest ? 'TEST: přijetí platby bylo nasimulováno, bez započítání tržby.' : 'Platba je označena jako přijatá.';
  if (!entry.emailSent) {
    if (!isValidEmail_(order.email)) {
      message += ' Chybí platný e-mail zákazníka; doplňte jej a potvrzení odešlete znovu.';
    } else {
      try {
        MailApp.sendEmail({to:order.email, subject:(isTest ? 'TEST – simulace: ' : '') + 'Platba přijata – objednávka ' + order.orderNumber,
          body:(isTest ? 'TESTOVACÍ E-MAIL: jde pouze o simulaci přijetí platby. Peníze neposílejte; skutečná platba nebyla ověřena.\n\n' : '') + 'Dobrý den,\n\n' + (isTest ? 'Simulované přijetí platby převodem ve výši ' : 'přijali jsme Vaši platbu převodem ve výši ') + entry.amount + ' Kč za objednávku ' + order.orderNumber + '.\n\nDěkujeme. O připravené objednávce Vás budeme informovat samostatně.\n\n' + CONFIG.BRAND_NAME,
          name:CONFIG.BRAND_NAME, replyTo:CONFIG.NOTIFICATION_EMAIL});
        entry.emailSent = true;
        timeline.push({type:'email', at:new Date().toISOString(), text:'Zákazníkovi odesláno potvrzení přijetí platby'});
        sheet.getRange(index + 1, 23).setValue(JSON.stringify(timeline));
        message += ' Potvrzení bylo odesláno zákazníkovi.';
      } catch (error) {
        message += ' E-mail se nepodařilo odeslat. Použijte tlačítko Odeslat potvrzení platby znovu.';
      }
    }
  }
  return htmlResponse_(true, message, order.id, {orders:readOrdersAdminFast_()});
}

// QR vytváříme přímo v aplikaci, bez odesílání platebních údajů cizí službě.
function paymentReceipt_(order) {
  const payment = orderPayment_(order);
  if (!payment || !payment.spd) return payment;
  try {
    const qr = pdpQrGenerator(0, 'M');
    qr.addData(payment.spd, 'Alphanumeric');
    qr.make();
    payment.qrDataUrl = qr.createDataURL(6, 24);
  } catch (error) {
    console.error('Vytvoření QR obrázku selhalo.', error);
  }
  return payment;
}

function customerConfirmationEmail_(order, orderNumber) {
  const payment = paymentReceipt_(order);
  const mail = {
    to: order.email,
    subject: `${isTestOrder_(order) ? 'TEST – ' : ''}Potvrzení přijetí objednávky – ${CONFIG.BRAND_NAME}`,
    body: buildCustomerTextEmail_(order, orderNumber),
    htmlBody: buildCustomerHtmlEmail_(order, orderNumber),
    name: CONFIG.BRAND_NAME,
    replyTo: CONFIG.NOTIFICATION_EMAIL
  };
  if (payment && payment.qrDataUrl) {
    const blob = Utilities.newBlob(Utilities.base64Decode(payment.qrDataUrl.split(',')[1]), 'image/gif', 'QR-' + orderNumber + '.gif');
    mail.inlineImages = {paymentQr:blob};
    mail.attachments = [blob];
    mail.htmlBody += '<div style="font-family:Arial,sans-serif;max-width:620px;margin:24px auto;text-align:center;background:#ffffff;color:#222;padding:20px;box-sizing:border-box"><h2>' + (payment.isTest ? 'TEST – QR platba k ověření' : 'QR platba') + '</h2>'
      + (payment.isTest ? '<p>QR obsahuje skutečný účet. V bance převod nepotvrzujte.</p>' : '')
      + '<img src="cid:paymentQr" width="280" height="280" alt="QR platba za objednávku ' + escapeHtml_(orderNumber) + '" style="display:block;width:280px;max-width:100%;height:auto;margin:0 auto">'
      + '<p>Účet ' + escapeHtml_(payment.account) + ' · ' + payment.amount.toFixed(2) + ' Kč<br>VS ' + escapeHtml_(payment.vs) + '<br>Zpráva: ' + escapeHtml_(payment.message) + '</p><p>QR najdete také v příloze tohoto e-mailu.</p></div>';
    mail.body += '\n\nQR kód pro načtení bankovní aplikací je přiložen jako obrázek.';
  }
  return mail;
}

function orderReceiptResponse_(requestId) {
  const id = cleanText_(requestId || '', 100)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 100);
  if (!id) return { ok:true, kind:'orderReceipt', found:false };

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(CONFIG.ORDERS_SHEET);
  const order = sheet ? findOrderByRequestId_(sheet, id) : null;
  return {
    ok:true,
    kind:'orderReceipt',
    found:Boolean(order),
    payment:order ? paymentReceipt_(order) : undefined,
    orderNumber:order ? String(order.orderNumber || '') : '',
    loyalty:order ? publicLoyaltyOrderResult_(order) : undefined
  };
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
  let loyaltyWarning = '';

  try {
    // Zámek chrání pouze validaci dostupnosti + zápis. E-maily se posílají až po jeho uvolnění.
    lock.waitLock(20000);

    sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    formatOrdersSheet_(sheet);

    if (requestId) {
      const existing = findOrderByRequestId_(sheet, requestId);
      if (existing) {
        if (!manual && !isTestOrder_(existing) && typeof linkOrderToVisitorV27_ === 'function') {
          try {
            linkOrderToVisitorV27_(payload, existing);
          } catch (visitorError) {
            console.error('Dodatečné propojení návštěvníka s objednávkou selhalo.', visitorError);
          }
        }
        return htmlResponse_(true, 'Objednávka už byla přijata. Nevytváříme ji podruhé.', existing.id, {
          orderNumber: existing.orderNumber,
          order: manual ? existing : undefined,
          duplicatePrevented: true,
          payment: paymentReceipt_(existing),
          loyalty: publicLoyaltyOrderResult_(existing)
        });
      }
    }

    order = validateOrder_(payload, manual);
    order.isTest = String(order.name || '').trim().toLowerCase() === 'test';
    validatePickupRules_(order, '');
    if (!manual) validateBusinessRules_(order);

    const stockDeltas = fulfilledStockDeltas_(null, order);
    id = Utilities.getUuid();
    createdAt = new Date();
    orderNumber = isTestOrder_(order) ? nextTestOrderNumber_() : nextOrderNumber_(createdAt);
    order.orderNumber = orderNumber;
    const fulfilledAt = !order.splitOrder && isFulfilledStatus_(order.status) ? createdAt : '';
    const regularFulfilledAt = order.splitOrder && isFulfilledStatus_(order.regularStatus) ? createdAt : '';
    const preorderFulfilledAt = order.splitOrder && isFulfilledStatus_(order.preorderStatus) ? createdAt : '';
    order.fulfilledAtKey = normalizeDateKey_(fulfilledAt, '');
    order.regularFulfilledAtKey = normalizeDateKey_(regularFulfilledAt, '');
    order.preorderFulfilledAtKey = normalizeDateKey_(preorderFulfilledAt, '');
    try {
      order = prepareLoyaltyForOrder_(payload, order, id, manual);
    } catch (loyaltyError) {
      console.error('Věrnostní program se při vytvoření objednávky nepodařilo zpracovat.', loyaltyError);
      loyaltyWarning = ' Věrnostní program se nepodařilo ověřit; objednávka byla uložena bez slevy.';
      order = clearLoyaltyOrderMeta_(order, toBool_(payload && payload.loyaltyOptIn));
    }
    const itemsText = order.items.map(i => `${i.qty}× ${i.name} (${i.qty * i.price} Kč)`).join(', ');
    let stockAdjusted = false;

    try {
      applyProductStockDeltas_(stockDeltas);
      stockAdjusted = true;

      const orderRow = [
        id, createdAt, order.status, safeSheetText_(order.name), safeSheetText_(order.phone), order.pickup,
        safeSheetText_(itemsText), order.total, safeSheetText_(order.note), manual ? 'Administrace' : 'Web', JSON.stringify(order.items), safeSheetText_(order.email),
        safeSheetText_(order.contactMethod), order.splitOrder, order.preorderPickup, order.regularStatus, order.preorderStatus,
        orderNumber, '', '', JSON.stringify([]), '', JSON.stringify([{type:'created', at:createdAt.toISOString(), text:'Objednávka vytvořena'}]),
        fulfilledAt, regularFulfilledAt, preorderFulfilledAt, requestId,
        order.loyaltyCustomerId || '', order.loyaltyDiscount || 0, order.loyaltyRewardId || '',
        order.loyaltyRewardState || '', order.loyaltyEggsCounted || 0, order.loyaltyOptIn
      ];
      const initialTimeline = parseJsonArray_(orderRow[22]);
      initialTimeline.push({type:'payment', at:createdAt.toISOString(), method:payload.paymentMethod === 'qr' ? 'qr' : 'pickup', paid:false, text:payload.paymentMethod === 'qr' ? 'QR platba – čeká na platbu' : 'Platba při vyzvednutí'});
      orderRow[22] = JSON.stringify(initialTimeline);
      sheet.appendRow(orderRow);
      savedOrder = orderFromSheetRow_(orderRow);
      try {
        savedOrder = syncLoyaltyAfterOrderState_(null, savedOrder, sheet, sheet.getLastRow());
        order = savedOrder;
      } catch (loyaltySyncError) {
        console.error('Věrnostní stav nové objednávky se nepodařilo dokončit.', loyaltySyncError);
        loyaltyWarning = ' Věrnostní stav se nepodařilo dokončit; objednávku zkontrolujte v administraci.';
      }

      // Visitor ID posílá zákaznická stránka. Uložíme ho mimo list Objednávky,
      // takže kvůli propojení návštěvnosti neměníme stabilní strukturu objednávek.
      if (!manual && !isTestOrder_(order) && typeof linkOrderToVisitorV27_ === 'function') {
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
      if (order && order.loyaltyRewardId) {
        try { releaseLoyaltyReward_(order.loyaltyRewardId, id); }
        catch (loyaltyRollbackError) { console.error('Vrácení věrnostní odměny po chybě selhalo.', loyaltyRollbackError); }
      }
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
      MailApp.sendEmail(customerConfirmationEmail_(order, orderNumber));
    } catch (customerEmailError) {
      console.error('Objednávka byla uložena, ale potvrzení zákazníkovi se nepodařilo odeslat.', customerEmailError);
      emailWarning += ' Potvrzovací e-mail zákazníkovi se nepodařilo odeslat.';
    }
  }

  return htmlResponse_(true, (isTestOrder_(order) ? 'TEST: zkušební objednávka bez započítání tržby, skladu a věrnosti. Neplaťte ji.' : manual ? 'Objednávka byla uložena.' : 'Objednávka byla přijata.') + emailWarning + loyaltyWarning, id, {
    orderNumber:orderNumber,
    order:manual ? savedOrder : undefined,
    payment: paymentReceipt_(savedOrder || order),
    loyalty: publicLoyaltyOrderResult_(savedOrder || order)
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
  let loyaltyWarning = '';

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
    // Typ je po vytvoření neměnný; přejmenování nesmí změnit sklad ani historii.
    order.isTest = isTestOrder_(oldOrder);
    order.orderNumber = oldOrder.orderNumber;
    const oldOrderRow = values[row - 1].slice(0, CONFIG.ORDER_COLUMN_COUNT);
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

    let fulfilledAt = values[row - 1][23] || '';
    let regularFulfilledAt = values[row - 1][24] || '';
    let preorderFulfilledAt = values[row - 1][25] || '';

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
    order.fulfilledAtKey = normalizeDateKey_(fulfilledAt, '');
    order.regularFulfilledAtKey = normalizeDateKey_(regularFulfilledAt, '');
    order.preorderFulfilledAtKey = normalizeDateKey_(preorderFulfilledAt, '');

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
    const packagingPlan = !isTestOrder_(order) && Object.prototype.hasOwnProperty.call(payload || {}, 'packagingSelection')
      ? (typeof preparePackagingOrderUpdateV290_ === 'function'
        ? preparePackagingOrderUpdateV290_(id, Object.assign({}, order, {id:id, orderNumber:orderNumber}), payload.packagingSelection)
        : (() => { throw new Error('Doplněk skladu obalů je zastaralý. Nahrajte také nový Code_V2_6_ADDON.gs.'); })())
      : null;
    const stockDeltas = fulfilledStockDeltas_(oldOrder, order);
    try {
      prepareLoyaltyForUpdatedOrder_(submitted, order, oldOrder, id);
    } catch (loyaltyError) {
      console.error('Věrnostní program se při úpravě objednávky nepodařilo připravit.', loyaltyError);
      preserveLoyaltyOrderMeta_(order, oldOrder);
      loyaltyWarning = ' Věrnostní stav se nepodařilo ověřit.';
    }
    const hasStockDeltas = Object.keys(stockDeltas).some(key => Number(stockDeltas[key] || 0) !== 0);
    let stockChangesApplied = false;
    let orderChangesApplied = false;
    let packagingResult = null;

    try {
      if (hasStockDeltas) {
        applyProductStockDeltas_(stockDeltas);
        stockChangesApplied = true;
      }

      sheet.getRange(row, 1, 1, CONFIG.ORDER_COLUMN_COUNT).setValues([[
        id, created, order.status, safeSheetText_(order.name), safeSheetText_(order.phone), order.pickup,
        safeSheetText_(itemsText), order.total, safeSheetText_(order.note), source, JSON.stringify(order.items), safeSheetText_(order.email),
        safeSheetText_(order.contactMethod || oldOrder.contactMethod || 'SMS'), order.splitOrder, order.preorderPickup,
        order.regularStatus, order.preorderStatus, orderNumber, oldOrder.readyEmailRegularAt || '', oldOrder.readyEmailPreorderAt || '',
        JSON.stringify(communication), safeSheetText_(submitted.internalNote || oldOrder.internalNote || ''), JSON.stringify(timeline),
        fulfilledAt, regularFulfilledAt, preorderFulfilledAt, oldOrder.requestId || '',
        order.loyaltyCustomerId || '', order.loyaltyDiscount || 0, order.loyaltyRewardId || '',
        order.loyaltyRewardState || '', order.loyaltyEggsCounted || 0, order.loyaltyOptIn
      ]]);
      orderChangesApplied = true;

      if (packagingPlan) {
        packagingResult = commitPackagingOrderUpdateV290_(packagingPlan, orderNumber);
      }

      try {
        const syncedOrder = syncLoyaltyAfterOrderState_(oldOrder, Object.assign({}, order, {
          id:id,
          orderNumber:orderNumber,
          fulfilledAt:fulfilledAt,
          regularFulfilledAt:regularFulfilledAt,
          preorderFulfilledAt:preorderFulfilledAt,
          fulfilledAtKey:normalizeDateKey_(fulfilledAt, ''),
          regularFulfilledAtKey:normalizeDateKey_(regularFulfilledAt, ''),
          preorderFulfilledAtKey:normalizeDateKey_(preorderFulfilledAt, '')
        }), sheet, row);
        Object.assign(order, syncedOrder);
      } catch (loyaltySyncError) {
        console.error('Věrnostní stav upravené objednávky se nepodařilo dokončit.', loyaltySyncError);
        loyaltyWarning = ' Věrnostní stav se nepodařilo dokončit; změnu lze zopakovat uložením objednávky.';
      }
    } catch (error) {
      if (orderChangesApplied) {
        try { sheet.getRange(row, 1, 1, CONFIG.ORDER_COLUMN_COUNT).setValues([oldOrderRow]); }
        catch (rollbackError) { console.error('Vrácení objednávky po chybě obalů selhalo.', rollbackError); }
      }
      if (order._loyaltyNewReward && order.loyaltyRewardId) {
        try { releaseLoyaltyReward_(order.loyaltyRewardId, id); }
        catch (loyaltyRollbackError) { console.error('Vrácení nové věrnostní odměny po chybě selhalo.', loyaltyRollbackError); }
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

  return htmlResponse_(true, 'Objednávka byla upravena.' + (queuedCount ? ' E-mail se odešle na pozadí.' : '') + queueWarning + loyaltyWarning, result.id, {
    order: Object.assign({}, result.order, {
      id: result.id,
      orderNumber: result.orderNumber
    }),
    orderNumber: result.orderNumber,
    notificationsQueued: queuedCount,
    packaging: result.packaging,
    loyalty: publicLoyaltyOrderResult_(result.order)
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
    const deletedOrder = orderFromSheetRow_(values[i]);
    reverseLoyaltyForDeletedOrder_(deletedOrder);
    deletedOrders.push(deletedOrder);
    const year = isTestOrder_(deletedOrder) ? '' : orderNumberYear_(values[i][17], values[i][1]);
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
    if (isTestOrder_(order)) return;
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
  const subtotal = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);

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
    payment: orderPayment_({timeline:timeline, total:Number(row[7] || 0), orderNumber:String(row[17] || '')}),
    fulfilledAt: partFulfilledTimestamp_(row[23], timeline, status, 'Stav dostupné části: Vyzvednuto'),
    regularFulfilledAt: partFulfilledTimestamp_(row[24], timeline, regularStatus, 'Stav dostupné části: Vyzvednuto'),
    preorderFulfilledAt: partFulfilledTimestamp_(row[25], timeline, preorderStatus, 'Stav předobjednané části: Vyzvednuto'),
    fulfilledAtKey: normalizeDateKey_(row[23], ''),
    regularFulfilledAtKey: normalizeDateKey_(row[24], ''),
    preorderFulfilledAtKey: normalizeDateKey_(row[25], ''),
    requestId: String(row[26] || '')
    ,loyaltyCustomerId: String(row[27] || '')
    ,loyaltyDiscount: Math.max(0, Number(row[28] || 0))
    ,loyaltyRewardId: String(row[29] || '')
    ,loyaltyRewardState: String(row[30] || '')
    ,loyaltyEggsCounted: Math.max(0, Math.floor(Number(row[31] || 0)))
    ,loyaltyOptIn: toBool_(row[32])
    ,subtotal: subtotal
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

  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  return {
    name: name,
    phone: phone,
    email: email,
    pickup: pickup,
    note: note,
    status: splitOrder ? aggregateSplitStatus_(regularStatus, preorderStatus) : status,
    items: items,
    subtotal: subtotal,
    total: subtotal,
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
  const headers = ['Interní ID', 'Vytvořeno', 'Stav', 'Jméno', 'Telefon', 'Termín vyzvednutí', 'Položky', 'Celkem Kč', 'Poznámka', 'Zdroj', 'ItemsJSON', 'E-mail', 'Kontakt před vyzvednutím', 'Rozdělená objednávka', 'Termín předobjednávky', 'Stav dostupné části', 'Stav předobjednávky', 'Číslo objednávky', 'E-mail připraveno 1', 'E-mail připraveno 2', 'Komunikace JSON', 'Interní poznámka', 'Časová osa JSON', 'Skutečně vyzvednuto', 'Vyzvednuta dostupná část', 'Vyzvednuta předobjednaná část', 'Request ID', 'Věrnostní zákazník ID', 'Věrnostní sleva Kč', 'Věrnostní odměna ID', 'Stav věrnostní odměny', 'Započtená vejce', 'Zapojen do věrnosti'];
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
  if (toBool_(settings.ordersPaused) && pauseFrom && pauseTo && pauseFrom > pauseTo) throw new Error('Konec blokace nesmí být před jejím začátkem.');
  const bannerFrom = normalizeDateKey_(settings.bannerFrom, '');
  const bannerTo = normalizeDateKey_(settings.bannerTo, '');
  if (toBool_(settings.bannerEnabled) && bannerFrom && bannerTo && bannerFrom > bannerTo) throw new Error('Konec zobrazení banneru nesmí být před jeho začátkem.');
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


// -----------------------------------------------------------------------------
// V3.3 – věrnostní program na vejce
// -----------------------------------------------------------------------------

let LOYALTY_INFRA_CACHE_V330_ = null;

function formatLoyaltyCustomersSheet_(sheet) {
  ensureHeaders_(sheet, ['ID zákazníka', 'Zapsán', 'Jméno', 'Telefon', 'E-mail', 'Vejce do další odměny', 'Vejce celkem', 'Aktivní', 'Aktualizováno', 'Poslední objednávka', 'Poznámka']);
}

function formatLoyaltyRewardsSheet_(sheet) {
  ensureHeaders_(sheet, ['ID odměny', 'ID zákazníka', 'Získána', 'Požadováno vajec', 'Sleva Kč', 'Stav', 'ID objednávky', 'Rezervována', 'Uplatněna', 'Aktualizováno']);
}

function formatLoyaltyLedgerSheet_(sheet) {
  ensureHeaders_(sheet, ['ID pohybu', 'Čas', 'ID zákazníka', 'ID objednávky', 'Číslo objednávky', 'Typ', 'Změna vajec', 'Nový zůstatek', 'Poznámka']);
}

function seedLoyaltySettings_(sheet) {
  setSettingIfMissing_(sheet, 'LOYALTY_ENABLED', true, 'Zapnout věrnostní program na vejce');
  setSettingIfMissing_(sheet, 'LOYALTY_EGGS_REQUIRED', CONFIG.DEFAULT_LOYALTY_EGGS_REQUIRED, 'Počet vyzvednutých vajec potřebných pro jednu odměnu');
  setSettingIfMissing_(sheet, 'LOYALTY_DISCOUNT_CZK', CONFIG.DEFAULT_LOYALTY_DISCOUNT_CZK, 'Výše věrnostní slevy v Kč');
  setSettingIfMissing_(sheet, 'LOYALTY_START_DATE', CONFIG.LOYALTY_START_DATE, 'Začátek věrnostního programu', true);
}

function ensureLoyaltyInfrastructure_() {
  if (LOYALTY_INFRA_CACHE_V330_) return LOYALTY_INFRA_CACHE_V330_;
  const settingsSheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  formatSettingsSheet_(settingsSheet);
  seedLoyaltySettings_(settingsSheet);
  const customers = getOrCreateSheet_(CONFIG.LOYALTY_CUSTOMERS_SHEET);
  const rewards = getOrCreateSheet_(CONFIG.LOYALTY_REWARDS_SHEET);
  const ledger = getOrCreateSheet_(CONFIG.LOYALTY_LEDGER_SHEET);
  formatLoyaltyCustomersSheet_(customers);
  formatLoyaltyRewardsSheet_(rewards);
  formatLoyaltyLedgerSheet_(ledger);
  LOYALTY_INFRA_CACHE_V330_ = {settings:settingsSheet, customers:customers, rewards:rewards, ledger:ledger};
  return LOYALTY_INFRA_CACHE_V330_;
}

function setupLoyaltyProgramV330() {
  return withMutationLock_(() => {
    ensureLoyaltyInfrastructure_();
    formatOrdersSheet_(getOrCreateSheet_(CONFIG.ORDERS_SHEET));
    invalidatePublicCatalogCache_();
    return 'Věrnostní program V3.3 je připraven. Začíná 27. 8. 2026, výchozí pravidlo je 100 vajec = sleva 20 Kč.';
  }, 20000);
}

function loyaltySettingsFromMap_(map) {
  const source = map || {};
  const enabledValue = Object.prototype.hasOwnProperty.call(source, 'LOYALTY_ENABLED')
    ? toBool_(source.LOYALTY_ENABLED)
    : true;
  return {
    enabled: enabledValue,
    eggsRequired: Math.max(1, safeInteger_(source.LOYALTY_EGGS_REQUIRED, CONFIG.DEFAULT_LOYALTY_EGGS_REQUIRED)),
    discountCzk: Math.max(1, safeInteger_(source.LOYALTY_DISCOUNT_CZK, CONFIG.DEFAULT_LOYALTY_DISCOUNT_CZK)),
    startDate: normalizeDateKey_(source.LOYALTY_START_DATE, CONFIG.LOYALTY_START_DATE)
  };
}

function readLoyaltySettings_() {
  const infra = ensureLoyaltyInfrastructure_();
  return loyaltySettingsFromMap_(readSettingsMap_(infra.settings));
}

function normalizeLoyaltyEmail_(value) {
  return cleanText_(value, 254).trim().toLowerCase();
}

function normalizeLoyaltyPhone_(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.indexOf('00420') === 0) digits = digits.slice(5);
  else if (digits.indexOf('420') === 0 && digits.length > 9) digits = digits.slice(3);
  return digits;
}

function loyaltyContactsFromPayload_(payload) {
  const source = payload || {};
  const contact = cleanText_(source.contact, 254).trim();
  let email = normalizeLoyaltyEmail_(source.email);
  let phone = normalizeLoyaltyPhone_(source.phone);
  if (contact) {
    if (contact.indexOf('@') >= 0 && !email) email = normalizeLoyaltyEmail_(contact);
    else if (!phone) phone = normalizeLoyaltyPhone_(contact);
  }
  return {email:email, phone:phone};
}

function validateLoyaltyContacts_(contacts) {
  if (!contacts.email && contacts.phone.length < 9) {
    throw new Error('Zadejte platný telefon nebo e-mail.');
  }
  if (contacts.email && !isValidEmail_(contacts.email)) {
    throw new Error('Zadejte platný telefon nebo e-mail.');
  }
}

function loyaltyCustomerFromRow_(row, rowNumber) {
  return {
    rowNumber: rowNumber,
    id: String(row[0] || ''),
    createdValue: row[1] || '',
    created: formatDateTime_(row[1]),
    name: restoreSheetText_(row[2] || ''),
    phone: String(row[3] || ''),
    email: String(row[4] || '').toLowerCase(),
    balance: Math.floor(Number(row[5] || 0)),
    lifetimeEggs: Math.max(0, Math.floor(Number(row[6] || 0))),
    active: row[7] === '' ? true : toBool_(row[7]),
    updatedValue: row[8] || '',
    updated: formatDateTime_(row[8]),
    lastOrderId: String(row[9] || ''),
    note: restoreSheetText_(row[10] || '')
  };
}

function readLoyaltyCustomers_() {
  const sheet = ensureLoyaltyInfrastructure_().customers;
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues()
    .map((row, index) => loyaltyCustomerFromRow_(row, index + 2))
    .filter(customer => customer.id);
}

function saveLoyaltyCustomer_(customer) {
  const sheet = ensureLoyaltyInfrastructure_().customers;
  if (!customer || !customer.id) throw new Error('Věrnostní zákazník není platný.');
  const rowNumber = Number(customer.rowNumber || 0);
  const values = [[
    customer.id,
    customer.createdValue || new Date(),
    safeSheetText_(customer.name || ''),
    normalizeLoyaltyPhone_(customer.phone),
    normalizeLoyaltyEmail_(customer.email),
    Math.floor(Number(customer.balance || 0)),
    Math.max(0, Math.floor(Number(customer.lifetimeEggs || 0))),
    customer.active !== false,
    new Date(),
    customer.lastOrderId || '',
    safeSheetText_(customer.note || '')
  ]];
  if (rowNumber >= 2) sheet.getRange(rowNumber, 1, 1, 11).setValues(values);
  else {
    sheet.appendRow(values[0]);
    customer.rowNumber = sheet.getLastRow();
  }
  customer.updatedValue = values[0][8];
  return customer;
}

function findLoyaltyCustomerById_(id) {
  const customerId = String(id || '');
  return readLoyaltyCustomers_().find(customer => customer.id === customerId) || null;
}

function findLoyaltyCustomerByContacts_(contacts) {
  const source = contacts || {};
  const email = normalizeLoyaltyEmail_(source.email);
  const phone = normalizeLoyaltyPhone_(source.phone);
  if (!email && !phone) return null;
  const matches = readLoyaltyCustomers_().filter(customer =>
    (email && customer.email === email) || (phone && customer.phone === phone)
  );
  const ids = Array.from(new Set(matches.map(customer => customer.id)));
  if (ids.length > 1) {
    throw new Error('Telefon a e-mail jsou vedené u různých zákazníků. Záznamy spojte v administraci.');
  }
  return matches.length ? matches[0] : null;
}

function createLoyaltyCustomer_(name, contacts) {
  const customer = {
    id: Utilities.getUuid(),
    createdValue: new Date(),
    name: cleanText_(name, 100),
    phone: normalizeLoyaltyPhone_(contacts.phone),
    email: normalizeLoyaltyEmail_(contacts.email),
    balance: 0,
    lifetimeEggs: 0,
    active: true,
    lastOrderId: '',
    note: ''
  };
  if (customer.name.length < 2) throw new Error('Vyplňte jméno.');
  validateLoyaltyContacts_(contacts);
  return saveLoyaltyCustomer_(customer);
}

function updateLoyaltyCustomerIdentity_(customer, name, contacts) {
  if (!customer) return null;
  const nextName = cleanText_(name, 100);
  const nextPhone = normalizeLoyaltyPhone_(contacts && contacts.phone);
  const nextEmail = normalizeLoyaltyEmail_(contacts && contacts.email);
  let changed = false;
  if (nextName && nextName !== customer.name) { customer.name = nextName; changed = true; }
  if (nextPhone && nextPhone !== customer.phone) { customer.phone = nextPhone; changed = true; }
  if (nextEmail && nextEmail !== customer.email) { customer.email = nextEmail; changed = true; }
  return changed ? saveLoyaltyCustomer_(customer) : customer;
}

function loyaltyRewardFromRow_(row, rowNumber) {
  return {
    rowNumber: rowNumber,
    id: String(row[0] || ''),
    customerId: String(row[1] || ''),
    earnedAtValue: row[2] || '',
    earnedAt: formatDateTime_(row[2]),
    eggsRequired: Math.max(1, Math.floor(Number(row[3] || CONFIG.DEFAULT_LOYALTY_EGGS_REQUIRED))),
    amount: Math.max(0, Number(row[4] || 0)),
    state: String(row[5] || 'Dostupná'),
    orderId: String(row[6] || ''),
    reservedAtValue: row[7] || '',
    usedAtValue: row[8] || '',
    updatedValue: row[9] || ''
  };
}

function readLoyaltyRewards_() {
  const sheet = ensureLoyaltyInfrastructure_().rewards;
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues()
    .map((row, index) => loyaltyRewardFromRow_(row, index + 2))
    .filter(reward => reward.id);
}

function saveLoyaltyReward_(reward) {
  const sheet = ensureLoyaltyInfrastructure_().rewards;
  const values = [[
    reward.id,
    reward.customerId,
    reward.earnedAtValue || new Date(),
    Math.max(1, Math.floor(Number(reward.eggsRequired || CONFIG.DEFAULT_LOYALTY_EGGS_REQUIRED))),
    Math.max(0, Number(reward.amount || 0)),
    reward.state || 'Dostupná',
    reward.orderId || '',
    reward.reservedAtValue || '',
    reward.usedAtValue || '',
    new Date()
  ]];
  if (Number(reward.rowNumber || 0) >= 2) sheet.getRange(reward.rowNumber, 1, 1, 10).setValues(values);
  else {
    sheet.appendRow(values[0]);
    reward.rowNumber = sheet.getLastRow();
  }
  return reward;
}

function createLoyaltyReward_(customerId, settings) {
  return saveLoyaltyReward_({
    id: Utilities.getUuid(),
    customerId: customerId,
    earnedAtValue: new Date(),
    eggsRequired: settings.eggsRequired,
    amount: settings.discountCzk,
    state: 'Dostupná',
    orderId: '',
    reservedAtValue: '',
    usedAtValue: ''
  });
}

function appendLoyaltyMovement_(customerId, orderId, orderNumber, type, eggDelta, balance, note) {
  const sheet = ensureLoyaltyInfrastructure_().ledger;
  sheet.appendRow([
    Utilities.getUuid(), new Date(), customerId || '', orderId || '', orderNumber || '',
    safeSheetText_(type || ''), Math.floor(Number(eggDelta || 0)), Math.floor(Number(balance || 0)), safeSheetText_(note || '')
  ]);
}

function reserveLoyaltyRewardForOrder_(customerId, orderId, eggSubtotal) {
  const reward = readLoyaltyRewards_()
    .filter(item => item.customerId === customerId && item.state === 'Dostupná' && Number(item.amount || 0) <= Number(eggSubtotal || 0))
    .sort((a, b) => String(a.earnedAt || '').localeCompare(String(b.earnedAt || '')))[0];
  if (!reward) return null;
  reward.state = 'Rezervovaná';
  reward.orderId = orderId;
  reward.reservedAtValue = new Date();
  reward.usedAtValue = '';
  saveLoyaltyReward_(reward);
  appendLoyaltyMovement_(customerId, orderId, '', 'Rezervace odměny', 0, 0, `Sleva ${reward.amount} Kč rezervována pro objednávku.`);
  return reward;
}

function setLoyaltyRewardState_(reward, state, orderId) {
  if (!reward) return null;
  reward.state = state;
  reward.orderId = state === 'Dostupná' ? '' : String(orderId || reward.orderId || '');
  if (state === 'Dostupná') {
    reward.reservedAtValue = '';
    reward.usedAtValue = '';
  } else if (state === 'Rezervovaná') {
    reward.reservedAtValue = reward.reservedAtValue || new Date();
    reward.usedAtValue = '';
  } else if (state === 'Uplatněná') {
    reward.reservedAtValue = reward.reservedAtValue || new Date();
    reward.usedAtValue = new Date();
  }
  return saveLoyaltyReward_(reward);
}

function releaseLoyaltyReward_(rewardId, orderId) {
  const reward = readLoyaltyRewards_().find(item => item.id === String(rewardId || ''));
  if (!reward) return null;
  if (orderId && reward.orderId && reward.orderId !== String(orderId)) return reward;
  setLoyaltyRewardState_(reward, 'Dostupná', '');
  appendLoyaltyMovement_(reward.customerId, orderId || '', '', 'Vrácení odměny', 0, 0, `Sleva ${reward.amount} Kč vrácena zákazníkovi.`);
  return reward;
}

function applyLoyaltyEggDelta_(customerId, delta, orderId, orderNumber, note) {
  const customer = findLoyaltyCustomerById_(customerId);
  if (!customer) throw new Error('Věrnostní zákazník nebyl nalezen.');
  const change = Math.floor(Number(delta || 0));
  if (!change) return customer;
  const settings = readLoyaltySettings_();
  customer.balance = Math.floor(Number(customer.balance || 0)) + change;
  customer.lifetimeEggs = Math.max(0, Math.floor(Number(customer.lifetimeEggs || 0)) + change);
  customer.lastOrderId = orderId || customer.lastOrderId || '';

  let rewardsCreated = 0;
  while (customer.balance >= settings.eggsRequired) {
    customer.balance -= settings.eggsRequired;
    createLoyaltyReward_(customer.id, settings);
    rewardsCreated += 1;
  }

  if (customer.balance < 0) {
    const cancellable = readLoyaltyRewards_()
      .filter(reward => reward.customerId === customer.id && reward.state === 'Dostupná')
      .sort((a, b) => String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')));
    while (customer.balance < 0 && cancellable.length) {
      const reward = cancellable.shift();
      reward.state = 'Zrušená';
      reward.orderId = orderId || '';
      saveLoyaltyReward_(reward);
      customer.balance += reward.eggsRequired;
    }
  }

  saveLoyaltyCustomer_(customer);
  appendLoyaltyMovement_(customer.id, orderId, orderNumber, change > 0 ? 'Přičtení vajec' : 'Oprava vajec', change, customer.balance,
    `${note || 'Změna věrnostního zůstatku.'}${rewardsCreated ? ` Vytvořeno odměn: ${rewardsCreated}.` : ''}`);
  return customer;
}

function publicLoyaltyStatus_(customer, settings, allRewards) {
  const config = settings || readLoyaltySettings_();
  const rewards = (allRewards || readLoyaltyRewards_()).filter(reward => customer && reward.customerId === customer.id);
  const available = rewards.filter(reward => reward.state === 'Dostupná');
  const reserved = rewards.filter(reward => reward.state === 'Rezervovaná');
  const balance = customer ? Math.floor(Number(customer.balance || 0)) : 0;
  const nextReward = available.sort((a, b) => String(a.earnedAt || '').localeCompare(String(b.earnedAt || '')))[0] || null;
  return {
    enabled: config.enabled,
    enrolled: Boolean(customer),
    active: Boolean(customer && customer.active),
    firstName: customer ? cleanText_(String(customer.name || '').trim().split(/\s+/)[0], 50) : '',
    balance: Math.max(0, balance),
    eggsRequired: config.eggsRequired,
    eggsNeeded: customer ? (available.length ? 0 : Math.max(0, config.eggsRequired - balance)) : config.eggsRequired,
    availableRewards: available.length,
    reservedRewards: reserved.length,
    rewardReady: available.length > 0,
    discountCzk: nextReward ? Number(nextReward.amount || 0) : config.discountCzk,
    startDate: config.startDate
  };
}

function loyaltyStatusResponse_(payload) {
  const settings = readLoyaltySettings_();
  const contacts = loyaltyContactsFromPayload_(payload);
  validateLoyaltyContacts_(contacts);
  const customer = findLoyaltyCustomerByContacts_(contacts);
  return htmlResponse_(true, customer ? 'Věrnostní stav byl načten.' : 'Kontakt zatím není ve věrnostním programu.', '', {
    kind: 'loyaltyStatus',
    requestId: cleanText_(payload && payload.requestId, 100),
    loyalty: publicLoyaltyStatus_(customer, settings)
  });
}

function joinLoyalty_(payload) {
  const settings = readLoyaltySettings_();
  if (!settings.enabled) throw new Error('Věrnostní program je nyní vypnutý.');
  const contacts = loyaltyContactsFromPayload_(payload);
  validateLoyaltyContacts_(contacts);
  const name = cleanText_(payload && payload.name, 100);
  let customer = findLoyaltyCustomerByContacts_(contacts);
  const created = !customer;
  if (!customer) customer = createLoyaltyCustomer_(name, contacts);
  else {
    if (!customer.active) { customer.active = true; saveLoyaltyCustomer_(customer); }
    customer = updateLoyaltyCustomerIdentity_(customer, name || customer.name, contacts);
  }
  return htmlResponse_(true, created ? 'Byli jste zařazeni do věrnostního programu.' : 'Váš věrnostní stav byl načten.', '', {
    kind: 'loyaltyJoin',
    requestId: cleanText_(payload && payload.requestId, 100),
    loyalty: publicLoyaltyStatus_(customer, settings)
  });
}

function customerAccessHash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '').slice(0, 42);
}

function customerAccessEmailHint_(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return '';
  const name = parts[0];
  const visible = name.length <= 2 ? name.charAt(0) : name.slice(0, 2);
  return visible + '***@' + parts[1];
}

function requestCustomerAccess_(payload) {
  const email = normalizeLoyaltyEmail_(payload && payload.email);
  if (!isValidEmail_(email)) throw new Error('Zadejte platnou e-mailovou adresu.');

  const cache = CacheService.getScriptCache();
  const now = Date.now();
  const emailHash = customerAccessHash_(email);
  const rateKey = 'customer-access-rate-' + emailHash;
  let rate = null;
  try { rate = JSON.parse(cache.get(rateKey) || 'null'); } catch (_) {}
  if (!rate || now - Number(rate.windowStarted || 0) >= 3600000) {
    rate = {windowStarted:now, count:0, lastSent:0};
  }
  if (now - Number(rate.lastSent || 0) < 60000) {
    throw new Error('Nový kód lze poslat nejdříve za jednu minutu.');
  }
  if (Number(rate.count || 0) >= 5) {
    throw new Error('Bylo odesláno příliš mnoho kódů. Zkuste to znovu přibližně za hodinu.');
  }

  const globalKey = 'customer-access-global-' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyyMMdd-HH');
  const globalCount = Math.max(0, Number(cache.get(globalKey) || 0));
  if (globalCount >= 80) throw new Error('Ověřování je nyní dočasně vytížené. Zkuste to prosím později.');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const record = {code:code, expires:now + CONFIG.CUSTOMER_ACCESS_CODE_SECONDS * 1000, attempts:0};
  cache.put('customer-access-code-' + emailHash, JSON.stringify(record), CONFIG.CUSTOMER_ACCESS_CODE_SECONDS);
  rate.count = Number(rate.count || 0) + 1;
  rate.lastSent = now;
  cache.put(rateKey, JSON.stringify(rate), 3600);
  cache.put(globalKey, String(globalCount + 1), 3700);

  MailApp.sendEmail({
    to:email,
    subject:'Ověřovací kód – ' + CONFIG.BRAND_NAME,
    body:[
      'Dobrý den,',
      '',
      'Váš jednorázový kód pro zobrazení věrnostního stavu a historie objednávek je:',
      '',
      code,
      '',
      'Kód platí 10 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.',
      '',
      'S přáním krásného dne',
      CONFIG.BRAND_NAME
    ].join('\n'),
    htmlBody:`<p>Dobrý den,</p><p>Váš jednorázový kód pro zobrazení věrnostního stavu a historie objednávek je:</p><p style="font-size:30px;font-weight:800;letter-spacing:6px">${code}</p><p>Kód platí 10 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.</p><p>S přáním krásného dne<br><strong>${CONFIG.BRAND_NAME}</strong></p>`,
    name:CONFIG.BRAND_NAME,
    replyTo:CONFIG.NOTIFICATION_EMAIL
  });

  return htmlResponse_(true, 'Ověřovací kód byl odeslán na zadaný e-mail.', '', {
    kind:'customerAccessRequested',
    requestId:cleanText_(payload && payload.requestId, 100),
    emailHint:customerAccessEmailHint_(email),
    expiresIn:CONFIG.CUSTOMER_ACCESS_CODE_SECONDS
  });
}

function customerAccessSessionEmail_(sessionToken) {
  const token = cleanText_(sessionToken, 200).replace(/[^a-zA-Z0-9_-]/g, '');
  if (token.length < 30) throw new Error('Přihlášení vypršelo. Nechte si poslat nový kód.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('customer-access-session-' + customerAccessHash_(token));
  if (!raw) throw new Error('Přihlášení vypršelo. Nechte si poslat nový kód.');
  let session = null;
  try { session = JSON.parse(raw); } catch (_) {}
  const email = normalizeLoyaltyEmail_(session && session.email);
  if (!email || Number(session.expires || 0) <= Date.now()) {
    throw new Error('Přihlášení vypršelo. Nechte si poslat nový kód.');
  }
  return email;
}

function publicCustomerOrder_(order) {
  const items = (order && order.items || []).map(item => ({
    name:cleanText_(item && item.name || 'Produkt', 120),
    qty:Math.max(0, Number(item && item.qty || 0)),
    price:Math.max(0, Number(item && item.price || 0)),
    lineTotal:Math.max(0, Number(item && item.qty || 0) * Number(item && item.price || 0))
  }));
  const subtotal = Math.max(0, Number(order && order.subtotal || items.reduce((sum, item) => sum + item.lineTotal, 0)));
  const discount = Math.max(0, Number(order && order.loyaltyDiscount || 0));
  return {
    id:String(order && order.id || ''),
    orderNumber:String(order && order.orderNumber || order && order.id || ''),
    created:String(order && order.created || ''),
    pickup:String(order && order.pickup || ''),
    preorderPickup:String(order && order.preorderPickup || ''),
    status:String(order && order.status || 'Nová'),
    splitOrder:Boolean(order && order.splitOrder),
    regularStatus:String(order && order.regularStatus || order && order.status || 'Nová'),
    preorderStatus:String(order && order.preorderStatus || 'Nová'),
    items:items,
    subtotal:subtotal,
    loyaltyDiscount:discount,
    total:Math.max(0, Number(order && order.total != null ? order.total : subtotal - discount)),
    loyaltyEggsCounted:Math.max(0, Math.floor(Number(order && order.loyaltyEggsCounted || 0))),
    loyaltyRewardState:String(order && order.loyaltyRewardState || ''),
    fulfilledAt:String(order && order.fulfilledAt || ''),
    regularFulfilledAt:String(order && order.regularFulfilledAt || ''),
    preorderFulfilledAt:String(order && order.preorderFulfilledAt || '')
  };
}

function customerLoyaltyMovements_(customerId) {
  if (!customerId) return [];
  const sheet = ensureLoyaltyInfrastructure_().ledger;
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues()
    .filter(row => String(row[2] || '') === String(customerId))
    .reverse()
    .slice(0, 200)
    .map(row => ({
      at:formatDateTime_(row[1]),
      orderNumber:String(row[4] || ''),
      type:restoreSheetText_(row[5] || ''),
      eggDelta:Number(row[6] || 0),
      balance:Number(row[7] || 0),
      note:restoreSheetText_(row[8] || '')
    }));
}

function customerAccountSnapshot_(email) {
  const normalizedEmail = normalizeLoyaltyEmail_(email);
  const matchingOrders = readOrdersAdminFast_()
    .filter(order => !isTestOrder_(order) && normalizeLoyaltyEmail_(order.email) === normalizedEmail);
  let customer = findLoyaltyCustomerByContacts_({email:normalizedEmail});
  // Starší člen mohl být původně vedený jen podle telefonu. Pokud je jeho
  // ověřený e-mail uložený u objednávky, použijeme bezpečné propojení přes
  // věrnostní ID této objednávky a zobrazíme mu i jeho skutečný stav.
  if (!customer) {
    const linkedOrder = matchingOrders.find(order => String(order.loyaltyCustomerId || ''));
    if (linkedOrder) customer = findLoyaltyCustomerById_(linkedOrder.loyaltyCustomerId);
  }
  const settings = readLoyaltySettings_();
  const allRewards = readLoyaltyRewards_();
  const orderNumbers = {};
  matchingOrders.forEach(order => { orderNumbers[String(order.id || '')] = String(order.orderNumber || order.id || ''); });
  const rewards = customer ? allRewards
    .filter(reward => reward.customerId === customer.id)
    .sort((a, b) => String(b.earnedAt || '').localeCompare(String(a.earnedAt || '')))
    .map(reward => ({
      earnedAt:reward.earnedAt,
      eggsRequired:reward.eggsRequired,
      amount:reward.amount,
      state:reward.state,
      orderNumber:orderNumbers[String(reward.orderId || '')] || ''
    })) : [];

  return {
    emailHint:customerAccessEmailHint_(normalizedEmail),
    suggestedName:matchingOrders.length ? cleanText_(matchingOrders[0].name, 100) : '',
    loyalty:publicLoyaltyStatus_(customer, settings, allRewards),
    rewards:rewards,
    movements:customerLoyaltyMovements_(customer && customer.id),
    orders:matchingOrders.slice(0, 200).map(publicCustomerOrder_),
    orderCount:matchingOrders.length,
    hasMoreOrders:matchingOrders.length > 200
  };
}

function verifyCustomerAccess_(payload) {
  const email = normalizeLoyaltyEmail_(payload && payload.email);
  const code = cleanText_(payload && payload.code, 12).replace(/\D/g, '');
  if (!isValidEmail_(email) || !/^\d{6}$/.test(code)) throw new Error('Zadejte platný e-mail a šestimístný kód.');

  const cache = CacheService.getScriptCache();
  const codeKey = 'customer-access-code-' + customerAccessHash_(email);
  const raw = cache.get(codeKey);
  if (!raw) throw new Error('Kód vypršel nebo není platný. Nechte si poslat nový.');
  let record = null;
  try { record = JSON.parse(raw); } catch (_) {}
  if (!record || Number(record.expires || 0) <= Date.now()) {
    cache.remove(codeKey);
    throw new Error('Kód vypršel. Nechte si poslat nový.');
  }
  if (Number(record.attempts || 0) >= 5) {
    cache.remove(codeKey);
    throw new Error('Kód byl zadán příliš mnohokrát. Nechte si poslat nový.');
  }
  if (String(record.code || '') !== code) {
    record.attempts = Number(record.attempts || 0) + 1;
    const remaining = Math.max(30, Math.floor((Number(record.expires) - Date.now()) / 1000));
    cache.put(codeKey, JSON.stringify(record), remaining);
    throw new Error('Zadaný kód není správný.');
  }

  cache.remove(codeKey);
  const sessionToken = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const session = {email:email, expires:Date.now() + CONFIG.CUSTOMER_ACCESS_SESSION_SECONDS * 1000};
  cache.put('customer-access-session-' + customerAccessHash_(sessionToken), JSON.stringify(session), CONFIG.CUSTOMER_ACCESS_SESSION_SECONDS);
  return htmlResponse_(true, 'E-mail byl bezpečně ověřen.', '', {
    kind:'customerAccessVerified',
    requestId:cleanText_(payload && payload.requestId, 100),
    sessionToken:sessionToken,
    expiresIn:CONFIG.CUSTOMER_ACCESS_SESSION_SECONDS,
    account:customerAccountSnapshot_(email)
  });
}

function customerAccountData_(payload) {
  const email = customerAccessSessionEmail_(payload && payload.sessionToken);
  return htmlResponse_(true, 'Zákaznický účet byl načten.', '', {
    kind:'customerAccountData',
    requestId:cleanText_(payload && payload.requestId, 100),
    account:customerAccountSnapshot_(email)
  });
}

function joinCustomerAccountLoyalty_(payload) {
  const email = customerAccessSessionEmail_(payload && payload.sessionToken);
  const settings = readLoyaltySettings_();
  if (!settings.enabled) throw new Error('Věrnostní program je nyní vypnutý.');
  const contacts = {email:email, phone:normalizeLoyaltyPhone_(payload && payload.phone)};
  validateLoyaltyContacts_(contacts);
  const name = cleanText_(payload && payload.name, 100);
  if (name.length < 2) throw new Error('Vyplňte jméno a příjmení.');
  let customer = findLoyaltyCustomerByContacts_({email:email});
  const phoneOwner = contacts.phone ? findLoyaltyCustomerByContacts_({phone:contacts.phone}) : null;
  if (phoneOwner && (!customer || phoneOwner.id !== customer.id)) {
    throw new Error('Tento telefon je už spojený s jiným věrnostním účtem. Pro bezpečné propojení nás prosím kontaktujte.');
  }
  const created = !customer;
  if (!customer) customer = createLoyaltyCustomer_(name, contacts);
  else {
    if (!customer.active) { customer.active = true; saveLoyaltyCustomer_(customer); }
    customer = updateLoyaltyCustomerIdentity_(customer, name, contacts);
  }
  return htmlResponse_(true, created ? 'Byli jste zařazeni do věrnostního programu.' : 'Váš věrnostní účet byl aktualizován.', '', {
    kind:'customerAccountJoined',
    requestId:cleanText_(payload && payload.requestId, 100),
    account:customerAccountSnapshot_(email)
  });
}

function loyaltySubtotal_(order) {
  return (order && order.items || []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
}

function loyaltyEggSubtotal_(order) {
  return (order && order.items || [])
    .filter(item => String(item.productId) === CONFIG.EGG_PRODUCT_ID)
    .reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
}

function loyaltyEggPartStatus_(order) {
  return String(order && order.splitOrder ? order.regularStatus : order && order.status || 'Nová');
}

function loyaltyActiveEggQty_(order) {
  return loyaltyEggPartStatus_(order) === 'Zrušeno' ? 0 : eggQtyFromItems_(order && order.items);
}

function loyaltyFulfilledEggQty_(order) {
  return loyaltyEggPartStatus_(order) === 'Vyzvednuto' ? eggQtyFromItems_(order && order.items) : 0;
}

function loyaltyEggFulfilledDateKey_(order) {
  if (!order) return '';
  const value = order.splitOrder
    ? (order.regularFulfilledAtKey || order.regularFulfilledAt)
    : (order.fulfilledAtKey || order.fulfilledAt);
  return normalizeDateKey_(value, '');
}

function loyaltyOrderMayUseReward_(order, settings) {
  if (loyaltyFulfilledEggQty_(order) <= 0) return true;
  const fulfilledDate = loyaltyEggFulfilledDateKey_(order);
  return Boolean(fulfilledDate && fulfilledDate >= settings.startDate);
}

function clearLoyaltyOrderMeta_(order, optedIn) {
  const subtotal = loyaltySubtotal_(order);
  return Object.assign(order, {
    subtotal: subtotal,
    total: subtotal,
    loyaltyCustomerId: '',
    loyaltyDiscount: 0,
    loyaltyRewardId: '',
    loyaltyRewardState: '',
    loyaltyEggsCounted: 0,
    loyaltyOptIn: Boolean(optedIn)
  });
}

function preserveLoyaltyOrderMeta_(order, oldOrder) {
  const subtotal = loyaltySubtotal_(order);
  return Object.assign(order, {
    subtotal: subtotal,
    loyaltyCustomerId: oldOrder.loyaltyCustomerId || '',
    loyaltyDiscount: Math.max(0, Number(oldOrder.loyaltyDiscount || 0)),
    loyaltyRewardId: oldOrder.loyaltyRewardId || '',
    loyaltyRewardState: oldOrder.loyaltyRewardState || '',
    loyaltyEggsCounted: Math.max(0, Number(oldOrder.loyaltyEggsCounted || 0)),
    loyaltyOptIn: Boolean(oldOrder.loyaltyOptIn || oldOrder.loyaltyCustomerId),
    total: Math.max(0, subtotal - Math.max(0, Number(oldOrder.loyaltyDiscount || 0)))
  });
}

function resolveLoyaltyCustomerForOrder_(payload, order, allowCreate) {
  const contacts = loyaltyContactsFromPayload_({phone:order.phone, email:order.email});
  let customer = findLoyaltyCustomerByContacts_(contacts);
  if (!customer && allowCreate) customer = createLoyaltyCustomer_(order.name, contacts);
  if (customer) customer = updateLoyaltyCustomerIdentity_(customer, order.name, contacts);
  return customer && customer.active ? customer : null;
}

function prepareLoyaltyForOrder_(payload, order, orderId, manual) {
  if (isTestOrder_(order)) return clearLoyaltyOrderMeta_(order, false);
  const optedIn = toBool_(payload && payload.loyaltyOptIn);
  clearLoyaltyOrderMeta_(order, optedIn);
  const settings = readLoyaltySettings_();
  if (!settings.enabled) return order;
  const customer = resolveLoyaltyCustomerForOrder_(payload, order, optedIn);
  if (!customer) return order;
  order.loyaltyCustomerId = customer.id;
  order.loyaltyOptIn = true;
  customer.lastOrderId = orderId;
  saveLoyaltyCustomer_(customer);
  if (loyaltyActiveEggQty_(order) > 0 && loyaltyOrderMayUseReward_(order, settings)) {
    const reward = reserveLoyaltyRewardForOrder_(customer.id, orderId, loyaltyEggSubtotal_(order));
    if (reward) {
      order.loyaltyDiscount = Number(reward.amount || 0);
      order.loyaltyRewardId = reward.id;
      order.loyaltyRewardState = 'reserved';
      order.total = Math.max(0, order.subtotal - order.loyaltyDiscount);
    }
  }
  return order;
}

function prepareLoyaltyForUpdatedOrder_(payload, order, oldOrder, orderId) {
  if (isTestOrder_(order)) { Object.assign(order, clearLoyaltyOrderMeta_(order, false)); return order; }
  preserveLoyaltyOrderMeta_(order, oldOrder);
  const settings = readLoyaltySettings_();
  let customer = oldOrder.loyaltyCustomerId ? findLoyaltyCustomerById_(oldOrder.loyaltyCustomerId) : null;
  if (!customer && settings.enabled) {
    customer = resolveLoyaltyCustomerForOrder_(payload, order, toBool_(payload && payload.loyaltyOptIn));
  } else if (customer) {
    customer = updateLoyaltyCustomerIdentity_(customer, order.name, loyaltyContactsFromPayload_({phone:order.phone, email:order.email}));
  }
  if (!customer || !customer.active) return order;
  order.loyaltyCustomerId = customer.id;
  order.loyaltyOptIn = true;
  customer.lastOrderId = orderId;
  saveLoyaltyCustomer_(customer);

  if ((!order.loyaltyRewardId || order.loyaltyRewardState === 'released') && settings.enabled && loyaltyActiveEggQty_(order) > 0 && loyaltyOrderMayUseReward_(order, settings)) {
    const reward = reserveLoyaltyRewardForOrder_(customer.id, orderId, loyaltyEggSubtotal_(order));
    if (reward) {
      order.loyaltyRewardId = reward.id;
      order.loyaltyRewardState = 'reserved';
      order.loyaltyDiscount = Number(reward.amount || 0);
      order._loyaltyNewReward = true;
    }
  }
  order.total = Math.max(0, order.subtotal - Math.max(0, Number(order.loyaltyDiscount || 0)));
  return order;
}

function syncLoyaltyAfterOrderState_(oldOrder, order, ordersSheet, orderRow) {
  if (isTestOrder_(order)) return clearLoyaltyOrderMeta_(order, false);
  if (!order || !order.loyaltyCustomerId) return order;
  const customer = findLoyaltyCustomerById_(order.loyaltyCustomerId);
  if (!customer) return order;
  const settings = readLoyaltySettings_();
  let reward = order.loyaltyRewardId
    ? readLoyaltyRewards_().find(item => item.id === order.loyaltyRewardId)
    : null;
  const activeEggs = loyaltyActiveEggQty_(order);
  const fulfilledEggs = loyaltyFulfilledEggQty_(order);
  const fulfilledDate = loyaltyEggFulfilledDateKey_(order);
  const fulfillmentEligible = fulfilledEggs > 0 && Boolean(fulfilledDate && fulfilledDate >= settings.startDate);

  if (reward) {
    if (!activeEggs || loyaltyEggSubtotal_(order) < Number(reward.amount || 0) || (fulfilledEggs > 0 && !fulfillmentEligible)) {
      setLoyaltyRewardState_(reward, 'Dostupná', '');
      appendLoyaltyMovement_(customer.id, order.id, order.orderNumber, 'Vrácení odměny', 0, customer.balance, 'Objednávka už nesplňuje podmínky slevy.');
      order.loyaltyRewardId = '';
      order.loyaltyRewardState = 'released';
      order.loyaltyDiscount = 0;
    } else if (fulfilledEggs > 0) {
      setLoyaltyRewardState_(reward, 'Uplatněná', order.id);
      order.loyaltyRewardState = 'used';
    } else {
      setLoyaltyRewardState_(reward, 'Rezervovaná', order.id);
      order.loyaltyRewardState = 'reserved';
    }
  } else if (order.loyaltyDiscount > 0) {
    order.loyaltyRewardId = '';
    order.loyaltyRewardState = '';
    order.loyaltyDiscount = 0;
  }

  const oldCounted = Math.max(0, Math.floor(Number(oldOrder && oldOrder.loyaltyEggsCounted || 0)));
  const canStartCounting = settings.enabled && customer.active && fulfillmentEligible;
  const targetCounted = fulfilledEggs > 0 && (oldCounted > 0 || canStartCounting) ? fulfilledEggs : 0;
  const delta = targetCounted - oldCounted;
  if (delta) {
    applyLoyaltyEggDelta_(customer.id, delta, order.id, order.orderNumber, 'Podle skutečně vyzvednutého množství objednávky.');
  }
  order.loyaltyEggsCounted = targetCounted;
  order.subtotal = loyaltySubtotal_(order);
  order.total = Math.max(0, order.subtotal - Math.max(0, Number(order.loyaltyDiscount || 0)));

  if (ordersSheet && Number(orderRow || 0) >= 2) {
    ordersSheet.getRange(orderRow, 8).setValue(order.total);
    ordersSheet.getRange(orderRow, 28, 1, 6).setValues([[
      order.loyaltyCustomerId || '', order.loyaltyDiscount || 0, order.loyaltyRewardId || '',
      order.loyaltyRewardState || '', order.loyaltyEggsCounted || 0, order.loyaltyOptIn
    ]]);
  }
  return order;
}

function reverseLoyaltyForDeletedOrder_(order) {
  if (isTestOrder_(order)) return;
  if (!order || !order.loyaltyCustomerId) return;
  if (Number(order.loyaltyEggsCounted || 0) > 0) {
    applyLoyaltyEggDelta_(order.loyaltyCustomerId, -Math.floor(Number(order.loyaltyEggsCounted || 0)), order.id, order.orderNumber, 'Objednávka byla smazána.');
  }
  if (order.loyaltyRewardId) releaseLoyaltyReward_(order.loyaltyRewardId, order.id);
}

function publicLoyaltyOrderResult_(order) {
  const source = order || {};
  return {
    enrolled: Boolean(source.loyaltyCustomerId),
    discountApplied: Math.max(0, Number(source.loyaltyDiscount || 0)),
    rewardState: String(source.loyaltyRewardState || ''),
    eggsCounted: Math.max(0, Number(source.loyaltyEggsCounted || 0))
  };
}

function loyaltyAdminSnapshot_() {
  const settings = readLoyaltySettings_();
  const rewards = readLoyaltyRewards_();
  const customers = readLoyaltyCustomers_().map(customer => {
    const own = rewards.filter(reward => reward.customerId === customer.id);
    const available = own.filter(reward => reward.state === 'Dostupná');
    const reserved = own.filter(reward => reward.state === 'Rezervovaná');
    const used = own.filter(reward => reward.state === 'Uplatněná');
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      balance: customer.balance,
      lifetimeEggs: customer.lifetimeEggs,
      active: customer.active,
      created: customer.created,
      updated: customer.updated,
      availableRewards: available.length,
      reservedRewards: reserved.length,
      usedRewards: used.length,
      eggsNeeded: available.length ? 0 : Math.max(0, settings.eggsRequired - customer.balance),
      nextDiscount: available.length ? Number(available[0].amount || settings.discountCzk) : settings.discountCzk
    };
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs'));

  const ledgerSheet = ensureLoyaltyInfrastructure_().ledger;
  let movements = [];
  if (ledgerSheet.getLastRow() >= 2) {
    const count = Math.min(100, ledgerSheet.getLastRow() - 1);
    const start = ledgerSheet.getLastRow() - count + 1;
    movements = ledgerSheet.getRange(start, 1, count, 9).getValues().reverse().map(row => ({
      id:String(row[0] || ''), at:formatDateTime_(row[1]), customerId:String(row[2] || ''), orderId:String(row[3] || ''),
      orderNumber:String(row[4] || ''), type:restoreSheetText_(row[5] || ''), eggDelta:Number(row[6] || 0),
      balance:Number(row[7] || 0), note:restoreSheetText_(row[8] || '')
    }));
  }
  return {
    settings: settings,
    customers: customers,
    movements: movements,
    summary: {
      customers: customers.filter(customer => customer.active).length,
      availableRewards: customers.reduce((sum, customer) => sum + customer.availableRewards, 0),
      usedRewards: customers.reduce((sum, customer) => sum + customer.usedRewards, 0),
      lifetimeEggs: customers.reduce((sum, customer) => sum + customer.lifetimeEggs, 0)
    }
  };
}

function getLoyaltyAdminData_() {
  const snapshot = loyaltyAdminSnapshot_();
  return htmlResponse_(true, 'Věrnostní program byl načten.', '', {
    kind:'loyaltyAdmin', loyaltySettings:snapshot.settings, loyaltyCustomers:snapshot.customers,
    loyaltyMovements:snapshot.movements, loyaltySummary:snapshot.summary
  });
}

function saveLoyaltySettings_(payload) {
  const source = payload && (payload.settings || payload) || {};
  const enabled = toBool_(source.enabled);
  const eggsRequired = clampInteger_(source.eggsRequired, 1, 10000, 'Počet vajec pro slevu');
  const discountCzk = clampInteger_(source.discountCzk, 1, 10000, 'Výše slevy');
  const infra = ensureLoyaltyInfrastructure_();
  setSettingsBatch_(infra.settings, [
    {key:'LOYALTY_ENABLED', value:enabled, description:'Zapnout věrnostní program na vejce'},
    {key:'LOYALTY_EGGS_REQUIRED', value:eggsRequired, description:'Počet vyzvednutých vajec potřebných pro jednu odměnu'},
    {key:'LOYALTY_DISCOUNT_CZK', value:discountCzk, description:'Výše věrnostní slevy v Kč'},
    {key:'LOYALTY_START_DATE', value:CONFIG.LOYALTY_START_DATE, description:'Začátek věrnostního programu', text:true}
  ]);
  if (enabled) {
    const settings = {enabled:true, eggsRequired:eggsRequired, discountCzk:discountCzk, startDate:CONFIG.LOYALTY_START_DATE};
    readLoyaltyCustomers_().filter(customer => customer.active).forEach(customer => {
      let changed = false;
      while (customer.balance >= settings.eggsRequired) {
        customer.balance -= settings.eggsRequired;
        createLoyaltyReward_(customer.id, settings);
        changed = true;
      }
      if (changed) saveLoyaltyCustomer_(customer);
    });
  }
  invalidatePublicCatalogCache_();
  const snapshot = loyaltyAdminSnapshot_();
  return htmlResponse_(true, 'Nastavení věrnostního programu bylo uloženo.', '', {
    loyaltySettings:snapshot.settings, loyaltyCustomers:snapshot.customers,
    loyaltyMovements:snapshot.movements, loyaltySummary:snapshot.summary
  });
}

function adjustLoyaltyCustomer_(payload) {
  const id = cleanIdentifier_(payload && payload.id, 'ID zákazníka');
  const delta = clampInteger_(payload && payload.delta, -10000, 10000, 'Úprava vajec');
  if (!delta) throw new Error('Zadejte nenulovou změnu počtu vajec.');
  const customer = findLoyaltyCustomerById_(id);
  if (!customer) throw new Error('Věrnostní zákazník nebyl nalezen.');
  applyLoyaltyEggDelta_(id, delta, '', '', cleanText_(payload && payload.note || 'Ruční úprava v administraci', 300));
  const snapshot = loyaltyAdminSnapshot_();
  return htmlResponse_(true, 'Věrnostní stav zákazníka byl upraven.', id, {
    loyaltySettings:snapshot.settings, loyaltyCustomers:snapshot.customers,
    loyaltyMovements:snapshot.movements, loyaltySummary:snapshot.summary
  });
}

function setLoyaltyCustomerActive_(payload) {
  const id = cleanIdentifier_(payload && payload.id, 'ID zákazníka');
  const customer = findLoyaltyCustomerById_(id);
  if (!customer) throw new Error('Věrnostní zákazník nebyl nalezen.');
  customer.active = toBool_(payload && payload.active);
  saveLoyaltyCustomer_(customer);
  appendLoyaltyMovement_(id, '', '', customer.active ? 'Aktivace zákazníka' : 'Pozastavení zákazníka', 0, customer.balance, 'Změna v administraci.');
  const snapshot = loyaltyAdminSnapshot_();
  return htmlResponse_(true, customer.active ? 'Zákazník byl aktivován.' : 'Zákazník byl pozastaven.', id, {
    loyaltySettings:snapshot.settings, loyaltyCustomers:snapshot.customers,
    loyaltyMovements:snapshot.movements, loyaltySummary:snapshot.summary
  });
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
  if (isTestOrder_(order)) return result;
  const productParts = preorderMap || productPreorderMap_();
  (order && order.items || []).forEach(item => {
    const id = String(item.productId || '');
    if (!id || !isFulfilledStatus_(itemPartStatus_(order, id, productParts))) return;
    result[id] = (result[id] || 0) + Math.max(0, Math.floor(Number(item.qty) || 0));
  });
  return result;
}

function orderHasFulfilledPart_(order) {
  if (isTestOrder_(order)) return false;
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
  if (isTestOrder_(order)) return [];
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
    ...(Number(order.loyaltyDiscount || 0) > 0 ? ['', `Mezisoučet: ${loyaltySubtotal_(order)} Kč`, `Věrnostní sleva na vejce: -${Number(order.loyaltyDiscount)} Kč`] : []),
    '',
    `Celkem: ${order.total} Kč`,
    paymentInstructions_(order),
    `Poznámka: ${order.note || '—'}`
  ].join('\n');
}

function buildHtmlEmail_(order, id) {
  const discountRow = Number(order.loyaltyDiscount || 0) > 0 ? `<tr><td style="padding:8px;color:#2f7d55"><b>Věrnostní sleva na vejce</b></td><td style="text-align:right;font-weight:700;color:#2f7d55">-${Number(order.loyaltyDiscount)} Kč</td></tr>` : '';
  const rows = order.items.map(item => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml_(item.qty + '× ' + item.name)}</td><td style="text-align:right;font-weight:700">${item.qty * item.price} Kč</td></tr>`).join('') + discountRow;
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

function isTestOrder_(order) {
  return Boolean(order && (order.isTest === true || /^TEST-\d+$/i.test(String(order.orderNumber || ''))));
}

// Voláno pod zámkem createOrder_; čítač se nikdy nevrací po smazání testu.
function nextTestOrderNumber_() {
  const props = PropertiesService.getScriptProperties();
  const key = 'TEST_ORDER_COUNTER_V362';
  let highest = Number(props.getProperty(key) || 0);
  if (!props.getProperty(key)) {
    const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 18, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(row => {
      const match = String(row[0] || '').match(/^TEST-(\d+)$/i);
      if (match) highest = Math.max(highest, Number(match[1]));
    });
  }
  const next = highest + 1;
  props.setProperty(key, String(next));
  return 'TEST-' + String(next).padStart(3, '0');
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
    ...(Number(order.loyaltyDiscount || 0) > 0 ? ['', `Mezisoučet: ${loyaltySubtotal_(order)} Kč`, `Věrnostní sleva na vejce: -${Number(order.loyaltyDiscount)} Kč`, 'Sleva byla automaticky započítána do tohoto nákupu.'] : []),
    '',
    `Celkem: ${order.total} Kč`,
    `Termín vyzvednutí: ${formatCustomerPickupDate_(order.pickup)}`,
    paymentInstructions_(order),
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

function paymentInstructions_(order) {
  const p = orderPayment_(order);
  if (p.isTest) {
    const warning = 'TEST – zkušební objednávka bez započítání tržby, skladu a věrnosti. Peníze neposílejte.';
    if (p.paid) return warning + ' Přijetí platby bylo pouze nasimulováno.';
    if (p.method !== 'qr') return warning + ' Zvolená platba při vyzvednutí.';
    return warning + ' Platební údaje k ověření QR: účet ' + p.account + ', částka ' + p.amount.toFixed(2) + ' Kč, variabilní symbol ' + p.vs + ', zpráva ' + p.message + '. QR používá skutečný bankovní účet; v bankovní aplikaci převod nepotvrzujte.';
  }
  if (p.method !== 'qr') return 'Platba při vyzvednutí.';
  if (p.paid) return 'Platba převodem přijata.';
  if (p.amount <= 0) return 'Není potřeba nic platit.';
  return 'Platba převodem: účet ' + p.account + ', částka ' + p.amount.toFixed(2) + ' Kč, variabilní symbol ' + p.vs + '. Přijetí platby Vám potvrdíme samostatným e-mailem.';
}

function buildCustomerHtmlEmail_(order, id) {
  const greeting = firstNameVocative_(order.name);
  const discountRow = Number(order.loyaltyDiscount || 0) > 0 ? `<tr><td style="padding:10px 0;color:#2f7d55"><b>Věrnostní sleva na vejce</b><br><small>Sleva byla automaticky započítána.</small></td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f7d55">-${Number(order.loyaltyDiscount)} Kč</td></tr>` : '';
  const rows = order.items.map(item => `<tr><td style="padding:9px 0;border-bottom:1px solid #eadfce">${escapeHtml_(item.qty + '× ' + item.name)}</td><td style="padding:9px 0;border-bottom:1px solid #eadfce;text-align:right;font-weight:700">${item.qty * item.price} Kč</td></tr>`).join('') + discountRow;
  const split = '<p>' + escapeHtml_(paymentInstructions_(order)) + '</p>' + (order.splitOrder ? `<p style="padding:16px;background:#eef7ff;border-radius:12px"><b>${escapeHtml_(splitOrderMessage_(order))}</b></p>` : '');
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


// Bundled QR generator (MIT license retained below).
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/pdpQrGenerator/faqpatent-e.html
//
//---------------------------------------------------------------------

var pdpQrGenerator = function() {

  //---------------------------------------------------------------------
  // pdpQrGenerator
  //---------------------------------------------------------------------

  /**
   * pdpQrGenerator
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var pdpQrGenerator = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'pdpQrGenerator-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'pdpQrGenerator-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // pdpQrGenerator.stringToBytes
  //---------------------------------------------------------------------

  pdpQrGenerator.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  pdpQrGenerator.stringToBytes = pdpQrGenerator.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // pdpQrGenerator.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  pdpQrGenerator.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(pdpQrGenerator) {

      var moduleCount = pdpQrGenerator.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = pdpQrGenerator.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == pdpQrGenerator.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (pdpQrGenerator.isDark(row, col) ) count += 1;
          if (pdpQrGenerator.isDark(row + 1, col) ) count += 1;
          if (pdpQrGenerator.isDark(row, col + 1) ) count += 1;
          if (pdpQrGenerator.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (pdpQrGenerator.isDark(row, col)
              && !pdpQrGenerator.isDark(row, col + 1)
              &&  pdpQrGenerator.isDark(row, col + 2)
              &&  pdpQrGenerator.isDark(row, col + 3)
              &&  pdpQrGenerator.isDark(row, col + 4)
              && !pdpQrGenerator.isDark(row, col + 5)
              &&  pdpQrGenerator.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (pdpQrGenerator.isDark(row, col)
              && !pdpQrGenerator.isDark(row + 1, col)
              &&  pdpQrGenerator.isDark(row + 2, col)
              &&  pdpQrGenerator.isDark(row + 3, col)
              &&  pdpQrGenerator.isDark(row + 4, col)
              && !pdpQrGenerator.isDark(row + 5, col)
              &&  pdpQrGenerator.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (pdpQrGenerator.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = pdpQrGenerator.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = pdpQrGenerator.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns pdpQrGenerator function.

  return pdpQrGenerator;
}();

// multibyte support
!function() {

  pdpQrGenerator.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return pdpQrGenerator;
}));

// V3.7 — evidence krmiva. Čte se až po otevření vlastní záložky.
function feedNumber_(value, min, max, label, decimals) {
  if (value == null || String(value).trim() === '') throw new Error(label + ': vyplňte číslo.');
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(label + ': neplatná hodnota.');
  const scale = Math.pow(10, decimals);
  return Math.round(number * scale) / scale;
}

function feedDate_(value) {
  const key = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Zadejte platné datum.');
  const date = new Date(key + 'T00:00:00Z');
  if (isNaN(date) || date.toISOString().slice(0, 10) !== key || key < '2000-01-01' || key > todayKey_()) {
    throw new Error('Datum musí být platné, od roku 2000 a nejpozději dnes.');
  }
  return key;
}

function feedSheet_() {
  const sheet = getOrCreateSheet_('Krmivo slepic');
  ensureHeaders_(sheet, ['ID', 'Datum nákupu', 'Krmivo', 'Množství kg', 'Zaplaceno Kč', 'Poznámka', 'Verze', 'Smazáno']);
  return sheet;
}

function feedPurchases_(sheet) {
  const source = sheet || feedSheet_();
  if (source.getLastRow() < 2) return [];
  return source.getRange(2, 1, source.getLastRow() - 1, 8).getValues().map((row, i) => ({
    id:String(row[0] || ''), date:formatSheetDate_(row[1]), name:restoreSheetText_(row[2] || ''),
    kg:Number(row[3] || 0), cost:Number(row[4] || 0), note:restoreSheetText_(row[5] || ''),
    revision:String(row[6] || ''), deleted:toBool_(row[7]), row:i + 2
  })).filter(purchase => purchase.id);
}

function feedSettings_() {
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  const raw = readSettingsMap_(sheet).FEED_SETTINGS_V370;
  if (!raw) return {dailyKg:0, pricePerKg:0, stockKg:0, stockDate:todayKey_(), revision:''};
  try { return JSON.parse(String(raw)); }
  catch (_) { throw new Error('Nastavení krmiva nelze přečíst. Zkontrolujte záznam v Nastavení.'); }
}

function feedEggRevenue_(sourceOrders, today) {
  const years = {};
  let missingDateOrders = 0;
  (sourceOrders || []).forEach(order => {
    if (isTestOrder_(order)) return;
    // Vejce patří stejně jako ve věrnostním programu do dostupné části.
    if (String(order.splitOrder ? order.regularStatus : order.status) !== 'Vyzvednuto') return;
    const items = (order.items || []).filter(item => String(item.productId) === String(CONFIG.EGG_PRODUCT_ID));
    if (!items.length) return;
    const fulfilled = order.splitOrder
      ? order.regularFulfilledAtKey || order.regularFulfilledAt
      : order.fulfilledAtKey || order.fulfilledAt;
    const date = String(fulfilled || order.pickup || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z'))) { missingDateOrders++; return; }
    if (date > today) return;
    const year = date.slice(0, 4);
    const summary = years[year] || (years[year] = {revenue:0, eggs:0, orders:0, estimatedDateOrders:0});
    const gross = items.reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0) * Math.max(0, Number(item.price) || 0), 0);
    const discount = Math.max(0, Number(order.loyaltyDiscount) || 0);
    summary.revenue += Math.round(Math.max(0, gross - discount) * 100);
    summary.eggs += items.reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
    summary.orders++;
    if (!fulfilled) summary.estimatedDateOrders++;
  });
  Object.keys(years).forEach(year => { years[year].revenue /= 100; });
  return {years:years, missingDateOrders:missingDateOrders};
}

function feedData_() {
  const today = todayKey_();
  return {
    asOf:today, settings:feedSettings_(),
    purchases:feedPurchases_().filter(item => !item.deleted).map(item => { delete item.row; return item; }),
    sales:feedEggRevenue_(readOrdersAdminFast_(), today)
  };
}

function saveFeedSettings_(payload) {
  const current = feedSettings_();
  if (String(payload.expectedRevision || '') !== current.revision) throw new Error('Nastavení se mezitím změnilo. Obnovte přehled a změnu zopakujte.');
  const source = payload.settings || {};
  const settings = {
    dailyKg:feedNumber_(source.dailyKg, 0.001, 10000, 'Denní spotřeba', 3),
    pricePerKg:feedNumber_(source.pricePerKg, 0, 100000, 'Cena za kg', 2),
    stockKg:feedNumber_(source.stockKg, 0, 1000000, 'Zásoba', 3),
    stockDate:feedDate_(source.stockDate), revision:Utilities.getUuid()
  };
  const sheet = getOrCreateSheet_(CONFIG.SETTINGS_SHEET);
  setSettingsBatch_(sheet, [{key:'FEED_SETTINGS_V370', value:JSON.stringify(settings), text:true, description:'Spotřeba, výchozí zásoba a cena krmiva pro odhad'}]);
  return htmlResponse_(true, 'Nastavení krmiva uloženo.', '', {feedSettings:settings});
}

function feedPurchaseId_(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) throw new Error('Neplatné ID nákupu. Obnovte přehled.');
  return id;
}

function saveFeedPurchase_(payload) {
  const source = payload.purchase || {};
  const item = {
    id:feedPurchaseId_(source.id), date:feedDate_(source.date),
    name:cleanText_(source.name || '', 100), kg:feedNumber_(source.kg, 0.001, 1000000, 'Množství', 3),
    cost:feedNumber_(source.cost, 0, 10000000, 'Zaplaceno', 2), note:cleanText_(source.note || '', 300)
  };
  if (!item.name) throw new Error('Vyplňte název krmiva.');
  const sheet = feedSheet_();
  const existing = feedPurchases_(sheet).find(purchase => purchase.id === item.id);
  if (existing && !existing.deleted && ['date','name','kg','cost','note'].every(key => existing[key] === item[key])) {
    delete existing.row;
    return htmlResponse_(true, 'Nákup je uložený.', item.id, {feedPurchase:existing});
  }
  if (existing && (existing.deleted || existing.revision !== String(payload.expectedRevision || '')) || !existing && payload.expectedRevision) {
    throw new Error('Nákup se mezitím změnil nebo byl smazán. Obnovte přehled a změnu zopakujte.');
  }
  item.revision = Utilities.getUuid();
  item.deleted = false;
  const row = existing ? existing.row : sheet.getLastRow() + 1;
  sheet.getRange(row, 2).setNumberFormat('@');
  sheet.getRange(row, 1, 1, 8).setValues([[item.id, item.date, safeSheetText_(item.name), item.kg, item.cost, safeSheetText_(item.note), item.revision, false]]);
  return htmlResponse_(true, 'Nákup krmiva uložen.', item.id, {feedPurchase:item});
}

function deleteFeedPurchase_(payload) {
  const id = feedPurchaseId_(payload.id);
  const sheet = feedSheet_();
  const item = feedPurchases_(sheet).find(purchase => purchase.id === id);
  if (!item || item.deleted) return htmlResponse_(true, 'Nákup byl odstraněn.', id, {feedDeletedId:id});
  if (item.revision !== String(payload.expectedRevision || '')) throw new Error('Nákup se mezitím změnil. Obnovte přehled před smazáním.');
  // Záznam zůstane jako smazaný: opožděné opakování požadavku jej nesmí obnovit.
  sheet.getRange(item.row, 7, 1, 2).setValues([[Utilities.getUuid(), true]]);
  return htmlResponse_(true, 'Nákup byl odstraněn.', id, {feedDeletedId:id});
}
