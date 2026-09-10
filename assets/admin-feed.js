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
