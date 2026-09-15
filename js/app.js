import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
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
let resumen = null;
let damnificadoEnEdicion = null; // referencia al damnificado que está abierto en el modal, para refrescar su núcleo familiar en vivo

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
  document.getElementById("btn-importar-resumen").hidden = !puedeEditarDamnificados;
  document.getElementById("btn-agregar-item").hidden = !puedeInventario;
  document.getElementById("btn-importar-inventario").hidden = !puedeInventario;
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
    const overlay = btn.closest(".modal-overlay");
    overlay.hidden = true;
    if (overlay.id === "modal-damnificado") damnificadoEnEdicion = null;
  });
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.hidden = true;
      if (overlay.id === "modal-damnificado") damnificadoEnEdicion = null;
    }
  });
});

function cerrarModal(id) {
  document.getElementById(id).hidden = true;
  if (id === "modal-damnificado") damnificadoEnEdicion = null;
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
    renderDashboard();
  });

  onSnapshot(collection(db, "inventario"), (snap) => {
    inventario = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderInventario();
    renderDashboard();
  });

  onSnapshot(query(collection(db, "movimientos"), orderBy("fecha", "desc")), (snap) => {
    movimientos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMovimientos();
    renderDamnificados();
    renderReporteSiHayBusqueda();
    renderDashboard();
  });

  onSnapshot(collection(db, "familiares"), (snap) => {
    familiares = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderNucleoPanel();
    if (damnificadoEnEdicion) {
      const actualizado = damnificados.find((x) => x.id === damnificadoEnEdicion.id) || damnificadoEnEdicion;
      renderNucleoFamiliarEnModal(actualizado);
    }
    renderDashboard();
  });

  onSnapshot(doc(db, "resumen", "general"), (snap) => {
    resumen = snap.exists() ? snap.data() : null;
    renderDashboard();
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${
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
      <td><span class="badge badge-count">${contarEntregas(d.id, "kit")}</span></td>
      <td>
        ${rolActual === "admin" ? `
          <button class="btn btn-ghost btn-small" data-editar-damnificado="${d.id}">Editar</button>
          <button class="btn btn-ghost btn-small" data-eliminar-damnificado="${d.id}">Eliminar</button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-editar-damnificado]").forEach((btn) => {
    btn.addEventListener("click", () => abrirEdicionDamnificado(btn.dataset.editarDamnificado));
  });

  tbody.querySelectorAll("[data-eliminar-damnificado]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const d = damnificados.find((x) => x.id === btn.dataset.eliminarDamnificado);
      if (!d) return;
      if (confirm(`¿Eliminar a ${d.nombre} (CC ${d.cedula}, RUD ${d.rud})? Esta acción no se puede deshacer. El historial de entregas que ya se le registraron se conserva, pero quedará sin damnificado asociado.`)) {
        try {
          await deleteDoc(doc(db, "damnificados", d.id));
          mostrarToast("Damnificado eliminado.");
        } catch (err) {
          mostrarToast("No se pudo eliminar. Intenta de nuevo.", true);
        }
      }
    });
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
  damnificadoEnEdicion = d;
  renderNucleoFamiliarEnModal(d);
  document.getElementById("modal-damnificado").hidden = false;
}

document.getElementById("btn-registrar-damnificado").addEventListener("click", () => {
  formDamnificado.reset();
  document.getElementById("damnificado-id").value = "";
  damnificadoEnEdicion = null;
  document.getElementById("damnificado-nucleo-familiar").innerHTML =
    `<p class="empty-state">Guarda primero el damnificado; una vez guardado, edítalo de nuevo para agregarle integrantes del núcleo familiar.</p>`;
});

function numeroRud(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos ? parseInt(digitos, 10) : null;
}

function renderNucleoFamiliarEnModal(d) {
  const cont = document.getElementById("damnificado-nucleo-familiar");
  const num = numeroRud(d.rud);
  const miembros = num === null ? [] : familiares.filter((f) => f.formularioNum === num);

  const tablaHtml = miembros.length === 0
    ? `<p class="empty-state">No hay integrantes registrados para este RUD todavía.</p>`
    : `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Parentesco</th><th>Nombre completo</th><th>Documento</th><th></th></tr></thead>
          <tbody>
            ${miembros.map((f) => `
              <tr>
                <td>${escapeHtml(f.parentesco || "—")}</td>
                <td>${escapeHtml(f.nombreCompleto)}</td>
                <td>${escapeHtml(f.tipoDocumento || "")} ${escapeHtml(f.numeroDocumento || "")}</td>
                <td>${rolActual === "admin" ? `<button type="button" class="btn btn-ghost btn-small" data-eliminar-familiar="${f.id}">Eliminar</button>` : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

  const formHtml = rolActual === "admin" ? `
    <div class="agregar-familiar">
      <label>Nombre completo <input type="text" id="familiar-nombre" /></label>
      <label>Parentesco <input type="text" id="familiar-parentesco" placeholder="Hijo(a), cónyuge…" /></label>
      <label>Tipo de documento
        <select id="familiar-tipo-doc">
          <option value="CC">CC</option>
          <option value="TI">TI</option>
          <option value="RC">RC</option>
          <option value="CE">CE</option>
          <option value="Otro">Otro</option>
        </select>
      </label>
      <label>Número de documento <input type="text" id="familiar-num-doc" /></label>
      <button type="button" class="btn btn-secondary btn-small" id="btn-agregar-familiar">Agregar integrante</button>
      <p class="form-error" id="familiar-error" hidden></p>
    </div>
  ` : "";

  cont.innerHTML = tablaHtml + formHtml;

  cont.querySelectorAll("[data-eliminar-familiar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("¿Eliminar este integrante del núcleo familiar?")) {
        try {
          await deleteDoc(doc(db, "familiares", btn.dataset.eliminarFamiliar));
        } catch (err) {
          mostrarToast("No se pudo eliminar el integrante.", true);
        }
      }
    });
  });

  const btnAgregarFamiliar = document.getElementById("btn-agregar-familiar");
  if (btnAgregarFamiliar) {
    btnAgregarFamiliar.addEventListener("click", async () => {
      const errorEl = document.getElementById("familiar-error");
      errorEl.hidden = true;
      const nombreCompleto = document.getElementById("familiar-nombre").value.trim();
      const parentesco = document.getElementById("familiar-parentesco").value.trim();
      const tipoDocumento = document.getElementById("familiar-tipo-doc").value;
      const numeroDocumento = document.getElementById("familiar-num-doc").value.trim();

      if (!nombreCompleto) {
        errorEl.textContent = "Escribe el nombre completo del integrante.";
        errorEl.hidden = false;
        return;
      }
      const numRud = numeroRud(d.rud);
      if (numRud === null) {
        errorEl.textContent = "Este damnificado no tiene un RUD válido; no se puede asociar el integrante.";
        errorEl.hidden = false;
        return;
      }
      try {
        await addDoc(collection(db, "familiares"), {
          formulario: String(numRud),
          formularioNum: numRud,
          nombreCompleto,
          parentesco,
          tipoDocumento,
          numeroDocumento,
          fechaImportacion: serverTimestamp(),
          registradoPor: auth.currentUser.email,
        });
        mostrarToast("Integrante agregado al núcleo familiar.");
      } catch (err) {
        errorEl.textContent = "No se pudo agregar. Intenta de nuevo.";
        errorEl.hidden = false;
      }
    });
  }
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
  renderTablaInventario("kit", "tabla-inventario-kit");
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
// MOVIMIENTOS: SALIDA (entrega a un damnificado o a un integrante de su núcleo familiar)
// ============================================================
const buscarSalidaInput = document.getElementById("salida-buscar-damnificado");
const resultadosSalida = document.getElementById("salida-damnificado-resultados");
let resultadosSalidaActuales = [];

// Busca coincidencias tanto en la lista de damnificados (jefes de hogar) como en el
// núcleo familiar importado — pero un integrante del núcleo familiar solo puede recibir
// si su formulario coincide con el RUD de un damnificado ya registrado.
function buscarPersonasEntregables(filtro) {
  const resultados = [];

  damnificados.forEach((d) => {
    if (coincideBusqueda(d, filtro)) {
      resultados.push({
        damnificadoId: d.id,
        damnificadoNombre: d.nombre,
        damnificadoCedula: d.cedula,
        damnificadoRud: d.rud,
        entregadoNombre: d.nombre,
        entregadoDocumento: d.cedula,
        entregadoParentesco: "Jefe de hogar",
        etiqueta: `${d.nombre} — Jefe de hogar (CC ${d.cedula}, RUD ${d.rud})`,
      });
    }
  });

  familiares.forEach((f) => {
    if (f.formularioNum === null || f.formularioNum === undefined) return;
    const damnificado = damnificados.find((d) => numeroRud(d.rud) === f.formularioNum);
    if (!damnificado) return; // debe pertenecer al núcleo familiar de un RUD ya registrado
    const coincide = (f.nombreCompleto || "").toLowerCase().includes(filtro) ||
      (f.numeroDocumento || "").toLowerCase().includes(filtro);
    if (coincide) {
      resultados.push({
        damnificadoId: damnificado.id,
        damnificadoNombre: damnificado.nombre,
        damnificadoCedula: damnificado.cedula,
        damnificadoRud: damnificado.rud,
        entregadoNombre: f.nombreCompleto,
        entregadoDocumento: f.numeroDocumento,
        entregadoParentesco: f.parentesco || "Familiar",
        etiqueta: `${f.nombreCompleto} — ${f.parentesco || "Familiar"} (Doc. ${f.tipoDocumento || ""} ${f.numeroDocumento || "sin documento"}, RUD ${damnificado.rud}, hogar de ${damnificado.nombre})`,
      });
    }
  });

  return resultados.slice(0, 8);
}

function limpiarSeleccionSalida() {
  document.getElementById("salida-damnificado-id").value = "";
  document.getElementById("salida-entregado-nombre").value = "";
  document.getElementById("salida-entregado-documento").value = "";
  document.getElementById("salida-entregado-parentesco").value = "";
  document.getElementById("salida-damnificado-elegido").hidden = true;
}

buscarSalidaInput.addEventListener("input", () => {
  const filtro = buscarSalidaInput.value.trim().toLowerCase();
  limpiarSeleccionSalida();
  if (!filtro) { resultadosSalida.innerHTML = ""; resultadosSalidaActuales = []; return; }

  resultadosSalidaActuales = buscarPersonasEntregables(filtro);
  resultadosSalida.innerHTML = resultadosSalidaActuales.map((r, idx) =>
    `<div class="autocomplete-item" data-idx="${idx}">${escapeHtml(r.etiqueta)}</div>`
  ).join("");

  resultadosSalida.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.addEventListener("click", () => {
      const r = resultadosSalidaActuales[Number(el.dataset.idx)];
      document.getElementById("salida-damnificado-id").value = r.damnificadoId;
      document.getElementById("salida-entregado-nombre").value = r.entregadoNombre;
      document.getElementById("salida-entregado-documento").value = r.entregadoDocumento;
      document.getElementById("salida-entregado-parentesco").value = r.entregadoParentesco;
      buscarSalidaInput.value = r.entregadoNombre;
      resultadosSalida.innerHTML = "";
      const nota = document.getElementById("salida-damnificado-elegido");
      nota.textContent = r.entregadoParentesco === "Jefe de hogar"
        ? `Se entregará a: ${r.entregadoNombre} (CC ${r.entregadoDocumento}) — Jefe de hogar, RUD ${r.damnificadoRud}`
        : `Se entregará a: ${r.entregadoNombre} (Doc. ${r.entregadoDocumento || "sin documento"}, ${r.entregadoParentesco}) — núcleo familiar de ${r.damnificadoNombre}, RUD ${r.damnificadoRud}`;
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
  const entregadoNombre = document.getElementById("salida-entregado-nombre").value;
  const entregadoDocumento = document.getElementById("salida-entregado-documento").value;
  const entregadoParentesco = document.getElementById("salida-entregado-parentesco").value;
  const itemId = document.getElementById("salida-item").value;
  const cantidad = Number(document.getElementById("salida-cantidad").value);
  const item = inventario.find((i) => i.id === itemId);
  const damnificado = damnificados.find((d) => d.id === damnificadoId);

  if (!damnificado || !entregadoNombre) {
    errorEl.textContent = "Selecciona una persona de la lista de resultados.";
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
        entregadoNombre,
        entregadoDocumento,
        entregadoParentesco,
        fecha: serverTimestamp(),
        responsable: auth.currentUser.email,
      });
    });
    mostrarToast("Entrega registrada y stock actualizado.");
    formSalida.reset();
    resultadosSalida.innerHTML = "";
    limpiarSeleccionSalida();
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
function formatEntregadoA(m) {
  if (!m.entregadoNombre || m.entregadoNombre === m.damnificadoNombre) {
    return `${m.damnificadoNombre} (CC ${m.damnificadoCedula})`;
  }
  return `${m.entregadoNombre} (Doc. ${m.entregadoDocumento || "sin documento"}, ${m.entregadoParentesco || "Familiar"}) — hogar de ${m.damnificadoNombre}`;
}

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
      <td>${etiquetaCategoria(m.categoria)}</td>
      <td>${escapeHtml(m.itemNombre)}</td>
      <td>${m.cantidad}</td>
      <td>${m.tipo === "salida" ? escapeHtml(formatEntregadoA(m)) : "—"}</td>
      <td>${escapeHtml(m.responsable || "—")}</td>
    </tr>
  `).join("");
}

// ============================================================
// REPORTES POR PERSONA
// ============================================================
const buscarReporteInput = document.getElementById("buscar-reporte");
buscarReporteInput.addEventListener("input", renderReporteSiHayBusqueda);

function formatRecibio(m, damnificadoPrincipal) {
  const nombre = m.entregadoNombre || damnificadoPrincipal.nombre;
  const partes = [];
  if (m.entregadoDocumento) partes.push(`Doc. ${m.entregadoDocumento}`);
  if (m.entregadoParentesco && m.entregadoParentesco !== "Jefe de hogar") partes.push(m.entregadoParentesco);
  return partes.length ? `${nombre} (${partes.join(", ")})` : nombre;
}

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
    const entregasKit = movimientos.filter((m) => m.tipo === "salida" && m.damnificadoId === d.id && m.categoria === "kit");
    const historial = [...entregasMercado, ...entregasMaterial, ...entregasKit].sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
    return `
      <div class="reporte-persona">
        <h3>${escapeHtml(d.nombre)}</h3>
        <p>CC ${escapeHtml(d.cedula)} · RUD ${escapeHtml(d.rud)}</p>
        <div class="reporte-counts">
          <div class="count-card"><div class="n">${entregasMercado.length}</div><div class="label">Entregas de mercado</div></div>
          <div class="count-card"><div class="n">${entregasMaterial.length}</div><div class="label">Entregas de materiales</div></div>
          <div class="count-card"><div class="n">${entregasKit.length}</div><div class="label">Entregas de kits de aseo</div></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Artículo</th><th>Cantidad</th><th>Recibió</th><th>Responsable</th></tr></thead>
            <tbody>
              ${historial.length === 0
                ? `<tr class="empty-row"><td colspan="6">Todavía no ha recibido entregas.</td></tr>`
                : historial.map((m) => `
                    <tr>
                      <td>${formatearFecha(m.fecha)}</td>
                      <td>${etiquetaCategoria(m.categoria)}</td>
                      <td>${escapeHtml(m.itemNombre)}</td>
                      <td>${m.cantidad}</td>
                      <td>${escapeHtml(formatRecibio(m, d))}</td>
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

function etiquetaCategoria(cat) {
  return { mercado: "Mercado", material: "Material", kit: "Kit de aseo" }[cat] || cat;
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
              ${miembros.map((f) => {
                const coincideMiembro = (f.nombreCompleto || "").toLowerCase().includes(filtro) ||
                  (f.numeroDocumento || "").toLowerCase().includes(filtro);
                return `
                <tr class="${coincideMiembro ? "fila-coincidente" : ""}">
                  <td>${escapeHtml(f.parentesco || "—")}</td>
                  <td>${escapeHtml(f.nombreCompleto)}</td>
                  <td>${escapeHtml(f.tipoDocumento || "")} ${escapeHtml(f.numeroDocumento || "")}</td>
                </tr>
              `;
              }).join("")}
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

    if (!confirm(`Se van a importar ${registros.length} integrantes de núcleo familiar${omitidos ? ` (se omiten ${omitidos} filas sin formulario o nombre)` : ""}.\n\nEsto REEMPLAZARÁ por completo el núcleo familiar que tengas guardado actualmente (se borra todo lo anterior antes de subir lo nuevo). ¿Continuar?`)) {
      inputExcelFamiliares.value = "";
      return;
    }

    const LOTE = 400;

    // Borra todo el núcleo familiar existente antes de subir el nuevo, para que
    // volver a importar el mismo Excel (o una versión corregida) nunca duplique datos.
    const existentesSnap = await getDocs(collection(db, "familiares"));
    const idsExistentes = existentesSnap.docs.map((d) => d.id);
    for (let i = 0; i < idsExistentes.length; i += LOTE) {
      const batchBorrado = writeBatch(db);
      idsExistentes.slice(i, i + LOTE).forEach((id) => batchBorrado.delete(doc(db, "familiares", id)));
      await batchBorrado.commit();
    }

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
// IMPORTAR INVENTARIO DESDE EXCEL (Categoría, Descripción/Elemento, Cantidad, Unidad/Detalle)
// ============================================================
const btnImportarInventario = document.getElementById("btn-importar-inventario");
const inputExcelInventario = document.getElementById("input-excel-inventario");

btnImportarInventario.addEventListener("click", () => inputExcelInventario.click());

const MAPA_COLUMNAS_INVENTARIO = {
  categoria: ["categoria"],
  nombre: ["descripcion / elemento", "descripcion/elemento", "descripcion", "elemento", "articulo"],
  cantidad: ["cantidad"],
  unidad: ["unidad / detalle", "unidad/detalle", "unidad", "detalle"],
};

function inferirCategoriaInventario(valor) {
  const t = normalizarTexto(valor);
  if (t.includes("mercado") || t.includes("alimento") || t.includes("comida")) return "mercado";
  if (t.includes("aseo") || t.includes("higiene") || t.includes("kit")) return "kit";
  return "material";
}

inputExcelInventario.addEventListener("change", async (e) => {
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
      const categoriaTexto = String(buscarColumna(fila, MAPA_COLUMNAS_INVENTARIO.categoria)).trim();
      return {
        categoria: inferirCategoriaInventario(categoriaTexto),
        categoriaOriginal: categoriaTexto,
        nombre: String(buscarColumna(fila, MAPA_COLUMNAS_INVENTARIO.nombre)).trim(),
        stock: Number(buscarColumna(fila, MAPA_COLUMNAS_INVENTARIO.cantidad)) || 0,
        unidad: String(buscarColumna(fila, MAPA_COLUMNAS_INVENTARIO.unidad)).trim(),
      };
    }).filter((r) => r.nombre);

    const omitidos = filas.length - registros.length;

    if (registros.length === 0) {
      mostrarToast("Ninguna fila tiene un nombre de artículo válido.", true);
      return;
    }

    const resumenPorCategoria = registros.reduce((acc, r) => {
      acc[r.categoria] = (acc[r.categoria] || 0) + 1;
      return acc;
    }, {});
    const resumenTexto = Object.entries(resumenPorCategoria)
      .map(([cat, n]) => `${etiquetaCategoria(cat)}: ${n}`)
      .join(", ");

    if (!confirm(`Se van a importar ${registros.length} artículos${omitidos ? ` (se omiten ${omitidos} filas sin nombre)` : ""}.\n\n${resumenTexto}\n\nSi un artículo ya existe (mismo nombre y categoría), se actualiza su cantidad en vez de duplicarse. ¿Continuar?`)) {
      inputExcelInventario.value = "";
      return;
    }

    let creados = 0;
    let actualizados = 0;

    for (const r of registros) {
      const existente = inventario.find(
        (i) => i.categoria === r.categoria && normalizarTexto(i.nombre) === normalizarTexto(r.nombre)
      );
      if (existente) {
        await updateDoc(doc(db, "inventario", existente.id), {
          stock: r.stock,
          unidad: r.unidad || existente.unidad,
        });
        actualizados++;
      } else {
        await addDoc(collection(db, "inventario"), {
          categoria: r.categoria,
          nombre: r.nombre,
          unidad: r.unidad,
          stock: r.stock,
        });
        creados++;
      }
    }

    mostrarToast(`Inventario importado: ${creados} artículos nuevos, ${actualizados} actualizados.`);
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.", true);
  } finally {
    inputExcelInventario.value = "";
  }
});

// ============================================================
// DASHBOARD
// ============================================================
let chartViviendas = null;
let chartEntregas = null;
let chartInventario = null;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function renderDashboard() {
  const cont = document.getElementById("resumen-familias");
  if (!cont) return; // el panel puede no existir todavía en el DOM en el primer render

  // ---------- Tarjetas del resumen importado ----------
  document.getElementById("resumen-familias").textContent = resumen ? num(resumen.familias).toLocaleString("es-CO") : "—";
  document.getElementById("resumen-personas").textContent = resumen ? num(resumen.personas).toLocaleString("es-CO") : "—";
  document.getElementById("resumen-habitables").textContent = resumen ? num(resumen.viviendasHabitables).toLocaleString("es-CO") : "—";
  document.getElementById("resumen-no-habitables").textContent = resumen ? num(resumen.viviendasNoHabitables).toLocaleString("es-CO") : "—";
  document.getElementById("resumen-destruidas").textContent = resumen ? num(resumen.viviendasDestruidas).toLocaleString("es-CO") : "—";
  document.getElementById("resumen-averiadas").textContent = resumen ? num(resumen.viviendasAveriadas).toLocaleString("es-CO") : "—";

  const metaEl = document.getElementById("resumen-meta");
  metaEl.textContent = resumen && resumen.actualizadoEn
    ? `Última actualización: ${formatearFecha(resumen.actualizadoEn)} · por ${resumen.actualizadoPor || "—"}`
    : "Todavía no se ha importado un resumen general.";

  // ---------- Cálculos a partir del registro ----------
  const totalDamnificados = damnificados.length;
  const totalHabitantes = damnificados.reduce((acc, d) => acc + num(d.habitantes), 0);
  const totalColapsadas = damnificados.filter((d) => d.viviendaColapsada).length;
  const totalAveriadas = damnificados.filter((d) => d.viviendaAveriadaTecho || d.viviendaAveriadaPared || d.viviendaAveriadaPisos).length;
  const totalFamiliares = familiares.length;
  const entregasMercado = movimientos.filter((m) => m.tipo === "salida" && m.categoria === "mercado").length;
  const entregasMaterial = movimientos.filter((m) => m.tipo === "salida" && m.categoria === "material").length;
  const entregasKit = movimientos.filter((m) => m.tipo === "salida" && m.categoria === "kit").length;
  const agotados = inventario.filter((i) => (i.stock || 0) <= 0).length;

  document.getElementById("op-damnificados").textContent = totalDamnificados.toLocaleString("es-CO");
  document.getElementById("op-habitantes").textContent = totalHabitantes.toLocaleString("es-CO");
  document.getElementById("op-familiares").textContent = totalFamiliares.toLocaleString("es-CO");
  document.getElementById("op-entregas-mercado").textContent = entregasMercado.toLocaleString("es-CO");
  document.getElementById("op-entregas-material").textContent = entregasMaterial.toLocaleString("es-CO");
  document.getElementById("op-entregas-kit").textContent = entregasKit.toLocaleString("es-CO");
  document.getElementById("op-agotados").textContent = agotados.toLocaleString("es-CO");

  // ---------- Tabla de concordancia ----------
  const filasConcordancia = [
    { etiqueta: "Familias", importado: resumen ? num(resumen.familias) : null, calculado: totalDamnificados },
    { etiqueta: "Personas", importado: resumen ? num(resumen.personas) : null, calculado: totalHabitantes },
    { etiqueta: "Viviendas destruidas", importado: resumen ? num(resumen.viviendasDestruidas) : null, calculado: totalColapsadas },
    { etiqueta: "Viviendas averiadas", importado: resumen ? num(resumen.viviendasAveriadas) : null, calculado: totalAveriadas },
  ];
  document.getElementById("tabla-concordancia").innerHTML = filasConcordancia.map((f) => {
    if (f.importado === null) {
      return `<tr><td>${escapeHtml(f.etiqueta)}</td><td>—</td><td>${f.calculado.toLocaleString("es-CO")}</td><td>—</td></tr>`;
    }
    const diferencia = f.importado - f.calculado;
    const claseDif = diferencia === 0 ? "diff-ok" : "diff-warn";
    const textoDif = diferencia === 0 ? "Coincide" : (diferencia > 0 ? `+${diferencia}` : String(diferencia));
    return `
      <tr>
        <td>${escapeHtml(f.etiqueta)}</td>
        <td>${f.importado.toLocaleString("es-CO")}</td>
        <td>${f.calculado.toLocaleString("es-CO")}</td>
        <td class="${claseDif}">${textoDif}</td>
      </tr>
    `;
  }).join("");

  // ---------- Gráficos ----------
  if (typeof Chart === "undefined") return; // por si el CDN todavía no cargó

  const dataViviendas = resumen
    ? [num(resumen.viviendasHabitables), num(resumen.viviendasNoHabitables), num(resumen.viviendasDestruidas), num(resumen.viviendasAveriadas)]
    : [0, 0, 0, 0];
  if (chartViviendas) chartViviendas.destroy();
  chartViviendas = new Chart(document.getElementById("chart-viviendas"), {
    type: "bar",
    data: {
      labels: ["Habitables", "No habitables", "Destruidas", "Averiadas"],
      datasets: [{ data: dataViviendas, backgroundColor: ["#1F4B4A", "#D98E3B", "#B23A34", "#5B6664"] }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  if (chartEntregas) chartEntregas.destroy();
  chartEntregas = new Chart(document.getElementById("chart-entregas"), {
    type: "doughnut",
    data: {
      labels: ["Mercado", "Material", "Kit de aseo"],
      datasets: [{ data: [entregasMercado, entregasMaterial, entregasKit], backgroundColor: ["#1F4B4A", "#D98E3B", "#5B6664"] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  const stockMercado = inventario.filter((i) => i.categoria === "mercado").reduce((acc, i) => acc + num(i.stock), 0);
  const stockMaterial = inventario.filter((i) => i.categoria === "material").reduce((acc, i) => acc + num(i.stock), 0);
  const stockKit = inventario.filter((i) => i.categoria === "kit").reduce((acc, i) => acc + num(i.stock), 0);
  if (chartInventario) chartInventario.destroy();
  chartInventario = new Chart(document.getElementById("chart-inventario"), {
    type: "bar",
    data: {
      labels: ["Mercado", "Material", "Kit de aseo"],
      datasets: [{ data: [stockMercado, stockMaterial, stockKit], backgroundColor: ["#1F4B4A", "#D98E3B", "#5B6664"] }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

// ============================================================
// IMPORTAR RESUMEN GENERAL DESDE EXCEL
// ============================================================
const btnImportarResumen = document.getElementById("btn-importar-resumen");
const inputExcelResumen = document.getElementById("input-excel-resumen");

btnImportarResumen.addEventListener("click", () => inputExcelResumen.click());

const MAPA_COLUMNAS_RESUMEN = {
  familias: ["familias"],
  personas: ["personas"],
  viviendasHabitables: ["viviendas habitables"],
  viviendasNoHabitables: ["viviendas no habitables"],
  viviendasDestruidas: ["viviendas destruidas"],
  viviendasAveriadas: ["viviendas averiadas"],
};

inputExcelResumen.addEventListener("change", async (e) => {
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

    // Si hay varias filas (por ejemplo una por vereda), se suman todas para el total general.
    const totales = { familias: 0, personas: 0, viviendasHabitables: 0, viviendasNoHabitables: 0, viviendasDestruidas: 0, viviendasAveriadas: 0 };
    filas.forEach((fila) => {
      for (const campo of Object.keys(MAPA_COLUMNAS_RESUMEN)) {
        totales[campo] += Number(buscarColumna(fila, MAPA_COLUMNAS_RESUMEN[campo])) || 0;
      }
    });

    if (!confirm(`Se va a reemplazar el resumen general con:\n\nFamilias: ${totales.familias}\nPersonas: ${totales.personas}\nViviendas habitables: ${totales.viviendasHabitables}\nViviendas no habitables: ${totales.viviendasNoHabitables}\nViviendas destruidas: ${totales.viviendasDestruidas}\nViviendas averiadas: ${totales.viviendasAveriadas}\n\n¿Continuar?`)) {
      inputExcelResumen.value = "";
      return;
    }

    await setDoc(doc(db, "resumen", "general"), {
      ...totales,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: auth.currentUser.email,
    });

    mostrarToast("Resumen general actualizado.");
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.", true);
  } finally {
    inputExcelResumen.value = "";
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

function normalizarTexto(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos, sin importar cómo estén codificados
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

function buscarColumna(fila, opciones) {
  const claves = Object.keys(fila);
  const opcionesNormalizadas = opciones.map(normalizarTexto);
  for (let i = 0; i < opcionesNormalizadas.length; i++) {
    const encontrada = claves.find((k) => normalizarTexto(k) === opcionesNormalizadas[i]);
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

// ============================================================
// INFORMES (EXPORTAR EXCEL Y PDF)
// ============================================================
const btnExportarExcel = document.getElementById("btn-exportar-excel");
const btnExportarPdf = document.getElementById("btn-exportar-pdf");
const informeEstado = document.getElementById("informe-estado");

function nombreArchivoConFecha(base, ext) {
  const fecha = new Date().toISOString().slice(0, 10);
  return `${base}-${fecha}.${ext}`;
}

function filasIndicadores() {
  const filas = [
    ["Damnificados registrados", damnificados.length],
    ["Habitantes (suma registrada)", damnificados.reduce((acc, d) => acc + (Number(d.habitantes) || 0), 0)],
    ["Integrantes de núcleo familiar", familiares.length],
    ["Entregas de mercado", movimientos.filter((m) => m.tipo === "salida" && m.categoria === "mercado").length],
    ["Entregas de materiales", movimientos.filter((m) => m.tipo === "salida" && m.categoria === "material").length],
    ["Entregas de kits de aseo", movimientos.filter((m) => m.tipo === "salida" && m.categoria === "kit").length],
    ["Artículos agotados", inventario.filter((i) => (i.stock || 0) <= 0).length],
  ];
  if (resumen) {
    filas.push(
      ["Familias (resumen importado)", resumen.familias || 0],
      ["Personas (resumen importado)", resumen.personas || 0],
      ["Viviendas habitables (resumen importado)", resumen.viviendasHabitables || 0],
      ["Viviendas no habitables (resumen importado)", resumen.viviendasNoHabitables || 0],
      ["Viviendas destruidas (resumen importado)", resumen.viviendasDestruidas || 0],
      ["Viviendas averiadas (resumen importado)", resumen.viviendasAveriadas || 0]
    );
  }
  return filas;
}

btnExportarExcel.addEventListener("click", () => {
  informeEstado.textContent = "Generando Excel…";
  try {
    const libro = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      libro,
      XLSX.utils.aoa_to_sheet([["Indicador", "Valor"], ...filasIndicadores()]),
      "Resumen"
    );

    const filasDamnificados = damnificados.map((d) => ({
      Nombre: d.nombre || "", Cedula: d.cedula || "", RUD: d.rud || "", Telefono: d.telefono || "",
      Vereda: d.vereda || "", Direccion: d.direccion || "", "Categoria RUFE": d.categoriaRufe || "",
      "Formato Ingenieros": d.formatoIngenieros || "", "Tipo de Bien": d.tipoBien || "",
      "Tenencia Vivienda": d.tenenciaVivienda || "", Habitantes: d.habitantes || 0, Adultos: d.adultos || 0,
      Menores: d.menores || 0, Edad: d.edad || "", "Enfermedades de Base": d.enfermedadesBase || "",
      "Afectacion en Servicios": d.afectacionServicios || "",
      "Vivienda Averiada Techo": d.viviendaAveriadaTecho ? "Si" : "No",
      "Vivienda Averiada Pared": d.viviendaAveriadaPared ? "Si" : "No",
      "Vivienda Averiada Pisos": d.viviendaAveriadaPisos ? "Si" : "No",
      "Vivienda Afectada Estructuralmente": d.viviendaAfectadaEstructural ? "Si" : "No",
      "Vivienda Colapsada": d.viviendaColapsada ? "Si" : "No",
      "Formato Desalojo Firmado": d.formatoDesalojoFirmado ? "Si" : "No",
      Desalojados: d.desalojados ? "Si" : "No",
      "Edificacion Averiada": d.edificacionAveriada ? "Si" : "No",
      "Edificacion Afectada Estructuralmente": d.edificacionAfectadaEstructural ? "Si" : "No",
      "Edificacion Colapsada": d.edificacionColapsada ? "Si" : "No",
      "Infraestructura Vial Afectada": d.infraestructuraVialAfectada ? "Si" : "No",
      "Mercados Entregados": contarEntregas(d.id, "mercado"),
      "Materiales Entregados": contarEntregas(d.id, "material"),
      "Kits de Aseo Entregados": contarEntregas(d.id, "kit"),
    }));
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasDamnificados), "Damnificados");

    const filasInventario = inventario.map((i) => ({
      Categoria: etiquetaCategoria(i.categoria), Articulo: i.nombre || "", Unidad: i.unidad || "", Stock: i.stock || 0,
    }));
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasInventario), "Inventario");

    const filasMovimientos = movimientos.map((m) => {
      const hogar = damnificados.find((d) => d.id === m.damnificadoId);
      return {
        Fecha: m.fecha && m.fecha.seconds ? formatearFecha(m.fecha) : "",
        Tipo: m.tipo === "entrada" ? "Entrada" : "Salida",
        Categoria: etiquetaCategoria(m.categoria),
        Articulo: m.itemNombre || "", Cantidad: m.cantidad || 0,
        "Entregado a": m.tipo === "salida" ? (m.entregadoNombre || m.damnificadoNombre || "") : "",
        Parentesco: m.tipo === "salida" ? (m.entregadoParentesco || "") : "",
        "RUD del hogar": hogar ? hogar.rud : "",
        Responsable: m.responsable || "",
      };
    });
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasMovimientos), "Movimientos");

    const filasFamiliares = familiares.map((f) => ({
      Formulario: f.formulario || "", "Nombre completo": f.nombreCompleto || "", Parentesco: f.parentesco || "",
      "Tipo Documento": f.tipoDocumento || "", "Numero Documento": f.numeroDocumento || "",
    }));
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasFamiliares), "Nucleo familiar");

    XLSX.writeFile(libro, nombreArchivoConFecha("informe-sismo-10-agosto", "xlsx"));
    informeEstado.textContent = "Excel descargado.";
  } catch (err) {
    console.error(err);
    informeEstado.textContent = "No se pudo generar el Excel.";
  }
});

btnExportarPdf.addEventListener("click", () => {
  informeEstado.textContent = "Generando PDF…";
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt" });
    const colorEncabezado = [31, 75, 74];
    let y = 40;

    pdf.setFontSize(16);
    pdf.text("Informe de Respuesta a Emergencia — Sismo 10 de agosto", 40, y);
    y += 18;
    pdf.setFontSize(9);
    pdf.text(`Generado: ${new Date().toLocaleString("es-CO")} · por ${auth.currentUser?.email || "—"}`, 40, y);
    y += 20;

    pdf.autoTable({
      startY: y,
      head: [["Indicador", "Valor"]],
      body: filasIndicadores().map(([a, b]) => [a, String(b)]),
      theme: "grid", styles: { fontSize: 9 }, headStyles: { fillColor: colorEncabezado },
    });
    y = pdf.lastAutoTable.finalY + 22;

    pdf.setFontSize(13);
    pdf.text("Damnificados", 40, y);
    pdf.autoTable({
      startY: y + 6,
      head: [["Nombre", "Cédula", "RUD", "Vereda", "Teléfono", "Habitantes", "Vivienda colapsada", "Mercados", "Materiales", "Kits"]],
      body: damnificados.map((d) => [
        d.nombre || "", d.cedula || "", d.rud || "", d.vereda || "", d.telefono || "",
        d.habitantes || 0, d.viviendaColapsada ? "Sí" : "No",
        contarEntregas(d.id, "mercado"), contarEntregas(d.id, "material"), contarEntregas(d.id, "kit"),
      ]),
      theme: "grid", styles: { fontSize: 8 }, headStyles: { fillColor: colorEncabezado },
    });
    y = pdf.lastAutoTable.finalY + 22;

    pdf.setFontSize(13);
    pdf.text("Inventario", 40, y);
    pdf.autoTable({
      startY: y + 6,
      head: [["Categoría", "Artículo", "Unidad", "Stock"]],
      body: inventario.map((i) => [etiquetaCategoria(i.categoria), i.nombre || "", i.unidad || "", i.stock || 0]),
      theme: "grid", styles: { fontSize: 9 }, headStyles: { fillColor: colorEncabezado },
    });
    y = pdf.lastAutoTable.finalY + 22;

    pdf.setFontSize(13);
    pdf.text("Entradas y salidas", 40, y);
    pdf.autoTable({
      startY: y + 6,
      head: [["Fecha", "Tipo", "Categoría", "Artículo", "Cantidad", "Entregado a", "Responsable"]],
      body: movimientos.map((m) => [
        formatearFecha(m.fecha), m.tipo === "entrada" ? "Entrada" : "Salida", etiquetaCategoria(m.categoria),
        m.itemNombre || "", m.cantidad || 0, m.tipo === "salida" ? formatEntregadoA(m) : "—", m.responsable || "",
      ]),
      theme: "grid", styles: { fontSize: 8 }, headStyles: { fillColor: colorEncabezado },
    });
    y = pdf.lastAutoTable.finalY + 22;

    pdf.setFontSize(13);
    pdf.text("Núcleo familiar", 40, y);
    pdf.autoTable({
      startY: y + 6,
      head: [["Formulario", "Nombre completo", "Parentesco", "Documento"]],
      body: familiares.map((f) => [
        f.formulario || "", f.nombreCompleto || "", f.parentesco || "",
        `${f.tipoDocumento || ""} ${f.numeroDocumento || ""}`.trim(),
      ]),
      theme: "grid", styles: { fontSize: 8 }, headStyles: { fillColor: colorEncabezado },
    });

    pdf.save(nombreArchivoConFecha("informe-sismo-10-agosto", "pdf"));
    informeEstado.textContent = "PDF descargado.";
  } catch (err) {
    console.error(err);
    informeEstado.textContent = "No se pudo generar el PDF.";
  }
});
