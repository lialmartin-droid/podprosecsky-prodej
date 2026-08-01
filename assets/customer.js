window.PDP_CUSTOMER_VERSION = "13";
console.info("Podprosečské produkty – customer.js V13");

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
    leadDays: 0,
    quick: [6, 10, 30]
  }
];

let products = DEFAULT_PRODUCTS.slice();
let eggAvailability = null;
let availabilityBlocked = false;
const cart = {};

const productsEl = document.getElementById("products");
const summaryEl = document.getElementById("summary");
const totalEl = document.getElementById("totalPrice");
const countEl = document.getElementById("itemCount");
const feedbackEl = document.getElementById("feedback");
const pickupInput = document.getElementById("pickupDate");
const availabilityEl = document.getElementById("pickupAvailability");
const submitButton = document.getElementById("submitOrder");

let submissionPending = false;
let submissionFinished = false;
let submitTimeout = null;

function backendUrl() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function money(value) {
  return `${value} Kč`;
}

function localDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("cs-CZ");
}

function todayKey() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function addDaysKey(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function activeProducts() {
  return products.filter(product => product.visible);
}

function isEggProduct(product) {
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
  if (isEggProduct(product)) return [6, 10, 30];
  return normalizeQuickButtons(product && product.quick);
}

function normalizeProducts(input) {
  return input.map(product => ({
    ...product,
    id: String(product.id),
    price: Number(product.price || 0),
    leadDays: isEggProduct(product) ? 0 : Math.max(0, Number(product.leadDays || 0)),
    quick: quickButtonsForProduct(product)
  }));
}

function appendJsonp(url, callbackName, onError) {
  const previous = document.getElementById(`jsonp-${callbackName}`);
  if (previous) previous.remove();

  const script = document.createElement("script");
  script.id = `jsonp-${callbackName}`;
  script.src = url;
  script.onerror = () => {
    script.remove();
    if (onError) onError();
  };
  document.head.appendChild(script);
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
      eggAvailability = data.availability || null;

      Object.keys(cart).forEach(id => {
        const product = products.find(item => String(item.id) === String(id));
        if (!product || !product.visible || product.soldOut) delete cart[id];
      });
    }

    renderAll();
  };

  appendJsonp(
    `${url}?action=products&callback=PDP_PRODUCTS_CALLBACK&t=${Date.now()}`,
    "PDP_PRODUCTS_CALLBACK",
    () => renderAll()
  );
}

function eggQuantity() {
  return Object.entries(cart).reduce((sum, [id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));
    return sum + (product && isEggProduct(product) ? Number(quantity || 0) : 0);
  }, 0);
}

function nonEggLeadMinimum() {
  const maximumLead = Object.entries(cart).reduce((maximum, [id, quantity]) => {
    if (!quantity) return maximum;
    const product = products.find(item => String(item.id) === String(id));
    if (!product || isEggProduct(product)) return maximum;
    return Math.max(maximum, Number(product.leadDays || 0));
  }, 0);

  return addDaysKey(todayKey(), maximumLead);
}

function calculatePickupMinimum() {
  const leadMinimum = nonEggLeadMinimum();
  const eggs = eggQuantity();

  if (!eggs) {
    return { minimum: leadMinimum, blocked: false, message: "" };
  }

  if (!eggAvailability || !Array.isArray(eggAvailability.days)) {
    return {
      minimum: leadMinimum,
      blocked: false,
      message: "Dostupnost vajec se ověřuje při odeslání objednávky."
    };
  }

  const earliest = eggAvailability.days.find(day =>
    day.date >= leadMinimum && Number(day.maxAdditional || 0) >= eggs
  );

  if (!earliest) {
    return {
      minimum: "",
      blocked: true,
      message: `Požadovaných ${eggs} vajec nelze při současné snášce zajistit během následujících ${eggAvailability.planningDays || 60} dní.`
    };
  }

  return {
    minimum: earliest.date,
    blocked: false,
    message: `Nejbližší možný termín vyzvednutí je ${localDate(earliest.date)}.`
  };
}

function updatePickupAvailability() {
  const result = calculatePickupMinimum();
  availabilityBlocked = result.blocked;

  pickupInput.min = result.minimum || todayKey();
  const hasEggs = eggQuantity() > 0;
  if (hasEggs && eggAvailability && eggAvailability.horizonEnd) pickupInput.max = eggAvailability.horizonEnd;
  else pickupInput.removeAttribute("max");

  if (result.minimum && (!pickupInput.value || pickupInput.value < result.minimum)) {
    pickupInput.value = result.minimum;
  }

  const eggNotices = document.querySelectorAll("[data-egg-pickup-notice]");
  let productMessage = "Po zvolení počtu vajec se zobrazí nejbližší možný termín vyzvednutí.";

  if (hasEggs) {
    if (result.blocked) {
      productMessage = result.message;
    } else if (result.minimum) {
      productMessage = `Nejbližší možný termín vyzvednutí je ${localDate(result.minimum)}.`;
    } else {
      productMessage = "Nejbližší termín vyzvednutí se ověří při odeslání objednávky.";
    }
  }

  eggNotices.forEach(notice => {
    notice.textContent = productMessage;
    notice.classList.toggle("notice-error", Boolean(result.blocked));
  });

  if (result.blocked) {
    availabilityEl.textContent = result.message;
    availabilityEl.classList.remove("hidden");
    availabilityEl.classList.add("availability-error");
  } else {
    availabilityEl.textContent = "";
    availabilityEl.classList.add("hidden");
    availabilityEl.classList.remove("availability-error");
  }

  submitButton.disabled = submissionPending || availabilityBlocked;
}

function formatRestock(value) {
  return localDate(value);
}

function renderProducts() {
  productsEl.innerHTML = "";

  activeProducts().forEach(product => {
    const article = document.createElement("article");
    article.className = "product";
    article.dataset.productId = String(product.id);
    article.innerHTML = `
      <div class="product-row">
        <div class="product-icon">${product.emoji}</div>
        <div style="flex:1">
          <h3>${product.name}</h3>
          <p class="lead">${product.short}</p>
          <div class="story">${product.detail}</div>
          <div class="price">${money(product.price)} <small>/ ${product.unit}</small></div>
          ${isEggProduct(product) ? `<div class="notice" data-egg-pickup-notice>Po zvolení počtu vajec se zobrazí nejbližší možný termín vyzvednutí.</div>` : ""}
          ${!isEggProduct(product) && product.leadDays ? `<div class="notice">Tento produkt je potřeba objednat minimálně ${product.leadDays} dní předem.</div>` : ""}
          ${product.soldOut ? `<div class="notice">Momentálně vyprodáno${product.restock ? `. Předpokládané doplnění: ${formatRestock(product.restock)}.` : "."}</div>` : ""}
          <div data-controls="${product.id}"></div>
        </div>
      </div>`;

    productsEl.appendChild(article);

    const controls = article.querySelector(`[data-controls="${product.id}"]`);
    if (product.soldOut) return;

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
    input.addEventListener("input", () => setQty(product.id, input.value));
    input.addEventListener("blur", () => { input.value = cart[product.id] || 0; });

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
  if (input) input.value = cart[id] || 0;
}

function changeQty(id, amount) {
  cart[id] = Math.max(0, (cart[id] || 0) + amount);
  if (!cart[id]) delete cart[id];
  updateQuantityInput(id);
  renderSummary();
}

function setQty(id, value) {
  const quantity = Math.max(0, Math.floor(Number(value) || 0));
  if (quantity) cart[id] = quantity;
  else delete cart[id];
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

  updatePickupAvailability();
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
  submitButton.textContent = "Odeslat objednávku";
  feedbackEl.textContent = message;

  if (success) {
    Object.keys(cart).forEach(key => delete cart[key]);
    ["customerName", "customerPhone", "pickupDate", "customerNote"].forEach(id => {
      document.getElementById(id).value = "";
    });
    loadProducts();
  } else {
    submitButton.disabled = availabilityBlocked;
    loadProducts();
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

submitButton.addEventListener("click", () => {
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
  const pickup = pickupInput.value;
  const note = document.getElementById("customerNote").value.trim();
  const pickupRules = calculatePickupMinimum();

  if (!items.length) return feedbackEl.textContent = "Nejprve vyberte alespoň jeden produkt.";
  if (!name) return feedbackEl.textContent = "Vyplňte jméno.";
  if (!phone) return feedbackEl.textContent = "Vyplňte telefon.";
  if (pickupRules.blocked) return feedbackEl.textContent = pickupRules.message;
  if (!pickup) return feedbackEl.textContent = "Vyberte termín vyzvednutí.";
  if (pickupRules.minimum && pickup < pickupRules.minimum) {
    return feedbackEl.textContent = `Nejbližší možný termín je ${localDate(pickupRules.minimum)}.`;
  }
  if (eggQuantity() > 0 && eggAvailability && eggAvailability.horizonEnd && pickup > eggAvailability.horizonEnd) {
    return feedbackEl.textContent = `Termín vajec lze zvolit nejvýše do ${localDate(eggAvailability.horizonEnd)}.`;
  }

  const url = backendUrl();
  if (!url || !url.endsWith("/exec")) {
    feedbackEl.textContent = "Odesílání není správně propojené.";
    return;
  }

  const form = document.getElementById("backendOrderForm");
  const payload = document.getElementById("backendPayload");

  form.action = url;
  form.querySelector('[name="action"]').value = "createOrder";
  payload.value = JSON.stringify({ name, phone, pickup, note, source: "Web", items });

  submissionPending = true;
  submissionFinished = false;
  submitButton.disabled = true;
  submitButton.textContent = "Odesílám…";
  feedbackEl.textContent = "Odesílám objednávku a ověřuji dostupnost…";
  form.submit();

  clearTimeout(submitTimeout);
  submitTimeout = setTimeout(() => {
    if (submissionPending && !submissionFinished) {
      submissionPending = false;
      submitButton.disabled = availabilityBlocked;
      submitButton.textContent = "Odeslat objednávku";
      feedbackEl.textContent = "Nepodařilo se potvrdit odeslání. Před opakováním zkontrolujte e-mail nebo tabulku.";
    }
  }, 25000);
});

pickupInput.addEventListener("change", () => {
  const rules = calculatePickupMinimum();
  if (rules.minimum && pickupInput.value < rules.minimum) {
    feedbackEl.textContent = `Nejbližší možný termín je ${localDate(rules.minimum)}.`;
    pickupInput.value = rules.minimum;
  }
});

renderAll();
loadProducts();
