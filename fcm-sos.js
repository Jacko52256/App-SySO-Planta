// =========================================================================
// MÓDULO INDEPENDIENTE WEB PUSH FCM (V6.60) — CERO COLISIONES GLOBALES
// =========================================================================
(function () {
  const WORKER_URL = "https://syso-fcm-bridge.jackmich555.workers.dev";
  const VAPID_KEY = "BJmOKEuskg8L3AHro8c6XoHuH45f9AHs0Rfl3VuojzF7ZR-UyoKAAySguLeVfRGU0qcBKLxSLBi_OeUkZZIMaiA";
  const FIREBASE_CFG = {
    apiKey: "AIzaSyDpWyi18A5KJdJLS9RGEK0fVmkm4DcoKqU",
    authDomain: "syso-industrial.firebaseapp.com",
    databaseURL: "https://syso-industrial-default-rtdb.firebaseio.com",
    projectId: "syso-industrial",
    storageBucket: "syso-industrial.firebasestorage.app",
    messagingSenderId: "89972723899",
    appId: "1:89972723899:web:731db5a9c03a3ff3e5599e"
  };

  let sdkPromise = null;
  let ultimoPerfilSync = "";

  function cargarScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  function cargarFirebaseSDK() {
    if (!sdkPromise) {
      sdkPromise = cargarScript("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js")
        .then(() => cargarScript("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"));
    }
    return sdkPromise;
  }

  function obtenerDatosUsuarioActual() {
    try {
      if (typeof usuarioActual !== "undefined" && usuarioActual) {
        return {
          usuario: usuarioActual.nombre || "Brigadista",
          rol: usuarioActual.rol || "Inspector",
          grupos: Array.isArray(usuarioActual.grupo) ? usuarioActual.grupo : [usuarioActual.grupo || "Todos"]
        };
      }
    } catch (e) {}
    const ult = localStorage.getItem("SySO_LastDeviceUser") || "Brigadista";
    return { usuario: ult, rol: "Inspector", grupos: ["Todos"] };
  }

  function esCreadorSeguro() {
    try {
      if (typeof esUsuarioCreador === "function") return esUsuarioCreador();
    } catch (e) {}
    return false;
  }

  async function fetchConTimeout(url, options, ms = 3500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function registrarDispositivoFCM(silencioso = false) {
    const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const esStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      if (!silencioso) {
        if (esIOS && !esStandalone) {
          alert("📱 En iPhone primero debes instalar la app en tu pantalla:\n\n1) Toca el botón Compartir (⬆️) abajo en Safari.\n2) Elige 'Agregar a pantalla de inicio'.\n3) Abre Gestión SySO desde ese ícono nuevo y vuelve a tocar este botón.");
        } else {
          alert("⚠️ Este navegador no admite notificaciones Push en segundo plano. Abre la app desde Google Chrome actualizado.");
        }
      }
      return { ok: false, motivo: "no-soporte" };
    }

    let permiso = Notification.permission;
    if (permiso !== "granted") {
      if (silencioso) return { ok: false, motivo: "sin-permiso" };
      if (permiso === "denied") {
        alert("🔒 Las notificaciones están bloqueadas para esta página.\n\nToca el ícono del candado o ajustes junto a la dirección web arriba, activa 'Notificaciones ➔ Permitir' y vuelve a presionar este botón.");
        return { ok: false, motivo: "denegado" };
      }
      permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        alert("⚠️ Debes tocar 'Permitir' en el aviso de notificaciones para recibir alertas con la app cerrada.");
        return { ok: false, motivo: "rechazado" };
      }
    }

    try {
      await cargarFirebaseSDK();
      const swReg = await navigator.serviceWorker.register("./firebase-messaging-sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;

      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(FIREBASE_CFG);
      }
      const messaging = firebase.messaging();

      if (!window._sysoFcmForegroundBound) {
        window._sysoFcmForegroundBound = true;
        messaging.onMessage((payload) => {
          const tipo = (payload && payload.data && payload.data.tipo) || "";
          if (String(tipo).toLowerCase().includes("prueba")) {
            try { if (typeof sonarSirenaWebAudio === "function") sonarSirenaWebAudio(); } catch (e) {}
            if (typeof mostrarToastGuardado === "function") mostrarToastGuardado("🔔 Prueba Push FCM recibida correctamente");
            return;
          }
          try { if (typeof verificarSOSActivoEnNube === "function") verificarSOSActivoEnNube(); } catch (e) {}
        });
      }

      const token = await messaging.getToken({
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg
      });
      if (!token) throw new Error("Firebase no devolvió un token Push válido.");

      const perfil = obtenerDatosUsuarioActual();
      const res = await fetchConTimeout(`${WORKER_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          usuario: perfil.usuario,
          rol: perfil.rol,
          grupos: perfil.grupos
        })
      }, 6000);

      if (!res.ok) throw new Error("El puente Cloudflare devolvió HTTP " + res.status);

      localStorage.setItem("SySO_FCM_Token", token);
      localStorage.setItem("SySO_SOS_Guard_Active", "true");
      ultimoPerfilSync = `${perfil.usuario}|${perfil.rol}|${perfil.grupos.join(",")}`;
      actualizarEstadoVisualBotonGuardia();
      return { ok: true, token };
    } catch (err) {
      if (!silencioso) {
        alert("❌ No se pudo vincular este dispositivo al canal Push FCM:\n" + (err.message || err));
      }
      return { ok: false, motivo: String(err.message || err) };
    }
  }

  window.probarPushFCMBloqueado = async function () {
    const token = localStorage.getItem("SySO_FCM_Token");
    if (!token) {
      alert("⚠️ Primero toca el botón verde/rojo 'Activar Guardia S.O.S. Push' para registrar este celular.");
      return;
    }
    const btn = document.getElementById("btnProbarPushFCM");
    if (btn) {
      btn.disabled = true;
      btn.innerText = "⏳ Bloquea la pantalla o cierra Chrome (5s)...";
    }
    if (typeof mostrarToastGuardado === "function") {
      mostrarToastGuardado("⏳ Enviando prueba en 5 segundos... ¡Bloquea tu pantalla ahora!");
    }
    setTimeout(async () => {
      try {
        const perfil = obtenerDatosUsuarioActual();
        const res = await fetchConTimeout(`${WORKER_URL}/send-sos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "Prueba S.O.S.",
            seccion: "Prueba de Sistema",
            reporta: perfil.usuario,
            hora: new Date().toLocaleTimeString(),
            sosId: String(Date.now()),
            titulo: "🧪 PRUEBA ALERTA S.O.S. (SySO)",
            cuerpo: "Si ves esto con la pantalla bloqueada o Chrome cerrado, Web Push FCM funciona al 100%."
          })
        }, 7000);
        const data = await res.json();
        if (btn) {
          btn.disabled = false;
          btn.innerText = `✅ Prueba enviada (${data.enviados || 0} cel.) — Probar de nuevo`;
        }
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.innerText = "🧪 Probar Alerta Push (Cuenta regresiva 5s)";
        }
        alert("❌ Error enviando prueba Push: " + (e.message || e));
      }
    }, 5000);
  };

  function inyectarBotonPruebaCreador() {
    const btnGuardia = document.getElementById("btnActivarGuardiaSOS");
    if (!btnGuardia) return;
    let btnTest = document.getElementById("btnProbarPushFCM");
    if (!esCreadorSeguro()) {
      if (btnTest) btnTest.remove();
      return;
    }
    if (!btnTest) {
      btnTest = document.createElement("button");
      btnTest.id = "btnProbarPushFCM";
      btnTest.type = "button";
      btnTest.className = "btn btn-info";
      btnTest.style.cssText = "margin-top:6px; font-size:13px;";
      btnTest.innerText = "🧪 Probar Alerta Push (Cuenta regresiva 5s)";
      btnTest.onclick = window.probarPushFCMBloqueado;
      btnGuardia.insertAdjacentElement("afterend", btnTest);
    }
  }

  window.actualizarEstadoVisualBotonGuardia = function () {
    const btn = document.getElementById("btnActivarGuardiaSOS");
    if (!btn) return;
    const activa = localStorage.getItem("SySO_SOS_Guard_Active") === "true";
    const tieneToken = !!localStorage.getItem("SySO_FCM_Token");
    const permOK = ("Notification" in window) && Notification.permission === "granted";

    if (activa && tieneToken && permOK) {
      btn.className = "btn btn-success";
      btn.innerHTML = "🛡️ Guardia S.O.S. Push 24/7 Activa (Sin ntfy)";
      try { if (typeof iniciarPulsoSilenciosoSegundoPlano === "function") iniciarPulsoSilenciosoSegundoPlano(); } catch (e) {}
    } else if (activa && !tieneToken) {
      btn.className = "btn btn-warning";
      btn.style.color = "#000";
      btn.innerHTML = "🔔 Tocar para Vincular Alertas Push FCM (Sin ntfy)";
    } else {
      btn.className = "btn btn-danger";
      btn.style.color = "";
      btn.innerHTML = "🔔 Activar Guardia S.O.S. Push 24/7 (App Cerrada)";
    }
    inyectarBotonPruebaCreador();
  };

  window.activarGuardiaSOS247 = async function () {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (typeof sharedAudioCtx !== "undefined") {
          if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
          if (sharedAudioCtx.state === "suspended") await sharedAudioCtx.resume();
        }
      }
      if (navigator.vibrate) navigator.vibrate(120);
    } catch (e) {}
    try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch (e) {}

    const btn = document.getElementById("btnActivarGuardiaSOS");
    if (btn) btn.innerHTML = "⏳ Vinculando este celular con Firebase Push...";

    const res = await registrarDispositivoFCM(false);
    if (res.ok) {
      try { if (typeof iniciarPulsoSilenciosoSegundoPlano === "function") iniciarPulsoSilenciosoSegundoPlano(); } catch (e) {}
      alert("✅ GUARDIA S.O.S. PUSH 24/7 ACTIVADA EN ESTE TELÉFONO:\n\n• Ya no necesitas instalar ntfy ni tendrás notificaciones fijas molestas.\n• Recibirás alertas S.O.S. aunque cierres Chrome o bloquees la pantalla.\n• Al tocar la alerta se abrirá Gestión SySO con la sirena y los datos del sector.");
    } else {
      actualizarEstadoVisualBotonGuardia();
    }
  };

  window.dispararSOS = async function (tipoEmergencia) {
    const selSec = document.getElementById("sosSeccion");
    const sec = selSec ? selSec.value : "Planta";
    const perfil = obtenerDatosUsuarioActual();
    const usr = perfil.usuario || "Operario de Planta";
    const horaStr = (typeof obtenerFechaHoraEstandar === "function")
      ? obtenerFechaHoraEstandar().fechaHora.split(", ")[1]
      : new Date().toLocaleTimeString();
    const sosId = Date.now();
    const payloadSOS = { active: true, id: sosId, tipo: tipoEmergencia, seccion: sec, reporta: usr, hora: horaStr };

    if (typeof cerrarModalSOS === "function") cerrarModalSOS();

    const pWorker = fetchConTimeout(`${WORKER_URL}/send-sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: tipoEmergencia,
        seccion: sec,
        reporta: usr,
        hora: horaStr,
        sosId: String(sosId),
        titulo: `🚨 ALERTA S.O.S.: ${String(tipoEmergencia).toUpperCase()}`,
        cuerpo: `📍 Sector: ${sec} | Reporta: ${usr} (${horaStr}) — Inicien protocolo de emergencia.`
      })
    }, 3500).catch(() => {});

    const cloudUrl = (typeof CLOUD_SOS_URL !== "undefined")
      ? CLOUD_SOS_URL
      : "https://syso-industrial-default-rtdb.firebaseio.com/syso_sos_active.json";

    const pFirebase = fetchConTimeout(cloudUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadSOS)
    }, 3500).catch(() => {});

    await Promise.allSettled([pWorker, pFirebase]);
    try { if (typeof verificarSOSActivoEnNube === "function") verificarSOSActivoEnNube(); } catch (e) {}

    let msg = `*🚨 ALERTA S.O.S. TIPO: ${tipoEmergencia.toUpperCase()} 🚨*\n\n📍 *Ubicación:* ${sec}\n👨‍🚒 *Reporta:* ${usr}\n⏰ *Hora:* ${horaStr}\n\n`;
    msg += tipoEmergencia === "Accidente Médico"
      ? `📢 *Atención requerida:* PA Equipo, Primeros Auxilios, Comunicación y Jefes de Brigada.\n\n`
      : `📢 *Atención requerida:* EVACUACIÓN INMEDIATA. Todo el personal de Brigada.\n\n`;
    msg += `🚨 *Brigadistas, inicien el protocolo de emergencia!*`;
    window.location.href = `whatsapp://send?text=${encodeURIComponent(msg)}`;
  };

  window.finalizarAlertaSOSGlobalPlanta = async function () {
    if (!esCreadorSeguro()) {
      if (typeof apagarMiAlarmaSOS === "function") apagarMiAlarmaSOS();
      return;
    }
    if (!confirm("👑 ¿Desea finalizar y apagar la alerta S.O.S. para TODOS los dispositivos de la planta?")) return;
    if (typeof apagarMiAlarmaSOS === "function") apagarMiAlarmaSOS();

    const perfil = obtenerDatosUsuarioActual();
    const cloudUrl = (typeof CLOUD_SOS_URL !== "undefined")
      ? CLOUD_SOS_URL
      : "https://syso-industrial-default-rtdb.firebaseio.com/syso_sos_active.json";

    await Promise.allSettled([
      fetchConTimeout(cloudUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false, id: 0, finalizadoPor: perfil.usuario || "Jack Wiens", ts: Date.now() })
      }, 4000),
      fetchConTimeout(`${WORKER_URL}/send-sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "Finalizada",
          seccion: "Planta",
          reporta: perfil.usuario || "Jack Wiens",
          titulo: "✅ ALARMA S.O.S. FINALIZADA",
          cuerpo: `La alerta S.O.S. fue desactivada globalmente por ${perfil.usuario || "Jefatura"}.`
        })
      }, 4000)
    ]);
    if (typeof cerrarModalSOS === "function") cerrarModalSOS();
    alert("🔕 Alerta S.O.S. finalizada en toda la planta.");
  };

  function inicializarModuloFCM() {
    document.title = "Gestión SySO V6.60 - Industrial Cloud IA";
    const badgeVer = document.querySelector(".version-badge");
    if (badgeVer) badgeVer.innerText = "V6.60";
    actualizarEstadoVisualBotonGuardia();

    if (("Notification" in window) && Notification.permission === "granted" && localStorage.getItem("SySO_SOS_Guard_Active") === "true") {
      registrarDispositivoFCM(true);
    }

    setInterval(() => {
      inyectarBotonPruebaCreador();
      if (("Notification" in window) && Notification.permission === "granted" && localStorage.getItem("SySO_FCM_Token")) {
        const p = obtenerDatosUsuarioActual();
        const firma = `${p.usuario}|${p.rol}|${p.grupos.join(",")}`;
        if (firma !== ultimoPerfilSync && typeof usuarioActual !== "undefined" && usuarioActual) {
          registrarDispositivoFCM(true);
        }
      }
    }, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(inicializarModuloFCM, 600));
  } else {
    setTimeout(inicializarModuloFCM, 600);
  }
})();
