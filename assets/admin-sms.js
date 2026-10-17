/**
 * Podprosečské domácí produkty – ruční SMS z administrace.
 * Samostatný doplněk: pouze čte objednávky, nikam nic neodesílá a nemění backend.
 */
(() => {
  'use strict';

  const list = document.getElementById('ordersList');
  if (!list || !('MutationObserver' in window)) return;

  const BRAND = 'Podprosečské domácí produkty';
  const PHONE_PATTERN = /^\+?\d{9,15}$/;
  const options = [
    ['accepted', 'Potvrzení objednávky'],
    ['ready', 'Připraveno k vyzvednutí'],
    ['delay', 'Zpoždění objednávky'],
    ['reminder', 'Připomenutí vyzvednutí']
  ];

  const css = document.createElement('style');
  css.textContent = `
    #pdpSmsDialog { box-sizing: border-box; width: min(540px, calc(100vw - 24px)); max-width: 540px;
      max-height: calc(100dvh - 24px); overflow-y: auto; margin: auto; padding: 20px;
      border: 1px solid #d9cdbf; border-radius: 16px; background: #fffdf8; color: #322d27;
      box-shadow: 0 12px 45px rgba(0,0,0,.25); }
    #pdpSmsDialog::backdrop { background: rgba(15,15,15,.55); }
    #pdpSmsDialog h2 { margin: 0 0 8px; font-size: 1.25rem; }
    #pdpSmsDialog .pdp-sms-hint { font-size: .88rem; line-height: 1.45; margin: 4px 0 14px; }
    #pdpSmsDialog .pdp-sms-fields { display: grid; gap: 12px; }
    #pdpSmsDialog .pdp-sms-fields label { display: grid; gap: 5px; font-weight: 600; }
    #pdpSmsDialog :is(input,select,textarea) { box-sizing: border-box; width: 100%; font: inherit;
      border-radius: 8px; border: 1px solid #b9b0a6; background: white; color: #29241e; padding: 10px; }
    #pdpSmsDialog textarea { min-height: 150px; resize: vertical; line-height: 1.5; }
    #pdpSmsDialog .pdp-sms-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    #pdpSmsDialog .pdp-sms-actions button { flex: 1 1 130px; min-height: 44px; }
    #pdpSmsDialog .pdp-sms-notice { min-height: 1.4em; font-size: .88rem; margin-top: 10px; }
    #pdpSmsDialog .pdp-sms-error { color: #a42621; }
  `;
  document.head.appendChild(css);

  const dialog = document.createElement('dialog');
  dialog.id = 'pdpSmsDialog';
  dialog.setAttribute('aria-labelledby', 'pdpSmsHeading');
  dialog.innerHTML = `
    <h2 id="pdpSmsHeading">Poslat SMS</h2>
    <p class="pdp-sms-hint" id="pdpSmsCustomer"></p>
    <div class="pdp-sms-fields">
      <label>Telefon zákazníka <input id="pdpSmsPhone" type="tel" inputmode="tel" autocomplete="off"></label>
      <label>Typ zprávy <select id="pdpSmsType"></select></label>
      <label>Text SMS <textarea id="pdpSmsBody" rows="6"></textarea></label>
    </div>
    <p class="pdp-sms-hint">Zprávu můžeš libovolně upravit. Při otevření Zpráv se aplikace pokusí text zkopírovat. Kdyby ho iPhone nepředvyplnil, můžeš použít tlačítko Kopírovat text.</p>
    <div class="pdp-sms-actions">
      <button id="pdpSmsCopy" class="secondary-button" type="button">Kopírovat text</button>
      <button id="pdpSmsOpen" class="primary-small" type="button">Otevřít Zprávy</button>
      <button id="pdpSmsClose" class="secondary-button" type="button">Zavřít</button>
    </div>
    <div class="pdp-sms-notice" id="pdpSmsNotice" role="status" aria-live="polite"></div>`;
  document.body.appendChild(dialog);

  const phoneInput = dialog.querySelector('#pdpSmsPhone');
  const typeSelect = dialog.querySelector('#pdpSmsType');
  const bodyInput = dialog.querySelector('#pdpSmsBody');
  const customerLabel = dialog.querySelector('#pdpSmsCustomer');
  const notice = dialog.querySelector('#pdpSmsNotice');
  let currentOrder = null;

  function findOrder(id) {
    // `orders` je existující datové pole v admin.js; přistupujeme k němu jen pro čtení.
    return typeof orders !== 'undefined' && Array.isArray(orders)
      ? orders.find(item => String(item.id) === String(id)) : null;
  }

  function orderNumber(order) {
    return String(order.orderNumber || order.id || '').trim();
  }

  function dateLabel(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return '';
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('cs-CZ');
  }

  function pickupText(order, part) {
    if (part === 'preorder') return dateLabel(order.preorderPickup);
    return dateLabel(order.pickup);
  }

  function readyPart(order) {
    if (!order.splitOrder) return {part: 'regular', label: ''};
    if (order.preorderStatus === 'Připraveno' && order.regularStatus !== 'Připraveno') {
      return {part: 'preorder', label: '2. část Vaší objednávky'};
    }
    return {part: 'regular', label: '1. část Vaší objednávky'};
  }

  function messageFor(order, type) {
    const num = orderNumber(order);
    const reference = num ? ` č. ${num}` : '';
    const date = pickupText(order);
    if (type === 'accepted') {
      return `Dobrý den, potvrzujeme přijetí Vaší objednávky${reference}.${date ? ` Plánovaný termín vyzvednutí: ${date}.` : ''} Děkujeme! ${BRAND}`;
    }
    if (type === 'ready') {
      const ready = readyPart(order);
      const readyDate = pickupText(order, ready.part);
      const detail = ready.label ? `${ready.label}${reference} je připravena` : `Vaše objednávka${reference} je připravena`;
      return `Dobrý den, ${detail} k vyzvednutí.${readyDate ? ` Termín: ${readyDate}.` : ''} Vyzvednutí: Pod Prosečí 102/2, Jablonec nad Nisou. ${BRAND}`;
    }
    if (type === 'delay') {
      return `Dobrý den, omlouváme se, vyřízení Vaší objednávky${reference} se může zpozdit. O termínu vyzvednutí Vás budeme informovat. Děkujeme za pochopení. ${BRAND}`;
    }
    return `Dobrý den, připomínáme vyzvednutí Vaší objednávky${reference}${date ? ` (termín ${date})` : ''}. Pokud potřebujete termín změnit, napište nám. ${BRAND}`;
  }

  function setNotice(message, error = false) {
    notice.textContent = message;
    notice.classList.toggle('pdp-sms-error', Boolean(error));
  }

  function normalizedPhone() {
    const phone = phoneInput.value.replace(/[\s().-]/g, '');
    return PHONE_PATTERN.test(phone) ? phone : '';
  }

  function showComposer(order) {
    currentOrder = order;
    customerLabel.textContent = `${order.name || 'Zákazník'} – objednávka ${orderNumber(order)}`;
    phoneInput.value = String(order.phone || '');
    typeSelect.replaceChildren();
    for (const [key, title] of options) {
      const item = new Option(title, key);
      typeSelect.add(item);
    }
    typeSelect.value = order.splitOrder
      ? ((order.regularStatus === 'Připraveno' || order.preorderStatus === 'Připraveno') ? 'ready' : 'accepted')
      : (order.status === 'Připraveno' ? 'ready' : 'accepted');
    bodyInput.value = messageFor(order, typeSelect.value);
    setNotice('');
    if (!dialog.open) dialog.showModal();
    if (!normalizedPhone()) {
      setNotice('U objednávky není platné telefonní číslo. Doplň ho před otevřením Zpráv.', true);
      phoneInput.focus();
    }
  }

  typeSelect.addEventListener('change', () => {
    if (currentOrder) bodyInput.value = messageFor(currentOrder, typeSelect.value);
    setNotice('');
  });

  async function copySms() {
    const message = bodyInput.value.trim();
    if (!message) return setNotice('Napiš text zprávy.', true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Schránka není dostupná');
      await navigator.clipboard.writeText(message);
      setNotice('Text SMS je zkopírovaný.');
    } catch (_) {
      bodyInput.focus();
      bodyInput.select();
      setNotice('Označil jsem text SMS. Podrž prst na textu a zvol Kopírovat.', true);
    }
  }

  dialog.querySelector('#pdpSmsCopy').addEventListener('click', copySms);
  dialog.querySelector('#pdpSmsClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelector('#pdpSmsOpen').addEventListener('click', () => {
    const phone = normalizedPhone();
    const message = bodyInput.value.trim();
    if (!phone) return setNotice('Zkontroluj telefonní číslo (9 až 15 číslic, případně + na začátku).', true);
    if (!message) return setNotice('Napiš text zprávy.', true);

    // Zkopírování je záloha pro iOS, který nemusí v každé verzi doplnit tělo SMS z odkazu.
    try { navigator.clipboard?.writeText(message).catch(() => {}); } catch (_) {}
    const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const link = `sms:${phone}${ios ? '&body=' : '?body='}${encodeURIComponent(message)}`;
    window.location.href = link;
  });

  function ensureButtons() {
    list.querySelectorAll('[data-edit-order]').forEach(editButton => {
      const actions = editButton.parentElement;
      if (!actions || actions.querySelector('[data-pdp-sms-order]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = 'Poslat SMS';
      button.dataset.pdpSmsOrder = editButton.dataset.editOrder;
      actions.insertBefore(button, editButton);
    });
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-pdp-sms-order]');
    if (!button || !list.contains(button)) return;
    const order = findOrder(button.dataset.pdpSmsOrder);
    if (!order) return window.alert('Objednávka nebyla nalezena. Obnov administraci.');
    showComposer(order);
  });

  // renderOrders() přepisuje obsah seznamu. Sledujeme pouze jeho přímé děti,
  // aby tlačítka fungovala i po filtru, přepnutí stavu či obnovení dat.
  new MutationObserver(ensureButtons).observe(list, {childList: true});
  ensureButtons();
})();
