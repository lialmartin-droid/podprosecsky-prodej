window.PDP_ADMIN_VERSION = "12";
console.info("Podprosečské produkty – admin.js V12");

let products = [];
let orders = [];
let eggSettings = null;
let eggAvailability = null;
let token = sessionStorage.getItem("pdp-admin-token") || "";
let requestTimer = null;

const $ = selector => document.querySelector(selector);
const money = value => `${Number(value || 0)} Kč`;
const esc = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function url() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function localDate(value) {
  if (!value) return "Bez termínu";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("cs-CZ");
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
  const endpoint = url();
  if (!endpoint || !endpoint.endsWith("/exec")) {
    callback({ ok: false, message: "Administrace není správně propojená s Apps Scriptem." });
    return;
  }

  const form = $("#adminBackendForm");
  form.action = endpoint;
  $("#adminAction").value = action;
  $("#adminToken").value = token;
  $("#adminPayload").value = JSON.stringify(payload || {});
  window.__adminCallback = callback;

  clearTimeout(requestTimer);
  requestTimer = setTimeout(() => {
    if (window.__adminCallback === callback) {
      window.__adminCallback = null;
      callback({
        ok: false,
        message: "Server nevrátil odpověď. Zkontrolujte nové nasazení Apps Scriptu a nastavení přístupu Kdokoli."
      });
    }
  }, 20000);

  form.submit();
}

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "PDP_BACKEND_RESULT") return;
  clearTimeout(requestTimer);
  if (window.__adminCallback) {
    const callback = window.__adminCallback;
    window.__adminCallback = null;
    callback(data);
  }
});

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
    $("#adminPassword").value = "";
    loadData();
  });
}

function loadData() {
  if (!token) return showLogin();

  window.PDP_ADMIN_DATA = data => {
    if (!data || !data.ok) {
      sessionStorage.removeItem("pdp-admin-token");
      token = "";
      return showLogin(data?.message || "Přihlaste se znovu.");
    }

    products = data.products || [];
    orders = data.orders || [];
    eggSettings = data.eggSettings || null;
    eggAvailability = data.eggAvailability || null;
    showApp();
    renderAll();
  };

  const script = document.createElement("script");
  script.src = `${url()}?action=adminData&token=${encodeURIComponent(token)}&callback=PDP_ADMIN_DATA&t=${Date.now()}`;
  script.onerror = () => showLogin("Nepodařilo se načíst administraci.");
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

function renderStats() {
  $("#statNew").textContent = orders.filter(order => order.status === "Nová").length;
  $("#statRevenue").textContent = money(
    orders.filter(order => order.status !== "Zrušeno").reduce((sum, order) => sum + Number(order.total || 0), 0)
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
}

function filteredOrders() {
  const query = $("#searchOrders").value.toLowerCase();
  const status = $("#statusFilter").value;
  const archive = $("#archiveFilter").value;

  return orders.filter(order =>
    (!query || order.name.toLowerCase().includes(query) || (order.phone || "").toLowerCase().includes(query)) &&
    (!status || order.status === status) &&
    (archive === "all" || (archive === "archive" ? archived(order) : !archived(order)))
  );
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

function renderOrders() {
  const list = filteredOrders();
  $("#ordersList").innerHTML = list.length ? list.map(order => `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${esc(order.name)}</h3>
          <div class="meta">${esc(order.created)} · ${esc(order.phone || "bez telefonu")}</div>
          <div class="badges">
            <span class="badge blue">${esc(localDate(order.pickup))}</span>
            ${eggQty(order) ? `<span class="badge green">🥚 ${eggQty(order)} ks</span>` : ""}
            ${archived(order) ? '<span class="badge gray">Archiv</span>' : ""}
          </div>
        </div>
        <strong>${money(order.total)}</strong>
      </div>
      <div class="item-list">${itemHtml(order)}</div>
      ${order.note ? `<div class="meta">Poznámka: ${esc(order.note)}</div>` : ""}
      <div class="card-bottom">
        <select class="status-select" data-status="${order.id}">${statusOptions(order.status)}</select>
        <div class="actions">
          <button class="secondary-button" data-edit-order="${order.id}">Upravit</button>
          <button class="danger-button" data-delete-order="${order.id}">Smazat</button>
        </div>
      </div>
      <div id="oe${order.id}" class="editor">
        <div class="form-grid">
          <label><span>Jméno</span><input data-on="${order.id}" value="${esc(order.name)}"></label>
          <label><span>Telefon</span><input data-op="${order.id}" value="${esc(order.phone)}"></label>
          <label><span>Termín</span><input data-od="${order.id}" type="date" value="${esc(order.pickup)}"></label>
          <label><span>Stav</span><select data-os="${order.id}">${statusOptions(order.status)}</select></label>
          <div class="full">
            <span class="field-label">Položky</span>
            <div class="quantity-list">
              ${products.map(product => {
                const item = (order.items || []).find(entry => String(entry.productId) === String(product.id));
                return `<div class="quantity-row"><span>${product.emoji} ${esc(product.name)}</span><input data-oi="${order.id}-${product.id}" type="number" min="0" value="${item ? item.qty : 0}"></div>`;
              }).join("")}
            </div>
          </div>
          <label class="full"><span>Poznámka</span><textarea data-ot="${order.id}">${esc(order.note)}</textarea></label>
        </div>
        <div class="actions"><button class="primary-small" data-save-order="${order.id}">Uložit změny</button></div>
      </div>
    </article>`).join("") : '<div class="empty">Žádné objednávky.</div>';

  document.querySelectorAll("[data-status]").forEach(select => {
    select.onchange = () => {
      const order = orders.find(item => item.id === select.dataset.status);
      order.status = select.value;
      saveOrder(order);
    };
  });

  document.querySelectorAll("[data-edit-order]").forEach(button => {
    button.onclick = () => $("#oe" + button.dataset.editOrder).classList.toggle("open");
  });

  document.querySelectorAll("[data-save-order]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.saveOrder;
      const order = orders.find(item => item.id === id);
      order.name = document.querySelector(`[data-on="${id}"]`).value;
      order.phone = document.querySelector(`[data-op="${id}"]`).value;
      order.pickup = document.querySelector(`[data-od="${id}"]`).value;
      order.status = document.querySelector(`[data-os="${id}"]`).value;
      order.note = document.querySelector(`[data-ot="${id}"]`).value;
      order.items = products.map(product => {
        const quantity = Number(document.querySelector(`[data-oi="${id}-${product.id}"]`).value) || 0;
        return { productId: String(product.id), name: product.name, qty: quantity, price: product.price };
      }).filter(item => item.qty > 0);
      saveOrder(order);
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
      ${groups[key].map(order => `<div class="calendar-entry"><div><strong>${esc(order.name)}</strong><div class="meta">${itemHtml(order)}</div></div><div><strong>${money(order.total)}</strong><div class="meta">${order.status}</div></div></div>`).join("")}
    </article>`;
  }).join("") || '<div class="empty">Kalendář je prázdný.</div>';
}

function productBadges(product) {
  if (!product.visible) return '<span class="badge gray">Skryto</span>';
  if (product.soldOut) return '<span class="badge orange">Vyprodáno</span>';
  return '<span class="badge green">V prodeji</span>';
}

function renderProducts() {
  $("#productsList").innerHTML = products.map(product => `
    <article class="card">
      <div class="card-head">
        <div style="display:flex;gap:12px">
          <div style="font-size:36px">${product.emoji}</div>
          <div><h3>${esc(product.name)}</h3><div class="meta">${esc(product.short)}</div><div class="badges">${productBadges(product)}</div></div>
        </div>
        <button class="secondary-button" data-ep="${product.id}">Upravit</button>
      </div>
      <div id="pe${product.id}" class="editor">
        <div class="form-grid">
          <label><span>Název</span><input data-pn="${product.id}" value="${esc(product.name)}"></label>
          <label><span>Emoji</span><input data-pem="${product.id}" value="${product.emoji}"></label>
          <label><span>Cena</span><input data-pp="${product.id}" type="number" value="${product.price}"></label>
          <label><span>Jednotka</span><input data-pu="${product.id}" value="${esc(product.unit)}"></label>
          <label class="full"><span>Krátký popis</span><input data-ps="${product.id}" value="${esc(product.short)}"></label>
          <label class="full"><span>Podrobnosti</span><textarea data-pd="${product.id}">${esc(product.detail)}</textarea></label>
          <label><span>Doplnění</span><input data-pr="${product.id}" type="date" value="${product.restock || ""}"></label>
          <label><span>Předstih dní</span><input data-pl="${product.id}" type="number" value="${product.leadDays}"></label>
          <label class="full"><span>Rychlá tlačítka</span><input data-pq="${product.id}" value="${(product.quick || []).join(", ")}"></label>
        </div>
        <div class="actions">
          <label><input data-pv="${product.id}" type="checkbox" ${product.visible ? "checked" : ""}> Zobrazovat</label>
          <label><input data-po="${product.id}" type="checkbox" ${product.soldOut ? "checked" : ""}> Vyprodáno</label>
          <button class="danger-button" data-dp="${product.id}">Smazat</button>
          <button class="primary-small" data-sp="${product.id}">Uložit</button>
        </div>
      </div>
    </article>`).join("");

  document.querySelectorAll("[data-ep]").forEach(button => {
    button.onclick = () => $("#pe" + button.dataset.ep).classList.toggle("open");
  });

  document.querySelectorAll("[data-sp]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.sp;
      const product = products.find(item => String(item.id) === id);
      product.name = document.querySelector(`[data-pn="${id}"]`).value;
      product.emoji = document.querySelector(`[data-pem="${id}"]`).value;
      product.price = Number(document.querySelector(`[data-pp="${id}"]`).value) || 0;
      product.unit = document.querySelector(`[data-pu="${id}"]`).value;
      product.short = document.querySelector(`[data-ps="${id}"]`).value;
      product.detail = document.querySelector(`[data-pd="${id}"]`).value;
      product.restock = document.querySelector(`[data-pr="${id}"]`).value;
      product.leadDays = Number(document.querySelector(`[data-pl="${id}"]`).value) || 0;
      product.quick = document.querySelector(`[data-pq="${id}"]`).value.split(",").map(value => Number(value.trim())).filter(Boolean);
      product.visible = document.querySelector(`[data-pv="${id}"]`).checked;
      product.soldOut = document.querySelector(`[data-po="${id}"]`).checked;
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
      <span>${product.emoji} ${esc(product.name)} · ${money(product.price)}</span>
      <input data-mp="${product.id}" type="number" min="0" value="0">
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

function renderAll() {
  renderStats();
  renderOrders();
  renderCalendar();
  renderProducts();
  renderManualOrderProducts();
  renderEggSettings();
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
    qty: Number(document.querySelector(`[data-mp="${product.id}"]`).value) || 0,
    price: product.price
  })).filter(item => item.qty > 0);

  post("manualOrder", {
    name: $("#manualName").value,
    phone: $("#manualPhone").value,
    pickup: $("#manualPickup").value,
    status: $("#manualStatus").value,
    note: $("#manualNote").value,
    items
  }, data => data.ok ? loadData() : alert(data.message));
};

$("#showProductForm").onclick = () => $("#productForm").classList.remove("hidden");
$("#cancelProductForm").onclick = () => $("#productForm").classList.add("hidden");
$("#saveNewProduct").onclick = () => {
  const product = {
    id: String(Date.now()),
    name: $("#newProductName").value,
    emoji: $("#newProductEmoji").value || "📦",
    price: Number($("#newProductPrice").value) || 0,
    unit: $("#newProductUnit").value || "kus",
    short: $("#newProductShort").value,
    detail: $("#newProductDetail").value,
    leadDays: Number($("#newProductLead").value) || 0,
    quick: $("#newProductQuick").value.split(",").map(value => Number(value.trim())).filter(Boolean),
    visible: true,
    soldOut: false,
    restock: ""
  };
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

if (token) loadData();
else showLogin();
