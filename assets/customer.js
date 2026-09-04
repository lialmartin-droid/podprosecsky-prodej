window.PDP_CUSTOMER_VERSION = "3.5.4";
console.info("Podprosečské produkty – customer.js V3.5.4 – věrnost pouze v zákaznickém účtu");

// Karty produktů se při první návštěvě vykreslí okamžitě z bezpečného náhledu.
// Sklad a objednávání se odemknou až po potvrzení živých dat z Google Tabulky.
let products = [];
let productsLoaded = false;
let productsVerified = false;
let productsLoadFailed = false;
let eggAvailability = null;
let availabilityBlocked = false;
let businessSettings = {};
let albumPhotos = [];
let activeAlbumPhotoIndex = -1;
let autoPickupDate = "";
let loyaltyOrderState = null;
let loyaltyOptInAutoChecked = false;
let loyaltyLookupTimer = 0;
let loyaltyRequestCounter = 0;
let activeLoyaltyRequest = null;
const loyaltyRequestQueue = [];
const cart = {};
const VISITOR_ID_KEY = "pdp-visitor-id-v1";
const VISIT_TRACKED_KEY = "pdp-visit-tracked-v1";
const ADMIN_VISIT_EXCLUDE_KEY = "pdp-admin-exclude-visits";
const ADMIN_VISIT_EXCLUDE_COOKIE = "pdp_admin_exclude_visits";
const LOYALTY_CONTACT_KEY = "pdp-loyalty-contact-v1";

const productsEl = document.getElementById("products");
const summaryEl = document.getElementById("summary");
const totalEl = document.getElementById("totalPrice");
const countEl = document.getElementById("itemCount");
const feedbackEl = document.getElementById("feedback");
const pickupInput = document.getElementById("pickupDate");
const availabilityEl = document.getElementById("pickupAvailability");
const submitButton = document.getElementById("submitOrder");
const loyaltyOrderStatusEl = document.getElementById("loyaltyOrderStatus");
const loyaltyOptInEl = document.getElementById("loyaltyOptIn");
const loyaltyJoinChoiceEl = document.getElementById("loyaltyJoinChoice");
const loyaltyPublicStatusEl = document.getElementById("loyaltyPublicStatus");

let submissionPending = false;
let submissionFinished = false;
let currentOrderRequestId = "";
let submitTimeout = null;
let orderReceiptPollTimer = null;
let orderReceiptRequestTimer = null;
let orderReceiptPollStartedAt = 0;
let orderReceiptCallbackName = "";
let watchPending = null;

function backendUrl() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function hasAdminVisitExclusionCookie() {
  try {
    return document.cookie
      .split(";")
      .map(value => value.trim())
      .some(value => value === `${ADMIN_VISIT_EXCLUDE_COOKIE}=1`);
  } catch (_) {
    return false;
  }
}

function adminExcludedFromVisitStats() {
  try {
    if (localStorage.getItem(ADMIN_VISIT_EXCLUDE_KEY) === "1") return true;
  } catch (_) {}
  return hasAdminVisitExclusionCookie();
}

function visitorId() {
  try {
    let value = localStorage.getItem(VISITOR_ID_KEY);
    if (!value) {
      value = (window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`)
        .replace(/[^a-zA-Z0-9_-]/g, "");
      localStorage.setItem(VISITOR_ID_KEY, value);
    }
    return value;
  } catch (_) {
    return `anon${Date.now()}`;
  }
}

function detectVisitSource() {
  try {
    const params = new URLSearchParams(window.location.search);
    const source = String(params.get("src") || params.get("source") || params.get("utm_source") || "").trim().toLowerCase();
    if (["qr", "qrcode", "qrkod", "qr-kod"].includes(source)) return "qr";
  } catch (_) {}
  return "link";
}

function trackVisitOnce() {
  if (adminExcludedFromVisitStats()) return;
  const url = backendUrl();
  if (!url || !url.endsWith("/exec")) return;

  const source = detectVisitSource();
  const sessionKey = `${VISIT_TRACKED_KEY}:${window.location.pathname}:${source}`;
  try {
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");
  } catch (_) {}

  const callbackName = `PDP_VISIT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanup = () => {
    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
  };
  window[callbackName] = () => cleanup();
  appendJsonp(
    `${url}?action=trackVisit&visitorId=${encodeURIComponent(visitorId())}&source=${encodeURIComponent(source)}&path=${encodeURIComponent(window.location.pathname)}&title=${encodeURIComponent(document.title)}&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`,
    callbackName,
    cleanup
  );
}

function showProductsLoading() {
  productsLoadFailed = false;
  countEl.textContent = "Načítám…";
  productsEl.innerHTML = `
    <div class="products-loading" role="status">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>Načítám aktuální nabídku…</span>
    </div>`;
  summaryEl.className = "muted";
  summaryEl.textContent = "Nejdřív načítáme aktuální nabídku.";
  totalEl.textContent = "0 Kč";
  availabilityEl.textContent = "";
  availabilityEl.classList.add("hidden");
  submitButton.disabled = true;
}

function showProductsLoadError(message) {
  productsLoaded = false;
  productsVerified = false;
  productsLoadFailed = true;
  products = [];
  eggAvailability = null;
  Object.keys(cart).forEach(id => delete cart[id]);

  countEl.textContent = "Nedostupné";
  productsEl.innerHTML = "";

  const box = document.createElement("div");
  box.className = "products-load-error";
  const text = document.createElement("p");
  text.textContent = message || "Aktuální nabídku se nepodařilo načíst.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = "Načíst znovu";
  button.addEventListener("click", loadProducts);
  box.append(text, button);
  productsEl.appendChild(box);

  summaryEl.className = "muted";
  summaryEl.textContent = "Objednávku lze vytvořit až po načtení aktuální nabídky.";
  totalEl.textContent = "0 Kč";
  submitButton.disabled = true;
}

function money(value) {
  return `${Number(value || 0)} Kč`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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


function isHoneyProduct(product) {
  if (String(product && product.id) === "1") return true;

  const text = `${product?.emoji || ""} ${product?.name || ""} ${product?.short || ""} ${product?.detail || ""}`
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return text.includes("🍯") || text.includes("med") || text.includes("vcel");
}

function defaultProductImage(product) {
  if (isEggProduct(product)) return "assets/images/products/vajicka-real.webp";
  if (isHoneyProduct(product)) return "assets/images/products/med-real.webp";
  return "assets/images/products/placeholder.webp";
}

function resolveProductImage(product) {
  const image = String(product?.image || "").trim();
  const localWebp = {
    "assets/images/products/vajicka-real.jpg": "assets/images/products/vajicka-real.webp",
    "assets/images/products/med-real.jpg": "assets/images/products/med-real.webp",
    "assets/images/products/placeholder.jpg": "assets/images/products/placeholder.webp",
    "assets/images/products/vajicka-real.webp": "assets/images/products/vajicka-real.webp",
    "assets/images/products/med-real.webp": "assets/images/products/med-real.webp",
    "assets/images/products/placeholder.webp": "assets/images/products/placeholder.webp"
  };
  if (localWebp[image]) return localWebp[image];
  if (!image || image === "assets/images/products/placeholder.jpg" || image === "assets/images/products/placeholder.webp") return defaultProductImage(product);
  return image;
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
    preorder: Boolean(product.preorder),
    restock: String(product.restock || ""),
    capacity: Math.max(0, Number(product.capacity || 0)),
    reserved: Math.max(0, Number(product.reserved || 0)),
    stock: Math.max(0, Number(product.stock || 0)),
    availableStock: Math.max(0, Number(product.availableStock || 0)),
    stockUnit: String(product.stockUnit || "ks"),
    soldOutText: String(product.soldOutText || "Momentálně vyprodáno"),
    quick: quickButtonsForProduct(product)
  }));
}

function normalizeAlbumPhotos(input) {
  return (Array.isArray(input) ? input : [])
    .map((photo, index) => ({
      id:String(photo?.id || `photo-${index}`),
      title:String(photo?.title || "Fotografie").trim(),
      caption:String(photo?.caption || "").trim(),
      image:String(photo?.image || "").trim()
    }))
    .filter(photo => photo.image);
}

// Bezpečný první náhled současné veřejné nabídky. Díky němu zákazník uvidí
// produkty a jejich fotografie okamžitě i při úplně první návštěvě. Sklad,
// kapacity a objednávací tlačítka zůstávají zamčené, dokud server nepotvrdí
// živá data. Po odpovědi serveru se celý náhled beze zbytku nahradí.
const FIRST_PAINT_PRODUCTS = [
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
    quick: [6, 10, 30],
    preorder: false,
    preorderDate: "",
    capacity: 0,
    reserved: 0,
    image: "assets/images/products/vajicka-real.webp",
    stock: 0,
    availableStock: 0,
    stockUnit: "ks",
    soldOutText: "Momentálně vyprodáno"
  },
  {
    id: "1785876289415",
    emoji: "🕯️",
    name: "Vánoční čajové svíčky",
    price: 40,
    unit: "Ks",
    short: "Vneste do svého domova kouzlo Vánoc s ručně vyráběnou čajovou svíčkou ve tvaru vánočního stromečku. Je vyrobena z čistého vosku od našich včel a zalita do elegantního skleněného kalíšku, který podtrhuje její jedinečný vzhled a lze jej po vypálení znovu využít.",
    detail: "🐝 Vyrobeno z vosku od našich včel. 🎄 Originální motiv vánočního stromečku. 🕯️ Ručně odléváno v malých sériích. 🫙 Elegantní skleněný kalíšek místo běžného hliníkového obalu. ♻️ Skleničku lze po vypálení snadno vyčistit a znovu využít. 🇨🇿 Vyrobeno s láskou v Pod Prosečí.",
    visible: true,
    soldOut: false,
    restock: "2026-10-31",
    leadDays: 0,
    quick: [],
    preorder: true,
    preorderDate: "2026-10-31",
    capacity: 10,
    reserved: 0,
    image: "https://lh3.googleusercontent.com/d/1uCrHS_advc10e9NnX_zQmZSlxAcqtiWf=w1600",
    stock: 0,
    availableStock: 0,
    stockUnit: "ks",
    soldOutText: "Momentálně vyprodáno"
  },
  {
    id: "1785950150037",
    emoji: "🕯️",
    name: "Vysoká svíčka",
    price: 65,
    unit: "kus",
    short: "Elegantní svíčka vyrobená z vosku. Každý kus je ručně odléván v malých sériích s důrazem na kvalitu a poctivé zpracování. Díky přirozené medové vůni včelího vosku vytvoří ve Vašem domově příjemnou a hřejivou atmosféru.",
    detail: "🐝 Vyrobeno z vosku od našich včel. 🕯️ Ručně odléváno v malých sériích. 🍯 Přirozená jemná vůně včelího vosku. 🌿 Bez přidaných barviv a parfemací. Vyrobeno s láskou v Pod Prosečí.",
    visible: true,
    soldOut: false,
    restock: "2026-10-31",
    leadDays: 0,
    quick: [2, 4],
    preorder: true,
    preorderDate: "2026-10-31",
    capacity: 12,
    reserved: 0,
    image: "https://lh3.googleusercontent.com/d/1ZBTrpHzvpdikGD4ELUTkzUJLCQwtwbPu=w1600",
    stock: 0,
    availableStock: 0,
    stockUnit: "ks",
    soldOutText: "Momentálně vyprodáno"
  }
];


let productsRequestInFlight = false;
let productsRequestCounter = 0;
const PRODUCTS_CACHE_KEY = "pdp-products-cache-v8-album";
const PRODUCTS_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

function saveProductsCache(data) {
  try {
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch (error) {
    console.warn("Mezipaměť nabídky se nepodařilo uložit.", error);
  }
}

function loadProductsCache() {
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || !cached.data || !Array.isArray(cached.data.products)) return false;
    if (Date.now() - Number(cached.savedAt || 0) > PRODUCTS_CACHE_MAX_AGE) return false;

    products = normalizeProducts(cached.data.products);
    // Z uložené nabídky použijeme vzhled a popisy, nikdy ale starý počet vajec
    // ani starý plán termínů. Ty musí vždy potvrdit živý server.
    eggAvailability = null;
    businessSettings = cached.data.settings || {};
    albumPhotos = normalizeAlbumPhotos(cached.data.album);
    productsLoaded = true;
    productsVerified = false;
    productsLoadFailed = false;
    renderPublicBanner();
    renderAll();
    submitButton.disabled = true;
    countEl.title = "Zobrazená nabídka je pouze orientační. Objednávku povolíme po ověření aktuálních dat na serveru.";
    return true;
  } catch (error) {
    console.warn("Mezipaměť nabídky se nepodařilo načíst.", error);
    return false;
  }
}

function loadFirstPaintOffer() {
  products = normalizeProducts(FIRST_PAINT_PRODUCTS);
  eggAvailability = null;
  businessSettings = {};
  albumPhotos = [];
  productsLoaded = true;
  productsVerified = false;
  productsLoadFailed = false;
  renderAll();
  submitButton.disabled = true;
  countEl.title = "Nabídka je zobrazená okamžitě. Aktuální sklad a možnost objednání právě ověřujeme na serveru.";
  return true;
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

function currentLoyaltySettings() {
  const source = businessSettings && businessSettings.loyalty || {};
  return {
    enabled: source.enabled !== false,
    eggsRequired: Math.max(1, Number(source.eggsRequired || 100)),
    discountCzk: Math.max(1, Number(source.discountCzk || 20)),
    startDate: String(source.startDate || "2026-08-27")
  };
}

function renderLoyaltyRule() {
  const settings = currentLoyaltySettings();
  const title = document.getElementById("loyaltyRuleTitle");
  const text = document.getElementById("loyaltyRuleText");
  const section = document.getElementById("vernostni-program");
  const orderBox = document.getElementById("loyaltyOrderBox");
  if (section) section.classList.toggle("hidden", !settings.enabled);
  if (orderBox) orderBox.classList.toggle("hidden", !settings.enabled);
  if (title) title.textContent = settings.enabled ? `${settings.eggsRequired} vajec = sleva ${settings.discountCzk} Kč` : "Věrnostní program je pozastavený";
  if (text) text.textContent = settings.enabled
    ? `Za každých ${settings.eggsRequired} skutečně vyzvednutých vajec získáte slevu ${settings.discountCzk} Kč na další objednávku vajec.`
    : "Věrnostní program je nyní dočasně vypnutý.";
}

function normalizeLoyaltyContact(value) {
  return String(value || "").trim().toLowerCase();
}

function validLoyaltyContact(value) {
  const contact = normalizeLoyaltyContact(value);
  if (contact.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
  return contact.replace(/\D/g, "").length >= 9;
}

function rememberLoyaltyContact(value) {
  try {
    if (validLoyaltyContact(value)) localStorage.setItem(LOYALTY_CONTACT_KEY, normalizeLoyaltyContact(value));
  } catch (_) {}
}

function enqueueLoyaltyRequest(action, payload, context, callback) {
  const requestId = `l${Date.now()}${++loyaltyRequestCounter}`;
  loyaltyRequestQueue.push({ action, payload: { ...(payload || {}), requestId }, context, callback, requestId });
  processLoyaltyRequestQueue();
}

function processLoyaltyRequestQueue() {
  if (activeLoyaltyRequest || !loyaltyRequestQueue.length) return;
  const endpoint = backendUrl();
  const job = loyaltyRequestQueue.shift();
  if (!endpoint || !endpoint.endsWith("/exec")) {
    job.callback?.({ ok: false, message: "Věrnostní program není správně propojený." });
    processLoyaltyRequestQueue();
    return;
  }
  const form = document.getElementById("loyaltyBackendForm");
  if (!form) {
    job.callback?.({ ok: false, message: "Věrnostní formulář není připravený." });
    processLoyaltyRequestQueue();
    return;
  }
  activeLoyaltyRequest = job;
  form.action = endpoint;
  document.getElementById("loyaltyAction").value = job.action;
  document.getElementById("loyaltyPayload").value = JSON.stringify(job.payload);
  job.timeout = window.setTimeout(() => {
    if (activeLoyaltyRequest !== job) return;
    activeLoyaltyRequest = null;
    job.callback?.({ ok: false, message: "Ověření věrnostního stavu trvá příliš dlouho. Zkuste to znovu." });
    processLoyaltyRequestQueue();
  }, 25000);
  form.submit();
}

function handleLoyaltyBackendResult(data) {
  const job = activeLoyaltyRequest;
  if (!job || !data || !["loyaltyStatus", "loyaltyJoin"].includes(String(data.kind || ""))) return false;
  if (data.requestId && data.requestId !== job.requestId) return true;
  clearTimeout(job.timeout);
  activeLoyaltyRequest = null;
  job.callback?.(data);
  processLoyaltyRequestQueue();
  return true;
}

function loyaltyStatusMarkup(status) {
  if (!status || !status.enrolled) return "";
  if (!status.active) return "<strong>Věrnostní účet je pozastavený.</strong><br>Pro další informace nás prosím kontaktujte.";
  const required = Math.max(1, Number(status.eggsRequired || currentLoyaltySettings().eggsRequired));
  const balance = Math.max(0, Number(status.balance || 0));
  const percent = Math.max(0, Math.min(100, Math.round((balance / required) * 100)));
  if (status.rewardReady) {
    const countText = Number(status.availableRewards || 0) > 1 ? ` Máte připravené ${Number(status.availableRewards)} odměny.` : "";
    return `<strong>🎉 Máte připravenou slevu ${Number(status.discountCzk || 0)} Kč.</strong>${countText}<br>Sleva se automaticky odečte u další objednávky vajec.<div class="loyalty-progress"><i style="width:${percent}%"></i></div><small>Do další odměny máte ${balance} z ${required} vajec.</small>`;
  }
  return `<strong>${status.firstName ? `${esc(status.firstName)}, ` : ""}máte ${balance} z ${required} vajec.</strong><div class="loyalty-progress"><i style="width:${percent}%"></i></div><small>Do slevy ${Number(status.discountCzk || 0)} Kč zbývá ${Math.max(0, Number(status.eggsNeeded || 0))} vajec.</small>`;
}

function renderPublicLoyaltyStatus(status, errorMessage = "") {
  const joinFields = document.getElementById("loyaltyJoinFields");
  if (!loyaltyPublicStatusEl) return;
  loyaltyPublicStatusEl.className = "loyalty-status";
  if (errorMessage) {
    loyaltyPublicStatusEl.classList.add("error");
    loyaltyPublicStatusEl.textContent = errorMessage;
    return;
  }
  if (!status || !status.enrolled) {
    loyaltyPublicStatusEl.innerHTML = "<strong>Tento kontakt zatím není zapojený.</strong><br>Vyplňte jméno a můžete začít sbírat vajíčka od příštího vyzvednutí.";
    joinFields?.classList.remove("hidden");
    return;
  }
  loyaltyPublicStatusEl.classList.toggle("reward-ready", Boolean(status.rewardReady));
  loyaltyPublicStatusEl.innerHTML = loyaltyStatusMarkup(status);
  joinFields?.classList.add("hidden");
}

function eggCartSubtotal() {
  return Object.entries(cart).reduce((sum, [id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));
    return sum + (product && isEggProduct(product) ? Number(product.price || 0) * Number(quantity || 0) : 0);
  }, 0);
}

function loyaltyPreviewDiscount() {
  const status = loyaltyOrderState;
  if (!currentLoyaltySettings().enabled || !status || !status.enrolled || !status.active || !status.rewardReady) return 0;
  const discount = Math.max(0, Number(status.discountCzk || 0));
  return eggCartSubtotal() >= discount ? discount : 0;
}

function renderOrderLoyaltyStatus() {
  const box = document.getElementById("loyaltyOrderBox");
  if (!box || !loyaltyOrderStatusEl) return;
  box.classList.remove("has-reward", "is-member");
  const settings = currentLoyaltySettings();
  if (!settings.enabled) {
    loyaltyJoinChoiceEl?.classList.add("hidden");
    return;
  }
  if (loyaltyOrderState && loyaltyOrderState.enrolled) {
    loyaltyJoinChoiceEl?.classList.add("hidden");
    box.classList.add("is-member");
    if (!loyaltyOrderState.active) {
      loyaltyOrderStatusEl.textContent = "Váš věrnostní účet je pozastavený. Pro další informace nás prosím kontaktujte.";
      return;
    }
    if (loyaltyOrderState.rewardReady) {
      box.classList.add("has-reward");
      const discount = Number(loyaltyOrderState.discountCzk || settings.discountCzk);
      loyaltyOrderStatusEl.textContent = eggCartSubtotal() >= discount
        ? `✓ Jste členem věrnostního programu. Máte připravenou slevu ${discount} Kč a v tomto nákupu ji automaticky odečteme.`
        : `✓ Jste členem věrnostního programu. Máte připravenou slevu ${discount} Kč. Pro její využití musí být hodnota vajec alespoň ${discount} Kč.`;
    } else {
      loyaltyOrderStatusEl.textContent = `✓ Jste členem věrnostního programu. Máte ${Number(loyaltyOrderState.balance || 0)} z ${Number(loyaltyOrderState.eggsRequired || settings.eggsRequired)} vajec. Do další slevy zbývá ${Number(loyaltyOrderState.eggsNeeded || 0)}.`;
    }
    return;
  }
  loyaltyJoinChoiceEl?.classList.remove("hidden");
  loyaltyOrderStatusEl.textContent = "Pokud jste se právě zaregistrovali, po návratu zadejte svůj telefon nebo e-mail znovu.";
}

function orderLoyaltyContact() {
  const email = normalizeLoyaltyContact(document.getElementById("customerEmail")?.value);
  const phone = normalizeLoyaltyContact(document.getElementById("customerPhone")?.value);
  if (validLoyaltyContact(email)) return email;
  if (validLoyaltyContact(phone)) return phone;
  return "";
}

function lookupOrderLoyalty() {
  clearTimeout(loyaltyLookupTimer);
  loyaltyLookupTimer = window.setTimeout(() => {
    const contact = orderLoyaltyContact();
    if (!contact || !currentLoyaltySettings().enabled) {
      loyaltyOrderState = null;
      renderOrderLoyaltyStatus();
      renderSummary();
      return;
    }
    if (loyaltyOrderStatusEl) loyaltyOrderStatusEl.textContent = "Ověřuji Váš věrnostní stav…";
    enqueueLoyaltyRequest("loyaltyStatus", { contact }, "order", data => {
      if (orderLoyaltyContact() !== contact) return;
      if (!data.ok) {
        loyaltyOrderState = null;
        if (loyaltyOrderStatusEl) loyaltyOrderStatusEl.textContent = data.message || "Věrnostní stav se nepodařilo ověřit.";
      } else {
        loyaltyOrderState = data.loyalty || null;
        if (loyaltyOrderState?.enrolled) rememberLoyaltyContact(contact);
      }
      renderOrderLoyaltyStatus();
      renderSummary();
    });
  }, 650);
}

function lookupPublicLoyalty() {
  const input = document.getElementById("loyaltyLookupContact");
  const button = document.getElementById("loyaltyLookupButton");
  const contact = normalizeLoyaltyContact(input?.value);
  if (!validLoyaltyContact(contact)) {
    renderPublicLoyaltyStatus(null, "Zadejte platný telefon nebo e-mail.");
    input?.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "Ověřuji…";
  loyaltyPublicStatusEl.className = "loyalty-status";
  loyaltyPublicStatusEl.textContent = "Načítám Váš věrnostní stav…";
  enqueueLoyaltyRequest("loyaltyStatus", { contact }, "public", data => {
    button.disabled = false;
    button.textContent = "Zobrazit můj stav";
    if (!data.ok) return renderPublicLoyaltyStatus(null, data.message || "Věrnostní stav se nepodařilo načíst.");
    rememberLoyaltyContact(contact);
    renderPublicLoyaltyStatus(data.loyalty || null);
  });
}

function joinPublicLoyalty() {
  const contactInput = document.getElementById("loyaltyLookupContact");
  const nameInput = document.getElementById("loyaltyJoinName");
  const button = document.getElementById("loyaltyJoinButton");
  const contact = normalizeLoyaltyContact(contactInput?.value);
  const name = String(nameInput?.value || "").trim();
  if (!validLoyaltyContact(contact)) return renderPublicLoyaltyStatus(null, "Zadejte platný telefon nebo e-mail.");
  if (name.length < 2) {
    nameInput?.focus();
    return renderPublicLoyaltyStatus(null, "Vyplňte jméno a příjmení.");
  }
  button.disabled = true;
  button.textContent = "Zapisujeme…";
  enqueueLoyaltyRequest("joinLoyalty", { contact, name }, "join", data => {
    button.disabled = false;
    button.textContent = "Zapojit se do slev";
    if (!data.ok) return renderPublicLoyaltyStatus(null, data.message || "Do programu se nepodařilo zapsat.");
    rememberLoyaltyContact(contact);
    renderPublicLoyaltyStatus(data.loyalty || null);
    if (orderLoyaltyContact() === contact) loyaltyOrderState = data.loyalty || loyaltyOrderState;
    renderSummary();
  });
}

function useProductsCacheFallback(message) {
  const restored = loadProductsCache();
  if (restored && message) feedbackEl.textContent = message;
  return restored;
}

function loadProducts(background = false) {
  if (productsRequestInFlight) return;
  const url = backendUrl();
  const hadCurrentProducts = productsLoaded && products.length > 0;

  if (!hadCurrentProducts && !background) showProductsLoading();

  if (!url || !url.endsWith("/exec")) {
    if (!hadCurrentProducts && !useProductsCacheFallback("Zobrazuji poslední uloženou nabídku.")) {
      showProductsLoadError("Aktuální nabídku se nepodařilo načíst – chybí propojení se serverem.");
    }
    return;
  }

  productsRequestInFlight = true;
  const requestNumber = ++productsRequestCounter;
  const callbackName = `PDP_PRODUCTS_CALLBACK_${requestNumber}_${Date.now()}`;
  let finished = false;
  let slowMessage = "";

  const cleanup = () => {
    clearTimeout(slowTimeout);
    clearTimeout(hardTimeout);
    document.getElementById(`jsonp-${callbackName}`)?.remove();
    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
  };

  const fail = message => {
    if (finished) return;
    finished = true;
    productsRequestInFlight = false;
    cleanup();

    if (hadCurrentProducts) {
      feedbackEl.textContent = productsVerified
        ? "Aktuální nabídku se nepodařilo obnovit. Zkuste to znovu za chvíli."
        : "Server nyní neodpověděl. Starý počet vajec proto nezobrazujeme jako aktuální.";
    } else if (!useProductsCacheFallback("Server nyní neodpověděl. Starý počet vajec nezobrazujeme jako aktuální.")) {
      showProductsLoadError(message || "Aktuální nabídku se nepodařilo načíst. Zkuste to znovu.");
    }
  };

  // Po šesti sekundách pouze zobrazíme informaci. Odpověď nezahodíme — stará
  // verze ji po 10 s ignorovala a v telefonu tak mohlo zůstat chybných 54 ks.
  const slowTimeout = setTimeout(() => {
    if (finished) return;
    slowMessage = hadCurrentProducts
      ? "Ověřuji aktuální počet vajec na serveru…"
      : "Server odpovídá pomaleji, stále ověřuji aktuální nabídku…";
    feedbackEl.textContent = slowMessage;
  }, 6000);

  const hardTimeout = setTimeout(() => {
    fail("Načtení aktuální nabídky trvá příliš dlouho. Zkuste to znovu.");
  }, 30000);

  window[callbackName] = data => {
    if (finished) return;
    if (!data || !data.ok || !Array.isArray(data.products)) {
      fail("Server nevrátil aktuální nabídku. Zkuste načtení zopakovat.");
      return;
    }

    finished = true;
    productsRequestInFlight = false;
    cleanup();
    if (slowMessage && feedbackEl.textContent === slowMessage) feedbackEl.textContent = "";

    products = normalizeProducts(data.products);
    eggAvailability = data.availability || null;
    businessSettings = data.settings || {};
    albumPhotos = normalizeAlbumPhotos(data.album);
    saveProductsCache(data);
    productsLoaded = true;
    productsVerified = true;
    productsLoadFailed = false;
    countEl.removeAttribute("title");
    renderPublicBanner();

    Object.keys(cart).forEach(id => {
      const product = products.find(item => String(item.id) === String(id));
      if (!product || !product.visible || (product.soldOut && !product.preorder)) {
        delete cart[id];
        return;
      }
      const limit = remainingCapacity(product);
      if (Number(cart[id] || 0) > limit) cart[id] = limit;
      if (!cart[id]) delete cart[id];
    });

    renderAll();
  };

  appendJsonp(
    `${url}?action=products&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`,
    callbackName,
    () => fail("Aktuální nabídku se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.")
  );
}

function eggQuantity() {
  return Object.entries(cart).reduce((sum, [id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));
    return sum + (product && isEggProduct(product) ? Number(quantity || 0) : 0);
  }, 0);
}

function pickupBlockActive() {
  return Boolean(businessSettings.ordersPaused && businessSettings.pauseFrom && businessSettings.pauseTo);
}

function isPickupDateBlocked(dateKey) {
  if (!pickupBlockActive() || !dateKey) return false;
  return dateKey >= businessSettings.pauseFrom && dateKey <= businessSettings.pauseTo;
}

function nextPickupDateOutsideBlock(dateKey) {
  if (!isPickupDateBlocked(dateKey)) return dateKey;
  return addDaysKey(businessSettings.pauseTo, 1);
}

function vacationNoticeText() {
  if (!pickupBlockActive()) return "";
  const firstAfter = addDaysKey(businessSettings.pauseTo, 1);
  return businessSettings.pauseMessage || `V době od ${localDate(businessSettings.pauseFrom)} do ${localDate(businessSettings.pauseTo)} nebude možné objednávky vyzvednout. Nejbližší vyzvednutí po dovolené je ${localDate(firstAfter)}.`;
}


function displayedAvailableStock(product) {
  if (!product) return 0;

  // Náhled ani místní cache se nesmí tvářit jako živý sklad. Do potvrzení
  // serverem proto u všech produktů zobrazíme pouze stav ověřování.
  if (!productsVerified) return null;

  if (isEggProduct(product) && eggAvailability && Array.isArray(eggAvailability.days)) {
    const today = eggAvailability.days.find(day => day.date === todayKey()) || eggAvailability.days[0];
    if (today) return Math.max(0, Math.floor(Number(today.maxAdditional || 0)));
  }

  return Math.max(0, Math.floor(Number(product.availableStock || 0)));
}

function remainingCapacity(product) {
  if (!product) return 0;

  // Z neověřeného prvního náhledu ani cache nelze nic vložit do košíku.
  if (!productsVerified) return 0;

  // Vejce se plánují dopředu podle aktuální zásoby + denní snášky.
  // Zákazník proto může objednat více, než je právě fyzicky skladem.
  if (isEggProduct(product)) {
    const plannedMaximum = eggAvailability && Array.isArray(eggAvailability.days)
      ? Math.max(0, ...eggAvailability.days.map(day => Math.floor(Number(day.maxAdditional || 0))))
      : 0;
    const technicalMaximum = product.capacity
      ? Math.max(0, Math.floor(Number(product.capacity || 0) - Number(product.reserved || 0)))
      : 500;
    return Math.min(500, technicalMaximum, plannedMaximum || technicalMaximum);
  }

  // Předobjednávky se řídí rezervační kapacitou, ne dnešním fyzickým skladem.
  if (product.preorder) {
    return product.capacity
      ? Math.max(0, Math.floor(Number(product.capacity || 0) - Number(product.reserved || 0)))
      : 500;
  }

  // Běžný produkt nelze objednat nad skutečně dostupný sklad.
  const available = Math.max(0, Math.floor(Number(product.availableStock || 0)));
  if (!product.capacity) return Math.min(500, available);
  const capacityLeft = Math.max(0, Math.floor(Number(product.capacity || 0) - Number(product.reserved || 0)));
  return Math.min(available, capacityLeft);
}

function nonEggLeadMinimum() {
  let minimum = todayKey();

  Object.entries(cart).forEach(([id, quantity]) => {
    if (!quantity) return;
    const product = products.find(item => String(item.id) === String(id));
    if (!product || isEggProduct(product)) return;

    const leadMinimum = addDaysKey(todayKey(), Number(product.leadDays || 0));
    if (leadMinimum > minimum) minimum = leadMinimum;
    if (product.preorder && selectedSplitMode() !== "split" && product.restock && product.restock > minimum) minimum = product.restock;
  });

  return nextPickupDateOutsideBlock(minimum);
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
    day.date >= leadMinimum && !isPickupDateBlocked(day.date) && Number(day.maxAdditional || 0) >= eggs
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

function updatePickupAvailability(forceNearest = false) {
  if (!productsLoaded) {
    availabilityBlocked = true;
    availabilityEl.textContent = "";
    availabilityEl.classList.add("hidden");
    submitButton.disabled = true;
    return;
  }

  const result = calculatePickupMinimum();
  availabilityBlocked = result.blocked;

  pickupInput.min = result.minimum || todayKey();
  const hasEggs = eggQuantity() > 0;
  if (hasEggs && eggAvailability && eggAvailability.horizonEnd) pickupInput.max = eggAvailability.horizonEnd;
  else pickupInput.removeAttribute("max");

  const previousAutoPickupDate = autoPickupDate;
  const shouldSetAutomaticDate = Boolean(
    result.minimum && (
      forceNearest ||
      !pickupInput.value ||
      pickupInput.value < result.minimum ||
      pickupInput.value === previousAutoPickupDate ||
      isPickupDateBlocked(pickupInput.value)
    )
  );

  if (shouldSetAutomaticDate) {
    pickupInput.value = result.minimum;
  }

  autoPickupDate = result.minimum || "";

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

  if (pickupBlockActive()) {
    const vacationText = vacationNoticeText();
    if (vacationText) {
      availabilityEl.textContent = vacationText;
      availabilityEl.classList.remove("hidden");
      availabilityEl.classList.remove("availability-error");
    }
  }
  submitButton.disabled = submissionPending || availabilityBlocked || !productsVerified;
}

function formatRestock(value) {
  return localDate(value);
}


function preorderProductsInCart() {
  return Object.entries(cart).map(([id, qty]) => {
    const product = products.find(item => String(item.id) === String(id));
    return product && qty > 0 && product.preorder ? product : null;
  }).filter(Boolean);
}

function regularProductsInCart() {
  return Object.entries(cart).map(([id, qty]) => {
    const product = products.find(item => String(item.id) === String(id));
    return product && qty > 0 && !product.preorder ? product : null;
  }).filter(Boolean);
}

function selectedSplitMode() {
  return document.querySelector('input[name="splitOrder"]:checked')?.value || "together";
}

function selectedContactMethod() {
  return document.querySelector('input[name="contactMethod"]:checked')?.value || "SMS";
}

function latestPreorderDate() {
  const date = preorderProductsInCart().map(p => p.restock || p.preorderDate || "").filter(Boolean).sort().pop() || "";
  return nextPickupDateOutsideBlock(date);
}

function renderSplitOptions(forceNearest = false) {
  const mixed = preorderProductsInCart().length > 0 && regularProductsInCart().length > 0;
  const box = document.getElementById("splitOrderBox");
  if (box) box.classList.toggle("hidden", !mixed);
  if (!mixed) {
    const together = document.querySelector('input[name="splitOrder"][value="together"]');
    if (together) together.checked = true;
  }
  const isSplit = mixed && selectedSplitMode() === "split";
  const label = document.getElementById("pickupDateLabel");
  if (label) label.textContent = isSplit ? "Termín prvního vyzvednutí" : "Termín vyzvednutí";
  const summary = document.getElementById("splitPickupSummary");
  if (summary) {
    summary.classList.toggle("hidden", !isSplit);
    if (isSplit) {
      const rules = calculatePickupMinimum();
      const second = latestPreorderDate();
      summary.innerHTML = `<strong>Objednávka bude rozdělena:</strong><br>1. dostupné produkty: ${rules.minimum ? esc(localDate(rules.minimum)) : "nejbližší možný termín"}<br>2. předobjednané produkty: ${second ? esc(localDate(second)) : "po naskladnění"}`;
      if (forceNearest && rules.minimum) {
        pickupInput.value = rules.minimum;
        feedbackEl.textContent = `První vyzvednutí bylo automaticky nastaveno na nejbližší možný termín ${localDate(rules.minimum)}.`;
      }
    }
  }
}

function renderPublicBanner() {
  const el = document.getElementById("publicBanner");
  if (!el) return;
  const today = todayKey();
  const activeByDate = (!businessSettings.bannerFrom || today >= businessSettings.bannerFrom) &&
    (!businessSettings.bannerTo || today <= businessSettings.bannerTo);
  if (businessSettings.bannerEnabled && activeByDate && (businessSettings.bannerTitle || businessSettings.bannerText)) {
    el.className = `public-banner ${businessSettings.bannerStyle || "yellow"}`;
    el.innerHTML = `${businessSettings.bannerTitle ? `<strong>${esc(businessSettings.bannerTitle)}</strong>` : ""}${businessSettings.bannerText ? `<p>${esc(businessSettings.bannerText)}</p>` : ""}`;
  } else {
    el.className = "public-banner hidden";
    el.innerHTML = "";
  }
}

function ordersArePaused() {
  return false;
}

function subscribeStockWatch(product, article) {
  const input = article.querySelector("[data-watch-email]");
  const feedback = article.querySelector("[data-watch-feedback]");
  const email = String(input?.value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    feedback.textContent = "Zadejte platnou e-mailovou adresu.";
    input?.focus();
    return;
  }
  const form = document.getElementById("backendOrderForm");
  form.action = backendUrl();
  form.querySelector('[name="action"]').value = "subscribeStock";
  document.getElementById("backendPayload").value = JSON.stringify({ productId: String(product.id), email });
  feedback.textContent = "Ukládám hlídání…";
  watchPending = { feedback, input };
  form.submit();
  setTimeout(() => {
    if (watchPending && watchPending.feedback === feedback) {
      feedback.textContent = "Potvrzení trvá déle. Zkuste hlídání případně odeslat znovu.";
      watchPending = null;
    }
  }, 20000);
}

function renderProducts() {
  if (!productsLoaded) {
    if (!productsLoadFailed) showProductsLoading();
    return;
  }

  productsEl.innerHTML = "";

  const visibleProducts = activeProducts();
  if (!visibleProducts.length) {
    productsEl.innerHTML = '<div class="empty">Momentálně nejsou k dispozici žádné produkty.</div>';
  }

  visibleProducts.forEach(product => {
    const article = document.createElement("article");
    article.className = "product";
    article.dataset.productId = String(product.id);
    const imageSrc = resolveProductImage(product);
    const displayedStock = displayedAvailableStock(product);
    const stockHtml = displayedStock === null
      ? `<span class="stock-checking" role="status">${isEggProduct(product) ? "Ověřuji aktuální počet vajec…" : "Ověřuji aktuální dostupnost…"}</span>`
      : `<strong>${displayedStock} ${esc(product.stockUnit || "ks")}</strong>`;
    article.innerHTML = `
      <div class="product-row">
        <div class="product-media"><img src="${esc(imageSrc)}" alt="${esc(product.name)}" loading="lazy" onerror="this.onerror=null;this.src='assets/images/products/placeholder.webp'"></div>
        <div class="product-body">
          <h3>${esc(product.name)}</h3>
          <p class="lead">${esc(product.short)}</p>
          <div class="story">${esc(product.detail)}</div>
          <div class="price">${money(product.price)} <small>/ ${esc(product.unit)}</small></div>
          <div class="stock-line">📦 Skladem: ${stockHtml}</div>
          ${isEggProduct(product) ? `<div class="notice egg-info">Každý den přibývají čerstvá vejce od našich slepiček. Pokud dnes není požadované množství skladem, systém Vám automaticky nabídne nejbližší možný termín vyzvednutí.</div><div class="notice" data-egg-pickup-notice>Po zvolení počtu vajec se zobrazí nejbližší možný termín vyzvednutí.</div>` : ""}
          ${!isEggProduct(product) && product.leadDays ? `<div class="notice">Tento produkt je potřeba objednat minimálně ${Math.max(0, Math.floor(Number(product.leadDays) || 0))} dní předem.</div>` : ""}
          ${productsVerified && product.preorder ? `<div class="notice"><strong>Předobjednávka.</strong> Předpokládané naskladnění: ${product.restock ? esc(formatRestock(nextPickupDateOutsideBlock(product.restock))) : "termín bude upřesněn"}.${product.capacity ? ` K rezervaci zbývá <strong>${Math.max(0, product.capacity - product.reserved)} z ${product.capacity} ${esc(product.unit)}</strong>.` : ""}</div>` : (productsVerified && (product.soldOut || (!isEggProduct(product) && product.availableStock <= 0)) ? `<div class="notice"><strong>${esc(product.soldOutText || "Momentálně vyprodáno")}</strong>${product.restock ? `. Předpokládané doplnění: ${esc(formatRestock(product.restock))}.` : "."}</div><div class="stock-watch"><strong>Hlídací pes</strong><p class="field-help">Pošleme vám jednorázový e-mail, až bude produkt znovu skladem.</p><div class="watch-row"><input type="email" data-watch-email placeholder="vas@email.cz"><button type="button" data-watch-button>Hlídat naskladnění</button></div><div class="field-help" data-watch-feedback></div></div>` : "")}
          <div class="product-controls"></div>
        </div>
      </div>`;

    productsEl.appendChild(article);

    const watchButton = article.querySelector("[data-watch-button]");
    if (watchButton) {
      watchButton.addEventListener("click", () => subscribeStockWatch(product, article));
    }
    const controls = article.querySelector(".product-controls");
    if (!productsVerified) {
      const waiting = document.createElement("div");
      waiting.className = "notice";
      waiting.textContent = isEggProduct(product)
        ? "Počet vajec právě ověřujeme. Výběr se zpřístupní hned po načtení aktuálního stavu."
        : "Aktuální dostupnost právě ověřujeme. Výběr se zpřístupní hned po načtení.";
      controls.appendChild(waiting);
      return;
    }
    if ((product.soldOut || (!isEggProduct(product) && product.availableStock <= 0)) && !product.preorder) return;

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
    const quantityLabel = document.createElement("span");
    quantityLabel.className = "muted";
    quantityLabel.textContent = product.unit === "kus" ? "Celkový počet kusů" : "Množství";
    row.appendChild(quantityLabel);

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
    input.max = String(remainingCapacity(product));
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
  const product = products.find(item => String(item.id) === String(id));
  const limit = remainingCapacity(product);
  const previousQuantity = Math.max(0, Number(cart[id] || 0));
  const requested = Math.max(0, previousQuantity + amount);
  const newQuantity = Math.min(limit, requested);
  cart[id] = newQuantity;
  if (requested > limit) feedbackEl.textContent = `U produktu ${product.name} lze nyní rezervovat nejvýše ${limit} ${product.unit}.`;
  if (!cart[id]) delete cart[id];
  updateQuantityInput(id);

  // Při snížení nebo odstranění položky se musí termín vždy přepočítat dolů.
  // Tím se odstraní starý vzdálený termín po odebrání předobjednávky.
  renderSummary(newQuantity < previousQuantity);
}

function setQty(id, value) {
  const product = products.find(item => String(item.id) === String(id));
  const limit = remainingCapacity(product);
  const previousQuantity = Math.max(0, Number(cart[id] || 0));
  const requested = Math.max(0, Math.floor(Number(value) || 0));
  const quantity = Math.min(limit, requested);
  if (requested > limit) feedbackEl.textContent = `U produktu ${product.name} lze nyní rezervovat nejvýše ${limit} ${product.unit}.`;
  if (quantity) cart[id] = quantity;
  else delete cart[id];

  // Stejná oprava platí i při ručním přepsání počtu na nižší hodnotu nebo nulu.
  renderSummary(quantity < previousQuantity);
}

function renderSummary(forceNearestPickup = false) {
  if (!productsLoaded) {
    countEl.textContent = productsLoadFailed ? "Nedostupné" : "Načítám…";
    summaryEl.className = "muted";
    summaryEl.textContent = productsLoadFailed
      ? "Objednávku lze vytvořit až po načtení aktuální nabídky."
      : "Nejdřív načítáme aktuální nabídku.";
    totalEl.textContent = "0 Kč";
    submitButton.disabled = true;
    return;
  }

  const entries = Object.entries(cart);
  const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  const cartSubtotal = entries.reduce((sum, [id, quantity]) => {
    const product = products.find(item => String(item.id) === String(id));
    return sum + (product ? product.price * quantity : 0);
  }, 0);
  const loyaltyDiscount = loyaltyPreviewDiscount();
  countEl.textContent = productsVerified
    ? `${count} ${count === 1 ? "položka" : count > 1 && count < 5 ? "položky" : "položek"}`
    : "Aktualizuji…";

  if (!entries.length) {
    summaryEl.className = "muted";
    summaryEl.textContent = "Zatím nemáte nic vybráno.";
    totalEl.textContent = "0 Kč";
  } else {
    summaryEl.className = "";
    summaryEl.innerHTML = "";
    entries.forEach(([id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      if (!product) return;
      const rowTotal = product.price * quantity;
      const row = document.createElement("div");
      row.className = "summary-row";
      const label = document.createElement("span");
      const price = document.createElement("strong");
      label.textContent = `${quantity}× ${product.name}`;
      price.textContent = money(rowTotal);
      row.append(label, price);
      summaryEl.appendChild(row);
    });

    if (loyaltyDiscount > 0) {
      const discountRow = document.createElement("div");
      discountRow.className = "summary-row loyalty-discount-row";
      discountRow.innerHTML = `<span>Věrnostní sleva na vejce</span><strong>−${money(loyaltyDiscount)}</strong>`;
      summaryEl.appendChild(discountRow);
    }
    totalEl.textContent = money(Math.max(0, cartSubtotal - loyaltyDiscount));
  }

  const mobileCartBar = document.getElementById("mobileCartBar");
  const mobileCartText = document.getElementById("mobileCartText");
  if (mobileCartBar && mobileCartText) {
    mobileCartBar.classList.toggle("hidden", count <= 0);
    mobileCartText.textContent = `${count} ${count === 1 ? "položka" : count < 5 ? "položky" : "položek"} · ${money(Math.max(0, cartSubtotal - loyaltyDiscount))}`;
  }

  renderOrderLoyaltyStatus();
  renderSplitOptions();
  updatePickupAvailability(forceNearestPickup);
}

function albumThumbnailUrl(url) {
  return String(url || "").replace(/=w\d+$/, "=w700");
}

function closePhotoLightbox() {
  const modal = document.getElementById("photoLightbox");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("photo-lightbox-open");
  activeAlbumPhotoIndex = -1;
}

function showPhotoLightbox(index) {
  if (!albumPhotos.length) return;
  const normalizedIndex = (Number(index) + albumPhotos.length) % albumPhotos.length;
  const photo = albumPhotos[normalizedIndex];
  const modal = document.getElementById("photoLightbox");
  const image = document.getElementById("photoLightboxImage");
  const title = document.getElementById("photoLightboxTitle");
  const caption = document.getElementById("photoLightboxCaption");
  if (!modal || !image || !title || !caption) return;

  activeAlbumPhotoIndex = normalizedIndex;
  image.src = photo.image;
  image.alt = photo.title || "Fotografie z Pod Prosečí";
  title.textContent = photo.title || "Fotografie z Pod Prosečí";
  caption.textContent = photo.caption || "";
  caption.classList.toggle("hidden", !photo.caption);
  modal.classList.remove("hidden");
  document.body.classList.add("photo-lightbox-open");
  const single = albumPhotos.length < 2;
  document.getElementById("photoLightboxPrevious")?.classList.toggle("hidden", single);
  document.getElementById("photoLightboxNext")?.classList.toggle("hidden", single);
}

function renderPhotoAlbum() {
  const section = document.getElementById("fotoalbum");
  const grid = document.getElementById("photoAlbumGrid");
  if (!section || !grid) return;
  if (!albumPhotos.length) {
    section.classList.add("hidden");
    grid.innerHTML = "";
    closePhotoLightbox();
    return;
  }

  section.classList.remove("hidden");
  grid.innerHTML = albumPhotos.map((photo, index) => `
    <button class="photo-album-card" type="button" data-album-photo-index="${index}" aria-label="Otevřít fotografii ${esc(photo.title || String(index + 1))}">
      <img src="${esc(albumThumbnailUrl(photo.image))}" alt="${esc(photo.title || "Fotografie z Pod Prosečí")}" loading="lazy" decoding="async">
      ${(photo.title || photo.caption) ? `<span><strong>${esc(photo.title || "Fotografie")}</strong>${photo.caption ? `<small>${esc(photo.caption)}</small>` : ""}</span>` : ""}
    </button>`).join("");
  grid.querySelectorAll("[data-album-photo-index]").forEach(button => {
    button.onclick = () => showPhotoLightbox(Number(button.dataset.albumPhotoIndex));
  });
}

function renderAll() {
  renderLoyaltyRule();
  renderProducts();
  renderSummary();
  renderPhotoAlbum();
}

function orderSuccessMessage(data) {
  const appliedDiscount = Math.max(0, Number(data?.loyalty?.discountApplied || 0));
  return appliedDiscount > 0
    ? `Objednávka byla odeslána. Věrnostní sleva ${appliedDiscount} Kč byla automaticky započítána.`
    : "Objednávka byla odeslána. Brzy se vám ozveme.";
}

function cleanupOrderReceiptRequest() {
  clearTimeout(orderReceiptRequestTimer);
  orderReceiptRequestTimer = null;
  if (!orderReceiptCallbackName) return;

  const callbackName = orderReceiptCallbackName;
  orderReceiptCallbackName = "";
  const script = document.getElementById(`jsonp-${callbackName}`);
  if (script) script.remove();
  try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
}

function stopOrderReceiptPolling() {
  clearTimeout(orderReceiptPollTimer);
  orderReceiptPollTimer = null;
  cleanupOrderReceiptRequest();
  orderReceiptPollStartedAt = 0;
}

function orderReceiptVerificationTimedOut() {
  stopOrderReceiptPolling();
  if (!submissionPending || submissionFinished) return;
  submissionPending = false;
  submitButton.disabled = availabilityBlocked || !productsVerified;
  submitButton.textContent = "Odeslat objednávku";
  feedbackEl.textContent = "Potvrzení trvá nezvykle dlouho. Objednávka může být už uložená; při opakování ji systém podle stejného ID nevytvoří podruhé.";
}

function scheduleOrderReceiptCheck(delay) {
  clearTimeout(orderReceiptPollTimer);
  if (!submissionPending || submissionFinished || !currentOrderRequestId) return;
  orderReceiptPollTimer = setTimeout(checkOrderReceipt, Math.max(0, Number(delay || 0)));
}

function checkOrderReceipt() {
  if (!submissionPending || submissionFinished || !currentOrderRequestId) return;
  if (Date.now() - orderReceiptPollStartedAt >= 75000) {
    orderReceiptVerificationTimedOut();
    return;
  }

  cleanupOrderReceiptRequest();
  const callbackName = `PDP_ORDER_RECEIPT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  orderReceiptCallbackName = callbackName;

  const completeAttempt = data => {
    if (orderReceiptCallbackName !== callbackName) return;
    cleanupOrderReceiptRequest();
    if (data && data.ok && data.found) {
      finish(true, orderSuccessMessage(data));
      return;
    }
    scheduleOrderReceiptCheck(3000);
  };

  window[callbackName] = completeAttempt;
  const query = new URLSearchParams({
    action: "orderReceipt",
    requestId: currentOrderRequestId,
    callback: callbackName,
    t: String(Date.now())
  });
  appendJsonp(`${backendUrl()}?${query.toString()}`, callbackName, () => completeAttempt(null));
  orderReceiptRequestTimer = setTimeout(() => completeAttempt(null), 10000);
}

function startOrderReceiptPolling() {
  stopOrderReceiptPolling();
  orderReceiptPollStartedAt = Date.now();
  scheduleOrderReceiptCheck(7000);
}

function finish(success, message) {
  if (submissionFinished) return;

  submissionFinished = true;
  submissionPending = false;
  clearTimeout(submitTimeout);
  stopOrderReceiptPolling();
  submitButton.textContent = "Odeslat objednávku";
  feedbackEl.textContent = message;

  if (success) {
    currentOrderRequestId = "";
    Object.keys(cart).forEach(key => delete cart[key]);
    autoPickupDate = "";
    ["customerName", "customerPhone", "customerEmail", "pickupDate", "customerNote"].forEach(id => {
      document.getElementById(id).value = "";
    });
    loyaltyOrderState = null;
    if (loyaltyOptInEl) loyaltyOptInEl.checked = false;
    renderOrderLoyaltyStatus();
    loadProducts();
  } else {
    submitButton.disabled = availabilityBlocked || !productsVerified;
    loadProducts();
  }
}

function isTrustedAppsScriptOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && (
      parsed.hostname === "script.google.com" ||
      parsed.hostname.endsWith(".googleusercontent.com")
    );
  } catch (_) {
    return false;
  }
}

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "PDP_BACKEND_RESULT") return;

  if (activeLoyaltyRequest && ["loyaltyStatus", "loyaltyJoin"].includes(String(data.kind || ""))) {
    const loyaltyFrame = document.getElementById("loyaltySubmitFrame");
    const directLoyaltyMessage = Boolean(loyaltyFrame && event.source === loyaltyFrame.contentWindow);
    if (!directLoyaltyMessage && !isTrustedAppsScriptOrigin(event.origin)) return;
    handleLoyaltyBackendResult(data);
    return;
  }

  if (!submissionPending && !watchPending) return;

  // HtmlService vrací výsledek z vnořeného rámce Googlu. Zdroj proto
  // nemusí být přímo orderSubmitFrame.contentWindow.
  const frame = document.getElementById("orderSubmitFrame");
  const directFrameMessage = Boolean(frame && event.source === frame.contentWindow);
  if (!directFrameMessage && !isTrustedAppsScriptOrigin(event.origin)) return;

  if (watchPending) {
    watchPending.feedback.textContent = data.ok ? "Hlídací pes je zapnutý. Až bude produkt skladem, přijde vám jednorázový e-mail." : (data.message || "Hlídacího psa se nepodařilo zapnout.");
    if (data.ok) watchPending.input.value = "";
    watchPending = null;
    return;
  }
  finish(Boolean(data.ok), data.ok ? orderSuccessMessage(data) : (data.message || "Objednávku se nepodařilo odeslat."));
});

function orderRequestId() {
  if (currentOrderRequestId) return currentOrderRequestId;
  currentOrderRequestId = (window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `o${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return currentOrderRequestId;
}

submitButton.addEventListener("click", () => {
  if (!productsLoaded || !productsVerified) {
    feedbackEl.textContent = "Počkejte na ověření aktuální nabídky a cen na serveru.";
    return;
  }

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
  const emailInput = document.getElementById("customerEmail");
  const email = emailInput.value.trim().toLowerCase();
  const pickup = pickupInput.value;
  const note = document.getElementById("customerNote").value.trim();
  const pickupRules = calculatePickupMinimum();

  if (!items.length) return feedbackEl.textContent = "Nejprve vyberte alespoň jeden produkt.";
  if (!name) return feedbackEl.textContent = "Vyplňte jméno.";
  if (!phone) return feedbackEl.textContent = "Vyplňte telefon.";
  if (!email) return feedbackEl.textContent = "Vyplňte e-mail.";
  if (!emailInput.checkValidity() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    emailInput.focus();
    return feedbackEl.textContent = "Zadejte platnou e-mailovou adresu.";
  }
  if (pickupRules.blocked) return feedbackEl.textContent = pickupRules.message;
  if (!pickup) return feedbackEl.textContent = "Vyberte termín vyzvednutí.";
  if (isPickupDateBlocked(pickup)) return feedbackEl.textContent = `V tomto termínu nebude možné objednávku vyzvednout. Zvolte nejdříve ${localDate(addDaysKey(businessSettings.pauseTo, 1))}.`;
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
  const splitMode = selectedSplitMode();
  const preorderPickup = latestPreorderDate();
  const contactMethod = selectedContactMethod();
  payload.value = JSON.stringify({
    name, phone, email, pickup, note, source: "Web", items,
    contactMethod,
    splitOrder: splitMode === "split",
    preorderPickup: preorderPickup,
    loyaltyOptIn: Boolean(loyaltyOrderState?.enrolled),
    requestId: orderRequestId(),
    visitorId: visitorId(),
    visitSource: detectVisitSource()
  });

  submissionPending = true;
  submissionFinished = false;
  submitButton.disabled = true;
  submitButton.textContent = "Odesílám…";
  feedbackEl.textContent = "Odesílám objednávku a ověřuji dostupnost…";
  form.submit();
  startOrderReceiptPolling();

  clearTimeout(submitTimeout);
  submitTimeout = setTimeout(() => {
    if (submissionPending && !submissionFinished) {
      submitButton.textContent = "Ověřuji objednávku…";
      feedbackEl.textContent = "Objednávka byla odeslána. Ještě ověřujeme její uložení…";
    }
  }, 25000);
});

document.querySelectorAll('input[name="splitOrder"]').forEach(input => input.addEventListener("change", () => {
  renderSplitOptions(selectedSplitMode() === "split");
  updatePickupAvailability();
}));
pickupInput.addEventListener("change", () => {
  const rules = calculatePickupMinimum();
  if (isPickupDateBlocked(pickupInput.value)) {
    const next = addDaysKey(businessSettings.pauseTo, 1);
    pickupInput.value = next;
    autoPickupDate = next;
    feedbackEl.textContent = `Zvolený termín spadá do dovolené. Termín byl změněn na ${localDate(next)}.`;
  } else if (rules.minimum && pickupInput.value < rules.minimum) {
    feedbackEl.textContent = `Nejbližší možný termín je ${localDate(rules.minimum)}.`;
    pickupInput.value = rules.minimum;
    autoPickupDate = rules.minimum;
  } else {
    // Zákazník zvolil pozdější termín ručně. Ten při dalších změnách košíku zachováme.
    autoPickupDate = "";
  }
});

["customerPhone", "customerEmail"].forEach(id => {
  const input = document.getElementById(id);
  input?.addEventListener("input", lookupOrderLoyalty);
  input?.addEventListener("blur", lookupOrderLoyalty);
});
loyaltyOptInEl?.addEventListener("change", () => {
  renderOrderLoyaltyStatus();
  renderSummary();
});
document.getElementById("loyaltyLookupButton")?.addEventListener("click", lookupPublicLoyalty);
document.getElementById("loyaltyJoinButton")?.addEventListener("click", joinPublicLoyalty);
document.getElementById("loyaltyLookupContact")?.addEventListener("keydown", event => {
  if (event.key === "Enter") lookupPublicLoyalty();
});
document.getElementById("loyaltyJoinName")?.addEventListener("keydown", event => {
  if (event.key === "Enter") joinPublicLoyalty();
});

document.getElementById("photoLightboxClose")?.addEventListener("click", closePhotoLightbox);
document.getElementById("photoLightboxPrevious")?.addEventListener("click", () => showPhotoLightbox(activeAlbumPhotoIndex - 1));
document.getElementById("photoLightboxNext")?.addEventListener("click", () => showPhotoLightbox(activeAlbumPhotoIndex + 1));
document.getElementById("photoLightbox")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) closePhotoLightbox();
});
document.addEventListener("keydown", event => {
  if (activeAlbumPhotoIndex < 0) return;
  if (event.key === "Escape") closePhotoLightbox();
  if (event.key === "ArrowLeft") showPhotoLightbox(activeAlbumPhotoIndex - 1);
  if (event.key === "ArrowRight") showPhotoLightbox(activeAlbumPhotoIndex + 1);
});

const cachedOfferShown = loadProductsCache();
const firstOfferShown = cachedOfferShown || loadFirstPaintOffer();
if (!firstOfferShown) showProductsLoading();
loadProducts(Boolean(firstOfferShown));

try {
  const rememberedLoyaltyContact = localStorage.getItem(LOYALTY_CONTACT_KEY) || "";
  const lookupInput = document.getElementById("loyaltyLookupContact");
  if (lookupInput && validLoyaltyContact(rememberedLoyaltyContact)) {
    lookupInput.value = rememberedLoyaltyContact;
    window.setTimeout(lookupPublicLoyalty, 1800);
  }
} catch (_) {}

// Nabídka a hlavně vejce mají přednost před zápisem návštěvnosti. Tracker
// spustíme až ve volné chvíli, aby při prvním otevření nesoutěžil se skladem.
if (typeof window.requestIdleCallback === "function") {
  window.requestIdleCallback(trackVisitOnce, { timeout: 1500 });
} else {
  setTimeout(trackVisitOnce, 500);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadProducts(true);
});
window.addEventListener("focus", () => loadProducts(true));
setInterval(() => {
  if (!document.hidden) loadProducts(true);
}, 30000);
