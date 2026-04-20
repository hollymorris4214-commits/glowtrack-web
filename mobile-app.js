const STORAGE_KEY = "glowtrack-web-data-v2";
const APP_VERSION = "1.3.0";
const MAX_IMPORT_BYTES = 1024 * 1024;
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

const DEFAULT_DATA = {
  inventory: [],
  routines: [],
  journal: [],
  progress: {}
};

let state = loadState();
let scannerState = {
  mode: "lookup",
  stream: null,
  intervalId: null,
  detector: null,
  reader: null,
  readerControls: null,
  targetInput: null
};

const statsGrid = document.getElementById("stats-grid");
const expiringList = document.getElementById("expiring-list");
const todayRoutine = document.getElementById("today-routine");
const todayLabel = document.getElementById("today-label");
const inventoryList = document.getElementById("inventory-list");
const inventorySearch = document.getElementById("inventory-search");
const inventoryFilter = document.getElementById("inventory-filter");
const barcodeLookup = document.getElementById("barcode-lookup");
const barcodeFeedback = document.getElementById("barcode-feedback");
const scanInButton = document.getElementById("scan-in-button");
const scanOutButton = document.getElementById("scan-out-button");
const cameraScanButton = document.getElementById("camera-scan-button");
const routineList = document.getElementById("routine-list");
const journalList = document.getElementById("journal-list");
const patternList = document.getElementById("pattern-list");
const modalRoot = document.getElementById("modal-root");
const scannerDialog = document.getElementById("scanner-dialog");
const scannerTitle = document.getElementById("scanner-title");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const scannerManualInput = document.getElementById("scanner-manual-input");
const scannerApplyButton = document.getElementById("scanner-apply-button");
const scannerCloseButton = document.getElementById("scanner-close-button");

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

document.querySelectorAll("[data-open-modal]").forEach((button) => {
  button.addEventListener("click", () => openModal(button.dataset.openModal));
});

document.getElementById("export-data").addEventListener("click", exportData);
document.getElementById("import-data").addEventListener("change", importData);
document.getElementById("seed-demo").addEventListener("click", seedDemoData);
document.getElementById("reset-data").addEventListener("click", resetData);
inventorySearch.addEventListener("input", render);
inventoryFilter.addEventListener("change", render);
scanInButton.addEventListener("click", () => barcodeLookup.value.trim() ? processBarcode(barcodeLookup.value, "in") : openScannerDialog("in"));
scanOutButton.addEventListener("click", () => barcodeLookup.value.trim() ? processBarcode(barcodeLookup.value, "out") : openScannerDialog("out"));
cameraScanButton.addEventListener("click", () => openScannerDialog("lookup"));
scannerApplyButton.addEventListener("click", () => handleScannerManualApply());
scannerDialog.addEventListener("close", closeScannerDialog);
scannerCloseButton.addEventListener("click", closeScannerDialog);
document.addEventListener("click", handleActionClick);
document.addEventListener("change", handleActionChange);

registerServiceWorker();
localStorage.removeItem("glowtrack-web-security-v1");
render();

function loadState() {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    const legacyRaw = localStorage.getItem("glowtrack-web-data-v1");
    const parsed = JSON.parse(currentRaw || legacyRaw || "null");
    if (!parsed) return structuredClone(DEFAULT_DATA);
    return normaliseState(parsed);
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

function normaliseState(parsed) {
  return {
    inventory: Array.isArray(parsed.inventory) ? parsed.inventory.map(normaliseInventoryItem) : [],
    routines: Array.isArray(parsed.routines) ? parsed.routines.map(normaliseRoutine) : [],
    journal: Array.isArray(parsed.journal) ? parsed.journal : [],
    progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {}
  };
}

function normaliseInventoryItem(item) {
  const quantity = normaliseQuantity(item.quantity);
  return {
    id: item.id || crypto.randomUUID(),
    brand: String(item.brand || "").trim(),
    name: String(item.name || "").trim(),
    category: String(item.category || "").trim(),
    status: quantity === 0 ? "depleted" : String(item.status || "active"),
    size: String(item.size || "").trim(),
    expiryDate: String(item.expiryDate || ""),
    notes: String(item.notes || "").trim(),
    barcode: normaliseBarcode(item.barcode || ""),
    quantity
  };
}

function normaliseRoutine(routine) {
  const steps = Array.isArray(routine.steps)
    ? routine.steps.map((step) => typeof step === "string" ? { id: crypto.randomUUID(), label: step } : {
      id: step.id || crypto.randomUUID(),
      label: String(step.label || "").trim()
    }).filter((step) => step.label)
    : [];

  return {
    id: routine.id || crypto.randomUUID(),
    name: String(routine.name || "").trim(),
    timeOfDay: String(routine.timeOfDay || "morning"),
    days: Array.isArray(routine.days) ? routine.days : [],
    active: routine.active !== false,
    steps
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  persist();
  renderStats();
  renderDashboard();
  renderInventory();
  renderRoutines();
  renderJournal();
}

function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${tab}`);
  });
}

async function handleActionClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;

  const { action, id, collection, type } = actionEl.dataset;
  if (action === "open-modal") return openModal(type, id || null);
  if (action === "close-modal") return closeModal();
  if (action === "delete-item") return removeItem(collection, id);
  if (action === "toggle-routine") return toggleRoutine(id);
  if (action === "clear-routine-progress") return clearRoutineProgress(id);
  if (action === "scan-into-field") return openScannerDialog("field", actionEl.dataset.targetInput || "");
}

function handleActionChange(event) {
  const toggle = event.target.closest("[data-step-toggle='true']");
  if (!toggle) return;
  toggleRoutineStep(toggle.dataset.routineId, Number(toggle.dataset.stepIndex));
}

async function openScannerDialog(mode, targetInput = "") {
  scannerState.mode = mode;
  scannerState.targetInput = targetInput;
  scannerTitle.textContent = mode === "in" ? "Scan product in" : mode === "out" ? "Scan product out" : "Scan barcode";
  scannerStatus.textContent = "Point your camera at a barcode, or type it manually below.";
  scannerManualInput.value = barcodeLookup.value.trim();

  if (typeof scannerDialog.showModal === "function") {
    scannerDialog.showModal();
  } else {
    scannerDialog.setAttribute("open", "open");
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    scannerStatus.textContent = "Live camera scanning needs HTTPS and camera access. You can still type the barcode manually.";
    return;
  }

  try {
    if ("BarcodeDetector" in window) {
      await startNativeBarcodeScanner();
      return;
    }

    if (window.ZXing?.BrowserMultiFormatReader) {
      await startZxingScanner();
      return;
    }

    scannerStatus.textContent = "This browser can open the camera, but barcode scanning is not available here yet. You can still type the barcode manually.";
  } catch (error) {
    scannerStatus.textContent = "Camera access was unavailable. You can still enter the barcode manually.";
  }
}

async function startNativeBarcodeScanner() {
  scannerState.detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
  scannerState.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  });
  scannerVideo.srcObject = scannerState.stream;
  await scannerVideo.play();
  scannerState.intervalId = window.setInterval(scanCurrentFrame, 700);
  scannerStatus.textContent = "Scanning...";
}

async function startZxingScanner() {
  scannerState.reader = new window.ZXing.BrowserMultiFormatReader();
  scannerState.readerControls = await scannerState.reader.decodeFromConstraints(
    {
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    },
    scannerVideo,
    (result, error, controls) => {
      if (controls) scannerState.readerControls = controls;
      if (result?.text) {
        const rawValue = normaliseBarcode(result.text);
        if (!rawValue) return;
        applyScannedBarcode(rawValue);
        closeScannerDialog();
        return;
      }
      if (error?.name && error.name !== "NotFoundException") {
        scannerStatus.textContent = "Camera is open, but the barcode has not locked in yet. Try moving slightly closer.";
      }
    }
  );
  scannerStatus.textContent = "Scanning with Safari-compatible mode...";
}

async function scanCurrentFrame() {
  if (!scannerState.detector || scannerVideo.readyState < 2) return;
  try {
    const barcodes = await scannerState.detector.detect(scannerVideo);
    if (!barcodes.length) return;
    const rawValue = normaliseBarcode(barcodes[0].rawValue || "");
    if (!rawValue) return;
    applyScannedBarcode(rawValue);
    closeScannerDialog();
  } catch {
    scannerStatus.textContent = "Trying to detect a barcode...";
  }
}

function handleScannerManualApply() {
  const value = normaliseBarcode(scannerManualInput.value);
  if (!value) {
    scannerStatus.textContent = "Enter a barcode first.";
    return;
  }
  applyScannedBarcode(value);
  closeScannerDialog();
}

function applyScannedBarcode(value) {
  if (scannerState.mode === "field" && scannerState.targetInput) {
    const target = document.querySelector(scannerState.targetInput);
    if (target) target.value = value;
    return;
  }
  barcodeLookup.value = value;
  processBarcode(value, scannerState.mode === "lookup" ? "lookup" : scannerState.mode);
}

function closeScannerDialog() {
  if (scannerState.intervalId) {
    window.clearInterval(scannerState.intervalId);
    scannerState.intervalId = null;
  }
  if (scannerState.readerControls?.stop) {
    try {
      scannerState.readerControls.stop();
    } catch {}
    scannerState.readerControls = null;
  }
  if (scannerState.reader?.reset) {
    try {
      scannerState.reader.reset();
    } catch {}
    scannerState.reader = null;
  }
  scannerState.detector = null;
  if (scannerState.stream) {
    scannerState.stream.getTracks().forEach((track) => track.stop());
    scannerState.stream = null;
  }
  scannerVideo.srcObject = null;
  if (scannerDialog.hasAttribute("open")) {
    try {
      scannerDialog.close();
    } catch {}
    scannerDialog.removeAttribute("open");
  }
}

function renderStats() {
  const todaysRoutines = getTodaysRoutines();
  const completedToday = todaysRoutines.reduce((sum, routine) => sum + getRoutineProgress(routine.id).filter(Boolean).length, 0);
  const totalTodaySteps = todaysRoutines.reduce((sum, routine) => sum + routine.steps.length, 0);
  const avgHydration = average(state.journal.map((entry) => Number(entry.hydration || 0)));

  const cards = [
    { label: "Active products", value: state.inventory.filter((item) => item.status === "active").length, note: `${state.inventory.length} total` },
    { label: "Routines today", value: todaysRoutines.length, note: dayName(new Date()) },
    { label: "Steps ticked today", value: totalTodaySteps ? `${completedToday}/${totalTodaySteps}` : "-", note: "Live checklist progress" },
    { label: "Avg hydration", value: avgHydration ? `${avgHydration.toFixed(1)}/5` : "-", note: "Based on journal entries" }
  ];

  statsGrid.innerHTML = cards.map((card) => `
    <article class="stat-card">
      <div class="muted">${card.label}</div>
      <div class="value">${card.value}</div>
      <div class="muted">${card.note}</div>
    </article>
  `).join("");
}

function renderDashboard() {
  const expiring = [...state.inventory]
    .filter((item) => item.expiryDate)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
    .filter((item) => daysUntil(item.expiryDate) <= 30);

  expiringList.innerHTML = expiring.length
    ? expiring.map((item) => `
      <article class="mini-card">
        <strong>${escapeHtml(item.brand)} ${escapeHtml(item.name)}</strong>
        <div class="muted">${escapeHtml(item.category || "Uncategorised")}</div>
        <div class="meta">
          <span>Expires in ${Math.max(daysUntil(item.expiryDate), 0)} days</span>
          <span>${formatDate(item.expiryDate)}</span>
        </div>
      </article>
    `).join("")
    : emptyState("No products expiring in the next 30 days.");

  const todaysRoutines = getTodaysRoutines();
  todayLabel.textContent = dayName(new Date());
  todayRoutine.innerHTML = todaysRoutines.length
    ? todaysRoutines.map(renderRoutineChecklistCard).join("")
    : emptyState("No routine is scheduled for today yet.");
}

function renderInventory() {
  const query = inventorySearch.value.trim().toLowerCase();
  const filter = inventoryFilter.value;
  const filtered = state.inventory.filter((item) => {
    const haystack = `${item.brand} ${item.name} ${item.category} ${item.barcode}`.toLowerCase();
    return (!query || haystack.includes(query)) && (filter === "all" || item.status === filter);
  });

  inventoryList.innerHTML = filtered.length
    ? filtered.map((item) => `
      <article class="product-card">
        <div class="section-heading">
          <div>
            <div class="badge status-${escapeHtml(item.status)}">${escapeHtml(capitalise(item.status))}</div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="muted">${escapeHtml(item.brand)}</p>
          </div>
        </div>
        <div class="meta">
          <span>${escapeHtml(item.category || "Uncategorised")}</span>
          ${item.barcode ? `<span>Code ${escapeHtml(item.barcode)}</span>` : ""}
          <span class="status-pill stock-pill">${item.quantity} in stock</span>
          ${item.size ? `<span>${escapeHtml(item.size)}</span>` : ""}
          ${item.expiryDate ? `<span>Expiry ${formatDate(item.expiryDate)}</span>` : ""}
        </div>
        ${item.notes ? `<div>${escapeHtml(item.notes)}</div>` : ""}
        <div class="list-item-actions">
          <button class="secondary-button" data-action="open-modal" data-type="inventory" data-id="${item.id}">Edit</button>
          <button class="ghost-button" data-action="delete-item" data-collection="inventory" data-id="${item.id}">Delete</button>
        </div>
      </article>
    `).join("")
    : emptyState("No products match your current search.");
}

function renderRoutines() {
  routineList.innerHTML = state.routines.length
    ? state.routines.map((routine) => {
      const progress = getRoutineProgress(routine.id);
      const completed = progress.filter(Boolean).length;
      const isToday = routine.active && routine.days.includes(dayName(new Date()));

      return `
        <article class="routine-card">
          <div class="section-heading">
            <div>
              <div class="badge status-${routine.active ? "active" : "paused"}">${routine.active ? "Active" : "Paused"}</div>
              <h3>${escapeHtml(routine.name)}</h3>
              <p class="muted">${escapeHtml(capitalise(routine.timeOfDay))} routine</p>
            </div>
            ${isToday ? `<div class="progress-copy">${completed}/${routine.steps.length} done today</div>` : ""}
          </div>
          <div class="pill-row">
            ${routine.days.map((day) => `<span class="status-pill">${escapeHtml(day)}</span>`).join("")}
          </div>
          ${routine.steps.length ? `
            <div class="checklist">
              ${routine.steps.map((step, index) => renderStepRow(routine.id, step, index, isToday)).join("")}
            </div>
          ` : `<div class="empty-state">No steps yet. Add one step per line and each will become a checkbox.</div>`}
          <div class="list-item-actions">
            <button class="secondary-button" data-action="open-modal" data-type="routine" data-id="${routine.id}">Edit</button>
            <button class="ghost-button" data-action="toggle-routine" data-id="${routine.id}">${routine.active ? "Pause" : "Resume"}</button>
            ${isToday ? `<button class="ghost-button" data-action="clear-routine-progress" data-id="${routine.id}">Reset today</button>` : ""}
            <button class="ghost-button" data-action="delete-item" data-collection="routines" data-id="${routine.id}">Delete</button>
          </div>
        </article>
      `;
    }).join("")
    : emptyState("No routines yet. Add a simple morning or evening flow to get started.");
}

function renderJournal() {
  const sorted = [...state.journal].sort((a, b) => new Date(b.date) - new Date(a.date));
  journalList.innerHTML = sorted.length
    ? sorted.map((entry) => `
      <article class="entry-card">
        <div class="section-heading">
          <div>
            <h3>${formatDate(entry.date)}</h3>
            <p class="muted">${escapeHtml(entry.skinCondition || "No skin condition tagged")}</p>
          </div>
          <div class="badge">${escapeHtml(entry.mood)}/5 mood</div>
        </div>
        <div class="meta">
          <span>Hydration ${escapeHtml(entry.hydration)}/5</span>
          <span>Sleep ${escapeHtml(entry.sleepHours)}h</span>
        </div>
        ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ""}
        <div class="list-item-actions">
          <button class="secondary-button" data-action="open-modal" data-type="journal" data-id="${entry.id}">Edit</button>
          <button class="ghost-button" data-action="delete-item" data-collection="journal" data-id="${entry.id}">Delete</button>
        </div>
      </article>
    `).join("")
    : emptyState("No journal entries yet. Log today to start spotting patterns.");

  const breakoutCount = state.journal.filter((entry) => (entry.skinCondition || "").toLowerCase().includes("break")).length;
  const avgMood = average(state.journal.map((entry) => Number(entry.mood || 0)));
  const avgSleep = average(state.journal.map((entry) => Number(entry.sleepHours || 0)));
  const mostUsedCondition = topValue(state.journal.map((entry) => entry.skinCondition).filter(Boolean));

  const patterns = [
    { title: "Average mood", text: avgMood ? `${avgMood.toFixed(1)}/5 across your entries.` : "No mood data yet." },
    { title: "Average sleep", text: avgSleep ? `${avgSleep.toFixed(1)} hours logged.` : "No sleep data yet." },
    { title: "Breakout entries", text: `${breakoutCount} entry${breakoutCount === 1 ? "" : "ies"} mention a breakout.` },
    { title: "Most common skin state", text: mostUsedCondition || "No condition has been tagged yet." }
  ];

  patternList.innerHTML = patterns.map((item) => `
    <article class="mini-card">
      <strong>${item.title}</strong>
      <div class="muted">${escapeHtml(item.text)}</div>
    </article>
  `).join("");
}

function renderRoutineChecklistCard(routine) {
  const progress = getRoutineProgress(routine.id);
  const completed = progress.filter(Boolean).length;

  return `
    <article class="mini-card today-routine-card">
      <div class="section-heading">
        <div>
          <strong>${escapeHtml(routine.name)}</strong>
          <div class="muted">${escapeHtml(capitalise(routine.timeOfDay))} routine</div>
        </div>
        <div class="progress-copy">${completed}/${routine.steps.length} done</div>
      </div>
      <div class="checklist">
        ${routine.steps.map((step, index) => renderStepRow(routine.id, step, index, true)).join("")}
      </div>
      <div class="list-item-actions">
        <button class="ghost-button" data-action="clear-routine-progress" data-id="${routine.id}">Reset today</button>
      </div>
    </article>
  `;
}

function renderStepRow(routineId, step, index, enabled) {
  const progress = getRoutineProgress(routineId);
  const checked = Boolean(progress[index]);
  return `
    <label class="step-check ${checked ? "is-complete" : ""} ${enabled ? "" : "is-disabled"}">
      <input type="checkbox" data-step-toggle="true" data-routine-id="${routineId}" data-step-index="${index}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}>
      <span class="step-copy">
        <span class="step-label">${escapeHtml(step.label)}</span>
      </span>
    </label>
  `;
}

function openModal(type, id = null) {
  const collection = type === "routine" ? "routines" : type;
  const editing = id ? getById(collection, id) : null;
  const template = document.getElementById("modal-template");
  const fragment = template.content.cloneNode(true);
  const backdrop = fragment.querySelector(".modal-backdrop");
  const title = fragment.querySelector(".modal-title");
  const body = fragment.querySelector(".modal-body");

  title.textContent = editing ? `Edit ${type}` : `Add ${type}`;
  body.innerHTML = getModalMarkup(type, editing);
  modalRoot.innerHTML = "";
  modalRoot.appendChild(fragment);

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });

  modalRoot.querySelector(".modal-close").textContent = "x";
  modalRoot.querySelector(".modal-close").addEventListener("click", closeModal);
  modalRoot.querySelector("form").addEventListener("submit", (event) => handleSubmit(event, type, id));
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function getModalMarkup(type, item) {
  if (type === "inventory") {
    return `
      <form>
        <div class="field-grid">
          <div class="field"><label>Brand</label><input class="text-input" name="brand" required value="${escapeAttribute(item?.brand || "")}"></div>
          <div class="field"><label>Product name</label><input class="text-input" name="name" required value="${escapeAttribute(item?.name || "")}"></div>
          <div class="field"><label>Category</label><input class="text-input" name="category" placeholder="Cleanser, Serum..." value="${escapeAttribute(item?.category || "")}"></div>
          <div class="field"><label>Status</label><select class="text-input" name="status">${["active", "unopened", "paused", "depleted"].map((status) => `<option value="${status}" ${item?.status === status ? "selected" : ""}>${capitalise(status)}</option>`).join("")}</select></div>
          <div class="field"><label>Barcode</label><div class="inline-field"><input class="text-input" name="barcode" inputmode="numeric" autocomplete="off" placeholder="EAN / UPC" value="${escapeAttribute(item?.barcode || "")}"><button type="button" class="ghost-button" data-action="scan-into-field" data-target-input="#modal-root input[name='barcode']">Scan</button></div></div>
          <div class="field"><label>Quantity</label><input class="text-input" name="quantity" type="number" min="0" step="1" value="${escapeAttribute(item?.quantity ?? 1)}"></div>
          <div class="field"><label>Size</label><input class="text-input" name="size" placeholder="50ml" value="${escapeAttribute(item?.size || "")}"></div>
          <div class="field"><label>Expiry date</label><input class="text-input" type="date" name="expiryDate" value="${escapeAttribute(item?.expiryDate || "")}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes" placeholder="How it feels, what it's for, or anything else useful.">${escapeHtml(item?.notes || "")}</textarea></div>
        <div class="modal-actions"><button type="button" class="ghost-button" data-action="close-modal">Cancel</button><button type="submit" class="primary-button">${item ? "Save changes" : "Add product"}</button></div>
      </form>
    `;
  }

  if (type === "routine") {
    const activeDays = item?.days || [];
    const stepLines = (item?.steps || []).map((step) => step.label).join("\n");
    return `
      <form>
        <div class="field-grid">
          <div class="field"><label>Routine name</label><input class="text-input" name="name" required value="${escapeAttribute(item?.name || "")}"></div>
          <div class="field"><label>Time of day</label><select class="text-input" name="timeOfDay">${["morning", "evening", "midday"].map((slot) => `<option value="${slot}" ${item?.timeOfDay === slot ? "selected" : ""}>${capitalise(slot)}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Days</label><div class="field-grid">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => `<label class="check-row"><input type="checkbox" name="days" value="${day}" ${activeDays.includes(day) ? "checked" : ""}><span>${day}</span></label>`).join("")}</div></div>
        <div class="field"><label>Steps</label><textarea name="steps" placeholder="One step per line">${escapeHtml(stepLines)}</textarea><div class="helper">Each line becomes a tick box on your phone.</div></div>
        <label class="check-row"><input type="checkbox" name="active" ${item?.active !== false ? "checked" : ""}><span>Routine is active</span></label>
        <div class="modal-actions"><button type="button" class="ghost-button" data-action="close-modal">Cancel</button><button type="submit" class="primary-button">${item ? "Save changes" : "Add routine"}</button></div>
      </form>
    `;
  }

  return `
    <form>
      <div class="field-grid">
        <div class="field"><label>Date</label><input class="text-input" type="date" name="date" value="${escapeAttribute(item?.date || todayIso())}"></div>
        <div class="field"><label>Skin condition</label><select class="text-input" name="skinCondition">${["", "Clear", "Dry", "Sensitive", "Breakout", "Mild Breakout", "Oily", "Textured", "Irritated"].map((value) => `<option value="${value}" ${item?.skinCondition === value ? "selected" : ""}>${value || "None"}</option>`).join("")}</select></div>
        <div class="field"><label>Mood (1-5)</label><input class="text-input" type="number" min="1" max="5" name="mood" value="${escapeAttribute(item?.mood || 3)}"></div>
        <div class="field"><label>Hydration (1-5)</label><input class="text-input" type="number" min="1" max="5" name="hydration" value="${escapeAttribute(item?.hydration || 3)}"></div>
        <div class="field"><label>Sleep hours</label><input class="text-input" type="number" min="0" max="24" step="0.5" name="sleepHours" value="${escapeAttribute(item?.sleepHours || 7)}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Anything you want to remember about today.">${escapeHtml(item?.notes || "")}</textarea></div>
      <div class="modal-actions"><button type="button" class="ghost-button" data-action="close-modal">Cancel</button><button type="submit" class="primary-button">${item ? "Save changes" : "Add entry"}</button></div>
    </form>
  `;
}

function handleSubmit(event, type, id) {
  event.preventDefault();
  const formData = new FormData(event.target);

  if (type === "inventory") {
    const quantity = normaliseQuantity(formData.get("quantity"));
    const barcode = normaliseBarcode(formData.get("barcode") || "");
    const duplicate = state.inventory.find((item) => item.barcode && item.barcode === barcode && item.id !== id);
    if (barcode && duplicate) {
      alert(`That barcode is already assigned to ${duplicate.brand} ${duplicate.name}.`);
      return;
    }
    upsertItem("inventory", {
      id: id || crypto.randomUUID(),
      brand: String(formData.get("brand") || "").trim(),
      name: String(formData.get("name") || "").trim(),
      category: String(formData.get("category") || "").trim(),
      status: quantity === 0 ? "depleted" : String(formData.get("status") || "active"),
      barcode,
      quantity,
      size: String(formData.get("size") || "").trim(),
      expiryDate: String(formData.get("expiryDate") || ""),
      notes: String(formData.get("notes") || "").trim()
    });
  } else if (type === "routine") {
    const existing = state.routines.find((routine) => routine.id === id);
    const steps = String(formData.get("steps") || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label, index) => ({ id: existing?.steps[index]?.id || crypto.randomUUID(), label }));

    upsertItem("routines", {
      id: id || crypto.randomUUID(),
      name: String(formData.get("name") || "").trim(),
      timeOfDay: String(formData.get("timeOfDay") || "morning"),
      days: formData.getAll("days").map(String),
      active: formData.get("active") === "on",
      steps
    });

    if (id) trimRoutineProgress(id, steps.length);
  } else {
    upsertItem("journal", {
      id: id || crypto.randomUUID(),
      date: String(formData.get("date") || todayIso()),
      skinCondition: String(formData.get("skinCondition") || "").trim(),
      mood: clampScore(formData.get("mood")),
      hydration: clampScore(formData.get("hydration")),
      sleepHours: String(formData.get("sleepHours") || "0"),
      notes: String(formData.get("notes") || "").trim()
    });
  }

  closeModal();
  render();
}

function upsertItem(collection, item) {
  const index = state[collection].findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    state[collection][index] = item;
  } else {
    state[collection].push(item);
  }
}

function processBarcode(rawCode, mode) {
  const barcode = normaliseBarcode(rawCode);
  if (!barcode) {
    setBarcodeFeedback("Enter or scan a barcode first.", true);
    return;
  }

  const product = state.inventory.find((item) => item.barcode === barcode);
  if (!product) {
    barcodeLookup.value = barcode;
    setBarcodeFeedback("No matching product found. Add it as a new product and save this barcode.", true);
    openModal("inventory");
    const barcodeField = modalRoot.querySelector('input[name="barcode"]');
    if (barcodeField) barcodeField.value = barcode;
    return;
  }

  if (mode === "in") {
    product.quantity += 1;
    product.status = "active";
    setBarcodeFeedback(`Added one ${product.brand} ${product.name}. Stock is now ${product.quantity}.`);
  } else if (mode === "out") {
    product.quantity = Math.max(0, product.quantity - 1);
    product.status = product.quantity === 0 ? "depleted" : "active";
    setBarcodeFeedback(product.quantity === 0
      ? `${product.brand} ${product.name} is now depleted.`
      : `Removed one ${product.brand} ${product.name}. Stock is now ${product.quantity}.`);
  } else {
    setBarcodeFeedback(`Matched ${product.brand} ${product.name}. Use Scan in or Scan out to update stock.`);
  }

  render();
}

function setBarcodeFeedback(message, isError = false) {
  barcodeFeedback.textContent = message;
  barcodeFeedback.classList.toggle("danger-text", isError);
}

function removeItem(collection, id) {
  if (!confirm("Delete this item?")) return;
  state[collection] = state[collection].filter((item) => item.id !== id);
  if (collection === "routines") {
    Object.keys(state.progress).forEach((dateKey) => {
      delete state.progress[dateKey][id];
      if (!Object.keys(state.progress[dateKey]).length) delete state.progress[dateKey];
    });
  }
  render();
}

function toggleRoutine(id) {
  const routine = state.routines.find((item) => item.id === id);
  if (!routine) return;
  routine.active = !routine.active;
  render();
}

function toggleRoutineStep(routineId, stepIndex) {
  const progress = ensureRoutineProgress(routineId);
  progress[stepIndex] = !progress[stepIndex];
  render();
}

function clearRoutineProgress(routineId) {
  const dateKey = todayIso();
  if (!state.progress[dateKey]) return;
  delete state.progress[dateKey][routineId];
  if (!Object.keys(state.progress[dateKey]).length) delete state.progress[dateKey];
  render();
}

function getById(collection, id) {
  return state[collection].find((item) => item.id === id) || null;
}

function getTodaysRoutines() {
  const today = dayName(new Date());
  return state.routines.filter((routine) => routine.active && routine.days.includes(today));
}

function ensureRoutineProgress(routineId) {
  const dateKey = todayIso();
  if (!state.progress[dateKey]) state.progress[dateKey] = {};
  const routine = state.routines.find((entry) => entry.id === routineId);
  const length = routine?.steps.length || 0;
  const existing = Array.isArray(state.progress[dateKey][routineId]) ? state.progress[dateKey][routineId] : [];
  state.progress[dateKey][routineId] = Array.from({ length }, (_, index) => Boolean(existing[index]));
  return state.progress[dateKey][routineId];
}

function getRoutineProgress(routineId) {
  const dateKey = todayIso();
  const routine = state.routines.find((entry) => entry.id === routineId);
  const length = routine?.steps.length || 0;
  const existing = state.progress[dateKey]?.[routineId];
  return Array.from({ length }, (_, index) => Boolean(existing?.[index]));
}

function trimRoutineProgress(routineId, stepCount) {
  Object.keys(state.progress).forEach((dateKey) => {
    const existing = state.progress[dateKey]?.[routineId];
    if (Array.isArray(existing)) state.progress[dateKey][routineId] = existing.slice(0, stepCount);
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `glowtrack-backup-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    alert("That backup file is too large.");
    event.target.value = "";
    return;
  }

  file.text().then((text) => {
    state = validateImportedState(JSON.parse(text));
    render();
    event.target.value = "";
  }).catch(() => {
    alert("That file could not be imported.");
  });
}

function resetData() {
  if (!confirm("This will erase all GlowTrack web data stored in this browser. Continue?")) return;
  state = structuredClone(DEFAULT_DATA);
  render();
}

function validateImportedState(parsed) {
  const candidate = normaliseState(parsed);
  if (!candidate.inventory.every(isValidInventoryItem)) throw new Error("Invalid inventory data");
  if (!candidate.routines.every(isValidRoutine)) throw new Error("Invalid routine data");
  if (!candidate.journal.every(isValidJournalEntry)) throw new Error("Invalid journal data");
  if (typeof candidate.progress !== "object" || Array.isArray(candidate.progress)) throw new Error("Invalid progress data");
  return candidate;
}

function isValidInventoryItem(item) {
  return item &&
    typeof item.id === "string" &&
    typeof item.brand === "string" &&
    typeof item.name === "string" &&
    typeof item.status === "string" &&
    typeof item.barcode === "string" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 0;
}

function isValidRoutine(item) {
  return item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.days) && Array.isArray(item.steps) && item.steps.every((step) => step && typeof step.id === "string" && typeof step.label === "string");
}

function isValidJournalEntry(item) {
  return item && typeof item.id === "string" && typeof item.date === "string" && typeof item.notes === "string";
}

function seedDemoData() {
  state = {
    inventory: [
      { id: crypto.randomUUID(), brand: "CeraVe", name: "Hydrating Cleanser", category: "Cleanser", status: "active", barcode: "3337875597197", quantity: 1, size: "236ml", expiryDate: "", notes: "Gentle evening cleanser." },
      { id: crypto.randomUUID(), brand: "La Roche-Posay", name: "Anthelios SPF 50+", category: "SPF", status: "active", barcode: "3337875797597", quantity: 2, size: "50ml", expiryDate: addDays(18), notes: "Daily sunscreen for mornings." },
      { id: crypto.randomUUID(), brand: "The Ordinary", name: "Niacinamide 10% + Zinc", category: "Serum", status: "unopened", barcode: "769915190397", quantity: 1, size: "30ml", expiryDate: addDays(75), notes: "Waiting to patch test." }
    ],
    routines: [
      {
        id: crypto.randomUUID(),
        name: "Weekday Morning",
        timeOfDay: "morning",
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        active: true,
        steps: [
          { id: crypto.randomUUID(), label: "Cleanser - CeraVe Hydrating Cleanser" },
          { id: crypto.randomUUID(), label: "Serum - Niacinamide" },
          { id: crypto.randomUUID(), label: "SPF - Anthelios SPF 50+" }
        ]
      },
      {
        id: crypto.randomUUID(),
        name: "Simple Evening Reset",
        timeOfDay: "evening",
        days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        active: true,
        steps: [
          { id: crypto.randomUUID(), label: "Cleanser" },
          { id: crypto.randomUUID(), label: "Treatment" },
          { id: crypto.randomUUID(), label: "Moisturiser" }
        ]
      }
    ],
    journal: [
      { id: crypto.randomUUID(), date: todayIso(), skinCondition: "Clear", mood: 4, hydration: 4, sleepHours: "7.5", notes: "Skin felt calm today. No irritation." }
    ],
    progress: {}
  };
  render();
  switchTab("dashboard");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : 0;
}

function normaliseBarcode(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[^0-9A-Za-z\-]/g, "").trim();
}

function normaliseQuantity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.round(parsed));
}

function topValue(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  let winner = "";
  let highest = 0;
  counts.forEach((count, value) => {
    if (count > highest) {
      winner = value;
      highest = count;
    }
  });
  return winner;
}

function clampScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(1, Math.min(5, score)) : 3;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(value) {
  return Math.ceil((new Date(value) - new Date()) / 86400000);
}

function dayName(date) {
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function capitalise(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

window.openModal = openModal;
window.closeModal = closeModal;
window.removeItem = removeItem;
window.toggleRoutine = toggleRoutine;
window.toggleRoutineStep = toggleRoutineStep;
window.clearRoutineProgress = clearRoutineProgress;
