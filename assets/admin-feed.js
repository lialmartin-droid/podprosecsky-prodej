(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('feedTab')) return;
  const model = window.PDPFeedModel;
  const moneyFeed = value => Number(value).toLocaleString('cs-CZ', {style:'currency', currency:'CZK', maximumFractionDigits:2});
  const numberFeed = value => Number(value).toLocaleString('cs-CZ', {maximumFractionDigits:6});
  const dateFeed = value => value ? value.split('-').reverse().map(Number).join('. ') : '—';
  const defaults = ['Směs pro nosnice', 'Pšenice', 'Krmná řepa', 'Slunečnice', 'Červi'];
  let data = null, busy = false, ready = false, dirtySettings = false, settingsRevision = '', editing = null, stale = true;
  const today = () => currentPragueDateKey();
  const active = () => el('feedTab').classList.contains('active');
  const rows = () => [...el('feedItems').querySelectorAll('[data-feed-row]')];
  const field = (row, name) => row.querySelector(`[data-feed-field="${name}"]`);
  function status(message, error = false) {
    el('feedStatus').textContent = message;
    el('feedStatus').classList.toggle('feed-warning', error);
  }
  function setBusy(value) {
    busy = value;
    el('feedTab').setAttribute('aria-busy', String(value));
    el('feedTab').querySelectorAll('fieldset, button').forEach(control => { control.disabled = value || !ready; });
    el('feedReload').disabled = value;
  }
  function markDirty() {
    dirtySettings = true;
    el('feedDirtyNote').hidden = false;
    el('feedDirtyNote').textContent = 'Přepočet reaguje hned. Změny ještě nejsou uložené — stiskni Uložit krmiva a dávky.';
    updateDaily();
  }
  function itemMarkup(item) {
    const unit = item.unit === 'g' ? 'g' : 'kg';
    const amount = item.dailyKg == null ? '' : Math.round(Number(item.dailyKg) * (unit === 'g' ? 1000 : 1) * 1000000) / 1000000;
    return `<article class="feed-item" data-feed-row="${esc(item.id)}">
      <div class="feed-item-head"><strong data-feed-title>${esc(item.name || 'Nové krmivo')}</strong><button type="button" class="feed-remove secondary-button" data-feed-remove aria-label="Odstranit ${esc(item.name || 'krmivo')}">Odstranit</button></div>
      <div class="feed-item-fields">
        <label class="feed-item-name"><span>Název krmiva</span><input data-feed-field="name" maxlength="100" value="${esc(item.name || '')}" placeholder="Např. pšenice"></label>
        <label><span>Cena za kg (Kč)</span><input data-feed-field="price" type="number" inputmode="decimal" min="0" max="100000" step="0.01" value="${esc(item.pricePerKg ?? '')}" placeholder="Kč/kg"></label>
        <label class="feed-dose"><span>Denní dávka celému hejnu</span><div class="feed-dose-input"><input data-feed-field="amount" type="number" inputmode="decimal" min="0" max="${unit === 'g' ? 10000000 : 10000}" step="any" value="${esc(amount)}" placeholder="Dávka"><select data-feed-field="unit" data-previous-unit="${unit}" aria-label="Jednotka denní dávky"><option value="kg" ${unit === 'kg' ? 'selected' : ''}>kg</option><option value="g" ${unit === 'g' ? 'selected' : ''}>g</option></select></div></label>
        <div class="feed-item-cost"><span>Cena za den</span><output data-feed-output>—</output></div>
      </div>
      <details class="feed-item-stock"><summary>Zásoba pro odhad nákupů</summary><div class="form-grid">
        <label><span>Zásoba na začátku dne (kg)</span><input data-feed-field="stock" type="number" inputmode="decimal" min="0" max="1000000" step="0.001" value="${esc(item.stockKg ?? 0)}"></label>
        <label><span>Datum této zásoby</span><input data-feed-field="date" type="date" min="2000-01-01" max="${esc(today())}" value="${esc(item.stockDate || today())}"></label>
      </div><p class="feed-note">Zadej stav před nákupy v tento den. Novější nákupy stejného krmiva se přičtou. Při změně dávky aktualizuj zásobu a datum. Zásoba sama nevytváří výdaj.</p></details>
    </article>`;
  }
  function rowItem(row) {
    const amount = Number(field(row, 'amount').value);
    const unit = field(row, 'unit').value;
    return {id:row.dataset.feedRow, name:field(row, 'name').value.trim(),
      dailyKg:Math.round(amount * (unit === 'g' ? 0.001 : 1) * 1000000) / 1000000,
      pricePerKg:Number(field(row, 'price').value), stockKg:Number(field(row, 'stock').value), stockDate:field(row, 'date').value, unit};
  }
  function entered(row) {
    return field(row, 'amount').value !== '' || field(row, 'price').value !== '' || Number(field(row, 'stock').value) > 0;
  }
  function updateDaily() {
    if (!data) return;
    const valid = [];
    let incomplete = false;
    rows().forEach(row => {
      const item = rowItem(row);
      row.querySelector('[data-feed-title]').textContent = item.name || 'Nové krmivo';
      const complete = field(row, 'amount').value !== '' && field(row, 'price').value !== '' &&
        Number.isFinite(item.dailyKg) && item.dailyKg >= 0 && item.dailyKg <= 10000 && Number.isFinite(item.pricePerKg) && item.pricePerKg >= 0 && item.pricePerKg <= 100000;
      row.querySelector('[data-feed-output]').textContent = complete ? moneyFeed(item.dailyKg * item.pricePerKg) : '—';
      if (complete) valid.push(item);
      else if (entered(row)) incomplete = true;
    });
    const d = model.dailyCosts(valid, Number(data.asOf.slice(0, 4)));
    el('feedDailyCosts').innerHTML = card('Celkem za den', valid.length ? moneyFeed(d.dailyCost) : '—', `${numberFeed(d.dailyKg)} kg pro celé hejno`, 'feed-result')
      + card('Za 30 dní', valid.length ? moneyFeed(d.monthlyCost) : '—', 'Při stejné denní dávce')
      + card('Za rok', valid.length ? moneyFeed(d.yearlyCost) : '—', `${d.annualDays} dní při stejné dávce`);
    el('feedDailyNote').textContent = incomplete ? 'V přepočtu jsou jen krmiva s vyplněnou cenou a dávkou. Doplň chybějící údaje.' : 'Přepočet spotřeby při současných cenách a dávkách. Roční výdělek výše se počítá podle skutečně zapsaných nákupů.';
    el('feedDailyNote').classList.toggle('feed-warning', incomplete);
  }
  function fillSettings() {
    if (!data || dirtySettings) return;
    const s = data.settings || {};
    settingsRevision = s.revision || '';
    const items = model.feedItems(s);
    const suggestions = items.length === 0 ? defaults : !Array.isArray(s.items) ? defaults.slice(1) : [];
    el('feedItems').innerHTML = [...items, ...suggestions.map(name => ({id:crypto.randomUUID(), name, unit:name === 'Slunečnice' || name === 'Červi' ? 'g' : 'kg'}))].map(itemMarkup).join('');
    el('feedSettingsNotice').textContent = items.some(item => item.legacy)
      ? 'Původní spotřeba a souhrnná zásoba jsou v prvním řádku. Pojmenuj ho podle hlavního krmiva. Pokud zásoba zahrnovala více druhů, rozděl ji mezi ně a nastav aktuální datum.' : '';
    el('feedDirtyNote').hidden = true;
    updateDaily();
  }
  function card(label, value, detail, style = '') {
    return `<article class="${style}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
  }
  function purchaseChoices() {
    if (!data) return;
    const selected = el('feedPurchaseType').value;
    const items = model.feedItems(data.settings);
    el('feedPurchaseType').innerHTML = '<option value="">Jiné krmivo / vlastní název</option>' + items.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    if (editing?.feedId && !items.some(item => item.id === editing.feedId)) {
      el('feedPurchaseType').add(new Option(editing.name + ' (dřívější krmivo)', editing.feedId));
    }
    el('feedPurchaseType').value = selected;
  }
  function render() {
    if (!data) return;
    el('feedContent').classList.remove('hidden');
    const yearBefore = el('feedYear').value || data.asOf.slice(0, 4);
    const years = new Set([data.asOf.slice(0, 4), ...Object.keys(data.sales.years), ...data.purchases.map(item => item.date.slice(0, 4))]);
    el('feedYear').innerHTML = [...years].sort().reverse().map(year => `<option value="${esc(year)}">${esc(year)}</option>`).join('');
    el('feedYear').value = years.has(yearBefore) ? yearBefore : data.asOf.slice(0, 4);
    const s = model.summary(data, el('feedYear').value);
    el('feedActual').innerHTML = card('Tržby za vejce', moneyFeed(s.sales.revenue), `${numberFeed(s.sales.eggs)} vyzvednutých vajec po slevách`)
      + card('Zaplaceno za krmivo', moneyFeed(s.spent), `${numberFeed(s.purchasedKg)} kg v zapsaných nákupech`)
      + card('Výdělek po krmivu', moneyFeed(s.profit), `Dosavadní výsledek za rok ${s.year}`, s.profit < 0 ? 'feed-negative' : 'feed-result');
    const notes = [];
    if (s.sales.estimatedDateOrders) notes.push(`U ${s.sales.estimatedDateOrders} starších objednávek chybí skutečný čas vyzvednutí; používá se zadaný termín.`);
    if (data.sales.missingDateOrders) notes.push(`${data.sales.missingDateOrders} vyzvednutých objednávek bez data nelze zařadit do roku.`);
    el('feedRevenueNote').textContent = notes.join(' ');
    el('feedRevenueNote').hidden = !notes.length;
    el('feedForecastHeading').hidden = s.year !== s.currentYear;
    el('feedForecast').hidden = s.year !== s.currentYear;
    el('feedForecast').style.display = s.year !== s.currentYear ? 'none' : '';
    el('feedForecast').innerHTML = '';
    el('feedForecastNote').classList.remove('feed-warning');
    el('feedForecastNote').textContent = s.year !== s.currentYear ? 'U minulých let jsou zobrazené pouze zaznamenané tržby a výdaje.' : 'Pro odhad nákupů ulož krmiva a dávky. Zásobu každého krmiva můžeš doplnit v jeho řádku.';
    el('feedStockBreakdown').innerHTML = '<p class="feed-note">Zásoby se zobrazí po uložení krmiv a denních dávek.</p>';
    if (s.forecast) {
      const f = s.forecast;
      el('feedForecast').innerHTML = card('Odhad zásob dnes', `${numberFeed(f.stockKg)} kg`, 'Součet zásob jednotlivých krmiv')
        + card('Ještě za krmivo do konce roku', moneyFeed(f.remainingCost), `Při uložených dávkách, zbývá ${f.remainingDays} dní`)
        + card('Krmivo za celý rok — odhad', moneyFeed(f.totalCost), 'Již zaplaceno + odhad dalších nákupů');
      el('feedForecastNote').textContent = `Stav k ${dateFeed(data.asOf)}. Každé krmivo se počítá zvlášť podle své zásoby, denní dávky a ceny. Odhad zahrnuje dnešek a nezaokrouhluje nákupy na celé pytle.`;
      if (f.depleted.length) {
        el('feedForecastNote').textContent += ` Podle evidence došlo: ${f.depleted.join(', ')}. Doplň nákupy nebo aktualizuj zásoby.`;
        el('feedForecastNote').classList.add('feed-warning');
      }
      el('feedStockBreakdown').innerHTML = f.items.map(item => `<div class="feed-stock-row"><strong>${esc(item.name)}</strong><span>${esc(numberFeed(item.stockKg))} kg${item.daysOfStock == null ? ' · denní dávka 0' : ` · na ${item.daysOfStock} dní`}</span></div>`).join('');
    }
    el('feedPurchases').innerHTML = s.purchases.length ? s.purchases.map(item => `<article class="card">
      <div class="feed-purchase-main"><div><h4>${esc(item.name)}</h4><p>${esc(dateFeed(item.date))} · ${esc(numberFeed(item.kg))} kg · ${esc(moneyFeed(item.cost / item.kg))}/kg</p></div><strong>${esc(moneyFeed(item.cost))}</strong></div>
      ${item.note ? `<p class="feed-note feed-purchase-note">${esc(item.note)}</p>` : ''}
      <div class="actions"><button type="button" class="secondary-button" data-feed-edit="${esc(item.id)}">Upravit</button><button type="button" class="danger-button" data-feed-delete="${esc(item.id)}">Smazat</button></div>
    </article>`).join('') : `<p class="empty">Za rok ${s.year} zatím není zapsaný žádný nákup krmiva.</p>`;
    fillSettings();
    purchaseChoices();
    setBusy(busy);
  }
  function load() {
    if (busy || !token) return;
    ready = false;
    setBusy(true);
    status('Načítám krmiva, nákupy a tržby za vejce…');
    post('getFeedData', {}, result => {
      if (result.ok && result.feedData) {
        data = result.feedData;
        ready = data.schemaVersion === 2;
        stale = false;
        render();
        status(ready ? `Aktuální přehled k ${dateFeed(data.asOf)}.` : 'Nejprve aktualizuj Code.gs v Google Apps Scriptu a nasaď novou verzi stejného nasazení. Potom stiskni Obnovit.', !ready);
      } else {
        stale = true;
        status((result.message || 'Přehled se nepodařilo načíst.') + (data ? ' Zobrazuji poslední načtený stav. Zkus Obnovit.' : ' Zkus Obnovit.'), true);
      }
      setBusy(false);
    });
  }
  function mutate(action, payload, success) {
    if (busy || !ready) return;
    setBusy(true);
    status('Ukládám…');
    post(action, payload, result => {
      if (result.ok) { if (success(result) !== false) { render(); status(result.message || 'Uloženo.'); } }
      else status(result.message || 'Změnu se nepodařilo uložit. Zadané údaje zůstaly ve formuláři.', true);
      setBusy(false);
    });
  }
  function editPurchase(item) {
    if (!ready || busy) return;
    editing = item ? {...item} : {id:crypto.randomUUID(), revision:''};
    el('feedPurchaseHeading').textContent = item ? 'Upravit nákup krmiva' : 'Nový nákup krmiva';
    el('feedPurchaseDate').value = item?.date || today();
    el('feedPurchaseDate').min = '2000-01-01';
    el('feedPurchaseDate').max = today();
    purchaseChoices();
    const matching = model.feedItems(data.settings).find(feed => model.nameKey(feed.name) === model.nameKey(item?.name));
    el('feedPurchaseType').value = item?.feedId || matching?.id || '';
    el('feedPurchaseName').value = item?.name || '';
    el('feedPurchaseKg').value = item?.kg ?? '';
    el('feedPurchaseCost').value = item?.cost ?? '';
    el('feedPurchaseNote').value = item?.note || '';
    el('feedPurchaseForm').classList.remove('hidden');
    updateUnitPrice();
    el('feedPurchaseType').focus();
  }
  function updateUnitPrice() {
    const kg = Number(el('feedPurchaseKg').value), cost = Number(el('feedPurchaseCost').value);
    el('feedPurchaseUnitPrice').textContent = kg > 0 && el('feedPurchaseCost').value !== '' ? `Cena: ${moneyFeed(cost / kg)}/kg` : '';
  }
  el('feedItems').addEventListener('input', event => { if (event.target.dataset.feedField !== 'unit') markDirty(); });
  el('feedItems').addEventListener('change', event => {
    if (event.target.dataset.feedField !== 'unit') return;
    const row = event.target.closest('[data-feed-row]'), amount = field(row, 'amount');
    const oldUnit = event.target.dataset.previousUnit;
    if (amount.value !== '') amount.value = String(Math.round(Number(amount.value) * (oldUnit === 'g' ? 0.001 : 1) * (event.target.value === 'g' ? 1000 : 1) * 1000000) / 1000000);
    amount.max = event.target.value === 'g' ? '10000000' : '10000';
    event.target.dataset.previousUnit = event.target.value;
    markDirty();
  });
  el('feedItems').addEventListener('click', event => {
    if (!event.target.closest('[data-feed-remove]') || busy || !ready) return;
    event.target.closest('[data-feed-row]').remove();
    markDirty();
  });
  el('feedItemAdd').onclick = () => {
    if (busy || !ready) return;
    if (rows().length >= 50) { status('Lze zadat nejvýše 50 krmiv.', true); return; }
    el('feedItems').insertAdjacentHTML('beforeend', itemMarkup({id:crypto.randomUUID(), unit:'kg'}));
    markDirty();
    field(rows().slice(-1)[0], 'name').focus();
  };
  el('feedSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!data || !ready || busy) return;
    const selected = rows().filter(entered), items = selected.map(rowItem), names = new Set();
    if (!items.length) { status('Vyplň alespoň jedno krmivo, cenu a denní dávku.', true); return; }
    for (let i = 0; i < items.length; i++) {
      const item = items[i], row = selected[i];
      if (!item.name || field(row, 'amount').value === '' || field(row, 'price').value === '' || field(row, 'stock').value === '' || !item.stockDate) {
        status(`Doplň název, cenu a denní dávku u krmiva ${item.name || '(bez názvu)'}. Zásoba musí být alespoň 0 kg s datem.`, true); return;
      }
      const key = model.nameKey(item.name);
      if (names.has(key)) { status('Každé krmivo musí mít vlastní název.', true); return; }
      names.add(key);
    }
    mutate('saveFeedSettings', {expectedRevision:settingsRevision, settings:{items}}, result => {
      if (!Array.isArray(result.feedSettings?.items)) { status('Server zatím neumí jednotlivá krmiva. Aktualizuj Code.gs.', true); return false; }
      data.settings = result.feedSettings;
      dirtySettings = false;
    });
  });
  el('feedPurchaseType').onchange = () => {
    const selected = model.feedItems(data.settings).find(item => item.id === el('feedPurchaseType').value);
    if (!selected) return;
    el('feedPurchaseName').value = selected.name;
    if (el('feedPurchaseKg').value !== '') el('feedPurchaseCost').value = (Number(el('feedPurchaseKg').value) * selected.pricePerKg).toFixed(2);
    updateUnitPrice();
  };
  el('feedPurchaseName').addEventListener('input', () => {
    const option = el('feedPurchaseType').selectedOptions[0];
    if (option?.value && model.nameKey(option.textContent) !== model.nameKey(el('feedPurchaseName').value)) el('feedPurchaseType').value = '';
  });
  el('feedPurchaseKg').addEventListener('input', () => {
    const selected = model.feedItems(data.settings).find(item => item.id === el('feedPurchaseType').value);
    if (selected && el('feedPurchaseKg').value !== '') el('feedPurchaseCost').value = (Number(el('feedPurchaseKg').value) * selected.pricePerKg).toFixed(2);
  });
  el('feedPurchaseForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!editing) return;
    const purchase = {id:editing.id, date:el('feedPurchaseDate').value, name:el('feedPurchaseName').value.trim(),
      feedId:el('feedPurchaseType').value, kg:Number(el('feedPurchaseKg').value), cost:Number(el('feedPurchaseCost').value), note:el('feedPurchaseNote').value.trim()};
    mutate('saveFeedPurchase', {purchase, expectedRevision:editing.revision}, result => {
      data.purchases = [...data.purchases.filter(item => item.id !== purchase.id), result.feedPurchase];
      el('feedYear').value = purchase.date.slice(0, 4);
      if (!el('feedYear').value) el('feedYear').add(new Option(purchase.date.slice(0, 4), purchase.date.slice(0, 4), true, true));
      el('feedPurchaseForm').classList.add('hidden');
      editing = null;
    });
  });
  el('feedPurchases').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || busy || !ready) return;
    const item = data.purchases.find(purchase => purchase.id === (button.dataset.feedEdit || button.dataset.feedDelete));
    if (!item) return;
    if (button.dataset.feedEdit) editPurchase(item);
    else if (confirm(`Smazat nákup ${item.name} ze dne ${dateFeed(item.date)} za ${moneyFeed(item.cost)}?`)) {
      mutate('deleteFeedPurchase', {id:item.id, expectedRevision:item.revision}, () => {
        data.purchases = data.purchases.filter(purchase => purchase.id !== item.id);
        if (editing?.id === item.id) { editing = null; el('feedPurchaseForm').classList.add('hidden'); }
      });
    }
  });
  el('feedPurchaseForm').addEventListener('input', updateUnitPrice);
  el('feedPurchaseCancel').onclick = () => { editing = null; el('feedPurchaseForm').classList.add('hidden'); };
  el('feedAdd').onclick = () => editPurchase(null);
  el('feedReload').onclick = () => {
    if ((dirtySettings || editing) && !confirm('Obnovit přehled a zahodit neuložené změny ve formuláři?')) return;
    dirtySettings = false;
    editing = null;
    el('feedPurchaseForm').classList.add('hidden');
    load();
  };
  el('feedYear').onchange = render;
  function invalidate() { stale = true; if (active() && !busy) load(); }
  window.addEventListener('pdp:admin-state-updated', invalidate);
  window.addEventListener('pdp:order-saved', invalidate);
  window.PDPFeed = {open(force = false) {
    if (force || stale || !data || data.asOf !== today()) load(); else render();
  }};
})();

(() => {
  'use strict';
  const TAB_ID = 'cashboxTab';
  const markerPattern = /^Kasička QR:\s*([0-9]+(?:[.,][0-9]+)?)\s*Kč\s*\|\s*(.+)$/i;
  const cashMoney = value => Number(value || 0).toLocaleString('cs-CZ', {style:'currency', currency:'CZK', maximumFractionDigits:2});

  function isTest(order) {
    return Boolean(order && (order.isTest === true || /^TEST-\d+$/i.test(String(order.orderNumber || ''))));
  }

  function paidAmount(order) {
    const paid = Number(order?.payment?.paidAmount);
    if (Number.isFinite(paid) && paid > 0) return paid;
    return Math.max(0, Number(order?.total || 0));
  }

  function cashboxEntry(order) {
    const lines = String(order?.internalNote || '').split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].trim().match(markerPattern);
      if (!match) continue;
      const amount = Number(String(match[1]).replace(',', '.'));
      return {amount:Number.isFinite(amount) ? amount : paidAmount(order), at:String(match[2] || '').trim()};
    }
    return null;
  }

  function receivedAt(order) {
    const entries = Array.isArray(order?.timeline) ? order.timeline : [];
    const entry = entries.filter(item => item && item.type === 'payment' && item.paid).slice(-1)[0];
    return String(entry?.at || '');
  }

  function formatDateTime(value) {
    if (!value) return 'datum neuvedeno';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('cs-CZ', {dateStyle:'short', timeStyle:'short'});
  }

  function eligibleOrders() {
    return (Array.isArray(orders) ? orders : []).filter(order => {
      const payment = order?.payment || {};
      return !isTest(order) && payment.method === 'qr' && payment.paid === true && paidAmount(order) > 0;
    });
  }

  function orderTitle(order) {
    return `${order?.orderNumber || order?.id || 'Objednávka'} · ${order?.name || 'Bez jména'}`;
  }

  function renderRow(order, moved) {
    const entry = cashboxEntry(order);
    const amount = moved && entry ? entry.amount : paidAmount(order);
    const detail = moved
      ? `Vloženo ${formatDateTime(entry?.at)} · platba přijata ${formatDateTime(receivedAt(order))}`
      : `Platba přijata ${formatDateTime(receivedAt(order))} · stav objednávky: ${order?.status || '—'}`;
    return `<article class="card cashbox-order">
      <div class="cashbox-order-main">
        <div><h4>${esc(orderTitle(order))}</h4><p>${esc(detail)}</p></div>
        <strong>${esc(cashMoney(amount))}</strong>
      </div>
      <div class="actions">${moved
        ? `<button type="button" class="secondary-button" data-cashbox-undo="${esc(order.id)}">Vrátit jako nevložené</button>`
        : `<button type="button" class="primary-small" data-cashbox-add="${esc(order.id)}">Přidat do kasičky</button>`}
      </div>
    </article>`;
  }

  function renderCashbox() {
    const panel = document.getElementById(TAB_ID);
    if (!panel) return;
    const eligible = eligibleOrders();
    const pending = eligible.filter(order => !cashboxEntry(order));
    const moved = eligible.filter(order => cashboxEntry(order));
    const pendingSum = pending.reduce((sum, order) => sum + paidAmount(order), 0);
    const movedSum = moved.reduce((sum, order) => sum + Number(cashboxEntry(order)?.amount || 0), 0);

    const cards = panel.querySelector('#cashboxCards');
    const status = panel.querySelector('#cashboxStatus');
    const pendingList = panel.querySelector('#cashboxPending');
    const movedList = panel.querySelector('#cashboxMoved');
    if (!cards || !status || !pendingList || !movedList) return;

    cards.innerHTML = `
      <article class="cashbox-card cashbox-card-pending"><span>Na účtu k přesunu</span><strong>${esc(cashMoney(pendingSum))}</strong><small>${pending.length} ${pending.length === 1 ? 'přijatá QR platba' : 'přijatých QR plateb'}</small></article>
      <article class="cashbox-card"><span>Vloženo do kasičky</span><strong>${esc(cashMoney(movedSum))}</strong><small>${moved.length} zaevidovaných plateb</small></article>
      <article class="cashbox-card"><span>Přijaté QR platby celkem</span><strong>${esc(cashMoney(pendingSum + movedSum))}</strong><small>Jen platby potvrzené v administraci</small></article>`;

    status.className = pendingSum > 0 ? 'cashbox-status cashbox-attention' : 'cashbox-status cashbox-ok';
    status.textContent = pendingSum > 0
      ? `Podle evidence máš na účtu ještě ${cashMoney(pendingSum)}, které je potřeba vložit do kasičky.`
      : 'Všechny přijaté QR platby jsou zaevidované v kasičce. Na účtu podle evidence nezůstává nic k přesunu.';

    pending.sort((a, b) => String(receivedAt(b)).localeCompare(String(receivedAt(a))));
    moved.sort((a, b) => String(cashboxEntry(b)?.at || '').localeCompare(String(cashboxEntry(a)?.at || '')));
    pendingList.innerHTML = pending.length ? pending.map(order => renderRow(order, false)).join('') : '<p class="empty">Žádná přijatá QR platba teď nečeká na vložení do kasičky.</p>';
    movedList.innerHTML = moved.length ? moved.map(order => renderRow(order, true)).join('') : '<p class="empty">Zatím není zaevidovaný žádný přesun do kasičky.</p>';
  }

  function setCashboxState(id, moved, button) {
    const current = (Array.isArray(orders) ? orders : []).find(order => String(order.id) === String(id));
    if (!current) return alert('Objednávka nebyla nalezena.');
    if (moved && (!current.payment || current.payment.method !== 'qr' || !current.payment.paid)) {
      return alert('Nejdřív označ QR platbu jako přijatou.');
    }
    button.disabled = true;
    post('setCashboxState', {id:current.id, moved, expectedAmount:Math.round(paidAmount(current) * 100) / 100}, result => {
      button.disabled = false;
      if (!result.ok) return alert(result.message || 'Kasičku se nepodařilo aktualizovat.');
      if (!applyReturnedOrder(result, current.id)) return loadData(true);
    });
  }

  function injectStyles() {
    if (document.getElementById('pdp-cashbox-styles')) return;
    const style = document.createElement('style');
    style.id = 'pdp-cashbox-styles';
    style.textContent = `
      #cashboxTab .cashbox-note{font-size:14px;line-height:1.55;color:var(--muted)}
      #cashboxTab .cashbox-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}
      #cashboxTab .cashbox-card{padding:18px;border:1px solid var(--line);border-radius:18px;min-width:0;background:#fff}
      #cashboxTab .cashbox-card-pending{background:#fff8e5;border-color:#e6c46e}
      #cashboxTab .cashbox-card span,#cashboxTab .cashbox-card small{display:block;font-size:14px;line-height:1.4;color:var(--muted)}
      #cashboxTab .cashbox-card strong{display:block;font-size:clamp(22px,4vw,30px);line-height:1.25;margin:10px 0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
      #cashboxTab .cashbox-status{padding:14px 16px;border-radius:14px;margin:12px 0 18px;font-weight:700;line-height:1.5}
      #cashboxTab .cashbox-ok{background:#edf5e9;border:1px solid #baceb1;color:#315d42}
      #cashboxTab .cashbox-attention{background:#fff4d6;border:1px solid #e5c36b;color:#73521b}
      #cashboxTab .cashbox-order-main{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
      #cashboxTab .cashbox-order-main h4{margin:0;font-size:17px;overflow-wrap:anywhere}
      #cashboxTab .cashbox-order-main p{margin:6px 0 0;font-size:14px;line-height:1.45;color:var(--muted)}
      #cashboxTab .cashbox-order-main strong{font-size:20px;white-space:nowrap}
      #cashboxTab .cashbox-order .actions{margin-top:12px}
      #cashboxTab button:disabled{opacity:.55;cursor:wait}
      @media(max-width:600px){#cashboxTab .cashbox-cards{grid-template-columns:1fr}#cashboxTab .cashbox-card{padding:14px 16px}#cashboxTab .cashbox-order-main{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);
  }

  function injectCashbox() {
    if (document.getElementById(TAB_ID)) return;
    const feedButton = document.querySelector('[data-tab="feedTab"]');
    const feedPanel = document.getElementById('feedTab');
    if (!feedButton || !feedPanel) return;

    injectStyles();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.dataset.tab = TAB_ID;
    button.textContent = 'Kasička';
    feedButton.insertAdjacentElement('afterend', button);

    const panel = document.createElement('section');
    panel.id = TAB_ID;
    panel.className = 'tab-panel';
    panel.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">QR platby předem</div><h2>Kasička</h2></div></div>
      <p class="cashbox-note">Zobrazuje jen QR platby, které už jsou u objednávky označené jako přijaté. Tlačítkem potvrď, že jsi stejnou částku fyzicky vložil do kasičky.</p>
      <div id="cashboxCards" class="cashbox-cards"></div>
      <div id="cashboxStatus" class="cashbox-status" role="status" aria-live="polite"></div>
      <div class="section-head compact-head"><div><div class="eyebrow">Ještě na účtu</div><h2>Čeká na vložení</h2></div></div>
      <div id="cashboxPending" class="stack"></div>
      <div class="section-head compact-head"><div><div class="eyebrow">Historie</div><h2>Vloženo do kasičky</h2></div></div>
      <div id="cashboxMoved" class="stack"></div>`;
    feedPanel.insertAdjacentElement('afterend', panel);

    button.onclick = () => {
      document.querySelectorAll('.tab,.tab-panel').forEach(element => element.classList.remove('active'));
      button.classList.add('active');
      panel.classList.add('active');
      renderCashbox();
    };

    panel.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.cashboxAdd) setCashboxState(target.dataset.cashboxAdd, true, target);
      if (target.dataset.cashboxUndo && confirm('Vrátit tuto částku zpět mezi peníze, které ještě nejsou vložené do kasičky?')) {
        setCashboxState(target.dataset.cashboxUndo, false, target);
      }
    });
  }

  window.addEventListener('pdp:admin-state-updated', () => {
    if (document.getElementById(TAB_ID)?.classList.contains('active')) renderCashbox();
  });
  window.addEventListener('pdp:order-saved', () => {
    if (document.getElementById(TAB_ID)?.classList.contains('active')) renderCashbox();
  });

  injectCashbox();
  window.PDPCashbox = {render:renderCashbox};
})();

