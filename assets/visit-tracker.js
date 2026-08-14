// Podprosečské produkty – spolehlivé měření návštěvnosti V2.7
// Návštěva se označí jako uložená až po potvrzení Apps Scriptu.
// Současně přidává visitorId do webové objednávky bez zásahu do velkého customer.js.
(() => {
  const TRACKED_KEY = "pdp-visit-tracked-v2";
  const VISITOR_ID_KEY = "pdp-visitor-id-v1";
  const ADMIN_EXCLUDE_KEY = "pdp-admin-exclude-visits";
  const ADMIN_EXCLUDE_COOKIE = "pdp_admin_exclude_visits";
  const MAX_ATTEMPTS = 3;

  function source() {
    try {
      const params = new URLSearchParams(window.location.search);
      const value = String(
        params.get("src") ||
        params.get("source") ||
        params.get("utm_source") ||
        ""
      ).trim().toLowerCase();
      return ["qr", "qrcode", "qrkod", "qr-kod"].includes(value) ? "qr" : "link";
    } catch (_) {
      return "link";
    }
  }

  const visitSource = source();
  const sessionKey = `${TRACKED_KEY}:${window.location.pathname}:${visitSource}`;

  function excluded() {
    try {
      if (localStorage.getItem(ADMIN_EXCLUDE_KEY) === "1") return true;
    } catch (_) {}

    try {
      return document.cookie
        .split(";")
        .map(value => value.trim())
        .some(value => value === `${ADMIN_EXCLUDE_COOKIE}=1`);
    } catch (_) {
      return false;
    }
  }

  function visitorId() {
    try {
      let value = localStorage.getItem(VISITOR_ID_KEY);
      if (!value) {
        value = (
          window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
        ).replace(/[^a-zA-Z0-9_-]/g, "");
        localStorage.setItem(VISITOR_ID_KEY, value);
      }
      return value;
    } catch (_) {
      return `anon${Date.now()}`;
    }
  }

  function backendUrl() {
    return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
  }

  function cleanup(callbackName) {
    document.getElementById(`jsonp-${callbackName}`)?.remove();
    try {
      delete window[callbackName];
    } catch (_) {
      window[callbackName] = undefined;
    }
  }

  function markTracked() {
    try {
      sessionStorage.setItem(sessionKey, "1");
    } catch (_) {}
  }

  function alreadyTracked() {
    try {
      return Boolean(sessionStorage.getItem(sessionKey));
    } catch (_) {
      return false;
    }
  }

  function scheduleRetry(attempt) {
    if (attempt >= MAX_ATTEMPTS || alreadyTracked() || excluded()) return;
    const delay = attempt === 1 ? 1500 : 4000;
    setTimeout(() => track(attempt + 1), delay);
  }

  function track(attempt = 1) {
    if (excluded() || alreadyTracked()) return;

    const url = backendUrl();
    if (!url || !url.endsWith("/exec")) {
      scheduleRetry(attempt);
      return;
    }

    const callbackName =
      `PDP_VISIT_V27_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let finished = false;

    const finishFailure = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cleanup(callbackName);
      scheduleRetry(attempt);
    };

    const timeout = setTimeout(finishFailure, 10000);

    window[callbackName] = data => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (data && data.ok && (data.tracked || data.excluded)) {
        markTracked();
      } else {
        scheduleRetry(attempt);
      }
      cleanup(callbackName);
    };

    const script = document.createElement("script");
    script.id = `jsonp-${callbackName}`;
    script.src =
      `${url}?action=trackVisit` +
      `&visitorId=${encodeURIComponent(visitorId())}` +
      `&source=${encodeURIComponent(visitSource)}` +
      `&path=${encodeURIComponent(window.location.pathname)}` +
      `&title=${encodeURIComponent(document.title)}` +
      `&callback=${encodeURIComponent(callbackName)}` +
      `&t=${Date.now()}`;
    script.onerror = finishFailure;
    document.head.appendChild(script);
  }

  function patchOrderForm() {
    const form = document.getElementById("backendOrderForm");
    const payloadInput = document.getElementById("backendPayload");
    if (!form || !payloadInput || form.dataset.pdpVisitorPatched === "1") return;

    form.dataset.pdpVisitorPatched = "1";
    const nativeSubmit = HTMLFormElement.prototype.submit;

    form.submit = function() {
      try {
        const action = String(
          form.querySelector('[name="action"]')?.value || ""
        );
        if (action === "createOrder") {
          const payload = JSON.parse(String(payloadInput.value || "{}"));
          payload.visitorId = visitorId();
          payload.visitSource = visitSource;
          payloadInput.value = JSON.stringify(payload);
        }
      } catch (error) {
        console.warn("Visitor ID se nepodařilo doplnit do objednávky.", error);
      }

      return nativeSubmit.call(form);
    };
  }

  patchOrderForm();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchOrderForm, { once: true });
  }

  setTimeout(() => track(1), 0);
})();
