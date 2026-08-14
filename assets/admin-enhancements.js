// Admin v2.6.1 – oprava vypršení přihlášení + sklad + návštěvy
(() => {
  const money2 = value => `${Math.round(Number(value || 0))} Kč`;
  const esc2 = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const COLORS = ["#2f7d55", "#d99a3e", "#5b7fa3", "#a66b7c", "#7c8d45", "#8b6f47", "#6d6aa8", "#b86e3c", "#4f8c8b", "#9b7b9d"];

  function dateKey(value) {
    if (!value) return "";
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function todayKeyLocal() {
    return typeof currentPragueDateKey === "function"
      ? currentPragueDateKey()
      : new Date().toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const d = new Date(`${value}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .analytics-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:0 0 18px;padding:14px;border:1px solid #eadfca;border-radius:16px;background:#fffdf8}
      .analytics-toolbar label{display:grid;gap:5px;font-size:13px;font-weight:700;color:#584d40;min-width:140px}
      .analytics-toolbar select,.analytics-toolbar input{min-height:42px;padding:8px 10px;border:1px solid #d8cbb7;border-radius:10px;background:#fff}
      .analytics-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 18px}
      .analytics-card{padding:14px;border:1px solid #eadfca;border-radius:15px;background:#fffdf8}
      .analytics-card span{display:block;font-size:12px;color:#75695d}.analytics-card strong{display:block;margin-top:4px;font-size:22px}
      .analytics-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,.7fr);gap:14px;margin-bottom:16px}
      .analytics-panel{padding:16px;border:1px solid #eadfca;border-radius:16px;background:#fff}
      .analytics-panel h3{margin-top:0}
      .chart-bars{display:grid;gap:10px}.chart-row{display:grid;grid-template-columns:minmax(95px,180px) 1fr auto;gap:10px;align-items:center}
      .chart-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chart-track{height:18px;background:#f0eadf;border-radius:999px;overflow:hidden}
      .chart-fill{height:100%;min-width:2px;background:linear-gradient(90deg,#2f7d55,#75a87f);border-radius:999px}
      .pie-wrap{display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:center}.pie-chart{width:180px;height:180px;border-radius:50%;position:relative}
      .pie-chart:after{content:"";position:absolute;inset:43px;border-radius:50%;background:#fff}.pie-legend{display:grid;gap:7px}
      .pie-key{display:flex;gap:8px;align-items:center;font-size:13px}.pie-dot{width:11px;height:11px;border-radius:3px;flex:none}
      .visit-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
      .visit-kpi{padding:13px;border-radius:14px;border:1px solid #eadfca;background:#fffdf8}
      .visit-kpi span{font-size:12px;color:#75695d;display:block}.visit-kpi strong{font-size:23px}
      .recent-visits{display:grid;gap:8px}.recent-visit{display:grid;grid-template-columns:1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid #eee5d8}
      .recent-visit small{display:block;color:#75695d}.analytics-note{font-size:13px;color:#75695d}
      .analytics-updated{font-size:12px;color:#75695d;margin-left:auto}
      .packaging-low{border-color:#d58d79;background:#fff6f2}
      .packaging-order-box{margin-top:12px;padding:14px;border:1px solid #eadfca;border-radius:14px;background:#fffdf8}
      .packaging-order-box .quantity-row small{display:block;color:#75695d;font-size:11px}
      .packaging-own-row{display:flex;align-items:center;gap:8px;margin:10px 0;font-weight:700}
      .packaging-summary-v26{margin:4px 0 8px;font-weight:700}
      .tabs{
        display:flex;
        gap:6px;
        overflow-x:auto;
        overflow-y:hidden;
        -webkit-overflow-scrolling:touch;
        scrollbar-width:none;
        scroll-snap-type:x proximity;
        padding-bottom:4px;
      }
      .tabs::-webkit-scrollbar{display:none}
      .tabs .tab{
        flex:0 0 auto;
        white-space:nowrap;
        scroll-snap-align:start;
        min-width:max-content;
      }
      @media(max-width:760px){
        .analytics-grid{grid-template-columns:1fr}.pie-wrap{grid-template-columns:1fr;justify-items:center}
        .chart-row{grid-template-columns:minmax(90px,130px) 1fr auto}
        .analytics-toolbar label{min-width:calc(50% - 8px);flex:1}.analytics-updated{width:100%;margin-left:0}
        .tabs{margin-left:-4px;margin-right:-4px;padding-left:4px;padding-right:4px}
        .tabs .tab{font-size:15px;padding-left:12px;padding-right:12px}
      }
    `;
    document.head.appendChild(style);
  }

  function addTab(buttonText, panelId) {
    const tabs = document.querySelector(".tabs");
    if (!tabs || document.querySelector(`[data-tab="${panelId}"]`)) return;
    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.tab = panelId;
    button.textContent = buttonText;
    const settings = tabs.querySelector('[data-tab="settingsTab"]');
    if (settings) tabs.insertBefore(button, settings); else tabs.appendChild(button);
    button.addEventListener("click", () => activateTab(panelId));
  }

  function activateTab(panelId) {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === panelId));
    document.querySelectorAll(".tab-panel").forEach(x => x.classList.toggle("active", x.id === panelId));
    if (panelId === "productStatsTab") renderProductAnalytics();
    if (panelId === "visitsTab") renderVisitAnalytics();
  }

  function cleanOldStats() {
    ["statVisits", "statUniqueToday", "statQrVisits", "statLinkVisits"].forEach(id =>
      document.getElementById(id)?.closest("article")?.classList.add("hidden")
    );

    const insights = document.getElementById("insightsTab");
    const insightsButton = document.querySelector('[data-tab="insightsTab"]');
    if (insightsButton) insightsButton.textContent = "Zákazníci";
    if (!insights) return;
    const h2 = insights.querySelector("h2");
    if (h2) h2.textContent = "Zákazníci a tržby";
    insights.querySelector(".settings-note")?.classList.add("hidden");
    ["visitSummary", "visitSources", "topProducts"].forEach(id =>
      document.getElementById(id)?.closest("article")?.classList.add("hidden")
    );
    document.getElementById("visitTimeline")?.closest("article")?.classList.add("hidden");
    document.querySelector(".visit-exclusion-card")?.classList.add("hidden");
  }

  function buildPanels() {
    const main = document.querySelector("#adminApp main.content");
    const settings = document.getElementById("settingsTab");
    if (!main || !settings || document.getElementById("productStatsTab")) return;

    const productPanel = document.createElement("section");
    productPanel.id = "productStatsTab";
    productPanel.className = "tab-panel";
    productPanel.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">Výkon nabídky</div><h2>Statistiky produktů</h2></div></div>
      <div class="analytics-toolbar">
        <label>Metrika<select id="paMetric">
          <option value="orders">Počet objednávek produktu</option>
          <option value="revenue">Tržba</option>
          <option value="qty">Prodané množství</option>
          <option value="avg">Průměrná tržba / objednávku</option>
        </select></label>
        <label>Období<select id="paPeriod">
          <option value="all">Celé období</option><option value="month">Tento měsíc</option>
          <option value="30">Posledních 30 dní</option><option value="year">Tento rok</option>
          <option value="custom">Vlastní období</option>
        </select></label>
        <label id="paFromWrap" class="hidden">Od<input id="paFrom" type="date"></label>
        <label id="paToWrap" class="hidden">Do<input id="paTo" type="date"></label>
        <label>Počet produktů<select id="paLimit"><option value="0">Všechny</option><option value="5">TOP 5</option><option value="10">TOP 10</option></select></label>
        <label>Řazení<select id="paSort"><option value="desc">Od nejvyššího</option><option value="asc">Od nejnižšího</option></select></label>
      </div>
      <div id="paCards" class="analytics-cards"></div>
      <div class="analytics-grid">
        <article class="analytics-panel"><h3 id="paBarTitle">Produkty</h3><div id="paBars" class="chart-bars"></div></article>
        <article class="analytics-panel"><h3>Podíl na celku</h3><div id="paPie"></div></article>
      </div>
      <article class="analytics-panel"><h3>Přehled všech produktů</h3><div id="paTable"></div></article>`;

    const visitsPanel = document.createElement("section");
    visitsPanel.id = "visitsTab";
    visitsPanel.className = "tab-panel";
    visitsPanel.innerHTML = `
      <div class="section-head">
        <div><div class="eyebrow">Zákaznická stránka</div><h2>Návštěvnost</h2></div>
        <button id="visitRefresh" class="secondary-button" type="button">Aktualizovat data</button>
      </div>
      <div class="analytics-toolbar">
        <label>Graf<select id="vaMetric"><option value="visits">Všechny návštěvy</option><option value="unique">Unikátní návštěvníci</option></select></label>
        <label>Období<select id="vaPeriod"><option value="7">7 dní</option><option value="14">14 dní</option><option value="30">30 dní</option><option value="90">3 měsíce</option><option value="365">1 rok</option></select></label>
        <span id="vaUpdated" class="analytics-updated"></span>
      </div>
      <div id="vaKpis" class="visit-kpis"></div>
      <div class="analytics-grid">
        <article class="analytics-panel"><h3>Návštěvy v čase</h3><div id="vaTimeline" class="chart-bars"></div></article>
        <article class="analytics-panel"><h3>Zdroj návštěv</h3><div id="vaSources"></div></article>
      </div>
      <div class="analytics-grid">
        <article class="analytics-panel"><h3>Poslední návštěvy</h3><div id="vaRecent" class="recent-visits"></div></article>
        <article class="analytics-panel visit-exclusion-card-v25"><h3>Moje zařízení</h3>
          <label class="visit-toggle-row"><input id="excludeMyVisitsV25" type="checkbox"><span><strong>Toto je moje zařízení – nepočítat návštěvy</strong><small>Platí pro tento prohlížeč.</small></span></label>
          <p id="visitExclusionStatusV25" class="analytics-note"></p>
        </article>
      </div>`;

    main.insertBefore(productPanel, settings);
    main.insertBefore(visitsPanel, settings);
    addTab("Statistiky produktů", "productStatsTab");
    addTab("Návštěvnost", "visitsTab");

    ["paMetric","paPeriod","paFrom","paTo","paLimit","paSort"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => {
        const custom = document.getElementById("paPeriod")?.value === "custom";
        document.getElementById("paFromWrap")?.classList.toggle("hidden", !custom);
        document.getElementById("paToWrap")?.classList.toggle("hidden", !custom);
        renderProductAnalytics();
      });
    });
    ["vaMetric","vaPeriod"].forEach(id =>
      document.getElementById(id)?.addEventListener("change", renderVisitAnalytics)
    );
    document.getElementById("visitRefresh")?.addEventListener("click", () => {
      if (typeof loadData === "function") loadData(true);
      loadRecentVisitsV26();
      setTimeout(renderVisitAnalytics, 700);
    });

    const toggle = document.getElementById("excludeMyVisitsV25");
    if (toggle) {
      toggle.checked = typeof isThisDeviceExcluded === "function" ? isThisDeviceExcluded() : true;
      toggle.addEventListener("change", () => {
        const original = document.getElementById("excludeMyVisits");
        if (original) {
          original.checked = toggle.checked;
          original.dispatchEvent(new Event("change", { bubbles: true }));
        }
        setTimeout(syncVisitExclusionUi, 300);
      });
      syncVisitExclusionUi();
    }
  }

  function productEntriesInPeriod() {
    const period = document.getElementById("paPeriod")?.value || "all";
    const today = todayKeyLocal();
    let from = "", to = today;
    if (period === "month") from = today.slice(0, 7) + "-01";
    else if (period === "30") from = addDays(today, -29);
    else if (period === "year") from = today.slice(0, 4) + "-01-01";
    else if (period === "custom") {
      from = document.getElementById("paFrom")?.value || "";
      to = document.getElementById("paTo")?.value || today;
    }

    const all = typeof fulfilledRevenueEntries === "function" ? fulfilledRevenueEntries() : [];
    return all.filter(entry => {
      const d = dateKey(entry.at);
      return (!from || d >= from) && (!to || d <= to);
    });
  }

  function productStats() {
    const map = new Map();
    productEntriesInPeriod().forEach(entry => (entry.items || []).forEach(item => {
      const id = String(item.productId || item.name || "");
      const key = id || String(item.name || "Produkt");
      let row = map.get(key);
      if (!row) row = {
        id: key,
        name: item.name || (typeof productById === "function" ? productById(id)?.name : "") || "Produkt",
        orderIds: new Set(),
        qty: 0,
        revenue: 0
      };
      row.orderIds.add(String(entry.orderId || entry.order?.id || ""));
      row.qty += Number(item.qty || 0);
      row.revenue += Number(item.qty || 0) * Number(item.price || 0);
      map.set(key, row);
    }));
    return [...map.values()].map(r => ({
      ...r,
      orders: r.orderIds.size,
      avg: r.orderIds.size ? r.revenue / r.orderIds.size : 0
    }));
  }

  function metricValue(row, metric) {
    return metric === "revenue" ? row.revenue :
      metric === "qty" ? row.qty :
      metric === "avg" ? row.avg : row.orders;
  }

  function metricLabel(metric) {
    return metric === "revenue" ? "Tržba" :
      metric === "qty" ? "Prodané množství" :
      metric === "avg" ? "Průměrná tržba / objednávku" :
      "Počet objednávek produktu";
  }

  function formatMetric(value, metric) {
    return ["revenue","avg"].includes(metric) ? money2(value) : String(Math.round(value));
  }

  function renderProductAnalytics() {
    if (!document.getElementById("productStatsTab")) return;
    const metric = document.getElementById("paMetric")?.value || "orders";
    const sort = document.getElementById("paSort")?.value || "desc";
    const limit = Number(document.getElementById("paLimit")?.value || 0);

    const rows = productStats().sort((a,b) =>
      sort === "asc"
        ? metricValue(a,metric) - metricValue(b,metric)
        : metricValue(b,metric) - metricValue(a,metric)
    );
    const shown = limit ? rows.slice(0, limit) : rows;

    const entries = productEntriesInPeriod();
    const totalRevenue = rows.reduce((s,r)=>s+r.revenue,0);
    const totalOrders = new Set(entries.map(e=>String(e.orderId||e.order?.id||""))).size;
    const totalQty = rows.reduce((s,r)=>s+r.qty,0);

    document.getElementById("paCards").innerHTML =
      `<div class="analytics-card"><span>Produktů s prodejem</span><strong>${rows.length}</strong></div>` +
      `<div class="analytics-card"><span>Objednávek</span><strong>${totalOrders}</strong></div>` +
      `<div class="analytics-card"><span>Prodaných položek</span><strong>${Math.round(totalQty)}</strong></div>` +
      `<div class="analytics-card"><span>Tržba</span><strong>${money2(totalRevenue)}</strong></div>`;

    document.getElementById("paBarTitle").textContent = metricLabel(metric);
    const max = Math.max(1, ...shown.map(r => metricValue(r,metric)));
    document.getElementById("paBars").innerHTML = shown.length
      ? shown.map(r => `
        <div class="chart-row">
          <span class="chart-label" title="${esc2(r.name)}">${esc2(r.name)}</span>
          <div class="chart-track"><div class="chart-fill" style="width:${Math.max(1,Math.round(metricValue(r,metric)/max*100))}%"></div></div>
          <strong>${formatMetric(metricValue(r,metric),metric)}</strong>
        </div>`).join("")
      : '<div class="empty">Zatím bez dat pro zvolené období.</div>';

    renderPie(shown, metric);

    const byOrders = [...rows].sort((a,b)=>b.orders-a.orders);
    document.getElementById("paTable").innerHTML = byOrders.length
      ? byOrders.map((r,i)=>`
        <div class="rank-row">
          <span>${i+1}. ${esc2(r.name)} <small>${r.orders} obj. · ${Math.round(r.qty)} ks</small></span>
          <strong>${money2(r.revenue)} <small>Ø ${money2(r.avg)}</small></strong>
        </div>`).join("")
      : '<div class="empty">Zatím bez dat.</div>';
  }

  function renderPie(rows, metric) {
    const host = document.getElementById("paPie");
    if (!host) return;
    const positive = rows.filter(r => metricValue(r,metric) > 0);
    const total = positive.reduce((s,r)=>s+metricValue(r,metric),0);
    if (!positive.length || !total) {
      host.innerHTML = '<div class="empty">Zatím bez dat.</div>';
      return;
    }
    let start = 0;
    const stops = [];
    positive.forEach((r,i)=>{
      const end = start + metricValue(r,metric)/total*100;
      stops.push(`${COLORS[i%COLORS.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      start=end;
    });
    host.innerHTML = `
      <div class="pie-wrap">
        <div class="pie-chart" style="background:conic-gradient(${stops.join(",")})"></div>
        <div class="pie-legend">
          ${positive.map((r,i)=>`
            <div class="pie-key"><span class="pie-dot" style="background:${COLORS[i%COLORS.length]}"></span>
            <span>${esc2(r.name)} <strong>${Math.round(metricValue(r,metric)/total*100)} %</strong></span></div>`).join("")}
        </div>
      </div>`;
  }

  function syncVisitExclusionUi() {
    const check = document.getElementById("excludeMyVisitsV25");
    const status = document.getElementById("visitExclusionStatusV25");
    const excluded = typeof isThisDeviceExcluded === "function" ? isThisDeviceExcluded() : true;
    if (check) check.checked = excluded;
    if (status) status.textContent = excluded
      ? "Toto zařízení se do návštěvnosti nezapočítává."
      : "Toto zařízení se do návštěvnosti započítává.";
  }

  function renderVisitAnalytics() {
    if (!document.getElementById("visitsTab")) return;
    const stats = typeof visitStats !== "undefined" && visitStats
      ? visitStats
      : {totalVisits:0,uniqueVisitors:0,todayVisits:0,uniqueToday:0,last30Visits:0,uniqueLast30:0,bySource:[],daily:[]};

    document.getElementById("vaKpis").innerHTML =
      `<div class="visit-kpi"><span>Návštěvy dnes</span><strong>${stats.todayVisits || 0}</strong></div>` +
      `<div class="visit-kpi"><span>Unikátní dnes</span><strong>${stats.uniqueToday || 0}</strong></div>` +
      `<div class="visit-kpi"><span>Posledních 30 dní</span><strong>${stats.last30Visits || 0}</strong></div>` +
      `<div class="visit-kpi"><span>Unikátní / 30 dní</span><strong>${stats.uniqueLast30 || 0}</strong></div>` +
      `<div class="visit-kpi"><span>Celkem</span><strong>${stats.totalVisits || 0}</strong></div>` +
      `<div class="visit-kpi"><span>Unikátní celkem</span><strong>${stats.uniqueVisitors || 0}</strong></div>`;

    const metric = document.getElementById("vaMetric")?.value || "visits";
    const days = Number(document.getElementById("vaPeriod")?.value || 14);
    const daily = Array.isArray(stats.daily) ? stats.daily.slice(-days) : [];
    const max = Math.max(1,...daily.map(d=>Number(d[metric]||0)));

    document.getElementById("vaTimeline").innerHTML = daily.length
      ? daily.map(d=>`
        <div class="chart-row"><span>${esc2(d.day)}</span>
        <div class="chart-track"><div class="chart-fill" style="width:${Math.max(1,Math.round(Number(d[metric]||0)/max*100))}%"></div></div>
        <strong>${Number(d[metric]||0)}</strong></div>`).join("")
      : '<div class="empty">Zatím bez dat.</div>';

    const sources = Array.isArray(stats.bySource) ? stats.bySource : [];
    document.getElementById("vaSources").innerHTML = sources.length
      ? sources.map(s=>`<div class="rank-row"><span>${esc2(s.source)}</span><strong>${s.total || 0} <small>${s.unique || 0} unik.</small></strong></div>`).join("")
      : '<div class="empty">Zatím bez dat.</div>';

    const recent = Array.isArray(window.PDP_RECENT_VISITS_V26) ? window.PDP_RECENT_VISITS_V26 : (Array.isArray(stats.recentVisits) ? stats.recentVisits : []);
    document.getElementById("vaRecent").innerHTML = recent.length
      ? recent.slice(0,30).map(v=>`
        <div class="recent-visit"><div><strong>${esc2(formatVisitTimeV26(v.at || v.day || ""))}</strong>
        <small>${esc2(v.source || "")} · ${esc2(v.path || "/")}</small></div>
        <code>${esc2(String(v.visitorId || "").slice(-8))}</code></div>`).join("")
      : '<div class="analytics-note">Souhrnné statistiky jsou funkční. Přesný seznam posledních návštěv vyžaduje ještě rozšíření Apps Script backendu.</div>';

    const now = new Date();
    document.getElementById("vaUpdated").textContent =
      `Zobrazeno: ${now.toLocaleDateString("cs-CZ")} ${now.toLocaleTimeString("cs-CZ",{hour:"2-digit",minute:"2-digit"})}`;
    syncVisitExclusionUi();
  }


  // ---------- V2.6: přesné návštěvy + sklad obalů ----------
  let packagingV26 = {
    items: [],
    orderSelections: {},
    orderConsumed: {},
    movements: []
  };

  function isExpiredSessionV261(result) {
    const message = String(result && result.message || "");
    return !result?.ok && /Přihlášení vypršelo|Přihlaste se znovu/i.test(message);
  }

  function handleExpiredSessionV261(result) {
    if (!isExpiredSessionV261(result)) return false;
    try { sessionStorage.removeItem("pdp-admin-token"); } catch (_) {}
    try { token = ""; } catch (_) {}
    if (typeof showLogin === "function") {
      showLogin("Přihlášení vypršelo. Přihlaste se znovu.");
    }
    return true;
  }

  function postPromiseV26(action, payload = {}) {
    return new Promise(resolve => {
      if (typeof post !== "function") {
        resolve({ ok:false, message:"Administrace není připravena." });
        return;
      }
      post(action, payload, result => {
        const safeResult = result || {ok:false};
        if (handleExpiredSessionV261(safeResult)) {
          resolve(safeResult);
          return;
        }
        resolve(safeResult);
      });
    });
  }

  function formatVisitTimeV26(value) {
    if (!value) return "";
    const text = String(value);
    const d = new Date(text.length === 19 && !/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("cs-CZ", {dateStyle:"short", timeStyle:"medium"});
    }
    return text.replace("T", " ");
  }

  async function loadRecentVisitsV26() {
    const result = await postPromiseV26("getRecentVisits", {limit:100});
    if (!result.ok) return;
    window.PDP_RECENT_VISITS_V26 = Array.isArray(result.recentVisits) ? result.recentVisits : [];
    renderVisitAnalytics();
  }

  async function loadPackagingV26() {
    const result = await postPromiseV26("getPackagingData", {});
    if (!result.ok) {
      if (isExpiredSessionV261(result)) return;
      const host = document.getElementById("packagingStockContent");
      if (host) host.innerHTML = `<div class="empty">${esc2(result.message || "Sklad obalů se nepodařilo načíst.")}</div>`;
      return;
    }
    packagingV26 = {
      items: Array.isArray(result.items) ? result.items : [],
      orderSelections: result.orderSelections || {},
      orderConsumed: result.orderConsumed || {},
      movements: Array.isArray(result.movements) ? result.movements : []
    };
    renderPackagingStockV26();
    injectPackagingIntoOrdersV26();
  }

  function addPackagingTabV26() {
    const main = document.querySelector("#adminApp main.content");
    const settings = document.getElementById("settingsTab");
    if (!main || !settings || document.getElementById("packagingTab")) return;

    const panel = document.createElement("section");
    panel.id = "packagingTab";
    panel.className = "tab-panel";
    panel.innerHTML = `
      <div class="section-head">
        <div><div class="eyebrow">Spotřební materiál</div><h2>Sklad obalů na vejce</h2></div>
        <button id="packagingRefresh" class="secondary-button" type="button">Aktualizovat</button>
      </div>
      <p class="settings-note">
        Sklad je vedený v <strong>fyzických kusech obalů</strong>. U varianty pro 30 vajec znamená jedna sada
        <strong>2 fyzické kusy</strong>. Obal se odečte při změně objednávky na <strong>Připraveno</strong>.
      </p>
      <div id="packagingStockContent"></div>
      <article class="analytics-panel" style="margin-top:16px">
        <h3>Poslední pohyby skladu</h3>
        <div id="packagingMovements"></div>
      </article>`;
    main.insertBefore(panel, settings);
    addTab("Sklad", "packagingTab");
    document.getElementById("packagingRefresh")?.addEventListener("click", loadPackagingV26);
  }

  function packagingCapacityTextV26(item) {
    const pieces = Math.max(1, Number(item.piecesPerPack || 1));
    if (pieces === 2) return `${Math.floor(Number(item.stock || 0) / 2)} sad po 30 vejcích`;
    return `${Number(item.stock || 0)} balení`;
  }

  function renderPackagingStockV26() {
    const host = document.getElementById("packagingStockContent");
    if (!host) return;

    host.innerHTML = packagingV26.items.length ? `
      <div class="analytics-cards">
        ${packagingV26.items.map(item => {
          const low = Number(item.stock || 0) <= Number(item.minimum || 0);
          return `<div class="analytics-card ${low ? "packaging-low" : ""}">
            <span>${esc2(item.name)}</span>
            <strong>${Number(item.stock || 0)} ks</strong>
            <small>${esc2(packagingCapacityTextV26(item))}${low ? " · ⚠️ Dochází" : ""}</small>
          </div>`;
        }).join("")}
      </div>
      <div class="stack">
        ${packagingV26.items.map(item => `
          <article class="card">
            <div class="card-head">
              <div><h3>${esc2(item.name)}</h3>
                <div class="meta">1 zvolená sada/balení = ${Number(item.piecesPerPack || 1)} ks ze skladu</div>
              </div>
              <strong>${Number(item.stock || 0)} ks</strong>
            </div>
            <div class="form-grid">
              <label><span>Aktuálně skladem</span>
                <input type="number" min="0" step="1" data-pack-stock="${esc2(item.id)}" value="${Number(item.stock || 0)}">
              </label>
              <label><span>Upozornit při zásobě</span>
                <input type="number" min="0" step="1" data-pack-min="${esc2(item.id)}" value="${Number(item.minimum || 0)}">
              </label>
            </div>
            <div class="actions">
              <button class="secondary-button" type="button" data-pack-add="${esc2(item.id)}" data-delta="10">+10 ks</button>
              <button class="secondary-button" type="button" data-pack-add="${esc2(item.id)}" data-delta="1">+1 ks</button>
              <button class="primary-small" type="button" data-pack-save="${esc2(item.id)}">Uložit stav</button>
            </div>
          </article>`).join("")}
      </div>` : `<div class="empty">Sklad obalů je zatím prázdný.</div>`;

    const moveHost = document.getElementById("packagingMovements");
    if (moveHost) {
      moveHost.innerHTML = packagingV26.movements.length
        ? packagingV26.movements.slice(0,50).map(m => `
          <div class="rank-row">
            <span>${esc2(formatVisitTimeV26(m.at))} · ${esc2(m.name || "")}
              <small>${esc2(m.reason || "")}${m.orderNumber ? ` · ${esc2(m.orderNumber)}` : ""}</small>
            </span>
            <strong>${Number(m.delta || 0) > 0 ? "+" : ""}${Number(m.delta || 0)} ks</strong>
          </div>`).join("")
        : `<div class="empty">Zatím bez pohybů.</div>`;
    }

    document.querySelectorAll("[data-pack-save]").forEach(button => {
      button.onclick = async () => {
        const id = button.dataset.packSave;
        const stock = Number(document.querySelector(`[data-pack-stock="${CSS.escape(id)}"]`)?.value || 0);
        const minimum = Number(document.querySelector(`[data-pack-min="${CSS.escape(id)}"]`)?.value || 0);
        button.disabled = true;
        const result = await postPromiseV26("savePackagingItem", {id, stock, minimum});
        button.disabled = false;
        if (!result.ok) return alert(result.message || "Sklad se nepodařilo uložit.");
        await loadPackagingV26();
      };
    });

    document.querySelectorAll("[data-pack-add]").forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        const result = await postPromiseV26("adjustPackagingStock", {
          id: button.dataset.packAdd,
          delta: Number(button.dataset.delta || 0),
          reason: "Příjem obalů"
        });
        button.disabled = false;
        if (!result.ok) return alert(result.message || "Příjem se nepodařilo uložit.");
        await loadPackagingV26();
      };
    });
  }

  function selectionForOrderV26(orderId) {
    const source = packagingV26.orderSelections?.[String(orderId)] || {};
    return {
      own: Boolean(source.own),
      quantities: source.quantities || {}
    };
  }

  function packagingSelectionCompleteV26(orderId) {
    const source = packagingV26.orderSelections?.[String(orderId)];
    if (!source) return false;
    if (source.own) return true;
    return Object.values(source.quantities || {}).some(value => Number(value || 0) > 0);
  }

  function packagingSummaryV26(orderId) {
    const source = packagingV26.orderSelections?.[String(orderId)];
    if (!source) return "Obal nevybrán";
    if (source.own) return "Vlastní / bez obalu";
    const parts = packagingV26.items
      .map(item => {
        const qty = Number(source.quantities?.[item.id] || 0);
        return qty > 0 ? `${qty}× ${item.name}` : "";
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : "Obal nevybrán";
  }

  function orderNeedsPackagingV26(order) {
    if (!order || typeof eggQty !== "function") return false;
    return Number(eggQty(order) || 0) > 0;
  }

  function injectPackagingIntoOrdersV26() {
    if (!Array.isArray(window.orders || (typeof orders !== "undefined" ? orders : null))) return;
    const sourceOrders = typeof orders !== "undefined" ? orders : [];
    sourceOrders.forEach(order => {
      if (!orderNeedsPackagingV26(order)) return;
      const editor = document.getElementById("oe" + order.id);
      if (!editor || editor.querySelector("[data-packaging-order-box]")) return;

      const selection = selectionForOrderV26(order.id);
      const consumed = packagingV26.orderConsumed?.[String(order.id)] || {};
      const box = document.createElement("div");
      box.className = "packaging-order-box";
      box.dataset.packagingOrderBox = order.id;
      box.innerHTML = `
        <div class="field-label">📦 Obal na vejce</div>
        <div class="meta packaging-summary-v26">${esc2(packagingSummaryV26(order.id))}</div>
        <label class="packaging-own-row">
          <input type="checkbox" data-pack-own="${esc2(order.id)}" ${selection.own ? "checked" : ""}>
          Vlastní obal zákazníka / bez obalu
        </label>
        <div class="quantity-list">
          ${packagingV26.items.map(item => `
            <div class="quantity-row">
              <span>${esc2(item.name)}
                <small>sklad ${Number(item.stock || 0)} ks${Number(item.piecesPerPack || 1) > 1 ? ` · 1 sada = ${Number(item.piecesPerPack)} ks skladu` : ""}</small>
              </span>
              <input type="number" min="0" max="20" step="1"
                data-pack-order="${esc2(order.id)}-${esc2(item.id)}"
                value="${Number(selection.quantities?.[item.id] || 0)}">
            </div>`).join("")}
        </div>
        ${Object.keys(consumed).length ? `<div class="meta">✅ Ze skladu již odečteno: ${esc2(JSON.stringify(consumed))}</div>` : ""}
        <div class="meta">Výběr se ukládá automaticky. Při stavu <strong>Připraveno</strong> se obaly odečtou pouze jednou.</div>`;

      const formGrid = editor.querySelector(".form-grid");
      if (formGrid) {
        box.classList.add("full");
        formGrid.appendChild(box);
      } else {
        editor.prepend(box);
      }

      const own = box.querySelector(`[data-pack-own="${CSS.escape(order.id)}"]`);
      const inputs = box.querySelectorAll(`[data-pack-order^="${CSS.escape(order.id)}-"]`);

      async function saveSelection() {
        const ownValue = Boolean(own?.checked);
        const quantities = {};
        packagingV26.items.forEach(item => {
          const input = box.querySelector(`[data-pack-order="${CSS.escape(order.id + "-" + item.id)}"]`);
          quantities[item.id] = Math.max(0, Math.floor(Number(input?.value || 0)));
        });
        if (ownValue) {
          inputs.forEach(input => {
            input.value = "0";
            input.disabled = true;
          });
          Object.keys(quantities).forEach(key => quantities[key] = 0);
        } else {
          inputs.forEach(input => input.disabled = false);
        }

        const result = await postPromiseV26("savePackagingSelection", {
          orderId: order.id,
          selection: {own:ownValue, quantities}
        });
        if (!result.ok) {
          alert(result.message || "Výběr obalu se nepodařilo uložit.");
          return;
        }
        packagingV26.orderSelections[String(order.id)] = {own:ownValue, quantities};
        if (result.consumed) packagingV26.orderConsumed[String(order.id)] = result.consumed;
        const summary = box.querySelector(".packaging-summary-v26");
        if (summary) summary.textContent = packagingSummaryV26(order.id);
        if (result.items) {
          packagingV26.items = result.items;
          renderPackagingStockV26();
        }
      }

      own?.addEventListener("change", saveSelection);
      inputs.forEach(input => input.addEventListener("change", saveSelection));
      if (selection.own) inputs.forEach(input => input.disabled = true);
    });
  }

  function wrapOrdersForPackagingV26() {
    if (typeof renderOrders === "function" && !window.__PDP_RENDER_ORDERS_PACK_V26__) {
      window.__PDP_RENDER_ORDERS_PACK_V26__ = true;
      const originalRenderOrders = renderOrders;
      renderOrders = function() {
        originalRenderOrders();
        injectPackagingIntoOrdersV26();
      };
    }

    if (typeof saveOrder === "function" && !window.__PDP_SAVE_ORDER_PACK_V26__) {
      window.__PDP_SAVE_ORDER_PACK_V26__ = true;
      const originalSaveOrder = saveOrder;
      saveOrder = function(order) {
        const status = order?.splitOrder ? order.regularStatus : order?.status;
        if (orderNeedsPackagingV26(order) && ["Připraveno","Vyzvednuto"].includes(String(status || "")) && !packagingSelectionCompleteV26(order.id)) {
          alert("Nejdříve u objednávky vyberte obal, nebo označte „Vlastní obal zákazníka / bez obalu“.");
          renderOrders();
          return;
        }

        originalSaveOrder(order);

        // Post fronta zajistí, že tento požadavek jde až po uložení stavu objednávky.
        if (orderNeedsPackagingV26(order) && ["Připraveno","Vyzvednuto"].includes(String(status || ""))) {
          post("consumePackagingForOrder", {orderId:order.id}, result => {
            if (!result.ok) {
              alert(result.message || "Obaly se nepodařilo odečíst ze skladu.");
              return;
            }
            loadPackagingV26();
          });
        }
      };
    }
  }


  function wrapRenderInsights() {
    if (typeof renderInsights !== "function") return;
    const original = renderInsights;
    renderInsights = function() {
      original();
      renderProductAnalytics();
      renderVisitAnalytics();
    };
  }

  function initAdminEnhancements() {
    if (!document.getElementById("adminApp")) return;
    if (window.__PDP_ADMIN_ENHANCEMENTS_V251__) return;
    window.__PDP_ADMIN_ENHANCEMENTS_V251__ = true;

    injectStyles();
    cleanOldStats();
    buildPanels();
    addPackagingTabV26();
    wrapOrdersForPackagingV26();
    wrapRenderInsights();
    renderProductAnalytics();
    renderVisitAnalytics();
    loadRecentVisitsV26();
    loadPackagingV26();

    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        setTimeout(() => tab.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"}), 0);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminEnhancements, { once: true });
  } else {
    setTimeout(initAdminEnhancements, 0);
  }
})();
