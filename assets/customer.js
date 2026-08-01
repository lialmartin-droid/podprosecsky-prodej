const DEFAULT_PRODUCTS = [
  {
    id: "1",
    emoji: "🍯",
    name: "Květový med",
    price: 190,
    unit: "950 g",
    short: "Smíšený květový med z okolí Lukášova.",
    detail: "Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.",
    visible: true,
    soldOut: false,
    restock: "",
    leadDays: 0,
    quick: []
  },
  {
    id: "2",
    emoji: "🥚",
    name: "Čerstvá vejce",
    price: 7,
    unit: "kus",
    short: "Vejce od našich slepic z domácího chovu.",
    detail: "Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.",
    visible: true,
    soldOut: false,
    restock: "",
    leadDays: 7,
    quick: [6, 10, 30]
  }
];

let products = DEFAULT_PRODUCTS.slice();
const cart = {};

const productsEl = document.getElementById("products");
const summaryEl = document.getElementById("summary");
const totalEl = document.getElementById("totalPrice");
const countEl = document.getElementById("itemCount");
const feedbackEl = document.getElementById("feedback");

let submissionPending = false;
let submissionFinished = false;
let submitTimeout = null;
let submissionStartedAt = 0;

function backendUrl() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function money(value) {
  return `${value} Kč`;
}

function activeProducts() {
  return products.filter(product => product.visible);
}

function isEggProduct(product) {
  // Produkt vajec má od začátku projektu ID 2. Kontrola ID je záměrně
  // první, aby tlačítka nezmizela ani při prázdném emoji nebo změně názvu.
  if (String(product && product.id) === "2") return true;

  const text = `${product?.emoji || ""} ${product?.name || ""} ${product?.short || ""} ${product?.detail || ""}`
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return text.includes("🥚") || text.includes("vejce") || text.includes("vajick");
}

function normalizeQuickButtons(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source
    .map(item => Number(String(item).trim()))
    .filter(item => Number.isFinite(item) && item > 0)
    .map(item => Math.floor(item))
  )];
}

function quickButtonsForProduct(product) {
  // U vajec se tato trojice používá vždy. Backend ji nesmí přepsat
  // prázdnou hodnotou ani jiným starým nastavením.
  if (isEggProduct(product)) return [6, 10, 30];
  return normalizeQuickButtons(product && product.quick);
}

function normalizeProducts(input) {
  return input.map(product => ({
    ...product,
    id: String(product.id),
    price: Number(product.price || 0),
    leadDays: Math.max(0, Number(product.leadDays || 0)),
    quick: quickButtonsForProduct(product)
  }));
}

function loadProducts() {
  const url = backendUrl();

  if (!url || !url.endsWith("/exec")) {
    renderAll();
    return;
  }

  window.PDP_PRODUCTS_CALLBACK = data => {
    if (data && data.ok && Array.isArray(data.products)) {
      products = normalizeProducts(data.products);

      Object.keys(cart).forEach(id => {
        const product = products.find(item => String(item.id) === String(id));
        if (!product || !product.visible || product.soldOut) {
          delete cart[id];
        }
      });
    }

    renderAll();
  };

  const script = document.createElement("script");
  script.src = `${url}?action=products&callback=PDP_PRODUCTS_CALLBACK&t=${Date.now()}`;
  script.onerror = () => renderAll();
  document.head.appendChild(script);
}

function minPickupDate() {
  const maxLeadDays = Object.entries(cart).reduce((maximum, [id, quantity]) => {
    if (!quantity) return maximum;

    const product = products.find(item => String(item.id) === String(id));
    return Math.max(maximum, product?.leadDays || 0);
  }, 0);

  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + maxLeadDays);
  return date.toISOString().slice(0, 10);
}

function formatRestock(value) {
  if (!value) return "";

  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("cs-CZ");
}

function renderProducts() {
  productsEl.innerHTML = "";

  activeProducts().forEach(product => {
    const article = document.createElement("article");
    article.className = "product";
    article.innerHTML = `
      <div class="product-row">
        <div class="product-icon">${product.emoji}</div>
        <div style="flex:1">
          <h3>${product.name}</h3>
          <p class="lead">${product.short}</p>
          <div class="story">${product.detail}</div>
          <div class="price">${money(product.price)} <small>/ ${product.unit}</small></div>
          ${product.leadDays ? `<div class="notice">Tento produkt je potřeba objednat minimálně ${product.leadDays} dní předem.</div>` : ""}
          ${product.soldOut ? `<div class="notice">Momentálně vyprodáno${product.restock ? `. Předpokládané doplnění: ${formatRestock(product.restock)}.` : "."}</div>` : ""}
          <div data-controls="${product.id}"></div>
        </div>
      </div>`;

    productsEl.appendChild(article);

    const controls = article.querySelector(`[data-controls="${product.id}"]`);
    if (product.soldOut) return;

    // Počítá se znovu přímo při každém vykreslení. Ani později načtená
    // data z Google Tabulky tedy nemohou tlačítka u vajec odstranit.
    const quickAmounts = quickButtonsForProduct(product);

    if (quickAmounts.length) {
      const label = document.createElement("div");
      label.className = "muted";
      label.style.marginTop = "18px";
      label.textContent = "Rychlé přidání";
      controls.appendChild(label);

      const quickGrid = document.createElement("div");
      quickGrid.className = "quick-grid";

      quickAmounts.forEach(amount => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `+ ${amount} ks`;
        button.addEventListener("click", () => changeQty(product.id, amount));
        quickGrid.appendChild(button);
      });

      controls.appendChild(quickGrid);
    }

    const row = document.createElement("div");
    row.className = "qty-row";
    row.innerHTML = `<span class="muted">${product.unit === "kus" ? "Celkový počet kusů" : "Množství"}</span>`;

    const stepper = document.createElement("div");
    stepper.className = "stepper";

    const minus = document.createElement("button");
    minus.className = "round-button";
    minus.type = "button";
    minus.textContent = "−";
    minus.addEventListener("click", () => changeQty(product.id, -1));

    const input = document.createElement("input");
    input.className = "qty-input";
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.inputMode = "numeric";
    input.dataset.qtyId = String(product.id);
    input.value = cart[product.id] || 0;

    // Důležité: při psaní se už nepřekresluje celý seznam produktů.
    // Kurzor proto zůstane v poli a lze normálně napsat např. 30 nebo 120.
    input.addEventListener("input", () => setQty(product.id, input.value));
    input.addEventListener("blur", () => {
      input.value = cart[product.id] || 0;
    });

    const plus = document.createElement("button");
    plus.className = "round-button";
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => changeQty(product.id, 1));

    stepper.append(minus, input, plus);
    row.appendChild(stepper);
    controls.appendChild(row);
  });
}

function updateQuantityInput(id) {
  const input = document.querySelector(`[data-qty-id="${CSS.escape(String(id))}"]`);
  if (input) {
    input.value = cart[id] || 0;
  }
}

function changeQty(id, amount) {
  cart[id] = Math.max(0, (cart[id] || 0) + amount);

  if (!cart[id]) {
    delete cart[id];
  }

  updateQuantityInput(id);
  renderSummary();
}

function setQty(id, value) {
  const quantity = Math.max(0, Math.floor(Number(value) || 0));

  if (quantity) {
    cart[id] = quantity;
  } else {
    delete cart[id];
  }

  renderSummary();
}

function renderSummary() {
  const entries = Object.entries(cart);
  const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);

  countEl.textContent = `${count} ${count === 1 ? "položka" : count > 1 && count < 5 ? "položky" : "položek"}`;

  if (!entries.length) {
    summaryEl.className = "muted";
    summaryEl.textContent = "Zatím nemáte nic vybráno.";
    totalEl.textContent = "0 Kč";
  } else {
    summaryEl.className = "";
    summaryEl.innerHTML = "";

    let total = 0;

    entries.forEach(([id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      if (!product) return;

      const rowTotal = product.price * quantity;
      total += rowTotal;

      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${quantity}× ${product.name}</span><strong>${money(rowTotal)}</strong>`;
      summaryEl.appendChild(row);
    });

    totalEl.textContent = money(total);
  }

  document.getElementById("pickupDate").min = minPickupDate();
}

function renderAll() {
  renderProducts();
  renderSummary();
}

function finish(success, message) {
  if (submissionFinished) return;

  submissionFinished = true;
  submissionPending = false;
  clearTimeout(submitTimeout);

  const button = document.getElementById("submitOrder");
  button.disabled = false;
  button.textContent = "Odeslat objednávku";
  feedbackEl.textContent = message;

  if (success) {
    Object.keys(cart).forEach(key => delete cart[key]);
    ["customerName", "customerPhone", "pickupDate", "customerNote"].forEach(id => {
      document.getElementById(id).value = "";
    });
    renderAll();
  }
}

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "PDP_BACKEND_RESULT") return;

  finish(
    Boolean(data.ok),
    data.ok
      ? "Objednávka byla odeslána. Brzy se vám ozveme."
      : (data.message || "Objednávku se nepodařilo odeslat.")
  );
});

const frame = document.getElementById("orderSubmitFrame");
if (frame) {
  frame.addEventListener("load", () => {
    if (!submissionPending || submissionFinished || Date.now() - submissionStartedAt < 500) return;

    setTimeout(() => {
      if (submissionPending && !submissionFinished) {
        finish(true, "Objednávka byla odeslána. Brzy se vám ozveme.");
      }
    }, 900);
  });
}

document.getElementById("submitOrder").addEventListener("click", () => {
  const items = Object.entries(cart)
    .map(([id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      return product
        ? { productId: String(product.id), name: product.name, qty: quantity, price: product.price }
        : null;
    })
    .filter(Boolean);

  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const pickup = document.getElementById("pickupDate").value;
  const note = document.getElementById("customerNote").value.trim();

  if (!items.length) return feedbackEl.textContent = "Nejprve vyberte alespoň jeden produkt.";
  if (!name) return feedbackEl.textContent = "Vyplňte jméno.";
  if (!phone) return feedbackEl.textContent = "Vyplňte telefon.";
  if (!pickup) return feedbackEl.textContent = "Vyberte termín vyzvednutí.";
  if (pickup < minPickupDate()) return feedbackEl.textContent = "Zvolený termín je příliš brzy pro některý z produktů.";

  const url = backendUrl();
  if (!url || !url.endsWith("/exec")) {
    feedbackEl.textContent = "Odesílání není správně propojené.";
    return;
  }

  const form = document.getElementById("backendOrderForm");
  const payload = document.getElementById("backendPayload");
  const button = document.getElementById("submitOrder");

  form.action = url;
  form.querySelector('[name="action"]').value = "createOrder";
  payload.value = JSON.stringify({ name, phone, pickup, note, source: "Web", items });

  submissionPending = true;
  submissionFinished = false;
  submissionStartedAt = Date.now();

  button.disabled = true;
  button.textContent = "Odesílám…";
  feedbackEl.textContent = "Odesílám objednávku…";
  form.submit();

  clearTimeout(submitTimeout);
  submitTimeout = setTimeout(() => {
    if (submissionPending && !submissionFinished) {
      submissionPending = false;
      button.disabled = false;
      button.textContent = "Odeslat objednávku";
      feedbackEl.textContent = "Nepodařilo se potvrdit odeslání. Před opakováním zkontrolujte e-mail nebo tabulku.";
    }
  }, 25000);
});

renderAll();
loadProducts();
