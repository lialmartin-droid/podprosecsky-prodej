/**
 * Podprosečské domácí produkty – doplněk V3.2.0
 * Sklad obalů + přesné návštěvy + propojení návštěvníků s objednávkami.
 *
 * Tento soubor přidejte do stejného Apps Script projektu jako Code.gs.
 * Hlavní Code.gs V3.1 už napojení doplňku obsahuje.
 * U staršího Code.gs bylo nutné do doPost(e) přidat řádek:
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
const PDP_V27_VISITORS_SHEET = 'Návštěvníci';

function handleV26Action_(action, payload) {
  if (action === 'getRecentVisits') return getRecentVisitsV26_(payload);
  if (action === 'saveVisitorLabel') return withMutationLock_(() => saveVisitorLabelV27_(payload), 10000);
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
  const visitors = getOrCreateSheet_(PDP_V27_VISITORS_SHEET);
  formatPackagingV26_(items);
  formatPackagingMovesV26_(moves);
  formatPackagingOrdersV26_(orders);
  formatVisitorsV27_(visitors);
  seedPackagingV26_(items);
  return 'V3.2.0 je připravena – sklad obalů i evidence návštěvníků byly založeny.';
}

function normalizeVisitorIdV27_(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

function formatVisitorsV27_(sheet) {
  ensureHeaders_(sheet, [
    'Návštěvník ID',
    'Ruční jméno',
    'Jméno z objednávky',
    'Objednávka ID',
    'Číslo objednávky',
    'Objednáno',
    'Zdroj objednávky',
    'Aktualizováno'
  ]);
  sheet.setFrozenRows(1);
}

function visitorProfileFromRowV27_(row) {
  return {
    visitorId:restoreSheetText_(row[0] || ''),
    manualLabel:restoreSheetText_(row[1] || ''),
    orderName:restoreSheetText_(row[2] || ''),
    orderId:restoreSheetText_(row[3] || ''),
    orderNumber:restoreSheetText_(row[4] || ''),
    orderCreated:row[5] || '',
    visitSource:restoreSheetText_(row[6] || ''),
    updatedAt:row[7] || ''
  };
}

function findVisitorProfileV27_(visitorId) {
  const id = normalizeVisitorIdV27_(visitorId);
  if (!id) return null;

  const sheet = getOrCreateSheet_(PDP_V27_VISITORS_SHEET);
  formatVisitorsV27_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (restoreSheetText_(values[i][0] || '') === id) {
      return {sheet:sheet, row:i + 1, profile:visitorProfileFromRowV27_(values[i])};
    }
  }
  return {sheet:sheet, row:0, profile:{visitorId:id, manualLabel:'', orderName:'', orderId:'', orderNumber:'', orderCreated:'', visitSource:'', updatedAt:''}};
}

function readVisitorProfilesV27_() {
  const sheet = getOrCreateSheet_(PDP_V27_VISITORS_SHEET);
  formatVisitorsV27_(sheet);
  const map = {};
  sheet.getDataRange().getValues().slice(1).forEach(row => {
    const profile = visitorProfileFromRowV27_(row);
    const id = normalizeVisitorIdV27_(profile.visitorId);
    if (id) map[id] = profile;
  });
  return map;
}

function upsertVisitorProfileV27_(visitorId, changes) {
  const found = findVisitorProfileV27_(visitorId);
  if (!found) throw new Error('Návštěvníka se nepodařilo identifikovat.');

  const current = found.profile || {};
  const source = changes || {};
  const has = key => Object.prototype.hasOwnProperty.call(source, key);
  const profile = {
    visitorId:normalizeVisitorIdV27_(visitorId),
    manualLabel:has('manualLabel') ? cleanText_(source.manualLabel || '', 100) : String(current.manualLabel || ''),
    orderName:has('orderName') ? cleanText_(source.orderName || '', 100) : String(current.orderName || ''),
    orderId:has('orderId') ? cleanText_(source.orderId || '', 100) : String(current.orderId || ''),
    orderNumber:has('orderNumber') ? cleanText_(source.orderNumber || '', 100) : String(current.orderNumber || ''),
    orderCreated:has('orderCreated') ? (source.orderCreated || '') : (current.orderCreated || ''),
    visitSource:has('visitSource') ? cleanText_(source.visitSource || '', 40) : String(current.visitSource || '')
  };

  const row = [[
    safeSheetText_(profile.visitorId),
    safeSheetText_(profile.manualLabel),
    safeSheetText_(profile.orderName),
    safeSheetText_(profile.orderId),
    safeSheetText_(profile.orderNumber),
    profile.orderCreated,
    safeSheetText_(profile.visitSource),
    new Date()
  ]];
  if (found.row) found.sheet.getRange(found.row, 1, 1, 8).setValues(row);
  else found.sheet.getRange(found.sheet.getLastRow() + 1, 1, 1, 8).setValues(row);
  return profile;
}

/**
 * Volá hlavní Code.gs po úspěšném vytvoření webové objednávky.
 * Návštěvu nemaže – pouze k visitorId uloží poslední známou objednávku a jméno.
 */
function linkOrderToVisitorV27_(payload, order) {
  const visitorId = normalizeVisitorIdV27_(payload && payload.visitorId);
  if (!visitorId) return false;

  const sourceOrder = order || {};
  upsertVisitorProfileV27_(visitorId, {
    orderName:sourceOrder.name || payload.name || '',
    orderId:sourceOrder.id || '',
    orderNumber:sourceOrder.orderNumber || '',
    orderCreated:sourceOrder.createdAt || sourceOrder.created || new Date(),
    visitSource:payload && (payload.visitSource || payload.source) || ''
  });
  return true;
}

function saveVisitorLabelV27_(payload) {
  const visitorId = normalizeVisitorIdV27_(payload && payload.visitorId);
  if (!visitorId) throw new Error('Návštěvníka se nepodařilo identifikovat.');

  const profile = upsertVisitorProfileV27_(visitorId, {
    manualLabel:payload && payload.label || ''
  });
  const displayName = profile.manualLabel || profile.orderName || '';
  return htmlResponse_(true,
    profile.manualLabel ? 'Jméno návštěvníka bylo uloženo.' : 'Ruční jméno bylo odstraněno.',
    visitorId,
    {
      visitorId:visitorId,
      manualLabel:profile.manualLabel,
      displayName:displayName,
      orderName:profile.orderName,
      orderId:profile.orderId,
      orderNumber:profile.orderNumber
    }
  );
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

/**
 * V3.1: připraví změnu obalů bez jediného zápisu. Hlavní Code.gs tak může
 * nejdřív ověřit objednávku, vejce i obaly a teprve potom vše potvrdit společně.
 */
function preparePackagingOrderUpdateV290_(orderId, order, rawSelection) {
  const normalizedOrderId = cleanText_(orderId, 100);
  if (!normalizedOrderId) throw new Error('Chybí objednávka.');

  const itemSheet = getOrCreateSheet_(PDP_V26_PACKAGING_SHEET);
  formatPackagingV26_(itemSheet);
  seedPackagingV26_(itemSheet);
  const itemValues = itemSheet.getDataRange().getValues();
  const itemMap = {};
  for (let row = 1; row < itemValues.length; row++) {
    const id = String(itemValues[row][0] || '');
    if (!id) continue;
    itemMap[id] = {
      id:id,
      name:restoreSheetText_(itemValues[row][1] || ''),
      stock:Math.max(0, Math.floor(Number(itemValues[row][2] || 0))),
      piecesPerPack:Math.max(1, Math.floor(Number(itemValues[row][4] || 1))),
      row:row + 1
    };
  }

  const sourceSelection = rawSelection && typeof rawSelection === 'object' ? rawSelection : {};
  const selection = {own:toBool_(sourceSelection.own), quantities:{}};
  Object.keys(sourceSelection.quantities || {}).forEach(id => {
    if (!itemMap[id]) return;
    const quantity = Math.max(0, Math.min(100, Math.floor(Number(sourceSelection.quantities[id]) || 0)));
    selection.quantities[id] = selection.own ? 0 : quantity;
  });

  const orderRows = readPackagingOrderRowsV26_();
  const existing = orderRows.map[normalizedOrderId] || null;
  const oldSelection = existing ? existing.selection || {} : {};
  const oldConsumed = existing ? existing.consumed || {} : {};
  const containsEggs = eggQtyFromItems_(order && order.items || []) > 0;
  const shouldConsume = containsEggs && orderPackagingReadyV26_(order);
  const hasSelectedPack = Object.values(selection.quantities).some(value => Number(value || 0) > 0);

  if (shouldConsume && !selection.own && !hasSelectedPack) {
    throw new Error('Nejdříve vyberte obal, nebo označte vlastní/bez obalu.');
  }

  const desired = {};
  if (shouldConsume && !selection.own) {
    Object.keys(selection.quantities).forEach(id => {
      const packs = Math.max(0, Math.floor(Number(selection.quantities[id]) || 0));
      if (packs > 0) desired[id] = packs * itemMap[id].piecesPerPack;
    });
  }

  const ids = {};
  Object.keys(oldConsumed).forEach(id => { ids[id] = true; });
  Object.keys(desired).forEach(id => { ids[id] = true; });
  const changes = [];

  Object.keys(ids).forEach(id => {
    const item = itemMap[id];
    if (!item) throw new Error('Vybraný obal už ve skladu neexistuje.');
    const consumptionChange = Number(desired[id] || 0) - Number(oldConsumed[id] || 0);
    if (!consumptionChange) return;
    const after = item.stock - consumptionChange;
    if (after < 0) {
      throw new Error(`Nedostatek obalů „${item.name}“. Skladem ${item.stock} ks, potřeba ještě ${consumptionChange} ks.`);
    }
    changes.push({
      id:id,
      name:item.name,
      row:item.row,
      before:item.stock,
      after:after,
      stockDelta:after - item.stock,
      reason:consumptionChange > 0 ? 'Výdej k připravené objednávce' : 'Vrácení po změně obalu'
    });
  });

  return {
    handled:true,
    orderId:normalizedOrderId,
    selection:selection,
    consumed:desired,
    oldSelection:oldSelection,
    oldConsumed:oldConsumed,
    orderRow:existing ? existing.row : 0,
    changes:changes
  };
}

/** Potvrdí předem ověřený plán a při technické chybě vrátí sklad obalů zpět. */
function commitPackagingOrderUpdateV290_(plan, orderNumber) {
  if (!plan || !plan.handled) return null;

  const itemSheet = getOrCreateSheet_(PDP_V26_PACKAGING_SHEET);
  const orderSheet = getOrCreateSheet_(PDP_V26_PACKAGING_ORDERS_SHEET);
  const applied = [];
  let orderRow = Number(plan.orderRow || 0);
  let createdOrderRow = false;

  try {
    (plan.changes || []).forEach(change => {
      itemSheet.getRange(change.row, 3).setValue(change.after);
      itemSheet.getRange(change.row, 6).setValue(new Date());
      applied.push(change);
    });

    const record = [[
      safeSheetText_(plan.orderId),
      JSON.stringify(plan.selection || {}),
      JSON.stringify(plan.consumed || {}),
      new Date()
    ]];
    if (orderRow) orderSheet.getRange(orderRow, 1, 1, 4).setValues(record);
    else {
      orderRow = orderSheet.getLastRow() + 1;
      orderSheet.getRange(orderRow, 1, 1, 4).setValues(record);
      createdOrderRow = true;
    }

    if ((plan.changes || []).length) {
      const movesSheet = getOrCreateSheet_(PDP_V26_PACKAGING_MOVES_SHEET);
      formatPackagingMovesV26_(movesSheet);
      const moveRows = plan.changes.map(change => [
        new Date(),
        safeSheetText_(change.id),
        safeSheetText_(change.name),
        Number(change.stockDelta || 0),
        Number(change.before || 0),
        Number(change.after || 0),
        safeSheetText_(change.reason || ''),
        safeSheetText_(orderNumber || '')
      ]);
      movesSheet.getRange(movesSheet.getLastRow() + 1, 1, moveRows.length, 8).setValues(moveRows);
    }
  } catch (error) {
    applied.forEach(change => {
      try {
        itemSheet.getRange(change.row, 3).setValue(change.before);
        itemSheet.getRange(change.row, 6).setValue(new Date());
      } catch (rollbackError) {
        console.error('Vrácení skladu obalů selhalo.', rollbackError);
      }
    });

    try {
      if (createdOrderRow && orderRow) orderSheet.deleteRow(orderRow);
      else if (orderRow) {
        orderSheet.getRange(orderRow, 1, 1, 4).setValues([[
          safeSheetText_(plan.orderId),
          JSON.stringify(plan.oldSelection || {}),
          JSON.stringify(plan.oldConsumed || {}),
          new Date()
        ]]);
      }
    } catch (rollbackError) {
      console.error('Vrácení záznamu obalu objednávky selhalo.', rollbackError);
    }
    throw error;
  }

  let currentItems = [];
  try { currentItems = readPackagingItemsV26_(); }
  catch (readError) { console.error('Aktuální stav obalů se po uložení nepodařilo načíst.', readError); }

  return {
    handled:true,
    selection:plan.selection || {},
    consumed:plan.consumed || {},
    items:currentItems
  };
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
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const count = Math.min(100, lastRow - 1);
  return sheet.getRange(lastRow - count + 1, 1, count, 8).getValues()
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
    .reverse();
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
  const profiles = readVisitorProfilesV27_();
  const allVisits = readVisits_();
  const visits = allVisits
    .slice()
    .reverse()
    .slice(0, limit)
    .map(visit => {
      const visitorId = normalizeVisitorIdV27_(visit && visit.visitorId);
      const profile = profiles[visitorId] || {};
      const manualLabel = String(profile.manualLabel || '');
      const orderName = String(profile.orderName || '');
      return Object.assign({}, visit, {
        manualLabel:manualLabel,
        orderName:orderName,
        orderId:String(profile.orderId || ''),
        orderNumber:String(profile.orderNumber || ''),
        displayName:manualLabel || orderName
      });
    });

  return htmlResponse_(true, '', '', {
    recentVisits:visits,
    visitStats:typeof calculateVisitStatsFromVisits_ === 'function'
      ? calculateVisitStatsFromVisits_(allVisits)
      : buildVisitStats_()
  });
}
