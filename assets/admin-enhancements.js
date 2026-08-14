// Admin v2.5.1 – samostatné statistiky produktů a návštěvnosti + oprava načtení
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

    const recent = Array.isArray(stats.recentVisits) ? stats.recentVisits : [];
    document.getElementById("vaRecent").innerHTML = recent.length
      ? recent.slice(0,30).map(v=>`
        <div class="recent-visit"><div><strong>${esc2(v.at || v.day || "")}</strong>
        <small>${esc2(v.source || "")} · ${esc2(v.path || "/")}</small></div>
        <code>${esc2(String(v.visitorId || "").slice(-8))}</code></div>`).join("")
      : '<div class="analytics-note">Souhrnné statistiky jsou funkční. Přesný seznam posledních návštěv vyžaduje ještě rozšíření Apps Script backendu.</div>';

    const now = new Date();
    document.getElementById("vaUpdated").textContent =
      `Zobrazeno: ${now.toLocaleDateString("cs-CZ")} ${now.toLocaleTimeString("cs-CZ",{hour:"2-digit",minute:"2-digit"})}`;
    syncVisitExclusionUi();
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
    wrapRenderInsights();
    renderProductAnalytics();
    renderVisitAnalytics();

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
