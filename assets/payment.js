window.showOrderPayment = function(payment) {
  const root = document.getElementById('paymentReceipt');
  if (!root) return;
  root.replaceChildren();
  if (payment?.isTest) {
    root.classList.remove('hidden');
    const notice = document.createElement('p');
    notice.textContent = 'TEST – QR můžete načíst pro kontrolu údajů. Používá skutečný účet; převod v bance nepotvrzujte. Přijetí platby vyzkoušíte tlačítkem v administraci bez posílání peněz.';
    root.append(notice);
  }
  root.classList.toggle('hidden', !payment || (payment.method !== 'qr' && !payment.isTest));
  if (!payment || payment.method !== 'qr') return;
  const heading = document.createElement('h3');
  heading.textContent = payment.paid ? (payment.isTest ? 'TEST – přijetí platby nasimulováno' : 'Platba přijata') : payment.amount <= 0 ? 'Není potřeba nic platit' : payment.isTest ? 'TEST – náhled QR platby' : 'Zaplatit objednávku převodem';
  root.append(heading);
  if (payment.paid || payment.amount <= 0) return;
  for (const [label, value] of [['Účet', payment.account], ['Částka', Number(payment.amount).toFixed(2) + ' Kč'], ['Variabilní symbol', payment.vs]]) {
    const row = document.createElement('p');
    row.textContent = label + ': ' + value;
    row.style.overflowWrap = 'anywhere';
    root.append(row);
  }
  const help = document.createElement('p');
  help.textContent = 'Údaje jsou také v potvrzovacím e-mailu. QR kód můžete uložit do telefonu a načíst z obrázku v bankovní aplikaci, pokud to umožňuje. Platbu potvrdíme e-mailem po přijetí peněz.';
  root.append(help);
  if (payment.message) {
    const message = document.createElement('p');
    message.textContent = 'Zpráva pro příjemce: ' + payment.message;
    root.append(message);
  }
  if (!payment.spd) return;
  try {
    if (payment.qrDataUrl && /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(payment.qrDataUrl)) {
      const image = document.createElement('img');
      image.src = payment.qrDataUrl;
      image.alt = 'QR platba za objednávku';
      image.style.cssText = 'display:block;width:280px;max-width:100%;height:auto;margin:16px auto;background:white';
      const download = document.createElement('a');
      download.href = image.src;
      download.download = 'platba-' + payment.vs + '.gif';
      download.textContent = 'Uložit QR kód';
      download.className = 'secondary-button';
      root.append(image, download);
      return;
    }
    const qr = qrcode(0, 'M');
    qr.addData(payment.spd, 'Alphanumeric');
    qr.make();
    const canvas = document.createElement('canvas');
    const cell = 6, border = 4, count = qr.getModuleCount();
    canvas.width = canvas.height = (count + border * 2) * cell;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) context.fillRect((x + border) * cell, (y + border) * cell, cell, cell);
    const image = document.createElement('img');
    image.src = canvas.toDataURL('image/png');
    image.alt = 'QR platba za objednávku';
    image.style.cssText = 'display:block;width:280px;max-width:100%;height:auto;margin:16px auto';
    const download = document.createElement('a');
    download.href = image.src;
    download.download = 'platba-' + payment.vs + '.png';
    download.textContent = 'Uložit QR kód';
    download.className = 'secondary-button';
    root.append(image, download);
  } catch (_) {
    const warning = document.createElement('p');
    warning.textContent = 'QR kód se nepodařilo vytvořit. Použijte platební údaje uvedené výše.';
    root.append(warning);
  }
};
