window.PDP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxX0zM4gURHiBdJfzn1Vux3y7WqgN_gP1DE9m26_e8bHQYynUOl2LZbkpmoGQJbhbZdvw/exec"
};

// Admin rozšíření V2.5 se načítá jen na administrační stránce.
window.addEventListener("load", () => {
  if (!document.getElementById("adminApp")) return;
  if (document.querySelector('script[data-pdp-admin-enhancements]')) return;

  const script = document.createElement("script");
  script.src = "../assets/admin-enhancements.js?v=251-20260814";
  script.dataset.pdpAdminEnhancements = "1";
  document.body.appendChild(script);
});
