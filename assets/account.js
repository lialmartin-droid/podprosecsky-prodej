window.PDP_ACCOUNT_VERSION = "3.5.4";

const ACCOUNT_SESSION_KEY = "pdp-customer-account-session-v1";
const accountState = {
  email:"",
  authMode:"register",
  registration:null,
  sessionToken:sessionStorage.getItem(ACCOUNT_SESSION_KEY) || "",
  activeRequest:null,
  requestTimeout:null,
  requestCounter:0,
  account:null
};

const accountQuery = selector => document.querySelector(selector);
const accountMoney = value => `${Number(value || 0).toLocaleString("cs-CZ")} Kč`;
const accountEsc = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function accountBackendUrl() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function accountLocalDate(value) {
  if (!value) return "Bez termínu";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("cs-CZ");
}

function accountIsTrustedOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && (parsed.hostname === "script.google.com" || parsed.hostname.endsWith(".googleusercontent.com"));
  } catch (_) {
    return false;
  }
}

function accountPost(action, payload = {}) {
  return new Promise(resolve => {
    if (accountState.activeRequest) {
      resolve({ok:false, message:"Počkejte prosím na dokončení předchozího požadavku."});
      return;
    }
    const endpoint = accountBackendUrl();
    if (!endpoint || !endpoint.endsWith("/exec")) {
      resolve({ok:false, message:"Zákaznický účet není správně propojený se serverem."});
      return;
    }
    const requestId = `ca${Date.now()}${++accountState.requestCounter}`;
    const form = accountQuery("#customerAccountForm");
    form.action = endpoint;
    accountQuery("#customerAccountAction").value = action;
    accountQuery("#customerAccountPayload").value = JSON.stringify({...payload, requestId});
    accountState.activeRequest = {requestId, resolve};
    clearTimeout(accountState.requestTimeout);
    accountState.requestTimeout = window.setTimeout(() => {
      if (!accountState.activeRequest || accountState.activeRequest.requestId !== requestId) return;
      const job = accountState.activeRequest;
      accountState.activeRequest = null;
      job.resolve({ok:false, message:"Server odpovídá pomalu. Zkuste akci znovu za chvíli."});
    }, 35000);
    form.submit();
  });
}

window.addEventListener("message", event => {
  const data = event.data;
  const job = accountState.activeRequest;
  if (!job || !data || data.type !== "PDP_BACKEND_RESULT") return;
  const frame = accountQuery("#customerAccountFrame");
  const direct = Boolean(frame && event.source === frame.contentWindow);
  if (!direct && !accountIsTrustedOrigin(event.origin)) return;
  if (data.requestId && data.requestId !== job.requestId) return;
  clearTimeout(accountState.requestTimeout);
  accountState.activeRequest = null;
  job.resolve(data);
});

function setAccountAuthMessage(message, error = false) {
  const element = accountQuery("#accountAuthMessage");
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(error));
}

function setAccountJoinMessage(message, error = false) {
  const element = accountQuery("#accountJoinMessage");
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(error));
}

function accountStatusClass(status) {
  return {"Nová":"blue", "Připravuji":"orange", "Připraveno":"green", "Vyzvednuto":"gray", "Zrušeno":"red"}[String(status || "Nová")] || "gray";
}

function renderAccountLoyalty(account) {
  const loyalty = account?.loyalty || {};
  const card = accountQuery("#customerLoyaltyCard");
  const join = accountQuery("#customerJoinLoyalty");
  if (!loyalty.enrolled) {
    card.className = "account-loyalty-card not-enrolled";
    card.innerHTML = `<div class="account-loyalty-symbol" aria-hidden="true">🥚❤</div><div><div class="eyebrow">Věrnostní program</div><h2>Zatím nejste ve věrnostním programu</h2><p>Po registraci se začnou počítat skutečně vyzvednutá vajíčka. Předchozí nákupy se zpětně nepřičítají.</p></div>`;
    join.classList.remove("hidden");
    accountQuery("#accountJoinName").value = account.suggestedName || "";
    return;
  }

  join.classList.add("hidden");
  const required = Math.max(1, Number(loyalty.eggsRequired || 100));
  const balance = Math.max(0, Number(loyalty.balance || 0));
  const percent = Math.max(0, Math.min(100, Math.round(balance / required * 100)));
  if (!loyalty.active) {
    card.className = "account-loyalty-card paused";
    card.innerHTML = `<div class="account-loyalty-symbol" aria-hidden="true">⏸️</div><div><div class="eyebrow">Věrnostní program</div><h2>Účet je pozastavený</h2><p>Pro další informace nás prosím kontaktujte.</p></div>`;
    return;
  }

  card.className = `account-loyalty-card ${loyalty.rewardReady ? "reward-ready" : ""}`;
  card.innerHTML = `
    <div class="account-loyalty-heading"><div class="account-loyalty-symbol" aria-hidden="true">${loyalty.rewardReady ? "🎉" : "🥚❤"}</div><div><div class="eyebrow">Věrnostní stav</div><h2>${loyalty.rewardReady ? `Máte připravenou slevu ${accountMoney(loyalty.discountCzk)}` : `${balance} z ${required} vajec`}</h2><p>${loyalty.rewardReady ? "Sleva se automaticky odečte u další objednávky obsahující vajíčka." : `Do další slevy zbývá ${Math.max(0, Number(loyalty.eggsNeeded || 0))} vajec.`}</p></div></div>
    <div class="account-progress"><i style="width:${percent}%"></i></div>
    <div class="account-loyalty-stats"><div><small>Započítáno</small><strong>${balance} vajec</strong></div><div><small>Připravené slevy</small><strong>${Number(loyalty.availableRewards || 0)}</strong></div><div><small>Rezervované slevy</small><strong>${Number(loyalty.reservedRewards || 0)}</strong></div></div>`;
}

function renderCustomerOrders(account) {
  const orders = Array.isArray(account?.orders) ? account.orders : [];
  accountQuery("#customerOrderCount").textContent = `${Number(account?.orderCount || orders.length)} objednávek`;
  const root = accountQuery("#customerOrdersList");
  if (!orders.length) {
    root.innerHTML = '<div class="empty">K tomuto e-mailu zatím nemáme uloženou žádnou objednávku.</div>';
    return;
  }
  root.innerHTML = orders.map(order => `
    <article class="customer-order-card ${order.status === "Zrušeno" ? "cancelled" : ""}">
      <div class="customer-order-head"><div><div class="eyebrow">Objednávka ${accountEsc(order.orderNumber)}</div><h3>${accountEsc(order.created || "")}</h3></div><span class="badge ${accountStatusClass(order.status)}">${accountEsc(order.status)}</span></div>
      <div class="customer-order-meta"><span>📅 Vyzvednutí: <strong>${accountEsc(accountLocalDate(order.pickup))}</strong></span>${order.splitOrder && order.preorderPickup ? `<span>📅 Druhá část: <strong>${accountEsc(accountLocalDate(order.preorderPickup))}</strong></span>` : ""}</div>
      ${order.splitOrder ? `<div class="customer-order-parts"><span>1. část: <strong>${accountEsc(order.regularStatus)}</strong></span><span>2. část: <strong>${accountEsc(order.preorderStatus)}</strong></span></div>` : ""}
      <div class="customer-order-items">${(order.items || []).map(item => `<div><span>${Number(item.qty || 0)}× ${accountEsc(item.name)} <small>po ${accountMoney(item.price)}</small></span><strong>${accountMoney(item.lineTotal)}</strong></div>`).join("")}</div>
      <div class="customer-order-totals"><div><span>Původní cena</span><strong>${accountMoney(order.subtotal)}</strong></div>${Number(order.loyaltyDiscount || 0) > 0 ? `<div class="discount"><span>Věrnostní sleva</span><strong>−${accountMoney(order.loyaltyDiscount)}</strong></div>` : ""}<div class="total"><span>Celkem</span><strong>${accountMoney(order.total)}</strong></div></div>
      <div class="customer-order-loyalty ${Number(order.loyaltyEggsCounted || 0) > 0 ? "counted" : ""}">${Number(order.loyaltyEggsCounted || 0) > 0 ? `✓ Do věrnostního programu započítáno ${Number(order.loyaltyEggsCounted)} vajec.` : "Z této objednávky zatím nebyla započítána žádná vajíčka."}</div>
    </article>`).join("") + (account.hasMoreOrders ? '<p class="settings-note">Zobrazeno je posledních 200 objednávek.</p>' : '');
}

function renderCustomerRewards(account) {
  const rewards = Array.isArray(account?.rewards) ? account.rewards : [];
  const section = accountQuery("#customerRewardsSection");
  if (!rewards.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  accountQuery("#customerRewardsList").innerHTML = rewards.map(reward => `
    <div class="customer-reward-row"><div><strong>Sleva ${accountMoney(reward.amount)}</strong><small>Získána: ${accountEsc(reward.earnedAt || "")}${reward.orderNumber ? ` · objednávka ${accountEsc(reward.orderNumber)}` : ""}</small></div><span class="reward-state">${accountEsc(reward.state)}</span></div>`).join("");
}

function renderCustomerMovements(account) {
  const movements = Array.isArray(account?.movements) ? account.movements : [];
  const section = accountQuery("#customerMovementsSection");
  if (!movements.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  accountQuery("#customerMovementsList").innerHTML = movements.map(movement => `
    <div class="customer-movement-row"><div><strong>${accountEsc(movement.type)}</strong><small>${accountEsc(movement.at || "")}${movement.orderNumber ? ` · objednávka ${accountEsc(movement.orderNumber)}` : ""}<br>${accountEsc(movement.note || "")}</small></div><span class="movement-delta ${Number(movement.eggDelta || 0) > 0 ? "positive" : Number(movement.eggDelta || 0) < 0 ? "negative" : ""}">${Number(movement.eggDelta || 0) ? `${Number(movement.eggDelta) > 0 ? "+" : ""}${Number(movement.eggDelta)} vajec` : "Sleva"}</span></div>`).join("");
}

function renderCustomerAccount(account) {
  accountState.account = account || {};
  accountQuery("#accountLogin").classList.add("hidden");
  accountQuery("#customerAccount").classList.remove("hidden");
  const firstName = account?.loyalty?.firstName || String(account?.suggestedName || "").trim().split(/\s+/)[0] || "";
  accountQuery("#customerAccountTitle").textContent = firstName ? `Dobrý den, ${firstName}` : "Můj účet";
  accountQuery("#customerAccountEmail").textContent = `Ověřený e-mail: ${account?.emailHint || ""}`;
  renderAccountLoyalty(account);
  renderCustomerOrders(account);
  renderCustomerRewards(account);
  renderCustomerMovements(account);
}

function switchAccountMode(mode) {
  accountState.authMode = mode === "login" ? "login" : "register";
  accountQuery("#accountRegisterStep").classList.toggle("hidden", accountState.authMode !== "register");
  accountQuery("#accountEmailStep").classList.toggle("hidden", accountState.authMode !== "login");
  accountQuery("#accountCodeStep").classList.add("hidden");
  const registerButton = accountQuery("#showAccountRegister");
  const loginButton = accountQuery("#showAccountLogin");
  registerButton.classList.toggle("active", accountState.authMode === "register");
  loginButton.classList.toggle("active", accountState.authMode === "login");
  registerButton.setAttribute("aria-selected", String(accountState.authMode === "register"));
  loginButton.setAttribute("aria-selected", String(accountState.authMode === "login"));
  setAccountAuthMessage("");
}

async function sendAccountCode(mode = accountState.authMode) {
  const registering = mode === "register";
  const emailInput = accountQuery(registering ? "#accountRegisterEmail" : "#accountEmail");
  const email = String(emailInput.value || "").trim().toLowerCase();
  let name = "";
  let phone = "";
  if (registering) {
    name = String(accountQuery("#accountRegisterName").value || "").trim();
    phone = String(accountQuery("#accountRegisterPhone").value || "").trim();
    if (name.length < 2) {
      setAccountAuthMessage("Vyplňte jméno a příjmení.", true);
      accountQuery("#accountRegisterName").focus();
      return;
    }
    if (phone && phone.replace(/\D/g, "").length < 9) {
      setAccountAuthMessage("Vyplňte platné telefonní číslo, nebo nechte telefon prázdný.", true);
      accountQuery("#accountRegisterPhone").focus();
      return;
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    setAccountAuthMessage("Zadejte platnou e-mailovou adresu.", true);
    emailInput.focus();
    return;
  }
  accountState.authMode = registering ? "register" : "login";
  accountState.registration = registering ? {name, phone} : null;
  const button = accountQuery(registering ? "#sendRegistrationCode" : "#sendAccountCode");
  const idleText = registering ? "Zaregistrovat se" : "Poslat přihlašovací kód";
  button.disabled = true;
  button.textContent = "Odesílám kód…";
  setAccountAuthMessage("Odesílám bezpečnostní kód…");
  const result = await accountPost("requestCustomerAccess", {email});
  button.disabled = false;
  button.textContent = idleText;
  if (!result.ok) return setAccountAuthMessage(result.message || "Kód se nepodařilo odeslat.", true);
  accountState.email = email;
  accountQuery("#accountRegisterStep").classList.add("hidden");
  accountQuery("#accountEmailStep").classList.add("hidden");
  accountQuery("#accountCodeStep").classList.remove("hidden");
  accountQuery("#accountCodeHeading").textContent = registering ? "Potvrďte registraci" : "Potvrďte přihlášení";
  accountQuery("#accountCodeSentTo").textContent = `Kód jsme poslali na ${result.emailHint || "zadaný e-mail"}.`;
  accountQuery("#accountCode").value = "";
  accountQuery("#accountCode").focus();
  setAccountAuthMessage("Kód platí 10 minut.");
}

async function verifyAccountCode() {
  const code = String(accountQuery("#accountCode").value || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return setAccountAuthMessage("Zadejte celý šestimístný kód.", true);
  const button = accountQuery("#verifyAccountCode");
  button.disabled = true;
  button.textContent = "Ověřuji…";
  setAccountAuthMessage(accountState.authMode === "register" ? "Ověřuji e-mail a zakládám členství…" : "Ověřuji kód a načítám Vaše objednávky…");
  const result = await accountPost("verifyCustomerAccess", {email:accountState.email, code});
  if (!result.ok || !result.sessionToken || !result.account) {
    button.disabled = false;
    button.textContent = "Potvrdit kód";
    return setAccountAuthMessage(result.message || "Kód se nepodařilo ověřit.", true);
  }
  accountState.sessionToken = result.sessionToken;
  sessionStorage.setItem(ACCOUNT_SESSION_KEY, result.sessionToken);
  if (accountState.authMode === "register" && !result.account?.loyalty?.enrolled) {
    button.textContent = "Zakládám členství…";
    const registration = accountState.registration || {};
    const joined = await accountPost("joinCustomerAccountLoyalty", {
      sessionToken:accountState.sessionToken,
      name:registration.name || "",
      phone:registration.phone || ""
    });
    button.disabled = false;
    button.textContent = "Potvrdit kód";
    if (!joined.ok || !joined.account) {
      renderCustomerAccount(result.account);
      accountQuery("#accountJoinName").value = registration.name || result.account.suggestedName || "";
      accountQuery("#accountJoinPhone").value = registration.phone || "";
      setAccountJoinMessage(joined.message || "E-mail je ověřený. Dokončete prosím registraci níže.", true);
      return;
    }
    renderCustomerAccount(joined.account);
    return;
  }
  button.disabled = false;
  button.textContent = "Potvrdit kód";
  renderCustomerAccount(result.account);
}

async function loadCustomerAccountSession() {
  if (!accountState.sessionToken) return;
  setAccountAuthMessage("Načítám Váš zabezpečený účet…");
  const result = await accountPost("customerAccountData", {sessionToken:accountState.sessionToken});
  if (!result.ok || !result.account) {
    accountState.sessionToken = "";
    sessionStorage.removeItem(ACCOUNT_SESSION_KEY);
    setAccountAuthMessage(result.message || "Přihlášení vypršelo. Nechte si poslat nový kód.", true);
    return;
  }
  renderCustomerAccount(result.account);
}

async function joinCustomerLoyalty() {
  const name = String(accountQuery("#accountJoinName").value || "").trim();
  const phone = String(accountQuery("#accountJoinPhone").value || "").trim();
  if (name.length < 2) return setAccountJoinMessage("Vyplňte jméno a příjmení.", true);
  if (phone && phone.replace(/\D/g, "").length < 9) return setAccountJoinMessage("Vyplňte platné telefonní číslo, nebo nechte telefon prázdný.", true);
  const button = accountQuery("#joinFromCustomerAccount");
  button.disabled = true;
  button.textContent = "Zapisujeme…";
  setAccountJoinMessage("Zakládám věrnostní účet…");
  const result = await accountPost("joinCustomerAccountLoyalty", {sessionToken:accountState.sessionToken, name, phone});
  button.disabled = false;
  button.textContent = "Zapojit se do slev";
  if (!result.ok || !result.account) return setAccountJoinMessage(result.message || "Registrace se nepodařila.", true);
  renderCustomerAccount(result.account);
}

function loadAccountLoyaltyRule() {
  const endpoint = accountBackendUrl();
  if (!endpoint || !endpoint.endsWith("/exec")) return;
  const callbackName = `PDP_LOYALTY_INFO_${Date.now()}`;
  const script = document.createElement("script");
  const cleanup = () => { script.remove(); try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; } };
  window[callbackName] = data => {
    cleanup();
    if (!data?.ok || !data.loyalty) return;
    const settings = data.loyalty;
    accountQuery("#accountLoyaltyRule").textContent = settings.enabled === false
      ? "Věrnostní program je nyní dočasně pozastavený. Své předchozí objednávky si můžete stále bezpečně zobrazit."
      : `Za každých ${Number(settings.eggsRequired || 100)} skutečně vyzvednutých vajec získáte slevu ${accountMoney(settings.discountCzk || 20)} na další nákup vajec.`;
  };
  script.onerror = cleanup;
  script.src = `${endpoint}?action=loyaltyInfo&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
  document.head.appendChild(script);
}

accountQuery("#showAccountRegister").onclick = () => switchAccountMode("register");
accountQuery("#showAccountLogin").onclick = () => switchAccountMode("login");
accountQuery("#sendRegistrationCode").onclick = () => sendAccountCode("register");
accountQuery("#sendAccountCode").onclick = () => sendAccountCode("login");
accountQuery("#verifyAccountCode").onclick = verifyAccountCode;
accountQuery("#resendAccountCode").onclick = () => sendAccountCode(accountState.authMode);
accountQuery("#changeAccountEmail").onclick = () => {
  accountState.email = "";
  accountQuery("#accountCodeStep").classList.add("hidden");
  accountQuery(accountState.authMode === "register" ? "#accountRegisterStep" : "#accountEmailStep").classList.remove("hidden");
  setAccountAuthMessage("");
  accountQuery(accountState.authMode === "register" ? "#accountRegisterEmail" : "#accountEmail").focus();
};
accountQuery("#logoutCustomerAccount").onclick = () => {
  sessionStorage.removeItem(ACCOUNT_SESSION_KEY);
  accountState.sessionToken = "";
  window.location.reload();
};
accountQuery("#joinFromCustomerAccount").onclick = joinCustomerLoyalty;
accountQuery("#accountEmail").addEventListener("keydown", event => { if (event.key === "Enter") sendAccountCode("login"); });
accountQuery("#accountRegisterName").addEventListener("keydown", event => { if (event.key === "Enter") sendAccountCode("register"); });
accountQuery("#accountRegisterEmail").addEventListener("keydown", event => { if (event.key === "Enter") sendAccountCode("register"); });
accountQuery("#accountRegisterPhone").addEventListener("keydown", event => { if (event.key === "Enter") sendAccountCode("register"); });
accountQuery("#accountCode").addEventListener("input", event => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6); });
accountQuery("#accountCode").addEventListener("keydown", event => { if (event.key === "Enter") verifyAccountCode(); });

loadAccountLoyaltyRule();
switchAccountMode("register");
loadCustomerAccountSession();
