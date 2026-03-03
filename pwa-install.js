(function () {
  let deferredPrompt = null;
  let btn = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIosSafari() {
    const ua = window.navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isIOS && isSafari;
  }

  function ensureButton() {
    if (btn || isStandalone()) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "pwaInstallBtn";
    btn.textContent = "Install App";
    btn.style.position = "fixed";
    btn.style.right = "14px";
    btn.style.bottom = "14px";
    btn.style.zIndex = "9999";
    btn.style.border = "0";
    btn.style.borderRadius = "10px";
    btn.style.padding = "10px 12px";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";
    btn.style.color = "#fff";
    btn.style.background = "#1f3d28";
    btn.style.boxShadow = "0 8px 18px rgba(0,0,0,.2)";
    btn.style.display = "none";
    document.body.appendChild(btn);
  }

  function showButton(label) {
    ensureButton();
    if (!btn) return;
    btn.textContent = label || "Install App";
    btn.style.display = "block";
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showButton("Install App");
  });

  window.addEventListener("appinstalled", function () {
    if (btn) btn.style.display = "none";
    deferredPrompt = null;
  });

  window.addEventListener("load", function () {
    if (isStandalone()) return;
    ensureButton();
    if (!btn) return;

    btn.addEventListener("click", async function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch (_err) {}
        deferredPrompt = null;
        return;
      }
      if (isIosSafari()) {
        alert("To install on iPhone: tap Share, then 'Add to Home Screen'.");
      } else {
        alert("Use your browser menu and choose 'Install app' or 'Add to Home Screen'.");
      }
    });

    if (isIosSafari()) {
      showButton("Add to Home Screen");
    }
  });
})();
