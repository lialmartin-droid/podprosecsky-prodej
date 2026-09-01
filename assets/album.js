window.PDP_ALBUM_VERSION = "3.5.2";

const albumState = { photos:[], activeIndex:-1 };
const albumStatus = document.getElementById("albumPageStatus");
const albumGrid = document.getElementById("albumPageGrid");

function albumBackendUrl() {
  return window.PDP_CONFIG && String(window.PDP_CONFIG.APPS_SCRIPT_URL || "").trim();
}

function albumEsc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function albumThumbnail(url) {
  return String(url || "").replace(/=w\d+$/, "=w700");
}

function normalizeAlbum(input) {
  return (Array.isArray(input) ? input : [])
    .map((photo, index) => ({
      id:String(photo?.id || `photo-${index}`),
      title:String(photo?.title || "").trim(),
      caption:String(photo?.caption || "").trim(),
      image:String(photo?.image || "").trim()
    }))
    .filter(photo => photo.image);
}

function renderAlbumPage() {
  if (!albumState.photos.length) {
    albumStatus.className = "empty";
    albumStatus.textContent = "Fotografie pro Vás právě připravujeme.";
    albumGrid.classList.add("hidden");
    albumGrid.innerHTML = "";
    return;
  }

  albumStatus.className = "hidden";
  albumGrid.classList.remove("hidden");
  albumGrid.innerHTML = albumState.photos.map((photo, index) => `
    <button class="photo-album-card" type="button" data-album-index="${index}" aria-label="Otevřít fotografii ${albumEsc(photo.title || String(index + 1))}">
      <img src="${albumEsc(albumThumbnail(photo.image))}" alt="${albumEsc(photo.title || photo.caption || "Fotografie z Pod Prosečí")}" loading="lazy" decoding="async">
      ${(photo.title || photo.caption) ? `<span>${photo.title ? `<strong>${albumEsc(photo.title)}</strong>` : ""}${photo.caption ? `<small>${albumEsc(photo.caption)}</small>` : ""}</span>` : ""}
    </button>`).join("");
  albumGrid.querySelectorAll("[data-album-index]").forEach(button => {
    button.onclick = () => openAlbumPhoto(Number(button.dataset.albumIndex));
  });
}

function openAlbumPhoto(index) {
  if (!albumState.photos.length) return;
  const nextIndex = (Number(index) + albumState.photos.length) % albumState.photos.length;
  const photo = albumState.photos[nextIndex];
  albumState.activeIndex = nextIndex;
  document.getElementById("albumPageLightboxImage").src = photo.image;
  document.getElementById("albumPageLightboxImage").alt = photo.title || "Fotografie z Pod Prosečí";
  document.getElementById("albumPageLightboxTitle").textContent = photo.title || "Fotografie z Pod Prosečí";
  const caption = document.getElementById("albumPageLightboxCaption");
  caption.textContent = photo.caption || "";
  caption.classList.toggle("hidden", !photo.caption);
  document.getElementById("albumPageLightbox").classList.remove("hidden");
  document.body.classList.add("photo-lightbox-open");
  const single = albumState.photos.length < 2;
  document.getElementById("albumPageLightboxPrevious").classList.toggle("hidden", single);
  document.getElementById("albumPageLightboxNext").classList.toggle("hidden", single);
}

function closeAlbumPhoto() {
  document.getElementById("albumPageLightbox").classList.add("hidden");
  document.body.classList.remove("photo-lightbox-open");
  albumState.activeIndex = -1;
}

function loadAlbumPage() {
  const endpoint = albumBackendUrl();
  if (!endpoint || !endpoint.endsWith("/exec")) {
    albumStatus.className = "empty";
    albumStatus.textContent = "Fotoalbum se nyní nepodařilo načíst.";
    return;
  }

  const callbackName = `PDP_PUBLIC_ALBUM_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const script = document.createElement("script");
  script.id = "public-album-jsonp";
  let finished = false;
  const cleanup = () => {
    clearTimeout(timeout);
    script.remove();
    try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
  };
  const fail = () => {
    if (finished) return;
    finished = true;
    cleanup();
    albumStatus.className = "empty";
    albumStatus.textContent = "Fotoalbum se nyní nepodařilo načíst. Zkuste stránku obnovit.";
  };
  window[callbackName] = data => {
    if (finished) return;
    if (!data?.ok) {
      finished = true;
      cleanup();
      albumStatus.className = "empty";
      albumStatus.textContent = "Fotoalbum se nyní nepodařilo načíst. Zkuste stránku obnovit.";
      return;
    }
    finished = true;
    cleanup();
    albumState.photos = normalizeAlbum(data.album);
    renderAlbumPage();
  };
  const timeout = window.setTimeout(fail, 25000);
  script.onerror = fail;
  script.src = `${endpoint}?action=album&callback=${encodeURIComponent(callbackName)}&t=${Date.now()}`;
  document.head.appendChild(script);
}

document.getElementById("albumPageLightboxClose").onclick = closeAlbumPhoto;
document.getElementById("albumPageLightboxPrevious").onclick = () => openAlbumPhoto(albumState.activeIndex - 1);
document.getElementById("albumPageLightboxNext").onclick = () => openAlbumPhoto(albumState.activeIndex + 1);
document.getElementById("albumPageLightbox").onclick = event => { if (event.target === event.currentTarget) closeAlbumPhoto(); };
document.addEventListener("keydown", event => {
  if (albumState.activeIndex < 0) return;
  if (event.key === "Escape") closeAlbumPhoto();
  if (event.key === "ArrowLeft") openAlbumPhoto(albumState.activeIndex - 1);
  if (event.key === "ArrowRight") openAlbumPhoto(albumState.activeIndex + 1);
});

loadAlbumPage();
