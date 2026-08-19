window.PDP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxX0zM4gURHiBdJfzn1Vux3y7WqgN_gP1DE9m26_e8bHQYynUOl2LZbkpmoGQJbhbZdvw/exec"
};

(() => {
  const isAdmin = Boolean(document.getElementById("adminApp"));

  if (isAdmin) {
    // Admin rozšíření se načte až po admin.js, aby byly dostupné jeho funkce.
    window.addEventListener("load", () => {
      if (document.querySelector('script[data-pdp-admin-enhancements]')) return;
      const script = document.createElement("script");
      script.src = "../assets/admin-enhancements.js?v=320-20260819";
      script.dataset.pdpAdminEnhancements = "1";
      document.body.appendChild(script);
    });
    return;
  }

  // Veřejná stránka: ještě před spuštěním starého trackeru v customer.js
  // označíme starou relaci jako zpracovanou. Návštěvu zapíše nový spolehlivý tracker.
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = String(
      params.get("src") ||
      params.get("source") ||
      params.get("utm_source") ||
      ""
    ).trim().toLowerCase();
    const source = ["qr", "qrcode", "qrkod", "qr-kod"].includes(raw) ? "qr" : "link";
    sessionStorage.setItem(
      `pdp-visit-tracked-v1:${window.location.pathname}:${source}`,
      "1"
    );
  } catch (_) {}

  const loadVisitTracker = () => {
    if (document.querySelector('script[data-pdp-visit-tracker]')) return;
    const tracker = document.createElement("script");
    tracker.src = "assets/visit-tracker.js?v=270-20260814";
    tracker.dataset.pdpVisitTracker = "1";
    document.body.appendChild(tracker);
  };

  // Nejdřív ověříme produkty a hlavně vejce. Návštěvnost nesmí při prvním
  // otevření soutěžit o stejný Apps Script server. Pokud server produktů
  // neodpoví, tracker se kvůli zachování statistik spustí nejpozději za 6 s.
  if (window.PDP_PRODUCTS_VERIFIED) {
    loadVisitTracker();
  } else {
    window.addEventListener("pdp-products-verified", loadVisitTracker, { once: true });
    setTimeout(loadVisitTracker, 6000);
  }
})();
