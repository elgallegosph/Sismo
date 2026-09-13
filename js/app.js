import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, runTransaction, serverTimestamp, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- Estado local (se llena con los listeners en tiempo real) ----------
let damnificados = [];
let inventario = [];
let movimientos = [];
let familiares = [];

// ============================================================
// AUTENTICACIÓN
// ============================================================
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "No se pudo ingresar. Revisa el correo y la contraseña.";
    loginError.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginScreen.hidden = true;
    appShell.hidden = false;
    document.getElementById("session-email").textContent = user.email;
    await cargarRol(user);
    iniciarListeners();
  } else {
    loginScreen.hidden = false;
    appShell.hidden = true;
    rolActual = null;
  }
});

// ============================================================
// ROLES Y PERMISOS
// ============================================================
let rolActual = "consulta"; // valor por defecto más restrictivo, hasta confirmar el real

async function cargarRol(user) {
  try {
    const snap = await getDoc(doc(db, "usuarios", user.uid));
    rolActual = snap.exists() ? (snap.data().rol || "consulta") : "consulta";
    if (!snap.exists()) {
      mostrarToast("Tu usuario no tiene un rol asignado todavía. Pídele al administrador que te lo configure. Por ahora solo puedes consultar.", true);
    }
  } catch (err) {
    rolActual = "consulta";
  }
  document.getElementById("session-rol").textContent =
    { admin: "Administrador", inventario: "Inventario", consulta: "Solo consulta" }[rolActual] || rolActual;
  aplicarPermisos();
}

function aplicarPermisos() {
  const puedeEditarDamnificados = rolActual === "admin";
  const puedeInventario = rolActual === "admin" || rolActual === "inventario";

  document.getElementById("btn-importar-excel").hidden = !puedeEditarDamnificados;
  document.getElementById("btn-registrar-damnificado").hidden = !puedeEditarDamnificados;
  document.getElementById("btn-importar-familiares").hidden = !puedeEditarDamnificados;
  document.getElementById("btn-agregar-item").hidden = !puedeInventario;
  document.getElementById("btn-registrar-entrada").hidden = !puedeInventario;
  document.getElementById("btn-registrar-salida").hidden = !puedeInventario;

  renderDamnificados();
  renderInventario();
}

// ============================================================
// NAVEGACIÓN ENTRE PANELES
// ============================================================
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    document.getElementById(btn.dataset.panel).classList.add("is-active");
  });
});

// ============================================================
// MODALES (abrir / cerrar)
// ============================================================
document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modal = document.getElementById(btn.dataset.openModal);
    modal.hidden = false;
    if (modal.id === "modal-entrada") pobladorSelectItem("entrada");
    if (modal.id === "modal-salida") pobladorSelectItem("salida");
  });
});
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".modal-overlay").hidden = true;
  });
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
});

function cerrarModal(id) {
  document.getElementById(id).hidden = true;
}

function mostrarToast(mensaje, esError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = mensaje;
  toast.classList.toggle("is-error", esError);
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3200);
}

// ============================================================
// LISTENERS EN TIEMPO REAL
// ============================================================
let listenersIniciados = false;
function iniciarListeners() {
  if (listenersIniciados) return;
  listenersIniciados = true;

  onSnapshot(query(collection(db, "damnificados"), orderBy("nombre")), (snap) => {
    damnificados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDamnificados();
    renderReporteSiHayBusqueda();
  });

  onSnapshot(collection(db, "inventario"), (snap) => {
    inventario = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderInventario();
  });

  onSnapshot(query(collection(db, "movimientos"), orderBy("fecha", "desc")), (snap) => {
    movimientos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMovimientos();
    renderDamnificados();
    renderReporteSiHayBusqueda();
  });

  onSnapshot(collection(db, "familiares"), (snap) => {
    familiares = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderNucleoPanel();
  });
}

// ============================================================
// DAMNIFICADOS
// ============================================================
const formDamnificado = document.getElementById("form-damnificado");
formDamnificado.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = formDamnificado.querySelector(".form-error");
  errorEl.hidden = true;
  const datos = {
    nombre: document.getElementById("damnificado-nombre").value.trim(),
    cedula: document.getElementById("damnificado-cedula").value.trim(),
    rud: document.getElementById("damnificado-rud").value.trim(),
    telefono: document.getElementById("damnificado-telefono").value.trim(),
    vereda: document.getElementById("damnificado-vereda").value.trim(),
    direccion: document.getElementById("damnificado-direccion").value.trim(),
    categoriaRufe: document.getElementById("damnificado-rufe").value.trim(),
    formatoIngenieros: document.getElementById("damnificado-ingenieros").value.trim(),
    tipoBien: document.getElementById("damnificado-tipobien").value.trim(),
    tenenciaVivienda: document.getElementById("damnificado-tenencia").value,
    habitantes: Number(document.getElementById("damnificado-habitantes").value) || 0,
    adultos: Number(document.getElementById("damnificado-adultos").value) || 0,
    menores: Number(document.getElementById("damnificado-menores").value) || 0,
    edad: document.getElementById("damnificado-edad").value.trim(),
    enfermedadesBase: document.getElementById("damnificado-enfermedades").value.trim(),
    afectacionServicios: document.getElementById("damnificado-servicios").value.trim(),
    viviendaAveriadaTecho: document.getElementById("damnificado-vivienda-techo").checked,
    viviendaAveriadaPared: document.getElementById("damnificado-vivienda-pared").checked,
    viviendaAveriadaPisos: document.getElementById("damnificado-vivienda-pisos").checked,
    viviendaAveriadaOtro: document.getElementById("damnificado-vivienda-otro").value.trim(),
    viviendaAfectadaEstructural: document.getElementById("damnificado-vivienda-estructural").checked,
    viviendaColapsada: document.getElementById("damnificado-vivienda-colapsada").checked,
    formatoDesalojoFirmado: document.getElementById("damnificado-desalojo-firmado").checked,
    desalojados: document.getElementById("damnificado-desalojados").checked,
    edificacionAveriada: document.getElementById("damnificado-edif-averiada").checked,
    edificacionAfectadaEstructural: document.getElementById("damnificado-edif-estructural").checked,
    edificacionColapsada: document.getElementById("damnificado-edif-colapsada").checked,
    infraestructuraVialAfectada: document.getElementById("damnificado-via-afectada").checked,
    personas: Number(document.getElementById("damnificado-habitantes").value) || 1,
  };
  try {
    const id = document.getElementById("damnificado-id").value;
    if (id) {
      await updateDoc(doc(db, "damnificados", id), datos);
      mostrarToast("Damnificado actualizado.");
    } else {
      await addDoc(collection(db, "damnificados"), {
        ...datos,
        fechaRegistro: serverTimestamp(),
        registradoPor: auth.currentUser.email,
      });
      mostrarToast("Damnificado registrado.");
    }
    formDamnificado.reset();
    document.getElementById("damnificado-id").value = "";
    cerrarModal("modal-damnificado");
  } catch (err) {
    errorEl.textContent = "No se pudo guardar. Intenta de nuevo.";
    errorEl.hidden = false;
  }
});

function contarEntregas(damnificadoId, categoria) {
  return movimientos.filter(
    (m) => m.tipo === "salida" && m.damnificadoId === damnificadoId && m.categoria === categoria
  ).length;
}

function renderDamnificados() {
  const tbody = document.getElementById("tabla-damnificados");
  const filtro = document.getElementById("buscar-damnificado").value.trim().toLowerCase();
  const filtrados = damnificados.filter((d) => coincideBusqueda(d, filtro));

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${
      filtro ? "Nadie coincide con esa búsqueda." : "Todavía no hay damnificados registrados."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map((d) => `
    <tr>
      <td>${escapeHtml(d.nombre)}</td>
      <td>${escapeHtml(d.cedula)}</td>
      <td>${escapeHtml(d.rud)}</td>
      <td>${escapeHtml(d.telefono || "—")}</td>
      <td><span class="badge badge-count">${contarEntregas(d.id, "mercado")}</span></td>
      <td><span class="badge badge-count">${contarEntregas(d.id, "material")}</span></td>
      <td>${rolActual === "admin" ? `<button class="btn btn-ghost btn-small" data-editar-damnificado="${d.id}">Editar</button>` : ""}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-editar-damnificado]").forEach((btn) => {
    btn.addEventListener("click", () => abrirEdicionDamnificado(btn.dataset.editarDamnificado));
  });
}

function abrirEdicionDamnificado(id) {
  const d = damnificados.find((x) => x.id === id);
  if (!d) return;
  document.getElementById("damnificado-id").value = d.id;
  document.getElementById("damnificado-nombre").value = d.nombre || "";
  document.getElementById("damnificado-cedula").value = d.cedula || "";
  document.getElementById("damnificado-rud").value = d.rud || "";
  document.getElementById("damnificado-telefono").value = d.telefono || "";
  document.getElementById("damnificado-vereda").value = d.vereda || "";
  document.getElementById("damnificado-direccion").value = d.direccion || "";
  document.getElementById("damnificado-rufe").value = d.categoriaRufe || "";
  document.getElementById("damnificado-ingenieros").value = d.formatoIngenieros || "";
  document.getElementById("damnificado-tipobien").value = d.tipoBien || "";
  document.getElementById("damnificado-tenencia").value = d.tenenciaVivienda || "";
  document.getElementById("damnificado-habitantes").value = d.habitantes || "";
  document.getElementById("damnificado-adultos").value = d.adultos || "";
  document.getElementById("damnificado-menores").value = d.menores || "";
  document.getElementById("damnificado-edad").value = d.edad || "";
  document.getElementById("damnificado-enfermedades").value = d.enfermedadesBase || "";
  document.getElementById("damnificado-servicios").value = d.afectacionServicios || "";
  document.getElementById("damnificado-vivienda-techo").checked = !!d.viviendaAveriadaTecho;
  document.getElementById("damnificado-vivienda-pared").checked = !!d.viviendaAveriadaPared;
  document.getElementById("damnificado-vivienda-pisos").checked = !!d.viviendaAveriadaPisos;
  document.getElementById("damnificado-vivienda-otro").value = d.viviendaAveriadaOtro || "";
  document.getElementById("damnificado-vivienda-estructural").checked = !!d.viviendaAfectadaEstructural;
  document.getElementById("damnificado-vivienda-colapsada").checked = !!d.viviendaColapsada;
  document.getElementById("damnificado-desalojo-firmado").checked = !!d.formatoDesalojoFirmado;
  document.getElementById("damnificado-desalojados").checked = !!d.desalojados;
  document.getElementById("damnificado-edif-averiada").checked = !!d.edificacionAveriada;
  document.getElementById("damnificado-edif-estructural").checked = !!d.edificacionAfectadaEstructural;
  document.getElementById("damnificado-edif-colapsada").checked = !!d.edificacionColapsada;
  document.getElementById("damnificado-via-afectada").checked = !!d.infraestructuraVialAfectada;
  renderNucleoFamiliarEnModal(d);
  document.getElementById("modal-damnificado").hidden = false;
}

document.getElementById("btn-registrar-damnificado").addEventListener("click", () => {
  formDamnificado.reset();
  document.getElementById("damnificado-id").value = "";
  document.getElementById("damnificado-nucleo-familiar").innerHTML =
    `<p class="empty-state">Se muestra al editar un damnificado ya guardado, si hay datos de núcleo familiar importados para su RUD.</p>`;
});

function numeroRud(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos ? parseInt(digitos, 10) : null;
}

function renderNucleoFamiliarEnModal(d) {
  const cont = document.getElementById("damnificado-nucleo-familiar");
  const num = numeroRud(d.rud);
  const miembros = num === null ? [] : familiares.filter((f) => f.formularioNum === num);
  if (miembros.length === 0) {
    cont.innerHTML = `<p class="empty-state">No hay núcleo familiar importado para este RUD.</p>`;
    return;
  }
  cont.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Parentesco</th><th>Nombre completo</th><th>Documento</th></tr></thead>
        <tbody>
          ${miembros.map((f) => `
            <tr>
              <td>${escapeHtml(f.parentesco || "—")}</td>
              <td>${escapeHtml(f.nombreCompleto)}</td>
              <td>${escapeHtml(f.tipoDocumento || "")} ${escapeHtml(f.numeroDocumento || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById("buscar-damnificado").addEventListener("input", renderDamnificados);

function coincideBusqueda(d, filtro) {
  if (!filtro) return true;
  return [d.nombre, d.cedula, d.rud].some((v) => (v || "").toLowerCase().includes(filtro));
}

// ============================================================
// INVENTARIO
// ============================================================
const formItem = document.getElementById("form-item");
formItem.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = formItem.querySelector(".form-error");
  errorEl.hidden = true;
  try {
    await addDoc(collection(db, "inventario"), {
      categoria: document.getElementById("item-categoria").value,
      nombre: document.getElementById("item-nombre").value.trim(),
      unidad: document.getElementById("item-unidad").value.trim(),
      stock: Number(document.getElementById("item-stock").value) || 0,
    });
    mostrarToast("Artículo agregado al inventario.");
    formItem.reset();
    cerrarModal("modal-item");
  } catch (err) {
    errorEl.textContent = "No se pudo guardar el artículo.";
    errorEl.hidden = false;
  }
});

function renderInventario() {
  renderTablaInventario("mercado", "tabla-inventario-mercado");
  renderTablaInventario("material", "tabla-inventario-material");
}

function renderTablaInventario(categoria, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  const items = inventario.filter((i) => i.categoria === categoria);
  if (items.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Sin artículos todavía.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((i) => `
    <tr>
      <td>${escapeHtml(i.nombre)}</td>
      <td>${escapeHtml(i.unidad)}</td>
      <td>${i.stock <= 0 ? `<span class="badge badge-low">0 — agotado</span>` : i.stock}</td>
      <td>${rolActual === "admin" ? `<button class="btn btn-ghost btn-small" data-eliminar-item="${i.id}">Eliminar</button>` : ""}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-eliminar-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("¿Eliminar este artículo del inventario?")) {
        await deleteDoc(doc(db, "inventario", btn.dataset.eliminarItem));
      }
    });
  });
}

function pobladorSelectItem(prefijo) {
  const categoriaSel = document.getElementById(`${prefijo}-categoria`);
  const itemSel = document.getElementById(`${prefijo}-item`);
  function poblar() {
    const cat = categoriaSel.value;
    const items = inventario.filter((i) => i.categoria === cat);
    itemSel.innerHTML = items.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)} (stock: ${i.stock} ${escapeHtml(i.unidad)})</option>`).join("")
      || `<option value="">No hay artículos en esta categoría</option>`;
    if (prefijo === "salida") actualizarInfoStockSalida();
  }
  categoriaSel.onchange = poblar;
  itemSel.onchange = prefijo === "salida" ? actualizarInfoStockSalida : null;
  poblar();
}

function actualizarInfoStockSalida() {
  const itemId = document.getElementById("salida-item").value;
  const item = inventario.find((i) => i.id === itemId);
  const info = document.getElementById("salida-stock-info");
  info.textContent = item ? `Stock disponible: ${item.stock} ${item.unidad}` : "";
}

// ============================================================
// MOVIMIENTOS: ENTRADA
// ============================================================
const formEntrada = document.getElementById("form-entrada");
formEntrada.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = formEntrada.querySelector(".form-error");
  errorEl.hidden = true;
  const itemId = document.getElementById("entrada-item").value;
  const cantidad = Number(document.getElementById("entrada-cantidad").value);
  const item = inventario.find((i) => i.id === itemId);
  if (!item || !cantidad || cantidad <= 0) {
    errorEl.textContent = "Selecciona un artículo y una cantidad válida.";
    errorEl.hidden = false;
    return;
  }
  try {
    await runTransaction(db, async (tx) => {
      const itemRef = doc(db, "inventario", itemId);
      const itemSnap = await tx.get(itemRef);
      const stockActual = itemSnap.data().stock || 0;
      tx.update(itemRef, { stock: stockActual + cantidad });
      tx.set(doc(collection(db, "movimientos")), {
        tipo: "entrada",
        categoria: item.categoria,
        itemId,
        itemNombre: item.nombre,
        cantidad,
        procedencia: document.getElementById("entrada-procedencia").value.trim() || null,
        fecha: serverTimestamp(),
        responsable: auth.currentUser.email,
      });
    });
    mostrarToast("Entrada registrada y stock actualizado.");
    formEntrada.reset();
    cerrarModal("modal-entrada");
  } catch (err) {
    errorEl.textContent = "No se pudo registrar la entrada.";
    errorEl.hidden = false;
  }
});

// ============================================================
// MOVIMIENTOS: SALIDA (entrega a un damnificado)
// ============================================================
const buscarSalidaInput = document.getElementById("salida-buscar-damnificado");
const resultadosSalida = document.getElementById("salida-damnificado-resultados");
let damnificadoElegidoSalida = null;

buscarSalidaInput.addEventListener("input", () => {
  const filtro = buscarSalidaInput.value.trim().toLowerCase();
  damnificadoElegidoSalida = null;
  document.getElementById("salida-damnificado-id").value = "";
  document.getElementById("salida-damnificado-elegido").hidden = true;
  if (!filtro) { resultadosSalida.innerHTML = ""; return; }
  const coincidencias = damnificados.filter((d) => coincideBusqueda(d, filtro)).slice(0, 6);
  resultadosSalida.innerHTML = coincidencias.map((d) =>
    `<div class="autocomplete-item" data-id="${d.id}">${escapeHtml(d.nombre)} — CC ${escapeHtml(d.cedula)}</div>`
  ).join("");
  resultadosSalida.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.addEventListener("click", () => {
      const d = damnificados.find((x) => x.id === el.dataset.id);
      damnificadoElegidoSalida = d;
      document.getElementById("salida-damnificado-id").value = d.id;
      buscarSalidaInput.value = d.nombre;
      resultadosSalida.innerHTML = "";
      const nota = document.getElementById("salida-damnificado-elegido");
      nota.textContent = `Se entregará a: ${d.nombre} (CC ${d.cedula}, RUD ${d.rud})`;
      nota.hidden = false;
    });
  });
});

const formSalida = document.getElementById("form-salida");
formSalida.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = formSalida.querySelector(".form-error");
  errorEl.hidden = true;

  const damnificadoId = document.getElementById("salida-damnificado-id").value;
  const itemId = document.getElementById("salida-item").value;
  const cantidad = Number(document.getElementById("salida-cantidad").value);
  const item = inventario.find((i) => i.id === itemId);
  const damnificado = damnificados.find((d) => d.id === damnificadoId);

  if (!damnificado) {
    errorEl.textContent = "Selecciona un damnificado de la lista de resultados.";
    errorEl.hidden = false;
    return;
  }
  if (!item || !cantidad || cantidad <= 0) {
    errorEl.textContent = "Selecciona un artículo y una cantidad válida.";
    errorEl.hidden = false;
    return;
  }

  try {
    await runTransaction(db, async (tx) => {
      const itemRef = doc(db, "inventario", itemId);
      const itemSnap = await tx.get(itemRef);
      const stockActual = itemSnap.data().stock || 0;
      if (cantidad > stockActual) {
        throw new Error("STOCK_INSUFICIENTE");
      }
      tx.update(itemRef, { stock: stockActual - cantidad });
      tx.set(doc(collection(db, "movimientos")), {
        tipo: "salida",
        categoria: item.categoria,
        itemId,
        itemNombre: item.nombre,
        cantidad,
        damnificadoId,
        damnificadoNombre: damnificado.nombre,
        damnificadoCedula: damnificado.cedula,
        fecha: serverTimestamp(),
        responsable: auth.currentUser.email,
      });
    });
    mostrarToast("Entrega registrada y stock actualizado.");
    formSalida.reset();
    resultadosSalida.innerHTML = "";
    document.getElementById("salida-damnificado-elegido").hidden = true;
    cerrarModal("modal-salida");
  } catch (err) {
    errorEl.textContent = err.message === "STOCK_INSUFICIENTE"
      ? "No hay suficiente stock para esta entrega."
      : "No se pudo registrar la entrega.";
    errorEl.hidden = false;
  }
});

// ============================================================
// TABLA DE MOVIMIENTOS
// ============================================================
function renderMovimientos() {
  const tbody = document.getElementById("tabla-movimientos");
  if (movimientos.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Todavía no hay movimientos registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = movimientos.map((m) => `
    <tr>
      <td>${formatearFecha(m.fecha)}</td>
      <td>${m.tipo === "entrada" ? "Entrada" : "Salida"}</td>
      <td>${m.categoria === "mercado" ? "Mercado" : "Material"}</td>
      <td>${escapeHtml(m.itemNombre)}</td>
      <td>${m.cantidad}</td>
      <td>${m.tipo === "salida" ? escapeHtml(`${m.damnificadoNombre} (CC ${m.damnificadoCedula})`) : "—"}</td>
      <td>${escapeHtml(m.responsable || "—")}</td>
    </tr>
  `).join("");
}

// ============================================================
// REPORTES POR PERSONA
// ============================================================
const buscarReporteInput = document.getElementById("buscar-reporte");
buscarReporteInput.addEventListener("input", renderReporteSiHayBusqueda);

function renderReporteSiHayBusqueda() {
  const filtro = buscarReporteInput.value.trim().toLowerCase();
  const contenedor = document.getElementById("reporte-resultado");
  if (!filtro) {
    contenedor.innerHTML = `<p class="empty-state">Escribe un nombre, cédula o RUD para ver su historial de entregas.</p>`;
    return;
  }
  const coincidencias = damnificados.filter((d) => coincideBusqueda(d, filtro));
  if (coincidencias.length === 0) {
    contenedor.innerHTML = `<p class="empty-state">Nadie coincide con esa búsqueda.</p>`;
    return;
  }
  contenedor.innerHTML = coincidencias.map((d) => {
    const entregasMercado = movimientos.filter((m) => m.tipo === "salida" && m.damnificadoId === d.id && m.categoria === "mercado");
    const entregasMaterial = movimientos.filter((m) => m.tipo === "salida" && m.damnificadoId === d.id && m.categoria === "material");
    const historial = [...entregasMercado, ...entregasMaterial].sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
    return `
      <div class="reporte-persona">
        <h3>${escapeHtml(d.nombre)}</h3>
        <p>CC ${escapeHtml(d.cedula)} · RUD ${escapeHtml(d.rud)}</p>
        <div class="reporte-counts">
          <div class="count-card"><div class="n">${entregasMercado.length}</div><div class="label">Entregas de mercado</div></div>
          <div class="count-card"><div class="n">${entregasMaterial.length}</div><div class="label">Entregas de materiales</div></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Artículo</th><th>Cantidad</th><th>Responsable</th></tr></thead>
            <tbody>
              ${historial.length === 0
                ? `<tr class="empty-row"><td colspan="5">Todavía no ha recibido entregas.</td></tr>`
                : historial.map((m) => `
                    <tr>
                      <td>${formatearFecha(m.fecha)}</td>
                      <td>${m.categoria === "mercado" ? "Mercado" : "Material"}</td>
                      <td>${escapeHtml(m.itemNombre)}</td>
                      <td>${m.cantidad}</td>
                      <td>${escapeHtml(m.responsable || "—")}</td>
                    </tr>
                  `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("<hr style='margin:1.5rem 0;border:none;border-top:1px solid var(--color-border)'>");
}

// ============================================================
// UTILIDADES
// ============================================================
function formatearFecha(ts) {
  if (!ts || !ts.seconds) return "Justo ahora";
  return new Date(ts.seconds * 1000).toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ============================================================
// NÚCLEO FAMILIAR (panel de consulta agrupado por formulario/RUD)
// ============================================================
const buscarNucleoInput = document.getElementById("buscar-nucleo");
buscarNucleoInput.addEventListener("input", renderNucleoPanel);

function renderNucleoPanel() {
  const contenedor = document.getElementById("nucleo-resultado");
  if (!contenedor) return; // el panel puede no existir todavía en el DOM en el primer render
  const filtro = buscarNucleoInput.value.trim().toLowerCase();
  if (!filtro) {
    contenedor.innerHTML = `<p class="empty-state">Escribe un nombre, cédula, RUD o número de formulario para ver el núcleo familiar.</p>`;
    return;
  }

  const grupos = new Map();
  familiares.forEach((f) => {
    if (f.formularioNum === null || f.formularioNum === undefined) return;
    if (!grupos.has(f.formularioNum)) grupos.set(f.formularioNum, []);
    grupos.get(f.formularioNum).push(f);
  });

  const soloDigitos = filtro.replace(/\D/g, "");

  const resultados = [...grupos.entries()].filter(([num, miembros]) => {
    const damnificado = damnificados.find((d) => numeroRud(d.rud) === num);
    if (damnificado && coincideBusqueda(damnificado, filtro)) return true;
    if (soloDigitos && String(num).includes(soloDigitos)) return true;
    return miembros.some((f) =>
      (f.nombreCompleto || "").toLowerCase().includes(filtro) ||
      (f.numeroDocumento || "").toLowerCase().includes(filtro)
    );
  });

  if (resultados.length === 0) {
    contenedor.innerHTML = `<p class="empty-state">No se encontraron coincidencias.</p>`;
    return;
  }

  contenedor.innerHTML = resultados.map(([num, miembros]) => {
    const damnificado = damnificados.find((d) => numeroRud(d.rud) === num);
    return `
      <div class="reporte-persona">
        <h3>${damnificado ? escapeHtml(damnificado.nombre) : `Formulario ${num}`}</h3>
        <p>${damnificado
          ? `CC ${escapeHtml(damnificado.cedula)} · RUD ${escapeHtml(damnificado.rud)}`
          : "Sin damnificado principal asociado en la lista de damnificados"}</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Parentesco</th><th>Nombre completo</th><th>Documento</th></tr></thead>
            <tbody>
              ${miembros.map((f) => `
                <tr>
                  <td>${escapeHtml(f.parentesco || "—")}</td>
                  <td>${escapeHtml(f.nombreCompleto)}</td>
                  <td>${escapeHtml(f.tipoDocumento || "")} ${escapeHtml(f.numeroDocumento || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("<hr style='margin:1.5rem 0;border:none;border-top:1px solid var(--color-border)'>");
}

// ============================================================
// IMPORTAR NÚCLEO FAMILIAR DESDE EXCEL
// ============================================================
const btnImportarFamiliares = document.getElementById("btn-importar-familiares");
const inputExcelFamiliares = document.getElementById("input-excel-familiares");

btnImportarFamiliares.addEventListener("click", () => inputExcelFamiliares.click());

const MAPA_COLUMNAS_FAMILIA = {
  formulario: ["numero formulario", "número formulario", "formulario", "no. formulario"],
  primerNombre: ["primer nombre"],
  segundoNombre: ["segundo nombre"],
  primerApellido: ["primer apellido"],
  segundoApellido: ["segundo apellido"],
  parentesco: ["parentesco"],
  tipoDocumento: ["tipo documento"],
  numeroDocumento: ["numero documento", "número documento"],
};

inputExcelFamiliares.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const libro = XLSX.read(buffer, { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });

    if (filas.length === 0) {
      mostrarToast("El archivo no tiene filas de datos.", true);
      return;
    }

    const registros = filas.map((fila) => {
      const formulario = String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.formulario)).trim();
      const primerNombre = String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.primerNombre)).trim();
      const segundoNombre = String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.segundoNombre)).trim();
      const primerApellido = String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.primerApellido)).trim();
      const segundoApellido = String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.segundoApellido)).trim();
      return {
        formulario,
        formularioNum: numeroRud(formulario),
        primerNombre, segundoNombre, primerApellido, segundoApellido,
        nombreCompleto: [primerNombre, segundoNombre, primerApellido, segundoApellido].filter(Boolean).join(" "),
        parentesco: String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.parentesco)).trim(),
        tipoDocumento: String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.tipoDocumento)).trim(),
        numeroDocumento: String(buscarColumna(fila, MAPA_COLUMNAS_FAMILIA.numeroDocumento)).trim(),
      };
    }).filter((r) => r.formularioNum !== null && r.nombreCompleto);

    const omitidos = filas.length - registros.length;

    if (registros.length === 0) {
      mostrarToast("Ninguna fila tiene número de formulario y nombre válidos.", true);
      return;
    }

    if (!confirm(`Se van a importar ${registros.length} integrantes de núcleo familiar${omitidos ? ` (se omiten ${omitidos} filas sin formulario o nombre)` : ""}. ¿Continuar?`)) {
      inputExcelFamiliares.value = "";
      return;
    }

    const LOTE = 400;
    for (let i = 0; i < registros.length; i += LOTE) {
      const batch = writeBatch(db);
      registros.slice(i, i + LOTE).forEach((r) => {
        const ref = doc(collection(db, "familiares"));
        batch.set(ref, { ...r, fechaImportacion: serverTimestamp(), registradoPor: auth.currentUser.email });
      });
      await batch.commit();
    }

    mostrarToast(`${registros.length} integrantes de núcleo familiar importados correctamente.`);
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.", true);
  } finally {
    inputExcelFamiliares.value = "";
  }
});

// ============================================================
// IMPORTAR DAMNIFICADOS DESDE EXCEL
// ============================================================
const btnImportar = document.getElementById("btn-importar-excel");
const inputExcel = document.getElementById("input-excel");

btnImportar.addEventListener("click", () => inputExcel.click());

// Cada dato reconoce varios posibles nombres de columna (sin importar tildes/mayúsculas).
const MAPA_COLUMNAS = {
  nombre: ["nombre y apellidos completos", "nombre completo", "nombre"],
  cedula: ["cedula ciudadania", "cedula", "cédula", "cc"],
  telefono: ["telefono", "teléfono", "celular"],
  vereda: ["vereda"],
  direccion: ["direccion", "dirección", "albergue"],
  rud: ["r.u.d", "rud"],
  categoriaRufe: ["formato de rufe", "categoria según rufe", "categoria rufe"],
  formatoIngenieros: ["formato ingenieros"],
  tipoBien: ["tipo de bien"],
  tenenciaVivienda: ["tenencia vivienda", "propia", "arrendada", "no informe", "no informa"],
  habitantes: ["habitantes"],
  adultos: ["adultos"],
  menores: ["menores"],
  edad: ["edad"],
  enfermedadesBase: ["enfermedades de base"],
  afectacionServicios: ["afectacion en servicios", "afectación en servicios"],
  viviendaAveriadaTecho: ["techo"],
  viviendaAveriadaPared: ["pared"],
  viviendaAveriadaPisos: ["pisos"],
  viviendaAveriadaOtro: ["otro"],
  formatoDesalojoFirmado: ["formato de desalojo", "firmado"],
  desalojados: ["desalojados"],
  viviendaAfectadaEstructural: ["viviendas afectadas estructuralmente", "vivienda afectada estructuralmente"],
  viviendaColapsada: ["viviendas colapsadas", "vivienda colapsada"],
  edificacionAveriada: ["edificaciones averiadas", "edificacion averiada"],
  edificacionAfectadaEstructural: ["edificaciones afectadas estructuralmente", "edificacion afectada estructuralmente"],
  edificacionColapsada: ["edificaciones colapsadas", "edificacion colapsada"],
  infraestructuraVialAfectada: ["infraestructural víal afectada", "infraestructura vial afectada"],
};

const CAMPOS_TEXTO = ["nombre", "cedula", "telefono", "vereda", "direccion", "rud", "categoriaRufe", "formatoIngenieros", "tipoBien", "tenenciaVivienda", "edad", "enfermedadesBase", "afectacionServicios", "viviendaAveriadaOtro"];
const CAMPOS_NUMERO = ["habitantes", "adultos", "menores"];
const CAMPOS_SINO = ["viviendaAveriadaTecho", "viviendaAveriadaPared", "viviendaAveriadaPisos", "formatoDesalojoFirmado", "desalojados", "viviendaAfectadaEstructural", "viviendaColapsada", "edificacionAveriada", "edificacionAfectadaEstructural", "edificacionColapsada", "infraestructuraVialAfectada"];

function buscarColumna(fila, opciones) {
  const claves = Object.keys(fila);
  for (const opcion of opciones) {
    const encontrada = claves.find((k) => k.trim().toLowerCase() === opcion);
    if (encontrada) return fila[encontrada];
  }
  return "";
}

function esAfirmativo(valor) {
  const v = String(valor ?? "").trim().toLowerCase();
  return ["si", "sí", "x", "1", "true", "verdadero"].includes(v);
}

inputExcel.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const libro = XLSX.read(buffer, { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });

    if (filas.length === 0) {
      mostrarToast("El archivo no tiene filas de datos.", true);
      return;
    }

    const registros = filas.map((fila) => {
      const registro = {};
      for (const campo of CAMPOS_TEXTO) {
        registro[campo] = String(buscarColumna(fila, MAPA_COLUMNAS[campo])).trim();
      }
      for (const campo of CAMPOS_NUMERO) {
        registro[campo] = Number(buscarColumna(fila, MAPA_COLUMNAS[campo])) || 0;
      }
      for (const campo of CAMPOS_SINO) {
        registro[campo] = esAfirmativo(buscarColumna(fila, MAPA_COLUMNAS[campo]));
      }
      registro.personas = registro.habitantes || 1;
      return registro;
    }).filter((r) => r.nombre && r.cedula);

    const omitidos = filas.length - registros.length;

    if (registros.length === 0) {
      mostrarToast("Ninguna fila tiene nombre y cédula válidos.", true);
      return;
    }

    if (!confirm(`Se van a importar ${registros.length} damnificados${omitidos ? ` (se omiten ${omitidos} filas sin nombre o cédula)` : ""}. ¿Continuar?`)) {
      inputExcel.value = "";
      return;
    }

    const LOTE = 400; // Firestore permite máximo 500 operaciones por lote
    for (let i = 0; i < registros.length; i += LOTE) {
      const batch = writeBatch(db);
      registros.slice(i, i + LOTE).forEach((r) => {
        const ref = doc(collection(db, "damnificados"));
        batch.set(ref, {
          ...r,
          fechaRegistro: serverTimestamp(),
          registradoPor: auth.currentUser.email,
        });
      });
      await batch.commit();
    }

    mostrarToast(`${registros.length} damnificados importados correctamente.`);
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.", true);
  } finally {
    inputExcel.value = "";
  }
});
