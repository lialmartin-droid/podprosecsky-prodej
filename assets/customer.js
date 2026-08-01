const DEFAULT_PRODUCTS = [
  {
    id: 1, emoji: "🍯", name: "Květový med", price: 190, unit: "950 g",
    short: "Smíšený květový med z okolí Lukášova.",
    detail: "Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.",
    visible: true, soldOut: false, restock: "", leadDays: 0, quick: []
  },
  {
    id: 2, emoji: "🥚", name: "Čerstvá vejce", price: 7, unit: "kus",
    short: "Vejce od našich slepic z domácího chovu.",
    detail: "Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.",
    visible: true, soldOut: false, restock: "", leadDays: 7, quick: [6,10,30]
  }
];

const products = JSON.parse(localStorage.getItem("pdp-products") || "null") || DEFAULT_PRODUCTS;
const cart = {};
const productsEl = document.getElementById("products");
const summaryEl = document.getElementById("summary");
const totalEl = document.getElementById("totalPrice");
const countEl = document.getElementById("itemCount");
const feedbackEl = document.getElementById("feedback");

function activeProducts(){ return products.filter(p => p.visible); }
function money(v){ return `${v} Kč`; }
function minPickupDate(){
  const maxLead = Object.entries(cart).reduce((max,[id,qty]) => {
    if(!qty) return max;
    const p = products.find(x => x.id === Number(id));
    return Math.max(max, p?.leadDays || 0);
  }, 0);
  const d = new Date();
  d.setDate(d.getDate() + maxLead);
  return d.toISOString().slice(0,10);
}

function renderProducts(){
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
          ${product.soldOut ? `<div class="notice">Momentálně vyprodáno${product.restock ? `. Předpokládané doplnění: ${product.restock}.` : "."}</div>` : ""}
          <div class="product-controls" data-controls="${product.id}"></div>
        </div>
      </div>`;
    productsEl.appendChild(article);

    const controls = article.querySelector(`[data-controls="${product.id}"]`);
    if(product.soldOut) return;

    if(product.quick?.length){
      const label = document.createElement("div");
      label.className = "muted";
      label.style.marginTop = "18px";
      label.textContent = "Rychlé přidání";
      controls.appendChild(label);

      const quick = document.createElement("div");
      quick.className = "quick-grid";
      product.quick.forEach(amount => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = `+ ${amount} ks`;
        b.addEventListener("click", () => changeQty(product.id, amount));
        quick.appendChild(b);
      });
      controls.appendChild(quick);
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
    input.inputMode = "numeric";
    input.value = cart[product.id] || 0;
    input.addEventListener("input", () => setQty(product.id, input.value));

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

function changeQty(id, delta){
  cart[id] = Math.max(0, (cart[id] || 0) + delta);
  if(!cart[id]) delete cart[id];
  renderAll();
}
function setQty(id, value){
  const qty = Math.max(0, Math.floor(Number(value) || 0));
  if(qty) cart[id] = qty; else delete cart[id];
  renderAll();
}

function renderSummary(){
  const entries = Object.entries(cart);
  const count = entries.reduce((s,[,q]) => s + q, 0);
  countEl.textContent = `${count} ${count===1 ? "položka" : count>1&&count<5 ? "položky" : "položek"}`;

  if(!entries.length){
    summaryEl.className = "muted";
    summaryEl.textContent = "Zatím nemáte nic vybráno.";
    totalEl.textContent = "0 Kč";
  }else{
    summaryEl.className = "";
    summaryEl.innerHTML = "";
    let total = 0;
    entries.forEach(([id,qty]) => {
      const p = products.find(x => x.id === Number(id));
      const rowTotal = p.price * qty;
      total += rowTotal;
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${qty}× ${p.name}</span><strong>${money(rowTotal)}</strong>`;
      summaryEl.appendChild(row);
    });
    totalEl.textContent = money(total);
  }

  const pickup = document.getElementById("pickupDate");
  pickup.min = minPickupDate();
}

function renderAll(){ renderProducts(); renderSummary(); }

let submitTimeout = null;

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "PDP_ORDER_RESULT") return;

  clearTimeout(submitTimeout);
  const button = document.getElementById("submitOrder");
  button.disabled = false;
  button.textContent = "Odeslat objednávku";

  if (data.ok) {
    feedbackEl.textContent = "Objednávka byla odeslána. Brzy se vám ozveme.";
    Object.keys(cart).forEach(key => delete cart[key]);
    document.getElementById("customerNote").value = "";
    renderAll();
  } else {
    feedbackEl.textContent = data.message || "Objednávku se nepodařilo odeslat.";
  }
});

document.getElementById("submitOrder").addEventListener("click", () => {
  const items = Object.entries(cart).map(([id,qty]) => {
    const p = products.find(x => x.id === Number(id));
    return {productId:p.id,name:p.name,qty,price:p.price};
  });
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const pickup = document.getElementById("pickupDate").value;
  const note = document.getElementById("customerNote").value.trim();

  if(!items.length) return feedbackEl.textContent = "Nejprve vyberte alespoň jeden produkt.";
  if(!name) return feedbackEl.textContent = "Vyplňte jméno.";
  if(!phone) return feedbackEl.textContent = "Vyplňte telefon.";
  if(!pickup) return feedbackEl.textContent = "Vyberte termín vyzvednutí.";
  if(pickup < minPickupDate()) return feedbackEl.textContent = "Zvolený termín je příliš brzy pro některý z produktů.";

  const backendUrl = window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
  if(!backendUrl || !backendUrl.endsWith("/exec")){
    feedbackEl.textContent = "Odesílání ještě není propojené. Doplňte adresu Apps Scriptu v assets/config.js.";
    return;
  }

  const order = {
    name,
    phone,
    pickup,
    note,
    source: "Web",
    items,
    total: items.reduce((sum,item) => sum + item.qty * item.price, 0)
  };

  const form = document.getElementById("backendOrderForm");
  const payloadInput = document.getElementById("backendPayload");
  const button = document.getElementById("submitOrder");

  form.action = backendUrl;
  payloadInput.value = JSON.stringify(order);
  button.disabled = true;
  button.textContent = "Odesílám…";
  feedbackEl.textContent = "Odesílám objednávku…";

  form.submit();

  clearTimeout(submitTimeout);
  submitTimeout = setTimeout(() => {
    button.disabled = false;
    button.textContent = "Odeslat objednávku";
    feedbackEl.textContent = "Odeslání trvá déle. Zkontrolujte připojení a zkuste to znovu.";
  }, 20000);
});

renderAll();
