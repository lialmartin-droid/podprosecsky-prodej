/**
 * Podprosečské domácí produkty – doplněk V2.6
 * Sklad obalů + přesné návštěvy.
 *
 * Tento soubor přidejte do stejného Apps Script projektu jako Code_V2_0.gs.
 * Potom v doPost(e) v Code_V2_0.gs přidejte JEDEN řádek:
 *
 * const v26 = handleV26Action_(action, payload); if (v26) return v26;
 *
 * Umístěte ho za řádek:
 * if (action === 'setVisitExclusion') return withMutationLock_(() => setVisitExclusion_(payload), 10000);
 * a PŘED:
 * throw new Error('Neznámá operace.');
 */

const PDP_V26_PACKAGING_SHEET = 'Obaly';
const PDP_V26_PACKAGING_MOVES_SHEET = 'Obaly pohyby';
const PDP_V26_PACKAGING_ORDERS_SHEET = 'Obaly objednávky';

function handleV26Action_(action, payload) {
  if (action === 'getRecentVisits') return getRecentVisitsV26_(payload);
  if (action === 'getPackagingData') return getPackagingDataV26_();
  if (action === 'savePackagingItem') return withMutationLock_(() => savePackagingItemV26_(payload), 10000);
  if (action === 'adjustPackagingStock') return withMutationLock_(() => adjustPackagingStockV26_(payload), 10000);
  if (action === 'savePackagingSelection') return withMutationLock_(() => savePackagingSelectionV26_(payload), 10000);
  if (action === 'consumePackagingForOrder') return withMutationLock_(() => consumePackagingForOrderV26_(payload), 10000);
  return null;
}

function setupV26() {
  const items = getOrCreateSheet_(PDP_V26_PACKAGING_SHEET);
  const moves = getOrCreateSheet_(PDP_V26_PACKAGING_MOVES_SHEET);
  const orders = getOrCreateSheet_(PDP_V26_PACKAGING_ORDERS_SHEET);
  formatPackagingV26_(items);
  formatPackagingMovesV26_(moves);
  formatPackagingOrdersV26_(orders);
  seedPackagingV26_(items);
  return 'V2.6 je připravena – sklad obalů byl založen.';
}

function formatPackagingV26_(sheet) {
  ensureHeaders_(sheet, ['ID', 'Název', 'Sklad ks', 'Minimum ks', 'Kusů skladu na 1 zvolenou sadu', 'Aktualizováno']);
  sheet.setFrozenRows(1);
}

function formatPackagingMovesV26_(sheet) {
  ensureHeaders_(sheet, ['Čas', 'ID obalu', 'Název', 'Změna ks', 'Před', 'Po', 'Důvod', 'Objednávka']);
  sheet.setFrozenRows(1);
}

function formatPackagingOrdersV26_(sheet) {
  ensureHeaders_(sheet, ['Objednávka ID', 'Výběr JSON', 'Odečteno JSON', 'Aktualizováno']);
  sheet.setFrozenRows(1);
}

function seedPackagingV26_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const existing = new Set(rows.slice(1).map(row => String(row[0] || '')));
  const now = new Date();
  const defaults = [
    ['pack6', 'Krabička na 6 vajec', 0, 10, 1, now],
    ['pack10', 'Krabička na 10 vajec', 0, 10, 1, now],
    ['pack30', 'Obal na 30 vajec', 0, 10, 2, now]
  ];
  defaults.forEach(row => {
    if (!existing.has(row[0])) sheet.appendRow(row);
  });
}

function readPackagingItemsV26_() {
  const sheet = getOrCreateSheet_(PDP_V26_PACKAGING_SHEET);
  formatPackagingV26_(sheet);
  seedPackagingV26_(sheet);
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[0] !== '')
    .map(row => ({
      id: String(row[0] || ''),
      name: restoreSheetText_(row[1] || ''),
      stock: Math.max(0, Math.floor(Number(row[2] || 0))),
      minimum: Math.max(0, Math.floor(Number(row[3] || 0))),
      piecesPerPack: Math.max(1, Math.floor(Number(row[4] || 1)))
    }));
}

function findPackagingItemRowV26_(id) {
  const sheet = getOrCreateSheet_(PDP_V26_PACKAGING_SHEET);
  formatPackagingV26_(sheet);
  seedPackagingV26_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return {sheet:sheet, row:i + 1, values:values[i]};
  }
  return null;
}

function recordPackagingMoveV26_(item, delta, before, after, reason, orderNumber) {
  const sheet = getOrCreateSheet_(PDP_V26_PACKAGING_MOVES_SHEET);
  formatPackagingMovesV26_(sheet);
  sheet.appendRow([
    new Date(),
    safeSheetText_(item.id),
    safeSheetText_(item.name),
    Number(delta || 0),
    Number(before || 0),
    Number(after || 0),
    safeSheetText_(reason || ''),
    safeSheetText_(orderNumber || '')
  ]);
}

function savePackagingItemV26_(payload) {
  const id = cleanText_(payload && payload.id, 50);
  const found = findPackagingItemRowV26_(id);
  if (!found) throw new Error('Obal nebyl nalezen.');

  const current = Math.max(0, Math.floor(Number(found.values[2] || 0)));
  const stock = Math.max(0, Math.floor(Number(payload.stock || 0)));
  const minimum = Math.max(0, Math.floor(Number(payload.minimum || 0)));
  const delta = stock - current;

  found.sheet.getRange(found.row, 3, 1, 4).setValues([[
    stock,
    minimum,
    Math.max(1, Math.floor(Number(found.values[4] || 1))),
    new Date()
  ]]);

  if (delta) {
    recordPackagingMoveV26_(
      {id:id, name:restoreSheetText_(found.values[1] || '')},
      delta, current, stock, 'Ruční úprava skladu', ''
    );
  }

  return htmlResponse_(true, 'Sklad obalu byl uložen.', id, {
    items: readPackagingItemsV26_()
  });
}

function adjustPackagingStockV26_(payload) {
  const id = cleanText_(payload && payload.id, 50);
  const delta = Math.floor(Number(payload && payload.delta || 0));
  if (!delta) throw new Error('Změna skladu je 0.');

  const found = findPackagingItemRowV26_(id);
  if (!found) throw new Error('Obal nebyl nalezen.');

  const before = Math.max(0, Math.floor(Number(found.values[2] || 0)));
  const after = before + delta;
  if (after < 0) throw new Error('Sklad obalů by klesl pod nulu.');

  found.sheet.getRange(found.row, 3).setValue(after);
  found.sheet.getRange(found.row, 6).setValue(new Date());
  recordPackagingMoveV26_(
    {id:id, name:restoreSheetText_(found.values[1] || '')},
    delta, before, after,
    cleanText_(payload && payload.reason || 'Ruční pohyb', 120),
    ''
  );

  return htmlResponse_(true, 'Sklad byl upraven.', id, {
    items: readPackagingItemsV26_()
  });
}

function parseObjectV26_(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function readPackagingOrderRowsV26_() {
  const sheet = getOrCreateSheet_(PDP_V26_PACKAGING_ORDERS_SHEET);
  formatPackagingOrdersV26_(sheet);
  const values = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][0] || '');
    if (!id) continue;
    map[id] = {
      row:i + 1,
      selection:parseObjectV26_(values[i][1]),
      consumed:parseObjectV26_(values[i][2])
    };
  }
  return {sheet:sheet, map:map};
}

function normalizePackagingSelectionV26_(payload) {
  const source = payload && payload.selection || {};
  const own = toBool_(source.own);
  const quantities = {};
  const valid = {};
  readPackagingItemsV26_().forEach(item => valid[item.id] = item);

  Object.keys(source.quantities || {}).forEach(id => {
    if (!valid[id]) return;
    const value = Math.max(0, Math.min(100, Math.floor(Number(source.quantities[id] || 0))));
    quantities[id] = value;
  });

  return {own:own, quantities:quantities};
}

function findOrderV26_(orderId) {
  const sheet = getOrCreateSheet_(CONFIG.ORDERS_SHEET);
  formatOrdersSheet_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(orderId)) return orderFromSheetRow_(values[i]);
  }
  return null;
}

function orderPackagingReadyV26_(order) {
  if (!order) return false;
  const status = order.splitOrder ? order.regularStatus : order.status;
  return ['Připraveno', 'Vyzvednuto'].includes(String(status || ''));
}

function packagingUsageV26_(selection) {
  if (!selection || selection.own) return {};
  const byId = {};
  readPackagingItemsV26_().forEach(item => byId[item.id] = item);
  const result = {};
  Object.keys(selection.quantities || {}).forEach(id => {
    const item = byId[id];
    if (!item) return;
    const packs = Math.max(0, Math.floor(Number(selection.quantities[id] || 0)));
    if (packs > 0) result[id] = packs * Math.max(1, Number(item.piecesPerPack || 1));
  });
  return result;
}

function writePackagingOrderV26_(orderId, selection, consumed) {
  const source = readPackagingOrderRowsV26_();
  const existing = source.map[String(orderId)];
  const record = [[
    safeSheetText_(orderId),
    JSON.stringify(selection || {}),
    JSON.stringify(consumed || {}),
    new Date()
  ]];
  if (existing) source.sheet.getRange(existing.row, 1, 1, 4).setValues(record);
  else source.sheet.getRange(source.sheet.getLastRow() + 1, 1, 1, 4).setValues(record);
}

function reconcilePackagingForOrderV26_(orderId, selection, oldConsumed) {
  const order = findOrderV26_(orderId);
  if (!order) throw new Error('Objednávka nebyla nalezena.');
  const orderNumber = order.orderNumber || order.id || '';
  const desired = packagingUsageV26_(selection);
  const beforeConsumed = oldConsumed || {};

  const itemMap = {};
  readPackagingItemsV26_().forEach(item => itemMap[item.id] = item);
  const ids = new Set([...Object.keys(desired), ...Object.keys(beforeConsumed)]);

  // Nejprve ověření, aby nevznikl částečný výdej.
  ids.forEach(id => {
    const moreNeeded = Number(desired[id] || 0) - Number(beforeConsumed[id] || 0);
    if (moreNeeded <= 0) return;
    const item = itemMap[id];
    if (!item) throw new Error('Vybraný obal už ve skladu neexistuje.');
    if (Number(item.stock || 0) < moreNeeded) {
      throw new Error(`Nedostatek obalů „${item.name}“. Skladem ${item.stock} ks, potřeba ještě ${moreNeeded} ks.`);
    }
  });

  ids.forEach(id => {
    const changeInConsumed = Number(desired[id] || 0) - Number(beforeConsumed[id] || 0);
    if (!changeInConsumed) return;

    const found = findPackagingItemRowV26_(id);
    if (!found) throw new Error('Vybraný obal nebyl nalezen.');
    const before = Math.max(0, Math.floor(Number(found.values[2] || 0)));
    const after = before - changeInConsumed;
    if (after < 0) throw new Error('Sklad obalů by klesl pod nulu.');

    found.sheet.getRange(found.row, 3).setValue(after);
    found.sheet.getRange(found.row, 6).setValue(new Date());
    recordPackagingMoveV26_(
      {id:id, name:restoreSheetText_(found.values[1] || '')},
      -changeInConsumed,
      before,
      after,
      changeInConsumed > 0 ? 'Výdej k připravené objednávce' : 'Vrácení po změně obalu',
      orderNumber
    );
  });

  return desired;
}

function savePackagingSelectionV26_(payload) {
  const orderId = cleanText_(payload && payload.orderId, 100);
  if (!orderId) throw new Error('Chybí objednávka.');
  const order = findOrderV26_(orderId);
  if (!order) throw new Error('Objednávka nebyla nalezena.');

  const selection = normalizePackagingSelectionV26_(payload);
  const source = readPackagingOrderRowsV26_();
  const existing = source.map[orderId];
  let consumed = existing ? existing.consumed : {};

  // Pokud už byly obaly odečtené, změna výběru okamžitě opraví sklad.
  if (Object.keys(consumed).length || orderPackagingReadyV26_(order)) {
    consumed = reconcilePackagingForOrderV26_(orderId, selection, consumed);
  }

  writePackagingOrderV26_(orderId, selection, consumed);
  return htmlResponse_(true, 'Výběr obalu byl uložen.', orderId, {
    consumed:consumed,
    items:readPackagingItemsV26_()
  });
}

function consumePackagingForOrderV26_(payload) {
  const orderId = cleanText_(payload && payload.orderId, 100);
  const order = findOrderV26_(orderId);
  if (!order) throw new Error('Objednávka nebyla nalezena.');

  // Obaly řešíme jen u objednávek s vejci.
  if (eggQtyFromItems_(order.items || []) <= 0) {
    return htmlResponse_(true, 'Objednávka neobsahuje vejce.', orderId, {});
  }

  const source = readPackagingOrderRowsV26_();
  const existing = source.map[orderId];

  // Při návratu objednávky z Připraveno/Vyzvednuto obaly automaticky vrátíme.
  if (!orderPackagingReadyV26_(order)) {
    if (!existing) {
      return htmlResponse_(true, 'Objednávka ještě není ve stavu Připraveno.', orderId, {
        consumed:{},
        items:readPackagingItemsV26_()
      });
    }

    let consumed = existing.consumed || {};
    if (Object.keys(consumed).length) {
      consumed = reconcilePackagingForOrderV26_(orderId, {own:true, quantities:{}}, consumed);
      writePackagingOrderV26_(orderId, existing.selection || {}, consumed);
    }
    return htmlResponse_(true, 'Objednávka ještě není ve stavu Připraveno.', orderId, {
      consumed:consumed,
      items:readPackagingItemsV26_()
    });
  }

  if (!existing) throw new Error('Nejdříve vyberte obal u objednávky.');

  const selection = existing.selection || {};
  const hasPack = Object.values(selection.quantities || {}).some(value => Number(value || 0) > 0);
  if (!selection.own && !hasPack) {
    throw new Error('Nejdříve vyberte obal, nebo označte vlastní/bez obalu.');
  }

  const consumed = reconcilePackagingForOrderV26_(orderId, selection, existing.consumed || {});
  writePackagingOrderV26_(orderId, selection, consumed);

  return htmlResponse_(true, 'Obaly byly započítány do skladu.', orderId, {
    consumed:consumed,
    items:readPackagingItemsV26_()
  });
}

function readPackagingMovesV26_() {
  const sheet = getOrCreateSheet_(PDP_V26_PACKAGING_MOVES_SHEET);
  formatPackagingMovesV26_(sheet);
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[0] !== '')
    .map(row => ({
      at:formatFulfilledTimestamp_(row[0]),
      id:restoreSheetText_(row[1] || ''),
      name:restoreSheetText_(row[2] || ''),
      delta:Number(row[3] || 0),
      before:Number(row[4] || 0),
      after:Number(row[5] || 0),
      reason:restoreSheetText_(row[6] || ''),
      orderNumber:restoreSheetText_(row[7] || '')
    }))
    .reverse()
    .slice(0,100);
}

function getPackagingDataV26_() {
  const rows = readPackagingOrderRowsV26_();
  const selections = {};
  const consumed = {};
  Object.keys(rows.map).forEach(id => {
    selections[id] = rows.map[id].selection || {};
    consumed[id] = rows.map[id].consumed || {};
  });

  return htmlResponse_(true, '', '', {
    items:readPackagingItemsV26_(),
    orderSelections:selections,
    orderConsumed:consumed,
    movements:readPackagingMovesV26_()
  });
}

function getRecentVisitsV26_(payload) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(payload && payload.limit || 100))));
  const visits = readVisits_()
    .slice()
    .reverse()
    .slice(0, limit);

  return htmlResponse_(true, '', '', {
    recentVisits:visits
  });
}

