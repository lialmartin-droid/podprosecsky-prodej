(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('feedTab')) return;
  const moneyFeed = value => Number(value).toLocaleString('cs-CZ', {style:'currency', currency:'CZK', maximumFractionDigits:2});
  const numberFeed = value => Number(value).toLocaleString('cs-CZ', {maximumFractionDigits:3});
  const dateFeed = value => value ? value.split('-').reverse().map(Number).join('. ') : '—';
  let data = null;
  let busy = false;
  let ready = false;
  let dirtySettings = false;
  let settingsRevision = '';
  let editing = null;
  let stale = true;
  const today = () => currentPragueDateKey();
  const active = () => el('feedTab').classList.contains('active');
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
  function fillSettings() {
    if (!data || dirtySettings) return;
    const s = data.settings;
    settingsRevision = s.revision || '';
    el('feedDaily').value = s.dailyKg || '';
    el('feedPrice').value = s.revision ? s.pricePerKg : '';
    el('feedStock').value = s.stockKg || 0;
    el('feedStockDate').value = s.stockDate || data.asOf;
    el('feedStockDate').min = '2000-01-01';
    el('feedStockDate').max = data.asOf;
    if (!s.revision) el('feedSettingsDetails').open = true;
  }
  function card(label, value, detail, style = '') {
    return `<article class="${style}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
  }
  function render() {
    if (!data) return;
    el('feedContent').classList.remove('hidden');
    const yearBefore = el('feedYear').value || data.asOf.slice(0,4);
    const years = new Set([data.asOf.slice(0,4), ...Object.keys(data.sales.years), ...data.purchases.map(item => item.date.slice(0,4))]);
    el('feedYear').innerHTML = [...years].sort().reverse().map(year => `<option value="${esc(year)}">${esc(year)}</option>`).join('');
    el('feedYear').value = years.has(yearBefore) ? yearBefore : data.asOf.slice(0,4);
    const s = window.PDPFeedModel.summary(data, el('feedYear').value);
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
    el('feedForecastNote').textContent = s.year !== s.currentYear ? 'U minulých let jsou zobrazené pouze zaznamenané tržby a výdaje.' : 'Pro odhad doplň denní spotřebu, zásobu a cenu za kilogram.';
    el('feedForecastNote').classList.remove('feed-warning');
    if (s.forecast) {
      const f = s.forecast;
      el('feedForecast').innerHTML = card('Odhad zásoby dnes', `${numberFeed(f.stockKg)} kg`, `Přibližně na ${f.daysOfStock} dní`)
        + card('Ještě za krmivo do konce roku', moneyFeed(f.remainingCost), `Potřeba dokoupit asi ${numberFeed(f.neededKg)} kg`)
        + card('Krmivo za celý rok — odhad', moneyFeed(f.totalCost), 'Již zaplaceno + odhad dalších nákupů');
      el('feedForecastNote').textContent = `Stav k ${dateFeed(data.asOf)}: ${numberFeed(data.settings.dailyKg)} kg denně, budoucí cena ${moneyFeed(data.settings.pricePerKg)}/kg. Zbývá ${f.remainingDays} dní včetně dneška. Jde o odhad podle spotřeby, bez zaokrouhlení na celé pytle a bez předpovědi budoucích tržeb.`;
      if (f.rawStock < 0) {
        el('feedForecastNote').textContent += ' Podle evidence už krmivo došlo. Doplň chybějící nákupy nebo aktualizuj zásobu; odhad dalších nákupů nyní počítá s nulovou zásobou.';
        el('feedForecastNote').classList.add('feed-warning');
      }
    }
    el('feedPurchases').innerHTML = s.purchases.length ? s.purchases.map(item => `<article class="card">
      <div class="feed-purchase-main"><div><h4>${esc(item.name)}</h4><p>${esc(dateFeed(item.date))} · ${esc(numberFeed(item.kg))} kg · ${esc(moneyFeed(item.cost / item.kg))}/kg</p></div><strong>${esc(moneyFeed(item.cost))}</strong></div>
      ${item.note ? `<p class="feed-note feed-purchase-note">${esc(item.note)}</p>` : ''}
      <div class="actions"><button type="button" class="secondary-button" data-feed-edit="${esc(item.id)}">Upravit</button><button type="button" class="danger-button" data-feed-delete="${esc(item.id)}">Smazat</button></div>
    </article>`).join('') : `<p class="empty">Za rok ${s.year} zatím není zapsaný žádný nákup krmiva.</p>`;
    fillSettings();
    setBusy(busy);
  }
  function load() {
    if (busy || !token) return;
    ready = false;
    setBusy(true);
    status('Načítám nákupy krmiva a tržby za vejce…');
    post('getFeedData', {}, result => {
      if (result.ok && result.feedData) {
        data = result.feedData;
        ready = true;
        stale = false;
        render();
        status(`Aktuální přehled k ${dateFeed(data.asOf)}.`);
      } else {
        stale = true;
        status((result.message === 'Neznámá operace.' ? 'Nová sekce ještě není dostupná na serveru.' : result.message || 'Přehled se nepodařilo načíst.') + (data ? ' Zobrazuji poslední načtený stav. Zkus Obnovit.' : ' Zkus Obnovit.'), true);
      }
      setBusy(false);
    });
  }
  function mutate(action, payload, success) {
    if (busy || !ready) return;
    setBusy(true);
    status('Ukládám…');
    post(action, payload, result => {
      if (result.ok) {
        success(result);
        render();
        status(result.message || 'Uloženo.');
      } else {
        // Preserve form and ID after timeout; a retry cannot create a duplicate.
        status(result.message || 'Změnu se nepodařilo uložit. Zadané údaje zůstaly ve formuláři.', true);
      }
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
    el('feedPurchaseName').value = item?.name || '';
    el('feedPurchaseKg').value = item?.kg ?? '';
    el('feedPurchaseCost').value = item?.cost ?? '';
    el('feedPurchaseNote').value = item?.note || '';
    el('feedPurchaseForm').classList.remove('hidden');
    updateUnitPrice();
    el('feedPurchaseName').focus();
  }
  function updateUnitPrice() {
    const kg = Number(el('feedPurchaseKg').value);
    const cost = Number(el('feedPurchaseCost').value);
    el('feedPurchaseUnitPrice').textContent = kg > 0 && el('feedPurchaseCost').value !== '' ? `Cena: ${moneyFeed(cost / kg)}/kg` : '';
  }
  el('feedSettingsForm').addEventListener('input', () => { dirtySettings = true; });
  el('feedSettingsForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!data) return;
    mutate('saveFeedSettings', {expectedRevision:settingsRevision, settings:{
      dailyKg:Number(el('feedDaily').value), pricePerKg:Number(el('feedPrice').value), stockKg:Number(el('feedStock').value), stockDate:el('feedStockDate').value
    }}, result => {
      data.settings = result.feedSettings;
      dirtySettings = false;
      el('feedSettingsDetails').open = false;
    });
  });
  el('feedPurchaseForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!editing) return;
    const purchase = {id:editing.id, date:el('feedPurchaseDate').value, name:el('feedPurchaseName').value.trim(), kg:Number(el('feedPurchaseKg').value), cost:Number(el('feedPurchaseCost').value), note:el('feedPurchaseNote').value.trim()};
    mutate('saveFeedPurchase', {purchase, expectedRevision:editing.revision}, result => {
      data.purchases = [...data.purchases.filter(item => item.id !== purchase.id), result.feedPurchase];
      el('feedYear').value = purchase.date.slice(0,4);
      // Make an earlier year selectable when this is its first record.
      if (!el('feedYear').value) el('feedYear').add(new Option(purchase.date.slice(0,4), purchase.date.slice(0,4), true, true));
      el('feedPurchaseForm').classList.add('hidden');
      editing = null;
    });
  });
  el('feedPurchases').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || busy || !ready) return;
    const id = button.dataset.feedEdit || button.dataset.feedDelete;
    const item = data.purchases.find(purchase => purchase.id === id);
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
  function invalidate() {
    stale = true;
    if (active() && !busy) load();
  }
  window.addEventListener('pdp:admin-state-updated', invalidate);
  window.addEventListener('pdp:order-saved', invalidate);
  window.PDPFeed = {open(force = false) {
    if (force || stale || !data || data.asOf !== today()) load();
    else render();
  }};
})();

(() => {
  'use strict';
  const TAB_ID = 'cashboxTab';
  const MARKER_PREFIX = 'Kasička QR:';
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

  function cleanCashboxMarker(note) {
    return String(note || '')
      .split(/\r?\n/)
      .filter(line => !markerPattern.test(line.trim()))
      .join('\n')
      .trim();
  }

  function noteWithCashboxMarker(note, amount, at) {
    const clean = cleanCashboxMarker(note);
    const line = `${MARKER_PREFIX} ${Number(amount || 0).toFixed(2)} Kč | ${at}`;
    return [clean, line].filter(Boolean).join('\n');
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

  async function setCashboxState(id, moved, button) {
    const current = (Array.isArray(orders) ? orders : []).find(order => String(order.id) === String(id));
    if (!current) return alert('Objednávka nebyla nalezena.');
    if (moved && (!current.payment || current.payment.method !== 'qr' || !current.payment.paid)) {
      return alert('Nejdřív označ QR platbu jako přijatou.');
    }
    const next = {...current};
    next.internalNote = moved
      ? noteWithCashboxMarker(current.internalNote, paidAmount(current), new Date().toISOString())
      : cleanCashboxMarker(current.internalNote);
    await saveOrder(next, button);
    renderCashbox();
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
