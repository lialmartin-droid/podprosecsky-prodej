window.PDP_ADMIN_VERSION = "20.4";
console.info("Podprosečské produkty – admin.js V20.3 – spolehlivé vyloučení vlastních návštěv");

let products = [];
let orders = [];
let eggSettings = null;
let eggAvailability = null;
let businessSettings = {};
let visitStats = null;
let token = sessionStorage.getItem("pdp-admin-token") || "";
let requestTimer = null;
let activePost = null;
let postCooldown = false;
const postQueue = [];
const ADMIN_CACHE_KEY = "pdp-admin-data-v2";
const ADMIN_VISIT_EXCLUDE_KEY = "pdp-admin-exclude-visits";
const VISITOR_ID_KEY = "pdp-visitor-id-v1";
const ADMIN_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const $ = selector => document.querySelector(selector);
const money = value => `${Number(value || 0)} Kč`;
const esc = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function url() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function adminVisitorId() {
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
    return "";
  }
}

function isThisDeviceExcluded() {
  try { return localStorage.getItem(ADMIN_VISIT_EXCLUDE_KEY) === "1"; } catch (_) { return false; }
}

function updateVisitExclusionUi(message = "") {
  const checkbox = $("#excludeMyVisits");
  const status = $("#visitExclusionStatus");
  if (checkbox) checkbox.checked = isThisDeviceExcluded();
  if (status) {
    status.textContent = message || (isThisDeviceExcluded()
      ? "Toto zařízení je vyloučeno ze statistik návštěvnosti."
      : "Toto zařízení se nyní do návštěvnosti započítává.");
    status.classList.toggle("visit-excluded-ok", isThisDeviceExcluded());
  }
}

function markThisDeviceAsAdminVisitor(syncBackend = false) {
  try { localStorage.setItem(ADMIN_VISIT_EXCLUDE_KEY, "1"); } catch (_) {}
  updateVisitExclusionUi();
  if (syncBackend && token) {
    const visitorId = adminVisitorId();
    if (visitorId) {
      post("setVisitExclusion", { visitorId, excluded: true, removeExisting: true }, data => {
        if (data && data.ok) {
          visitStats = data.visitStats || visitStats;
          updateVisitExclusionUi("Toto zařízení je vyloučeno. Jeho dřívější testovací návštěvy byly odstraněny.");
          renderStats();
          renderInsights();
        }
      });
    }
  }
}

function dataSelector(name, value) {
  return `[data-${name}="${CSS.escape(String(value))}"]`;
}


function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Soubor se nepodařilo načíst."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Obrázek se nepodařilo otevřít."));
    image.src = dataUrl;
  });
}

async function prepareImageForUpload(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error("Vyberte obrázek JPG, PNG nebo WEBP.");
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > 1900000 && quality > 0.52) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > 2200000) throw new Error("Fotografie je příliš velká. Zkuste menší obrázek.");

  return {
    dataUrl,
    fileName: String(file.name || "produkt.jpg").replace(/\.[^.]+$/, "") + ".jpg"
  };
}

async function uploadSelectedImage(file, button, onUploaded) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Nahrávám…";

  try {
    const prepared = await prepareImageForUpload(file);
    post("uploadProductImage", prepared, result => {
      button.disabled = false;
      button.textContent = originalText;
      if (!result.ok || !result.image) {
        alert(result.message || "Obrázek se nepodařilo nahrát do galerie.");
        return;
      }
      onUploaded(result.image);
    });
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    alert(error.message || "Obrázek se nepodařilo připravit.");
  }
}


function ensureGalleryModal() {
  let modal = document.getElementById("imageGalleryModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "imageGalleryModal";
  modal.className = "gallery-modal hidden";
  modal.innerHTML = `
    <div class="gallery-dialog">
      <div class="gallery-head">
        <div><strong>Galerie produktových obrázků</strong><p>Vyberte dříve nahraný obrázek.</p></div>
        <button type="button" class="secondary-button" data-gallery-close>Zavřít</button>
      </div>
      <div class="gallery-status">Načítám galerii…</div>
      <div class="gallery-grid"></div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector("[data-gallery-close]").onclick = () => modal.classList.add("hidden");
  modal.onclick = event => {
    if (event.target === modal) modal.classList.add("hidden");
  };
  return modal;
}

function openImageGallery(onSelect) {
  const modal = ensureGalleryModal();
  const grid = modal.querySelector(".gallery-grid");
  const status = modal.querySelector(".gallery-status");
  modal.classList.remove("hidden");
  grid.innerHTML = "";
  status.textContent = "Načítám galerii…";

  post("listProductImages", {}, result => {
    if (!result.ok) {
      status.textContent = result.message || "Galerii se nepodařilo načíst.";
      return;
    }

    const images = Array.isArray(result.images) ? result.images : [];
    if (!images.length) {
      status.textContent = "Galerie je zatím prázdná. Nejprve nahrajte nový obrázek.";
      return;
    }

    status.textContent = "";
    grid.innerHTML = images.map(item => `
      <button type="button" class="gallery-item" data-gallery-select="${esc(item.id)}">
        <img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy">
        <span>${esc(item.name)}</span>
      </button>`).join("");

    grid.querySelectorAll("[data-gallery-select]").forEach(button => {
      button.onclick = () => {
        const selected = images.find(item => String(item.id) === String(button.dataset.gallerySelect));
        if (!selected) return;
        onSelect(selected.image);
        modal.classList.add("hidden");
      };
    });
  });
}

function setImagePreview(image, url) {
  if (!image) return;
  if (!url) {
    image.removeAttribute("src");
    image.classList.add("hidden");
    return;
  }
  image.src = url;
  image.classList.remove("hidden");
}

function localDate(value) {
  if (!value) return "Bez termínu";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("cs-CZ");
}

function currentPragueMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value || "";
  const month = parts.find(part => part.type === "month")?.value || "";
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
}


function currentPragueDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value || "";
  const month = parts.find(part => part.type === "month")?.value || "";
  const day = parts.find(part => part.type === "day")?.value || "";
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function openPickupStatus(status) {
  return !["Vyzvednuto", "Zrušeno"].includes(String(status || "Nová"));
}

function overdueOrderParts(order) {
  const today = currentPragueDateKey();
  const result = [];
  if (!order) return result;
  if (!order.splitOrder) {
    if (openPickupStatus(order.status) && order.pickup && order.pickup < today) {
      result.push({ label: "Objednávka", date: order.pickup });
    }
    return result;
  }
  if (openPickupStatus(order.regularStatus) && order.pickup && order.pickup < today) {
    result.push({ label: "1. část", date: order.pickup });
  }
  if (openPickupStatus(order.preorderStatus) && order.preorderPickup && order.preorderPickup < today) {
    result.push({ label: "2. část", date: order.preorderPickup });
  }
  return result;
}

function overdueDays(dateKey) {
  if (!dateKey) return 0;
  const today = new Date(`${currentPragueDateKey()}T12:00:00Z`);
  const date = new Date(`${dateKey}T12:00:00Z`);
  return Math.max(1, Math.round((today - date) / 86400000));
}

function overdueBadgeText(part) {
  const days = overdueDays(part.date);
  return `${part.label} po termínu ${days} ${days === 1 ? "den" : days < 5 ? "dny" : "dní"}`;
}

function pickupReminderSmsText(order) {
  const parts = overdueOrderParts(order);
  const number = order.orderNumber || order.id || "";
  const dates = parts.map(part => `${part.label.toLowerCase()} (${localDate(part.date)})`).join(" a ");
  return `Dobrý den, připomínáme vyzvednutí Vaší objednávky${number ? " č. " + number : ""}${dates ? ", původní termín " + dates : ""}. Prosíme, napište nám, kdy si ji můžete vyzvednout. Podprosečské domácí produkty`;
}

function openSmsReminder(order) {
  const phone = String(order.phone || "").replace(/[^+\d]/g, "");
  if (!phone) return alert("Objednávka nemá telefonní číslo.");
  const body = encodeURIComponent(pickupReminderSmsText(order));
  window.location.href = `sms:${phone}?&body=${body}`;
}

function showLogin(message = "") {
  $("#adminLogin").classList.remove("hidden");
  $("#adminApp").classList.add("hidden");
  $("#loginMessage").textContent = message;
  const button = $("#loginButton");
  button.disabled = false;
  button.textContent = "Přihlásit";
}

function showApp() {
  $("#adminLogin").classList.add("hidden");
  $("#adminApp").classList.remove("hidden");
}

function post(action, payload, callback) {
  postQueue.push({ action, payload: payload || {}, callback });
  processPostQueue();
}

function processPostQueue() {
  if (activePost || postCooldown || !postQueue.length) return;

  const job = postQueue.shift();
  const endpoint = url();
  if (!endpoint || !endpoint.endsWith("/exec")) {
    job.callback({ ok: false, message: "Administrace není správně propojená s Apps Scriptem." });
    processPostQueue();
    return;
  }

  activePost = job;
  const form = $("#adminBackendForm");
  form.action = endpoint;
  $("#adminAction").value = job.action;
  $("#adminToken").value = token;
  $("#adminPayload").value = JSON.stringify(job.payload);

  clearTimeout(requestTimer);
  requestTimer = setTimeout(() => {
    if (activePost !== job) return;
    activePost = null;
    job.callback({
      ok: false,
      message: "Server odpovídá pomalu. Obnovte administraci a zkontrolujte, zda se změna už uložila. Pokud ne, zkuste akci znovu."
    });
    postCooldown = true;
    setTimeout(() => {
      postCooldown = false;
      processPostQueue();
    }, 100);
  }, 45000);

  form.submit();
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
  if (!data || data.type !== "PDP_BACKEND_RESULT" || !activePost) return;

  // Apps Script zobrazuje HtmlService odpověď uvnitř vlastního vnořeného iframe.
  // Zdroj zprávy proto nemusí být přímo adminSubmitFrame.contentWindow.
  const frame = $("#adminSubmitFrame");
  const directFrameMessage = Boolean(frame && event.source === frame.contentWindow);
  if (!directFrameMessage && !isTrustedAppsScriptOrigin(event.origin)) return;

  clearTimeout(requestTimer);
  const job = activePost;
  activePost = null;
  postCooldown = true;
  job.callback(data);
  setTimeout(() => {
    postCooldown = false;
    processPostQueue();
  }, 100);
});



function saveAdminCache(data) {
  try {
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      products: data.products || [],
      orders: data.orders || [],
      eggSettings: data.eggSettings || null,
      eggAvailability: data.eggAvailability || null,
      businessSettings: data.businessSettings || {},
      visitStats: data.visitStats || null
    }));
  } catch (error) {
    console.warn("Administrativní data se nepodařilo uložit do mezipaměti.", error);
  }
}

function loadAdminCache() {
  try {
    const raw = localStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.products) || !Array.isArray(cached.orders)) return false;
    if (Date.now() - Number(cached.savedAt || 0) > ADMIN_CACHE_MAX_AGE) return false;

    applyAdminData(cached, false);
    const message = document.getElementById("adminRefreshState");
    if (message) message.textContent = "Zobrazuji poslední uložená data, aktuální stav načítám…";
    return true;
  } catch (error) {
    console.warn("Administrativní mezipaměť se nepodařilo načíst.", error);
    return false;
  }
}

function setAdminRefreshState(text = "") {
  let element = document.getElementById("adminRefreshState");
  if (!element) {
    element = document.createElement("div");
    element.id = "adminRefreshState";
    element.className = "admin-refresh-state";
    const app = document.getElementById("adminApp");
    if (app) app.prepend(element);
  }
  element.textContent = text;
  element.classList.toggle("hidden", !text);
}

function applyAdminData(data, saveCache = true) {
  products = data.products || [];
  orders = data.orders || [];
  eggSettings = data.eggSettings || null;
  eggAvailability = data.eggAvailability || null;
  businessSettings = data.businessSettings || {};
  visitStats = data.visitStats || null;
  showApp();
  renderAll();
  if (saveCache) saveAdminCache(data);
}

function login() {
  const password = $("#adminPassword").value;
  if (!password) return showLogin("Zadejte heslo.");

  const button = $("#loginButton");
  button.disabled = true;
  button.textContent = "Přihlašuji…";
  $("#loginMessage").textContent = "Ověřuji heslo…";

  post("login", { password }, data => {
    button.disabled = false;
    button.textContent = "Přihlásit";
    if (!data.ok) return showLogin(data.message);

    token = data.token;
    sessionStorage.setItem("pdp-admin-token", token);
    markThisDeviceAsAdminVisitor(true);
    $("#adminPassword").value = "";

    // Přihlášení je hotové hned po ověření hesla.
    // Poslední data zobrazíme okamžitě a aktuální načteme na pozadí.
    const cacheShown = loadAdminCache();
    if (!cacheShown) {
      showApp();
      setAdminRefreshState("Přihlášeno. Načítám aktuální objednávky a produkty…");
    }
    loadData(true);
  });
}

function loadData(background = false) {
  if (!token) return showLogin();
  const endpoint = url();
  if (!endpoint || !endpoint.endsWith("/exec")) {
    return showLogin("Administrace není správně propojená s Apps Scriptem.");
  }

  const previous = document.getElementById("admin-data-jsonp");
  if (previous) previous.remove();
  if (!background) setAdminRefreshState("Načítám aktuální data…");

  const script = document.createElement("script");
  script.id = "admin-data-jsonp";

  window.PDP_ADMIN_DATA = data => {
    script.remove();
    if (!data || !data.ok) {
      sessionStorage.removeItem("pdp-admin-token");
      token = "";
      return showLogin(data?.message || "Přihlaste se znovu.");
    }

    applyAdminData(data);
    setAdminRefreshState("");
  };

  script.src = `${endpoint}?action=adminData&token=${encodeURIComponent(token)}&callback=PDP_ADMIN_DATA&t=${Date.now()}`;
  script.onerror = () => {
    script.remove();
    if (products.length || orders.length) {
      setAdminRefreshState("Aktuální data se nepodařilo načíst. Zobrazuji poslední uložený stav.");
    } else {
      showLogin("Nepodařilo se načíst administraci.");
    }
  };
  document.head.appendChild(script);
}

function archived(order) {
  return ["Vyzvednuto", "Zrušeno"].includes(order.status);
}

function activeReservation(order) {
  return !archived(order);
}

function eggQty(order) {
  return (order.items || [])
    .filter(item => String(item.productId) === "2")
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function productById(id) {
  return products.find(product => String(product.id) === String(id));
}

function orderRevenueEntries(order) {
  if (!order) return [];

  if (!order.splitOrder) {
    return order.fulfilledAt
      ? [{ orderId: order.id, at: order.fulfilledAt, amount: Number(order.total || 0), items: order.items || [], order }]
      : [];
  }

  const regularItems = (order.items || []).filter(item => !productById(item.productId)?.preorder);
  const preorderItems = (order.items || []).filter(item => productById(item.productId)?.preorder);
  const entries = [];

  if (order.regularFulfilledAt && regularItems.length) {
    entries.push({
      orderId: order.id,
      at: order.regularFulfilledAt,
      amount: regularItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0),
      items: regularItems,
      order
    });
  }

  if (order.preorderFulfilledAt && preorderItems.length) {
    entries.push({
      orderId: order.id,
      at: order.preorderFulfilledAt,
      amount: preorderItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0),
      items: preorderItems,
      order
    });
  }

  return entries;
}

function fulfilledRevenueEntries() {
  return orders.flatMap(orderRevenueEntries);
}

function renderStats() {
  $("#statNew").textContent = orders.filter(order => order.status === "Nová").length;
  $("#statOverdue").textContent = orders.filter(order => overdueOrderParts(order).length > 0).length;
  $("#statRevenue").textContent = money(
    fulfilledRevenueEntries().reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
  $("#statEggs").textContent = orders
    .filter(order => order.status !== "Zrušeno")
    .reduce((sum, order) => sum + eggQty(order), 0);
  $("#statHoney").textContent = orders
    .filter(order => order.status !== "Zrušeno")
    .flatMap(order => order.items || [])
    .filter(item => String(item.productId) === "1")
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);
  $("#statEggStock").textContent = eggSettings ? eggSettings.currentStock : "—";
  $("#statEggDaily").textContent = eggSettings ? `${eggSettings.dailyProduction} / den` : "—";
  const sourceRows = Array.isArray(visitStats?.bySource) ? visitStats.bySource : [];
  const qrSource = sourceRows.find(item => item.source === "QR kód");
  const linkSource = sourceRows.find(item => item.source === "Přímý odkaz");
  if ($("#statVisits")) $("#statVisits").textContent = String(visitStats?.totalVisits ?? 0);
  if ($("#statUniqueToday")) $("#statUniqueToday").textContent = String(visitStats?.uniqueToday ?? 0);
  if ($("#statQrVisits")) $("#statQrVisits").textContent = String(qrSource?.total ?? 0);
  if ($("#statLinkVisits")) $("#statLinkVisits").textContent = String(linkSource?.total ?? 0);
  const month = currentPragueMonthKey();
  const monthEntries = fulfilledRevenueEntries().filter(entry => (entry.at || "").slice(0, 7) === month);
  $("#statMonthRevenue").textContent = money(monthEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  $("#statMonthOrders").textContent = new Set(monthEntries.map(entry => entry.orderId)).size;
  $("#statPreorders").textContent = orders.filter(order => activeReservation(order) && (order.items || []).some(item => products.find(p => String(p.id) === String(item.productId))?.preorder)).length;
  $("#statCustomers").textContent = new Set(orders.filter(order => order.status !== "Zrušeno").map(order => (order.email || order.phone || order.name).toLowerCase())).size;
}

function filteredOrders() {
  const query = $("#searchOrders").value.toLowerCase();
  const status = $("#statusFilter").value;
  const archive = $("#archiveFilter").value;

  return orders.filter(order => {
    const matchesSearch = !query || order.name.toLowerCase().includes(query) || (order.phone || "").toLowerCase().includes(query);
    const matchesStatus = !status || order.status === status;
    const matchesArchive = archive === "all"
      || (archive === "overdue" ? overdueOrderParts(order).length > 0
        : archive === "archive" ? archived(order) : !archived(order));
    return matchesSearch && matchesStatus && matchesArchive;
  });
}

function itemHtml(order) {
  if (order.items?.length) return order.items.map(item => `${item.qty}× ${esc(item.name)}`).join("<br>");
  return esc(order.itemsText || "");
}

function statusOptions(selected) {
  return ["Nová", "Připravuji", "Připraveno", "Vyzvednuto", "Zrušeno"]
    .map(status => `<option ${status === selected ? "selected" : ""}>${status}</option>`)
    .join("");
}

function emailSubjectForOrder(order) {
  const subjects = [];
  (order.items || []).forEach(item => {
    const product = products.find(p => String(p.id) === String(item.productId));
    const group = item.emailGroup || product?.emailGroup || (/vejce/i.test(item.name || "") ? "SLEPICKY" : /med|včel|propolis|vosk/i.test(item.name || "") ? "VCELICKY" : "FARMARI");
    const subject = group === "SLEPICKY" ? "naše slepičky" : group === "VCELICKY" ? "naše včeličky" : group === "VLASTNI" ? (item.emailText || product?.emailText || "podprosečští farmáři") : "podprosečští farmáři";
    if (subject && !subjects.includes(subject)) subjects.push(subject);
  });
  if (!subjects.length) return "podprosečští farmáři";
  if (subjects.length === 1) return subjects[0];
  if (subjects.length === 2) return subjects.join(" a ");
  return subjects.slice(0, -1).join(", ") + " a " + subjects[subjects.length - 1];
}

function renderOrders() {
  const list = filteredOrders();
  $("#ordersList").innerHTML = list.length ? list.map(order => `
    <article class="card ${overdueOrderParts(order).length ? "overdue-card" : ""}">
      <div class="card-head">
        <div>
          <h3>${esc(order.name)} <span class="badge gray">${esc(order.orderNumber || order.id)}</span></h3>
          <div class="meta">${esc(order.created)} · ${order.contactMethod === "E-mail" ? "✉️ E-mail" : "📱 SMS"} · ${esc(order.phone || "bez telefonu")}${order.email ? ` · ${esc(order.email)}` : ""}</div>
          <div class="badges">
            <span class="badge blue">${esc(localDate(order.pickup))}</span>
            ${eggQty(order) ? `<span class="badge green">🥚 ${eggQty(order)} ks</span>` : ""}
            ${archived(order) ? '<span class="badge gray">Archiv</span>' : ""}
            ${overdueOrderParts(order).map(part => `<span class="badge red">⚠️ ${esc(overdueBadgeText(part))}</span>`).join("")}
          </div>
        </div>
        <strong>${money(order.total)}</strong>
      </div>
      <div class="item-list">${itemHtml(order)}</div>
      ${order.note ? `<div class="meta">Poznámka zákazníka: ${esc(order.note)}</div>` : ""}${order.internalNote ? `<div class="meta"><strong>Interní poznámka:</strong> ${esc(order.internalNote)}</div>` : ""}
      ${order.splitOrder ? `<div class="split-parts"><div class="split-part"><strong>1. Dostupné produkty</strong><div class="meta">${esc(localDate(order.pickup))}</div><select class="status-select" data-regular-status="${esc(order.id)}">${statusOptions(order.regularStatus || order.status)}</select></div><div class="split-part"><strong>2. Předobjednané produkty</strong><div class="meta">${esc(localDate(order.preorderPickup))}</div><select class="status-select" data-preorder-status="${esc(order.id)}">${statusOptions(order.preorderStatus || "Nová")}</select></div></div>` : ""}
      <div class="card-bottom">
        ${order.splitOrder ? "" : `<select class="status-select" data-status="${esc(order.id)}">${statusOptions(order.status)}</select>`}
        <div class="actions">
          ${overdueOrderParts(order).length ? `<button class="reminder-button" data-remind-order="${esc(order.id)}">Připomenout</button>` : ""}
          <button class="secondary-button" data-edit-order="${esc(order.id)}">Upravit</button>
          <button class="danger-button" data-delete-order="${esc(order.id)}">Smazat</button>
        </div>
      </div>
      <div id="oe${esc(order.id)}" class="editor">
        <div class="form-grid">
          <label><span>Jméno</span><input data-on="${esc(order.id)}" value="${esc(order.name)}"></label>
          <label><span>Telefon</span><input data-op="${esc(order.id)}" value="${esc(order.phone)}"></label>
          <label><span>E-mail</span><input data-oe="${esc(order.id)}" type="email" value="${esc(order.email || "")}"></label><label><span>Preferované upozornění</span><select data-oc="${esc(order.id)}"><option ${order.contactMethod !== "E-mail" ? "selected" : ""}>SMS</option><option ${order.contactMethod === "E-mail" ? "selected" : ""}>E-mail</option></select></label>
          <label><span>${order.splitOrder ? "Termín 1. části" : "Termín"}</span><input data-od="${esc(order.id)}" type="date" value="${esc(order.pickup)}"></label>
          ${order.splitOrder ? `<label><span>Stav 1. části</span><select data-ors="${esc(order.id)}">${statusOptions(order.regularStatus || order.status)}</select></label><label><span>Termín 2. části</span><input data-opd="${esc(order.id)}" type="date" value="${esc(order.preorderPickup || "")}"></label><label><span>Stav 2. části</span><select data-ops="${esc(order.id)}">${statusOptions(order.preorderStatus || "Nová")}</select></label>` : `<label><span>Stav</span><select data-os="${esc(order.id)}">${statusOptions(order.status)}</select></label>`}
          <div class="full">
            <span class="field-label">Položky</span>
            <div class="quantity-list">
              ${products.map(product => {
                const item = (order.items || []).find(entry => String(entry.productId) === String(product.id));
                return `<div class="quantity-row"><span>${esc(product.emoji)} ${esc(product.name)}</span><input data-oi="${esc(order.id)}-${esc(product.id)}" type="number" min="0" max="500" value="${item ? item.qty : 0}"></div>`;
              }).join("")}
            </div>
          </div>
          <label class="full"><span>Poznámka zákazníka</span><textarea data-ot="${esc(order.id)}">${esc(order.note)}</textarea></label><label class="full"><span>Interní poznámka (vidíš jen ty)</span><textarea data-oin="${esc(order.id)}">${esc(order.internalNote || "")}</textarea></label><div class="full"><span class="field-label">Komunikace</span><div class="meta">${(order.communication || []).length ? (order.communication || []).map(x => `✔ ${esc(x.text)} · ${esc(new Date(x.at).toLocaleString("cs-CZ"))}`).join("<br>") : "Zatím bez dalších zpráv."}</div></div><div class="full"><span class="field-label">Časová osa</span><div class="meta">${(order.timeline || []).length ? (order.timeline || []).map(x => `${esc(x.text)} · ${esc(new Date(x.at).toLocaleString("cs-CZ"))}`).join("<br>") : "Bez záznamu."}</div></div>
        </div>
        <div class="actions"><button class="primary-small" data-save-order="${esc(order.id)}">Uložit změny</button><button class="secondary-button" data-preview-ready="${esc(order.id)}">Náhled e-mailu</button><button class="secondary-button" data-resend-ready="${esc(order.id)}" data-part="regular">Odeslat znovu 1. část</button>${order.splitOrder ? `<button class="secondary-button" data-resend-ready="${esc(order.id)}" data-part="preorder">Odeslat znovu 2. část</button>` : ""}</div>
      </div>
    </article>`).join("") : '<div class="empty">Žádné objednávky.</div>';

  document.querySelectorAll("[data-status]").forEach(select => {
    select.onchange = () => {
      const order = orders.find(item => item.id === select.dataset.status);
      order.status = select.value;
      saveOrder(order);
    };
  });

  document.querySelectorAll("[data-regular-status]").forEach(select => {
    select.onchange = () => { const order = orders.find(item => item.id === select.dataset.regularStatus); order.regularStatus = select.value; saveOrder(order); };
  });
  document.querySelectorAll("[data-preorder-status]").forEach(select => {
    select.onchange = () => { const order = orders.find(item => item.id === select.dataset.preorderStatus); order.preorderStatus = select.value; saveOrder(order); };
  });


  document.querySelectorAll("[data-remind-order]").forEach(button => {
    button.onclick = () => {
      const order = orders.find(item => item.id === button.dataset.remindOrder);
      if (!order) return;
      if (order.contactMethod === "E-mail" && order.email) {
        if (!confirm(`Odeslat ${order.name} e-mail s připomenutím vyzvednutí?`)) return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Odesílám…";
        post("sendPickupReminder", { id: order.id }, data => {
          button.disabled = false;
          button.textContent = original;
          if (!data.ok) return alert(data.message);
          alert(data.message);
          loadData(true);
        });
        return;
      }
      if (order.phone) return openSmsReminder(order);
      if (order.email) {
        if (!confirm(`Objednávka nemá telefon. Odeslat ${order.name} připomínku e-mailem?`)) return;
        post("sendPickupReminder", { id: order.id }, data => data.ok ? (alert(data.message), loadData(true)) : alert(data.message));
        return;
      }
      alert("Objednávka nemá telefon ani e-mail.");
    };
  });

  document.querySelectorAll("[data-edit-order]").forEach(button => {
    button.onclick = () => document.getElementById("oe" + button.dataset.editOrder)?.classList.toggle("open");
  });

  document.querySelectorAll("[data-save-order]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.saveOrder;
      const order = orders.find(item => item.id === id);
      order.name = document.querySelector(dataSelector("on", id)).value;
      order.phone = document.querySelector(dataSelector("op", id)).value;
      order.email = document.querySelector(dataSelector("oe", id)).value;
      order.contactMethod = document.querySelector(dataSelector("oc", id)).value;
      order.pickup = document.querySelector(dataSelector("od", id)).value;
      if (order.splitOrder) {
        order.regularStatus = document.querySelector(dataSelector("ors", id)).value;
        order.preorderPickup = document.querySelector(dataSelector("opd", id)).value;
        order.preorderStatus = document.querySelector(dataSelector("ops", id)).value;
      } else {
        order.status = document.querySelector(dataSelector("os", id)).value;
      }
      order.note = document.querySelector(dataSelector("ot", id)).value;
      order.internalNote = document.querySelector(dataSelector("oin", id)).value;
      order.items = products.map(product => {
        const quantity = Number(document.querySelector(dataSelector("oi", `${id}-${product.id}`)).value) || 0;
        return { productId: String(product.id), name: product.name, qty: quantity, price: product.price };
      }).filter(item => item.qty > 0);
      saveOrder(order);
    };
  });

  document.querySelectorAll("[data-preview-ready]").forEach(button => {
    button.onclick = () => {
      const order = orders.find(item => item.id === button.dataset.previewReady);
      const subject = emailSubjectForOrder(order);
      const verb = /farmáři/i.test(subject) ? "dokončili" : "dokončily";
      alert(`Dobrý den, ${order.name.split(/\s+/)[0]},\n\n${subject} ${verb} práci.\n\nVaše objednávka je připravena k vyzvednutí.\n\nTermín: ${localDate(order.pickup)}\n\nPod Prosečí 102/2\nJablonec nad Nisou\n\nTelefon: +420 732 687 040\n\nČíslo objednávky: ${order.orderNumber || order.id}`);
    };
  });
  document.querySelectorAll("[data-resend-ready]").forEach(button => {
    button.onclick = () => {
      if (!confirm("Opravdu odeslat e-mail zákazníkovi znovu?")) return;
      post("resendReadyEmail", {id: button.dataset.resendReady, part: button.dataset.part}, data => data.ok ? (alert(data.message), loadData()) : alert(data.message));
    };
  });

  document.querySelectorAll("[data-delete-order]").forEach(button => {
    button.onclick = () => {
      if (!confirm("Opravdu smazat objednávku?")) return;
      post("deleteOrder", { id: button.dataset.deleteOrder }, data => data.ok ? loadData() : alert(data.message));
    };
  });
}

function saveOrder(order) {
  post("saveOrder", { order }, data => data.ok ? loadData() : alert(data.message));
}

function renderCalendar() {
  const groups = {};
  orders.filter(order => order.status !== "Zrušeno").forEach(order => {
    const key = order.pickup || "without";
    (groups[key] ??= []).push(order);
  });

  const keys = Object.keys(groups).sort((a, b) => a === "without" ? 1 : b === "without" ? -1 : a.localeCompare(b));
  $("#calendarList").innerHTML = keys.map(key => {
    const groupEggs = groups[key].reduce((sum, order) => sum + eggQty(order), 0);
    return `<article class="card">
      <div class="card-head">
        <h3>${key === "without" ? "Bez termínu" : localDate(key)}</h3>
        <div class="badges"><span class="badge blue">${groups[key].length} objednávek</span>${groupEggs ? `<span class="badge green">🥚 ${groupEggs} ks</span>` : ""}</div>
      </div>
      ${groups[key].map(order => `<div class="calendar-entry"><div><strong>${esc(order.name)}</strong><div class="meta">${itemHtml(order)}</div></div><div><strong>${money(order.total)}</strong><div class="meta">${esc(order.status)}</div></div></div>`).join("")}
    </article>`;
  }).join("") || '<div class="empty">Kalendář je prázdný.</div>';
}

function productBadges(product) {
  if (!product.visible) return '<span class="badge gray">Skryto</span>';
  if (product.preorder) return '<span class="badge blue">Předobjednávka</span>';
  if (product.soldOut) return '<span class="badge orange">Vyprodáno</span>';
  return '<span class="badge green">V prodeji</span>';
}

function renderProducts() {
  $("#productsList").innerHTML = products.map(product => `
    <article class="card">
      <div class="card-head">
        <div style="display:flex;gap:12px">
          <div style="font-size:36px">${esc(product.emoji)}</div>
          <div><h3>${esc(product.name)}</h3><div class="meta">${esc(product.short)}</div><div class="badges">${productBadges(product)}</div></div>
        </div>
        <button class="secondary-button" data-ep="${esc(product.id)}">Upravit</button>
      </div>
      <div id="pe${esc(product.id)}" class="editor">
        <div class="form-grid">
          <label><span>Název</span><input data-pn="${esc(product.id)}" value="${esc(product.name)}"></label>
          <label><span>Emoji</span><input data-pem="${esc(product.id)}" value="${esc(product.emoji)}"></label>
          <label><span>Cena</span><input data-pp="${esc(product.id)}" type="number" value="${product.price}"></label>
          <label><span>Jednotka</span><input data-pu="${esc(product.id)}" value="${esc(product.unit)}"></label>
          <label class="full"><span>Krátký popis</span><input data-ps="${esc(product.id)}" value="${esc(product.short)}"></label>
          <label class="full"><span>Podrobnosti</span><textarea data-pd="${esc(product.id)}">${esc(product.detail)}</textarea></label>
          <label class="full"><span>Fotografie produktu</span>
            <div class="image-upload-row">
              <input data-pimg="${esc(product.id)}" value="${esc(product.image || "")}" placeholder="Obrázek se doplní automaticky">
              <button class="secondary-button" type="button" data-pimg-button="${esc(product.id)}">Nahrát obrázek</button>
              <button class="secondary-button" type="button" data-pgallery-button="${esc(product.id)}">Vybrat z galerie</button>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-pimg-file="${esc(product.id)}" hidden>
            </div>
            <img class="admin-image-preview ${product.image ? "" : "hidden"}" data-pimg-preview="${esc(product.id)}" src="${esc(product.image || "")}" alt="Náhled produktu">
            <small>Vyberte fotografii z telefonu nebo počítače. Automaticky se zmenší a nahraje.</small>
          </label>
          <label><span>Předpokládané naskladnění</span><input data-pr="${esc(product.id)}" type="date" value="${esc(product.restock || "")}"></label>
          <label><span>Předstih dní</span><input data-pl="${esc(product.id)}" type="number" value="${product.leadDays}"></label>
          <label class="full"><span>Rychlá tlačítka</span><input data-pq="${esc(product.id)}" value="${(product.quick || []).join(", ")}"></label>
          <label><span>Plánované množství / kapacita</span><input data-pcap="${esc(product.id)}" type="number" min="0" value="${Number(product.capacity || 0)}"></label>
          <label><span>Počet skladem</span><input data-pstock="${esc(product.id)}" type="number" min="0" value="${Number(product.stock || 0)}" ${String(product.id) === "2" ? "disabled" : ""}></label>
          <label><span>Jednotka skladu</span><input data-pstockunit="${esc(product.id)}" value="${esc(product.stockUnit || "ks")}" ${String(product.id) === "2" ? "disabled" : ""}></label>
          <label><span>Text při vyprodání</span><select data-psoldtext="${esc(product.id)}"><option ${product.soldOutText !== "Vyprodáno" ? "selected" : ""}>Momentálně vyprodáno</option><option ${product.soldOutText === "Vyprodáno" ? "selected" : ""}>Vyprodáno</option></select></label>
          <label><span>Text v potvrzovacím e-mailu</span><select data-peg="${esc(product.id)}"><option value="SLEPICKY" ${product.emailGroup === "SLEPICKY" ? "selected" : ""}>🐔 Naše slepičky</option><option value="VCELICKY" ${product.emailGroup === "VCELICKY" ? "selected" : ""}>🐝 Naše včeličky</option><option value="FARMARI" ${product.emailGroup === "FARMARI" ? "selected" : ""}>🌿 Podprosečští farmáři</option><option value="VLASTNI" ${product.emailGroup === "VLASTNI" ? "selected" : ""}>✍️ Vlastní označení</option></select></label>
          <label class="full"><span>Vlastní označení</span><input data-pet="${esc(product.id)}" maxlength="120" value="${esc(product.emailText || "")}" placeholder="např. naše levandulová zahrada"><small>Použije se jen při volbě Vlastní označení.</small></label>
          <div><span class="field-label">Rezervováno</span><strong>${Number(product.reserved || 0)}${product.capacity ? ` / ${product.capacity}` : ""}</strong></div>
          <div><span class="field-label">Dostupné zákazníkům</span><strong>${Number(product.availableStock || 0)} ${esc(product.stockUnit || "ks")}</strong></div>
        </div>
        <div class="actions">
          <label><input data-pv="${esc(product.id)}" type="checkbox" ${product.visible ? "checked" : ""}> Zobrazovat</label>
          <label><input data-po="${esc(product.id)}" type="checkbox" ${product.soldOut ? "checked" : ""}> Vyprodáno</label>
          <label><input data-ppre="${esc(product.id)}" type="checkbox" ${product.preorder ? "checked" : ""}> Povolit předobjednávky</label>
          <button class="danger-button" data-dp="${esc(product.id)}">Smazat</button>
          <button class="primary-small" data-sp="${esc(product.id)}">Uložit</button>
        </div>
      </div>
    </article>`).join("");

  document.querySelectorAll("[data-ep]").forEach(button => {
    button.onclick = () => document.getElementById("pe" + button.dataset.ep)?.classList.toggle("open");
  });



  document.querySelectorAll("[data-pgallery-button]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.pgalleryButton;
      openImageGallery(imageUrl => {
        const field = document.querySelector(dataSelector("pimg", id));
        const preview = document.querySelector(dataSelector("pimg-preview", id));
        field.value = imageUrl;
        setImagePreview(preview, imageUrl);
      });
    };
  });

  document.querySelectorAll("[data-pimg-button]").forEach(button => {
    button.onclick = () => document.querySelector(dataSelector("pimg-file", button.dataset.pimgButton))?.click();
  });

  document.querySelectorAll("[data-pimg-file]").forEach(input => {
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const id = input.dataset.pimgFile;
      const button = document.querySelector(dataSelector("pimg-button", id));
      uploadSelectedImage(file, button, imageUrl => {
        const field = document.querySelector(dataSelector("pimg", id));
        const preview = document.querySelector(dataSelector("pimg-preview", id));
        field.value = imageUrl;
        setImagePreview(preview, imageUrl);
      });
      input.value = "";
    };
  });

  document.querySelectorAll("[data-sp]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.sp;
      const product = products.find(item => String(item.id) === id);
      const name = document.querySelector(dataSelector("pn", id)).value.trim();
      if (!name) return alert("Vyplňte název produktu.");
      product.name = name;
      product.emoji = document.querySelector(dataSelector("pem", id)).value;
      product.price = Number(document.querySelector(dataSelector("pp", id)).value) || 0;
      product.unit = document.querySelector(dataSelector("pu", id)).value;
      product.short = document.querySelector(dataSelector("ps", id)).value;
      product.detail = document.querySelector(dataSelector("pd", id)).value;
      product.image = document.querySelector(dataSelector("pimg", id)).value.trim();
      product.restock = document.querySelector(dataSelector("pr", id)).value;
      product.leadDays = Number(document.querySelector(dataSelector("pl", id)).value) || 0;
      product.quick = document.querySelector(dataSelector("pq", id)).value.split(",").map(value => Number(value.trim())).filter(Boolean);
      product.capacity = Number(document.querySelector(dataSelector("pcap", id)).value) || 0;
      if (String(product.id) !== "2") {
        product.stock = Number(document.querySelector(dataSelector("pstock", id)).value) || 0;
        product.stockUnit = document.querySelector(dataSelector("pstockunit", id)).value.trim() || "ks";
      }
      product.soldOutText = document.querySelector(dataSelector("psoldtext", id)).value;
      product.emailGroup = document.querySelector(dataSelector("peg", id)).value;
      product.emailText = document.querySelector(dataSelector("pet", id)).value.trim();
      if (product.emailGroup === "VLASTNI" && !product.emailText) return alert("U vlastního textu vyplňte vlastní označení.");
      product.visible = document.querySelector(dataSelector("pv", id)).checked;
      product.soldOut = document.querySelector(dataSelector("po", id)).checked;
      product.preorder = document.querySelector(dataSelector("ppre", id)).checked;
      if (product.preorder && !product.restock) return alert("U předobjednávky vyplňte předpokládané datum naskladnění.");
      post("saveProduct", { product }, data => data.ok ? loadData() : alert(data.message));
    };
  });

  document.querySelectorAll("[data-dp]").forEach(button => {
    button.onclick = () => {
      if (!confirm("Opravdu smazat produkt?")) return;
      post("deleteProduct", { id: button.dataset.dp }, data => data.ok ? loadData() : alert(data.message));
    };
  });
}

function renderManualOrderProducts() {
  $("#manualProducts").innerHTML = products.map(product => `
    <div class="quantity-row">
      <span>${esc(product.emoji)} ${esc(product.name)} · ${money(product.price)}</span>
      <input data-mp="${esc(product.id)}" type="number" min="0" max="500" value="0">
    </div>`).join("");
}

function renderEggSettings() {
  if (!eggSettings) {
    $("#eggForecast").innerHTML = '<div class="empty">Nastavení vajec se nepodařilo načíst.</div>';
    return;
  }

  $("#eggCurrentStock").value = eggSettings.currentStock;
  $("#eggDailyProduction").value = eggSettings.dailyProduction;
  $("#eggSafetyReserve").value = eggSettings.safetyReserve;
  $("#eggPlanningDays").value = eggSettings.planningDays;
  $("#eggStockDate").textContent = localDate(eggSettings.stockDate);
  const accrual = $("#eggAccrualInfo");
  if (accrual) {
    accrual.textContent = eggSettings.elapsedDays > 0
      ? `Od posledního fyzického stavu (${localDate(eggSettings.baseDate)}) automaticky připočteno ${eggSettings.accruedEggs} vajec za ${eggSettings.elapsedDays} ${eggSettings.elapsedDays === 1 ? "den" : "dny"}.`
      : `Fyzický stav byl naposledy potvrzen dnes (${localDate(eggSettings.baseDate)}).`;
  }

  const days = eggAvailability?.days || [];
  $("#eggForecast").innerHTML = days.slice(0, 21).map(day => `
    <div class="forecast-row ${day.projectedStock < eggSettings.safetyReserve ? "forecast-warning" : ""}">
      <div><strong>${localDate(day.date)}</strong><div class="meta">Rezervováno na tento den: ${day.reserved} ks</div></div>
      <div class="forecast-values">
        <span>Stav po rezervacích <strong>${day.projectedStock}</strong></span>
        <span>Další volná kapacita <strong>${day.maxAdditional}</strong></span>
      </div>
    </div>`).join("") || '<div class="empty">Předpověď je prázdná.</div>';
}


function renderInsights() {
  const valid = fulfilledRevenueEntries();
  const productTotals = {};
  valid.forEach(entry => (entry.items || []).forEach(item => {
    const key = item.name || item.productId;
    productTotals[key] = (productTotals[key] || 0) + Number(item.qty || 0);
  }));
  const topProducts = Object.entries(productTotals).sort((a,b) => b[1]-a[1]).slice(0,10);
  $("#topProducts").innerHTML = topProducts.map(([name, qty], i) => `<div class="rank-row"><span>${i+1}. ${esc(name)}</span><strong>${qty}</strong></div>`).join("") || '<div class="empty">Zatím bez dat.</div>';

  const customers = {};
  valid.forEach(entry => {
    const order = entry.order;
    const key = (order.email || order.phone || order.name).toLowerCase();
    const row = customers[key] || { name: order.name, orders: new Set(), total: 0 };
    row.orders.add(order.id);
    row.total += Number(entry.amount || 0);
    customers[key] = row;
  });
  const topCustomers = Object.values(customers).sort((a,b) => b.total-a.total).slice(0,10);
  $("#topCustomers").innerHTML = topCustomers.map((c,i) => `<div class="rank-row"><span>${i+1}. ${esc(c.name)} <small>${c.orders.size} obj.</small></span><strong>${money(c.total)}</strong></div>`).join("") || '<div class="empty">Zatím bez dat.</div>';

  const months = {};
  valid.forEach(entry => {
    const key = (entry.at || "").slice(0,7);
    if (key) months[key] = (months[key] || 0) + Number(entry.amount || 0);
  });
  const entries = Object.entries(months).sort().slice(-12);
  const max = Math.max(1, ...entries.map(x => x[1]));
  $("#monthlyRevenue").innerHTML = entries.map(([month,total]) => `<div class="bar-row"><span>${esc(month)}</span><div class="bar-track"><i style="width:${Math.round(total/max*100)}%"></i></div><strong>${money(total)}</strong></div>`).join("") || '<div class="empty">Zatím bez dat.</div>';

  const stats = visitStats || { totalVisits: 0, uniqueVisitors: 0, todayVisits: 0, uniqueToday: 0, last30Visits: 0, uniqueLast30: 0, bySource: [], daily: [] };
  const sources = Array.isArray(stats.bySource) ? stats.bySource : [];
  const dailyVisits = Array.isArray(stats.daily) ? stats.daily : [];
  if ($("#visitSummary")) {
    $("#visitSummary").innerHTML = [
      `<div class="rank-row"><span>Návštěvy celkem</span><strong>${stats.totalVisits}</strong></div>`,
      `<div class="rank-row"><span>Unikátní návštěvníci celkem</span><strong>${stats.uniqueVisitors}</strong></div>`,
      `<div class="rank-row"><span>Návštěvy dnes</span><strong>${stats.todayVisits}</strong></div>`,
      `<div class="rank-row"><span>Unikátní dnes</span><strong>${stats.uniqueToday}</strong></div>`,
      `<div class="rank-row"><span>Posledních 30 dní</span><strong>${stats.last30Visits} <small>${stats.uniqueLast30} unik.</small></strong></div>`
    ].join("");
  }
  if ($("#visitSources")) {
    $("#visitSources").innerHTML = sources.map(item => `<div class="rank-row"><span>${esc(item.source)}</span><strong>${item.total} <small>${item.uniqueLast30} unik. / 30 dní</small></strong></div>`).join("") || '<div class="empty">Zatím bez dat.</div>';
  }
  if ($("#visitTimeline")) {
    const maxVisits = Math.max(1, ...dailyVisits.map(item => Number(item.visits || 0)));
    $("#visitTimeline").innerHTML = dailyVisits.map(item => `<div class="bar-row"><span>${esc(localDate(item.day))}</span><div class="bar-track"><i style="width:${Math.round((Number(item.visits || 0) / maxVisits) * 100)}%"></i></div><strong>${Number(item.visits || 0)} <small>${Number(item.unique || 0)} unik.</small></strong></div>`).join("") || '<div class="empty">Zatím bez dat.</div>';
  }
}

function renderBusinessSettings() {
  const s = businessSettings || {};
  $("#bannerEnabled").checked = Boolean(s.bannerEnabled);
  $("#bannerStyle").value = s.bannerStyle || "yellow";
  $("#bannerTitle").value = s.bannerTitle || "";
  $("#bannerText").value = s.bannerText || "";
  $("#bannerFrom").value = s.bannerFrom || "";
  $("#bannerTo").value = s.bannerTo || "";
  $("#ordersPaused").checked = Boolean(s.ordersPaused);
  $("#pauseFrom").value = s.pauseFrom || "";
  $("#pauseTo").value = s.pauseTo || "";
  $("#pauseMessage").value = s.pauseMessage || "";
  $("#dailyOrderLimit").value = Number(s.dailyOrderLimit || 0);
}

function renderAll() {
  renderStats();
  renderOrders();
  renderCalendar();
  renderProducts();
  renderManualOrderProducts();
  renderEggSettings();
  renderInsights();
  renderBusinessSettings();
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".tab,.tab-panel").forEach(element => element.classList.remove("active"));
    tab.classList.add("active");
    $("#" + tab.dataset.tab).classList.add("active");
  };
});

["searchOrders", "statusFilter", "archiveFilter"].forEach(id => {
  $("#" + id).addEventListener(id === "searchOrders" ? "input" : "change", renderOrders);
});



const newProductGalleryButton = $("#newProductGalleryButton");
if (newProductGalleryButton) {
  newProductGalleryButton.onclick = () => {
    openImageGallery(imageUrl => {
      $("#newProductImage").value = imageUrl;
      setImagePreview($("#newProductImagePreview"), imageUrl);
    });
  };
}

const newProductImageButton = $("#newProductImageButton");
const newProductImageFile = $("#newProductImageFile");
if (newProductImageButton && newProductImageFile) {
  newProductImageButton.onclick = () => newProductImageFile.click();
  newProductImageFile.onchange = () => {
    const file = newProductImageFile.files && newProductImageFile.files[0];
    if (!file) return;
    uploadSelectedImage(file, newProductImageButton, imageUrl => {
      $("#newProductImage").value = imageUrl;
      setImagePreview($("#newProductImagePreview"), imageUrl);
    });
    newProductImageFile.value = "";
  };
}

$("#newProductImage")?.addEventListener("input", event => {
  setImagePreview($("#newProductImagePreview"), event.target.value.trim());
});

$("#loginButton").onclick = login;
$("#adminPassword").onkeydown = event => { if (event.key === "Enter") login(); };
$("#logoutButton").onclick = () => {
  sessionStorage.removeItem("pdp-admin-token");
  token = "";
  showLogin("Byli jste odhlášeni.");
};

$("#showManualOrder").onclick = () => $("#manualOrderForm").classList.remove("hidden");
$("#cancelManualOrder").onclick = () => $("#manualOrderForm").classList.add("hidden");
$("#saveManualOrder").onclick = () => {
  const items = products.map(product => ({
    productId: String(product.id),
    name: product.name,
    qty: Number(document.querySelector(`[data-mp="${esc(product.id)}"]`).value) || 0,
    price: product.price
  })).filter(item => item.qty > 0);

  post("manualOrder", {
    name: $("#manualName").value,
    phone: $("#manualPhone").value,
    email: $("#manualEmail").value,
    pickup: $("#manualPickup").value,
    status: $("#manualStatus").value,
    note: $("#manualNote").value,
    items
  }, data => data.ok ? loadData() : alert(data.message));
};

$("#showProductForm").onclick = () => $("#productForm").classList.remove("hidden");
$("#cancelProductForm").onclick = () => $("#productForm").classList.add("hidden");
$("#saveNewProduct").onclick = () => {
  const name = $("#newProductName").value.trim();
  if (!name) return alert("Vyplňte název produktu.");

  const product = {
    id: String(Date.now()),
    name,
    emoji: $("#newProductEmoji").value || "📦",
    price: Number($("#newProductPrice").value) || 0,
    unit: $("#newProductUnit").value || "kus",
    short: $("#newProductShort").value,
    detail: $("#newProductDetail").value,
    image: $("#newProductImage")?.value.trim() || "",
    leadDays: Number($("#newProductLead").value) || 0,
    quick: $("#newProductQuick").value.split(",").map(value => Number(value.trim())).filter(Boolean),
    capacity: Number($("#newProductCapacity").value) || 0,
    stock: Number($("#newProductStock").value) || 0,
    stockUnit: $("#newProductStockUnit").value.trim() || "ks",
    soldOutText: $("#newProductSoldOutText").value || "Momentálně vyprodáno",
    visible: true,
    soldOut: false,
    preorder: $("#newProductPreorder")?.checked || false,
    restock: $("#newProductRestock")?.value || "",
    emailGroup: $("#newProductEmailGroup")?.value || "FARMARI",
    emailText: $("#newProductEmailText")?.value.trim() || ""
  };
  if (product.emailGroup === "VLASTNI" && !product.emailText) return alert("U vlastního textu vyplňte vlastní označení.");
  post("saveProduct", { product }, data => data.ok ? loadData() : alert(data.message));
};

$("#saveEggSettings").onclick = () => {
  const button = $("#saveEggSettings");
  button.disabled = true;
  button.textContent = "Ukládám…";

  post("saveEggSettings", {
    settings: {
      currentStock: Number($("#eggCurrentStock").value),
      dailyProduction: Number($("#eggDailyProduction").value),
      safetyReserve: Number($("#eggSafetyReserve").value),
      planningDays: Number($("#eggPlanningDays").value)
    }
  }, data => {
    button.disabled = false;
    button.textContent = "Uložit nastavení";
    if (!data.ok) return alert(data.message);
    loadData();
  });
};


$("#saveBusinessSettings").onclick = () => {
  if ($("#ordersPaused").checked) {
    if (!$("#pauseFrom").value || !$("#pauseTo").value) return alert("Vyplňte začátek i konec blokace vyzvednutí.");
    if ($("#pauseFrom").value > $("#pauseTo").value) return alert("Konec blokace nesmí být před jejím začátkem.");
  }
  const settings = {
    bannerEnabled: $("#bannerEnabled").checked,
    bannerStyle: $("#bannerStyle").value,
    bannerTitle: $("#bannerTitle").value,
    bannerText: $("#bannerText").value,
    bannerFrom: $("#bannerFrom").value,
    bannerTo: $("#bannerTo").value,
    ordersPaused: $("#ordersPaused").checked,
    pauseFrom: $("#pauseFrom").value,
    pauseTo: $("#pauseTo").value,
    pauseMessage: $("#pauseMessage").value,
    dailyOrderLimit: Number($("#dailyOrderLimit").value) || 0
  };
  post("saveBusinessSettings", { settings }, data => {
    if (!data.ok) return alert(data.message);
    businessSettings = data.settings || settings;
    alert("Nastavení webu bylo uloženo.");
    renderBusinessSettings();
  });
};


const excludeMyVisits = $("#excludeMyVisits");
if (excludeMyVisits) {
  updateVisitExclusionUi();
  excludeMyVisits.addEventListener("change", () => {
    const excluded = excludeMyVisits.checked;
    try {
      if (excluded) localStorage.setItem(ADMIN_VISIT_EXCLUDE_KEY, "1");
      else localStorage.removeItem(ADMIN_VISIT_EXCLUDE_KEY);
    } catch (_) {}
    updateVisitExclusionUi("Ukládám nastavení zařízení…");

    const visitorId = adminVisitorId();
    if (!visitorId) {
      updateVisitExclusionUi("Nastavení v tomto prohlížeči nelze uložit.");
      return;
    }
    post("setVisitExclusion", { visitorId, excluded, removeExisting: excluded }, data => {
      if (!data.ok) {
        updateVisitExclusionUi(data.message || "Nastavení se nepodařilo uložit.");
        return;
      }
      visitStats = data.visitStats || visitStats;
      updateVisitExclusionUi(excluded
        ? "Toto zařízení je vyloučeno. Jeho dřívější návštěvy byly odstraněny."
        : "Toto zařízení se bude znovu započítávat do návštěvnosti.");
      renderStats();
      renderInsights();
    });
  });
}

if (token) {
  markThisDeviceAsAdminVisitor(true);
  const cacheShown = loadAdminCache();
  if (!cacheShown) {
    showApp();
    setAdminRefreshState("Načítám aktuální objednávky a produkty…");
  }
  loadData(true);
} else {
  showLogin();
}
