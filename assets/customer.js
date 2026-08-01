const DEFAULT_PRODUCTS = [
  {
    id: 1,
    emoji: "🍯",
    name: "Květový med",
    price: 190,
    unit: "950 g",
    short: "Smíšený květový med z okolí Lukášova.",
    detail:
      "Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů. Každá sklenice tak nese chuť místní krajiny.",
    visible: true,
    soldOut: false,
    restock: "",
    leadDays: 0,
    quick: []
  },
  {
    id: 2,
    emoji: "🥚",
    name: "Čerstvá vejce",
    price: 7,
    unit: "kus",
    short: "Vejce od našich slepic z domácího chovu.",
    detail:
      "Slepice krmíme kvalitní směsí a zeleninou. Každý den mají přístup na trávu, kde si hledají červy a další přirozenou potravu.",
    visible: true,
    soldOut: false,
    restock: "",
    leadDays: 7,
    quick: [6, 10, 30]
  }
];

const storedProducts = JSON.parse(
  localStorage.getItem("pdp-products") || "null"
);

const products = storedProducts || DEFAULT_PRODUCTS;
const cart = {};

const productsEl = document.getElementById("products");
const summaryEl = document.getElementById("summary");
const totalEl = document.getElementById("totalPrice");
const countEl = document.getElementById("itemCount");
const feedbackEl = document.getElementById("feedback");

let submitTimeout = null;
let submissionPending = false;
let submissionFinished = false;
let submissionStartedAt = 0;

function activeProducts() {
  return products.filter(product => product.visible);
}

function money(value) {
  return `${value} Kč`;
}

function minPickupDate() {
  const maxLeadDays = Object.entries(cart).reduce(
    (maximum, [id, quantity]) => {
      if (!quantity) {
        return maximum;
      }

      const product = products.find(
        item => item.id === Number(id)
      );

      return Math.max(
        maximum,
        product?.leadDays || 0
      );
    },
    0
  );

  const date = new Date();
  date.setDate(date.getDate() + maxLeadDays);

  return date.toISOString().slice(0, 10);
}

function formatRestockDate(dateValue) {
  if (!dateValue) {
    return "";
  }

  const date = new Date(`${dateValue}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString("cs-CZ");
}

function renderProducts() {
  productsEl.innerHTML = "";

  activeProducts().forEach(product => {
    const article = document.createElement("article");
    article.className = "product";

    const restockText = product.restock
      ? ` Předpokládané doplnění: ${formatRestockDate(
          product.restock
        )}.`
      : ".";

    article.innerHTML = `
      <div class="product-row">
        <div class="product-icon">${product.emoji}</div>

        <div style="flex:1">
          <h3>${product.name}</h3>

          <p class="lead">
            ${product.short}
          </p>

          <div class="story">
            ${product.detail}
          </div>

          <div class="price">
            ${money(product.price)}
            <small>/ ${product.unit}</small>
          </div>

          ${
            product.leadDays
              ? `
                <div class="notice">
                  Tento produkt je potřeba objednat minimálně
                  ${product.leadDays} dní předem.
                </div>
              `
              : ""
          }

          ${
            product.soldOut
              ? `
                <div class="notice">
                  Momentálně vyprodáno${restockText}
                </div>
              `
              : ""
          }

          <div
            class="product-controls"
            data-controls="${product.id}"
          ></div>
        </div>
      </div>
    `;

    productsEl.appendChild(article);

    const controls = article.querySelector(
      `[data-controls="${product.id}"]`
    );

    if (product.soldOut) {
      return;
    }

    if (product.quick?.length) {
      const label = document.createElement("div");
      label.className = "muted";
      label.style.marginTop = "18px";
      label.textContent = "Rychlé přidání";

      controls.appendChild(label);

      const quickGrid = document.createElement("div");
      quickGrid.className = "quick-grid";

      product.quick.forEach(amount => {
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = `+ ${amount} ks`;

        button.addEventListener("click", () => {
          changeQuantity(product.id, amount);
        });

        quickGrid.appendChild(button);
      });

      controls.appendChild(quickGrid);
    }

    const quantityRow = document.createElement("div");
    quantityRow.className = "qty-row";

    quantityRow.innerHTML = `
      <span class="muted">
        ${
          product.unit === "kus"
            ? "Celkový počet kusů"
            : "Množství"
        }
      </span>
    `;

    const stepper = document.createElement("div");
    stepper.className = "stepper";

    const minusButton = document.createElement("button");
    minusButton.className = "round-button";
    minusButton.type = "button";
    minusButton.textContent = "−";

    minusButton.addEventListener("click", () => {
      changeQuantity(product.id, -1);
    });

    const quantityInput = document.createElement("input");
    quantityInput.className = "qty-input";
    quantityInput.type = "number";
    quantityInput.min = "0";
    quantityInput.inputMode = "numeric";
    quantityInput.value = cart[product.id] || 0;
    quantityInput.setAttribute(
      "aria-label",
      `Množství produktu ${product.name}`
    );

    quantityInput.addEventListener("input", () => {
      setQuantity(
        product.id,
        quantityInput.value
      );
    });

    const plusButton = document.createElement("button");
    plusButton.className = "round-button";
    plusButton.type = "button";
    plusButton.textContent = "+";

    plusButton.addEventListener("click", () => {
      changeQuantity(product.id, 1);
    });

    stepper.append(
      minusButton,
      quantityInput,
      plusButton
    );

    quantityRow.appendChild(stepper);
    controls.appendChild(quantityRow);
  });
}

function changeQuantity(id, amount) {
  cart[id] = Math.max(
    0,
    (cart[id] || 0) + amount
  );

  if (!cart[id]) {
    delete cart[id];
  }

  feedbackEl.textContent = "";
  renderAll();
}

function setQuantity(id, value) {
  const quantity = Math.max(
    0,
    Math.floor(Number(value) || 0)
  );

  if (quantity > 0) {
    cart[id] = quantity;
  } else {
    delete cart[id];
  }

  feedbackEl.textContent = "";
  renderAll();
}

function renderSummary() {
  const entries = Object.entries(cart);

  const itemCount = entries.reduce(
    (sum, [, quantity]) => sum + quantity,
    0
  );

  countEl.textContent =
    `${itemCount} ${
      itemCount === 1
        ? "položka"
        : itemCount > 1 && itemCount < 5
          ? "položky"
          : "položek"
    }`;

  if (!entries.length) {
    summaryEl.className = "muted";
    summaryEl.textContent =
      "Zatím nemáte nic vybráno.";

    totalEl.textContent = "0 Kč";
  } else {
    summaryEl.className = "";
    summaryEl.innerHTML = "";

    let total = 0;

    entries.forEach(([id, quantity]) => {
      const product = products.find(
        item => item.id === Number(id)
      );

      if (!product) {
        return;
      }

      const rowTotal =
        product.price * quantity;

      total += rowTotal;

      const row = document.createElement("div");
      row.className = "summary-row";

      row.innerHTML = `
        <span>
          ${quantity}× ${product.name}
        </span>

        <strong>
          ${money(rowTotal)}
        </strong>
      `;

      summaryEl.appendChild(row);
    });

    totalEl.textContent = money(total);
  }

  const pickupInput =
    document.getElementById("pickupDate");

  pickupInput.min = minPickupDate();
}

function renderAll() {
  renderProducts();
  renderSummary();
}

function resetCustomerForm() {
  document.getElementById(
    "customerName"
  ).value = "";

  document.getElementById(
    "customerPhone"
  ).value = "";

  document.getElementById(
    "pickupDate"
  ).value = "";

  document.getElementById(
    "customerNote"
  ).value = "";

  Object.keys(cart).forEach(key => {
    delete cart[key];
  });

  renderAll();
}

function finishSubmission(success, message) {
  if (submissionFinished) {
    return;
  }

  submissionFinished = true;
  submissionPending = false;

  clearTimeout(submitTimeout);

  const button =
    document.getElementById("submitOrder");

  button.disabled = false;
  button.textContent =
    "Odeslat objednávku";

  feedbackEl.textContent = message;

  if (success) {
    resetCustomerForm();
  }
}

window.addEventListener("message", event => {
  const data = event.data;

  if (
    !data ||
    data.type !== "PDP_ORDER_RESULT"
  ) {
    return;
  }

  if (data.ok) {
    finishSubmission(
      true,
      "Objednávka byla odeslána. Brzy se vám ozveme."
    );
  } else {
    finishSubmission(
      false,
      data.message ||
        "Objednávku se nepodařilo odeslat."
    );
  }
});

const orderFrame =
  document.getElementById("orderSubmitFrame");

if (orderFrame) {
  orderFrame.addEventListener("load", () => {
    if (
      !submissionPending ||
      submissionFinished
    ) {
      return;
    }

    const elapsed =
      Date.now() - submissionStartedAt;

    /*
     * Ignoruje úvodní načtení prázdného iframe,
     * které proběhne při otevření stránky.
     */
    if (elapsed < 500) {
      return;
    }

    /*
     * Google Apps Script někdy objednávku správně
     * přijme, ale jeho postMessage se přes iframe
     * nevrátí. Dokončení načtení iframe proto
     * použijeme jako záložní potvrzení.
     */
    setTimeout(() => {
      if (
        !submissionPending ||
        submissionFinished
      ) {
        return;
      }

      finishSubmission(
        true,
        "Objednávka byla odeslána. Brzy se vám ozveme."
      );
    }, 700);
  });
}

document
  .getElementById("submitOrder")
  .addEventListener("click", () => {
    const items = Object.entries(cart)
      .map(([id, quantity]) => {
        const product = products.find(
          item => item.id === Number(id)
        );

        if (!product) {
          return null;
        }

        return {
          productId: product.id,
          name: product.name,
          qty: quantity,
          price: product.price
        };
      })
      .filter(Boolean);

    const name = document
      .getElementById("customerName")
      .value
      .trim();

    const phone = document
      .getElementById("customerPhone")
      .value
      .trim();

    const pickup = document
      .getElementById("pickupDate")
      .value;

    const note = document
      .getElementById("customerNote")
      .value
      .trim();

    if (!items.length) {
      feedbackEl.textContent =
        "Nejprve vyberte alespoň jeden produkt.";
      return;
    }

    if (!name) {
      feedbackEl.textContent =
        "Vyplňte jméno.";
      return;
    }

    if (!phone) {
      feedbackEl.textContent =
        "Vyplňte telefon.";
      return;
    }

    if (!pickup) {
      feedbackEl.textContent =
        "Vyberte termín vyzvednutí.";
      return;
    }

    if (pickup < minPickupDate()) {
      feedbackEl.textContent =
        "Zvolený termín je příliš brzy pro některý z produktů.";
      return;
    }

    const backendUrl =
      window.PDP_CONFIG &&
      String(
        window.PDP_CONFIG
          .APPS_SCRIPT_URL || ""
      ).trim();

    if (
      !backendUrl ||
      !backendUrl.endsWith("/exec")
    ) {
      feedbackEl.textContent =
        "Odesílání ještě není správně propojené.";
      return;
    }

    const order = {
      name,
      phone,
      pickup,
      note,
      source: "Web",
      items,
      total: items.reduce(
        (sum, item) =>
          sum + item.qty * item.price,
        0
      )
    };

    const form = document.getElementById(
      "backendOrderForm"
    );

    const payloadInput =
      document.getElementById(
        "backendPayload"
      );

    const button =
      document.getElementById(
        "submitOrder"
      );

    if (!form || !payloadInput) {
      feedbackEl.textContent =
        "Na stránce chybí odesílací formulář.";
      return;
    }

    form.action = backendUrl;
    payloadInput.value =
      JSON.stringify(order);

    submissionPending = true;
    submissionFinished = false;
    submissionStartedAt = Date.now();

    button.disabled = true;
    button.textContent = "Odesílám…";

    feedbackEl.textContent =
      "Odesílám objednávku…";

    form.submit();

    clearTimeout(submitTimeout);

    submitTimeout = setTimeout(() => {
      if (
        !submissionPending ||
        submissionFinished
      ) {
        return;
      }

      submissionPending = false;

      button.disabled = false;
      button.textContent =
        "Odeslat objednávku";

      feedbackEl.textContent =
        "Nepodařilo se potvrdit odeslání. Zkontrolujte e-mail nebo tabulku před opakováním objednávky.";
    }, 25000);
  });

renderAll();
