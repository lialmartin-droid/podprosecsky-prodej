const DEFAULT_PRODUCTS = [
  {id:1,emoji:"🍯",name:"Květový med",price:190,unit:"950 g",short:"Smíšený květový med z okolí Lukášova.",detail:"Včely sbírají nektar z lučního kvítí, maliní, ovocných stromů, lip a okolních lesů.",visible:true,soldOut:false,restock:"",leadDays:0,quick:[]},
  {id:2,emoji:"🥚",name:"Čerstvá vejce",price:7,unit:"kus",short:"Vejce od našich slepic z domácího chovu.",detail:"Kvalitní směs, zelenina a každý den přístup na trávu a k červům.",visible:true,soldOut:false,restock:"",leadDays:7,quick:[6,10,30]}
];

let products = JSON.parse(localStorage.getItem("pdp-products") || "null") || DEFAULT_PRODUCTS;
let orders = JSON.parse(localStorage.getItem("pdp-orders") || "[]");

function persist(){
  localStorage.setItem("pdp-products", JSON.stringify(products));
  localStorage.setItem("pdp-orders", JSON.stringify(orders));
}
function money(v){return `${v} Kč`}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function archived(o){return ["Vyzvednuto","Zrušeno"].includes(o.status)}
function formatDate(d){return d ? new Date(d+"T12:00:00").toLocaleDateString("cs-CZ",{weekday:"long",day:"numeric",month:"long"}) : "Bez termínu"}

function renderStats(){
  document.getElementById("statNew").textContent = orders.filter(o=>o.status==="Nová").length;
  document.getElementById("statRevenue").textContent = money(orders.filter(o=>o.status!=="Zrušeno").reduce((s,o)=>s+o.total,0));
  document.getElementById("statEggs").textContent = orders.filter(o=>o.status!=="Zrušeno").flatMap(o=>o.items).filter(i=>i.productId===2).reduce((s,i)=>s+i.qty,0);
  document.getElementById("statHoney").textContent = orders.filter(o=>o.status!=="Zrušeno").flatMap(o=>o.items).filter(i=>i.productId===1).reduce((s,i)=>s+i.qty,0);
}

function filteredOrders(){
  const q = document.getElementById("searchOrders").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const archive = document.getElementById("archiveFilter").value;
  return orders.filter(o=>{
    const searchOk = !q || o.name.toLowerCase().includes(q) || (o.phone||"").toLowerCase().includes(q);
    const statusOk = !status || o.status===status;
    const archiveOk = archive==="all" || (archive==="archive" ? archived(o) : !archived(o));
    return searchOk && statusOk && archiveOk;
  });
}

function orderEditorHtml(o){
  return `
    <div id="orderEditor${o.id}" class="editor">
      <div class="form-grid">
        <label><span>Jméno</span><input data-o-name="${o.id}" value="${esc(o.name)}"></label>
        <label><span>Telefon</span><input data-o-phone="${o.id}" value="${esc(o.phone||"")}"></label>
        <label><span>Termín vyzvednutí</span><input data-o-pickup="${o.id}" type="date" value="${esc(o.pickup||"")}"></label>
        <label><span>Stav</span><select data-o-status="${o.id}">${["Nová","Připravuji","Připraveno","Vyzvednuto","Zrušeno"].map(s=>`<option ${s===o.status?"selected":""}>${s}</option>`).join("")}</select></label>
        <div class="full"><span class="field-label">Položky</span><div class="quantity-list">
          ${products.map(p=>{const item=o.items.find(i=>i.productId===p.id);return `<div class="quantity-row"><span>${esc(p.emoji)} ${esc(p.name)}</span><input data-o-product="${o.id}-${p.id}" type="number" min="0" value="${item?item.qty:0}"></div>`}).join("")}
        </div></div>
        <label class="full"><span>Poznámka</span><textarea data-o-note="${o.id}" rows="3">${esc(o.note||"")}</textarea></label>
      </div>
      <div class="actions"><button class="primary-small" data-save-order="${o.id}">Uložit změny</button></div>
    </div>`;
}

function renderOrders(){
  const list = filteredOrders();
  const root = document.getElementById("ordersList");
  root.innerHTML = list.length ? list.map(o=>`
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${esc(o.name)}</h3>
          <div class="meta">${esc(o.created||"")} · ${esc(o.phone||"bez telefonu")}</div>
          <div class="badges"><span class="badge blue">${esc(formatDate(o.pickup))}</span>${archived(o)?'<span class="badge gray">Archiv</span>':""}</div>
        </div>
        <strong>${money(o.total)}</strong>
      </div>
      <div class="item-list">${o.items.map(i=>`${i.qty}× ${esc(i.name)}`).join("<br>")}</div>
      ${o.note?`<div class="meta">Poznámka: ${esc(o.note)}</div>`:""}
      <div class="card-bottom">
        <select class="status-select" data-status="${o.id}">${["Nová","Připravuji","Připraveno","Vyzvednuto","Zrušeno"].map(s=>`<option ${s===o.status?"selected":""}>${s}</option>`).join("")}</select>
        <div class="actions">
          <button class="secondary-button" data-edit-order="${o.id}">Upravit</button>
          <button class="danger-button" data-delete-order="${o.id}">Smazat</button>
        </div>
      </div>
      ${orderEditorHtml(o)}
    </article>`).join("") : '<div class="empty">Žádné objednávky neodpovídají filtru.</div>';

  document.querySelectorAll("[data-status]").forEach(el=>el.addEventListener("change",()=>{
    orders.find(o=>o.id===Number(el.dataset.status)).status=el.value;
    persist(); renderAll();
  }));
  document.querySelectorAll("[data-edit-order]").forEach(b=>b.addEventListener("click",()=>document.getElementById("orderEditor"+b.dataset.editOrder).classList.toggle("open")));
  document.querySelectorAll("[data-save-order]").forEach(b=>b.addEventListener("click",()=>saveEditedOrder(Number(b.dataset.saveOrder))));
  document.querySelectorAll("[data-delete-order]").forEach(b=>b.addEventListener("click",()=>{
    if(confirm("Opravdu chcete objednávku smazat?")){
      orders = orders.filter(o=>o.id!==Number(b.dataset.deleteOrder));
      persist(); renderAll();
    }
  }));
}

function saveEditedOrder(id){
  const o = orders.find(x=>x.id===id);
  o.name = document.querySelector(`[data-o-name="${id}"]`).value.trim() || "Bez jména";
  o.phone = document.querySelector(`[data-o-phone="${id}"]`).value.trim();
  o.pickup = document.querySelector(`[data-o-pickup="${id}"]`).value;
  o.status = document.querySelector(`[data-o-status="${id}"]`).value;
  o.note = document.querySelector(`[data-o-note="${id}"]`).value.trim();
  o.items = products.map(p=>{
    const qty = Math.max(0,Number(document.querySelector(`[data-o-product="${id}-${p.id}"]`).value)||0);
    return {productId:p.id,name:p.name,qty,price:p.price};
  }).filter(i=>i.qty>0);
  o.total = o.items.reduce((s,i)=>s+i.qty*i.price,0);
  persist(); renderAll();
}

function renderCalendar(){
  const groups = {};
  orders.filter(o=>o.status!=="Zrušeno").forEach(o=>{const key=o.pickup||"without";(groups[key] ||= []).push(o)});
  const keys = Object.keys(groups).sort((a,b)=>a==="without"?1:b==="without"?-1:a.localeCompare(b));
  document.getElementById("calendarList").innerHTML = keys.length ? keys.map(key=>`
    <article class="card">
      <div class="card-head"><div><div class="eyebrow">${key==="without"?"Neurčeno":"Vyzvednutí"}</div><h3>${esc(key==="without"?"Bez zadaného termínu":formatDate(key))}</h3></div><span class="badge blue">${groups[key].length} objednávek</span></div>
      ${groups[key].map(o=>`<div class="calendar-entry"><div><strong>${esc(o.name)}</strong><div class="meta">${o.items.map(i=>`${i.qty}× ${esc(i.name)}`).join(", ")}</div></div><div><strong>${money(o.total)}</strong><div class="meta">${esc(o.status)}</div></div></div>`).join("")}
    </article>`).join("") : '<div class="empty">V kalendáři zatím nejsou objednávky.</div>';
}

function productBadgeHtml(p){
  const badges=[];
  if(!p.visible) badges.push('<span class="badge gray">Skryto</span>');
  else if(p.soldOut) badges.push('<span class="badge orange">Vyprodáno</span>');
  else badges.push('<span class="badge green">V prodeji</span>');
  if(p.restock) badges.push(`<span class="badge orange">Doplnění: ${esc(p.restock)}</span>`);
  if(p.leadDays) badges.push(`<span class="badge blue">${p.leadDays} dní předem</span>`);
  return badges.join("");
}

function renderProducts(){
  document.getElementById("productsList").innerHTML = products.map(p=>`
    <article class="card">
      <div class="card-head">
        <div style="display:flex;gap:12px"><div style="font-size:36px">${esc(p.emoji)}</div><div><h3>${esc(p.name)}</h3><div class="meta">${esc(p.short)}</div><div class="badges">${productBadgeHtml(p)}</div></div></div>
        <button class="secondary-button" data-edit-product="${p.id}">Upravit</button>
      </div>
      <div id="productEditor${p.id}" class="editor">
        <div class="form-grid">
          <label><span>Název</span><input data-p-name="${p.id}" value="${esc(p.name)}"></label>
          <label><span>Emoji</span><input data-p-emoji="${p.id}" value="${esc(p.emoji)}"></label>
          <label><span>Cena</span><input data-p-price="${p.id}" type="number" min="0" value="${p.price}"></label>
          <label><span>Jednotka</span><input data-p-unit="${p.id}" value="${esc(p.unit)}"></label>
          <label class="full"><span>Krátký popis</span><input data-p-short="${p.id}" value="${esc(p.short)}"></label>
          <label class="full"><span>Podrobné informace</span><textarea data-p-detail="${p.id}" rows="3">${esc(p.detail)}</textarea></label>
          <label><span>Předpokládané doplnění</span><input data-p-restock="${p.id}" type="date" value="${esc(p.restock||"")}"></label>
          <label><span>Minimální předstih (dny)</span><input data-p-lead="${p.id}" type="number" min="0" value="${p.leadDays||0}"></label>
          <label class="full"><span>Rychlá tlačítka</span><input data-p-quick="${p.id}" value="${esc((p.quick||[]).join(", "))}"></label>
        </div>
        <div class="actions">
          <label><input data-p-visible="${p.id}" type="checkbox" ${p.visible?"checked":""}> Zobrazovat</label>
          <label><input data-p-sold="${p.id}" type="checkbox" ${p.soldOut?"checked":""}> Vyprodáno</label>
          <button class="danger-button" data-delete-product="${p.id}">Smazat</button>
          <button class="primary-small" data-save-product="${p.id}">Uložit</button>
        </div>
      </div>
    </article>`).join("");

  document.querySelectorAll("[data-edit-product]").forEach(b=>b.addEventListener("click",()=>document.getElementById("productEditor"+b.dataset.editProduct).classList.toggle("open")));
  document.querySelectorAll("[data-save-product]").forEach(b=>b.addEventListener("click",()=>saveEditedProduct(Number(b.dataset.saveProduct))));
  document.querySelectorAll("[data-delete-product]").forEach(b=>b.addEventListener("click",()=>{
    if(confirm("Opravdu chcete produkt smazat?")){
      products = products.filter(p=>p.id!==Number(b.dataset.deleteProduct));
      persist(); renderAll();
    }
  }));
}

function saveEditedProduct(id){
  const p=products.find(x=>x.id===id);
  p.name=document.querySelector(`[data-p-name="${id}"]`).value.trim();
  p.emoji=document.querySelector(`[data-p-emoji="${id}"]`).value.trim()||"📦";
  p.price=Math.max(0,Number(document.querySelector(`[data-p-price="${id}"]`).value)||0);
  p.unit=document.querySelector(`[data-p-unit="${id}"]`).value.trim();
  p.short=document.querySelector(`[data-p-short="${id}"]`).value.trim();
  p.detail=document.querySelector(`[data-p-detail="${id}"]`).value.trim();
  p.restock=document.querySelector(`[data-p-restock="${id}"]`).value;
  p.leadDays=Math.max(0,Number(document.querySelector(`[data-p-lead="${id}"]`).value)||0);
  p.quick=document.querySelector(`[data-p-quick="${id}"]`).value.split(",").map(x=>Number(x.trim())).filter(Boolean);
  p.visible=document.querySelector(`[data-p-visible="${id}"]`).checked;
  p.soldOut=document.querySelector(`[data-p-sold="${id}"]`).checked;
  persist(); renderAll();
}

function renderManualProducts(){
  document.getElementById("manualProducts").innerHTML = products.map(p=>`<div class="quantity-row"><span>${esc(p.emoji)} ${esc(p.name)} · ${money(p.price)}</span><input data-manual-product="${p.id}" type="number" min="0" value="0"></div>`).join("");
}

function renderAll(){renderStats();renderOrders();renderCalendar();renderProducts();renderManualProducts()}

document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
  document.querySelectorAll(".tab,.tab-panel").forEach(x=>x.classList.remove("active"));
  t.classList.add("active");document.getElementById(t.dataset.tab).classList.add("active");
}));
["searchOrders","statusFilter","archiveFilter"].forEach(id=>document.getElementById(id).addEventListener(id==="searchOrders"?"input":"change",renderOrders));

document.getElementById("showManualOrder").addEventListener("click",()=>document.getElementById("manualOrderForm").classList.remove("hidden"));
document.getElementById("cancelManualOrder").addEventListener("click",()=>document.getElementById("manualOrderForm").classList.add("hidden"));
document.getElementById("saveManualOrder").addEventListener("click",()=>{
  const name=document.getElementById("manualName").value.trim();
  if(!name) return alert("Vyplňte jméno zákazníka.");
  const items=products.map(p=>{const qty=Math.max(0,Number(document.querySelector(`[data-manual-product="${p.id}"]`).value)||0);return {productId:p.id,name:p.name,qty,price:p.price}}).filter(i=>i.qty>0);
  if(!items.length) return alert("Přidejte alespoň jeden produkt.");
  orders.unshift({
    id:Date.now(),name,phone:document.getElementById("manualPhone").value.trim(),
    pickup:document.getElementById("manualPickup").value,created:new Date().toLocaleString("cs-CZ"),
    status:document.getElementById("manualStatus").value,note:document.getElementById("manualNote").value.trim(),
    items,total:items.reduce((s,i)=>s+i.qty*i.price,0)
  });
  document.getElementById("manualOrderForm").classList.add("hidden");
  persist(); renderAll();
});

document.getElementById("showProductForm").addEventListener("click",()=>document.getElementById("productForm").classList.remove("hidden"));
document.getElementById("cancelProductForm").addEventListener("click",()=>document.getElementById("productForm").classList.add("hidden"));
document.getElementById("saveNewProduct").addEventListener("click",()=>{
  const name=document.getElementById("newProductName").value.trim();
  if(!name)return alert("Vyplňte název produktu.");
  products.push({
    id:Date.now(),name,emoji:document.getElementById("newProductEmoji").value.trim()||"📦",
    price:Math.max(0,Number(document.getElementById("newProductPrice").value)||0),
    unit:document.getElementById("newProductUnit").value.trim()||"kus",
    short:document.getElementById("newProductShort").value.trim(),
    detail:document.getElementById("newProductDetail").value.trim(),
    leadDays:Math.max(0,Number(document.getElementById("newProductLead").value)||0),
    quick:document.getElementById("newProductQuick").value.split(",").map(x=>Number(x.trim())).filter(Boolean),
    visible:true,soldOut:false,restock:""
  });
  document.getElementById("productForm").classList.add("hidden");
  persist(); renderAll();
});

persist();
renderAll();
