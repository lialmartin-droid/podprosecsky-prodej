(() => {
  const $ = selector => document.querySelector(selector);
  const weekdays = ["Po","Út","St","Čt","Pá","So","Ne"];
  let entries = [];
  let selectedDate = "";
  const todayKey = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Prague",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  let monthKey = todayKey().slice(0, 7);
  const esc = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
  const dateLabel = value => new Intl.DateTimeFormat("cs-CZ", {day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));
  const addMonths = (key, amount) => { const [y,m] = key.split("-").map(Number); const d = new Date(Date.UTC(y,m - 1 + amount,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`; };
  const stateClass = status => ({"Připravuji":"preparing","Připraveno":"ready","Vyzvednuto":"done"}[status] || "new");
  function renderDetail() {
    const dayEntries = entries.filter(entry => entry.date === selectedDate);
    $("#detailTitle").textContent = selectedDate ? dateLabel(selectedDate) : "Vyber den v kalendáři";
    $("#detail").innerHTML = dayEntries.length ? dayEntries.map(entry => `<article class="entry"><div class="entry-head"><span>${esc(entry.name)}${entry.partLabel ? ` · ${esc(entry.partLabel)}` : ""}</span><span class="pill">${esc(entry.status)}</span></div><div class="items">${entry.items.map(item => `${Number(item.qty)}× ${esc(item.name)}`).join("<br>")}</div></article>`).join("") : '<p class="muted">Na tento den nejsou naplánované žádné objednávky.</p>';
  }
  function render() {
    const [year, month] = monthKey.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const title = new Intl.DateTimeFormat("cs-CZ", {month:"long",year:"numeric",timeZone:"UTC"}).format(first);
    $("#monthTitle").textContent = title.charAt(0).toUpperCase() + title.slice(1);
    $("#weekdays").innerHTML = weekdays.map(day => `<div>${day}</div>`).join("");
    const grouped = entries.reduce((all, entry) => { (all[entry.date] ||= []).push(entry); return all; }, {});
    const offset = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(year, month - 1, 1 - offset));
    const today = todayKey();
    let html = "";
    for (let i = 0; i < 42; i++) {
      const date = new Date(start.getTime() + i * 86400000); const key = date.toISOString().slice(0,10); const dayEntries = grouped[key] || [];
      const eggs = dayEntries.reduce((sum, entry) => sum + entry.items.filter(item => /vejce/i.test(item.name)).reduce((s,item) => s + Number(item.qty || 0),0),0);
      html += `<button type="button" class="day ${date.getUTCMonth() !== month-1 ? "outside" : ""} ${date.getUTCDay() === 0 || date.getUTCDay() === 6 ? "weekend" : ""} ${key === today ? "today" : ""}" data-date="${key}"><span class="date"><b>${date.getUTCDate()}</b>${eggs ? `<span class="count">🥚 ${eggs}</span>` : ""}</span>${dayEntries.slice(0,2).map(entry => `<span class="mark ${stateClass(entry.status)}">${esc(entry.name)}</span>`).join("")}${dayEntries.length > 2 ? `<span class="more">+${dayEntries.length - 2} další</span>` : ""}</button>`;
    }
    $("#grid").innerHTML = html;
    document.querySelectorAll(".day").forEach(button => button.addEventListener("click", () => { selectedDate = button.dataset.date; renderDetail(); document.querySelector(".detail-card").scrollIntoView({behavior:"smooth",block:"nearest"}); }));
    renderDetail();
  }
  function load() {
    const endpoint = String(window.PDP_CONFIG?.APPS_SCRIPT_URL || "");
    if (!endpoint) { $("#status").textContent = "Kalendář není propojený se serverem."; $("#status").classList.add("error"); return; }
    const callback = `PDP_PUBLIC_CALENDAR_${Date.now()}`;
    const script = document.createElement("script"); let done = false;
    const finish = message => { if (done) return; done = true; script.remove(); delete window[callback]; $("#status").textContent = message; };
    window[callback] = data => { if (!data?.ok) { $("#status").classList.add("error"); finish(data?.message || "Kalendář se nepodařilo načíst."); return; } entries = Array.isArray(data.entries) ? data.entries : []; render(); finish(entries.length ? "Aktualizováno právě teď." : "V kalendáři zatím nejsou žádné budoucí termíny."); };
    script.onerror = () => { $("#status").classList.add("error"); finish("Kalendář se nepodařilo načíst. Zkus stránku obnovit."); };
    script.src = `${endpoint}?action=publicCalendar&callback=${callback}&_=${Date.now()}`; document.body.appendChild(script);
    setTimeout(() => { if (!done) { $("#status").classList.add("error"); finish("Načtení kalendáře trvá příliš dlouho."); } }, 12000);
  }
  $("#previous").onclick = () => { monthKey = addMonths(monthKey,-1); render(); };
  $("#next").onclick = () => { monthKey = addMonths(monthKey,1); render(); };
  $("#today").onclick = () => { monthKey = todayKey().slice(0,7); render(); };
  load();
})();
