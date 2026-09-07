import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, runTransaction, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- Estado local (se llena con los listeners en tiempo real) ----------
let damnificados = [];
let inventario = [];
let movimientos = [];

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

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.hidden = true;
    appShell.hidden = false;
    document.getElementById("session-email").textContent = user.email;
    iniciarListeners();
  } else {
    loginScreen.hidden = false;
    appShell.hidden = true;
  }
});

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
    direccion: document.getElementById("damnificado-direccion").value.trim(),
    personas: Number(document.getElementById("damnificado-personas").value) || 1,
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
      <td><button class="btn btn-ghost btn-small" data-editar-damnificado="${d.id}">Editar</button></td>
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
  document.getElementById("damnificado-direccion").value = d.direccion || "";
  document.getElementById("damnificado-personas").value = d.personas || 1;
  document.getElementById("modal-damnificado").hidden = false;
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
      <td><button class="btn btn-ghost btn-small" data-eliminar-item="${i.id}">Eliminar</button></td>
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
