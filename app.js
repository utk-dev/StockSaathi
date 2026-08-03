/* Pharma Stock Sense — static, in-browser inventory agent */

const LEAD_TIME_WEEKS = 1;
const SAFETY_BUFFER = 5;
const EXPIRY_WARNING_DAYS = 60;

let inventory = buildSampleInventory();
let activeView = "Shop 1";
let pendingStockId = null;
let pendingSellId = null;
let pendingTransfer = null;

const statusMeta = {
  sufficient: {
    label: "🟢 Sufficient",
    shortLabel: "Sufficient",
  },
  reorder_soon: {
    label: "🟡 Reorder soon",
    shortLabel: "Reorder soon",
  },
  reorder_now: {
    label: "🚨 Urgent Reorder",
    shortLabel: "Urgent Reorder",
  },
  transfer_available: {
    label: "🔵 Transfer available",
    shortLabel: "Transfer available",
  },
};

const el = {
  tabs: [...document.querySelectorAll(".view-tab")],
  summary: document.querySelector("#summary-cards"),
  context: document.querySelector("#table-context"),
  table: document.querySelector("#inventory-table-wrap"),
  expiryCount: document.querySelector("#expiry-count"),
  expiryList: document.querySelector("#expiry-alerts"),
  upload: document.querySelector("#csv-upload"),
  sample: document.querySelector("#load-sample"),
  export: document.querySelector("#export-inventory"),
  stockDialog: document.querySelector("#stock-dialog"),
  stockForm: document.querySelector("#stock-form"),
  stockTitle: document.querySelector("#stock-dialog-title"),
  stockCopy: document.querySelector("#stock-dialog-copy"),
  stockQuantity: document.querySelector("#stock-quantity"),
  transferDialog: document.querySelector("#transfer-dialog"),
  transferForm: document.querySelector("#transfer-form"),
  transferTitle: document.querySelector("#transfer-dialog-title"),
  transferCopy: document.querySelector("#transfer-dialog-copy"),
  transferQuantity: document.querySelector("#transfer-quantity"),
  transferLimit: document.querySelector("#transfer-limit"),
  toastRegion: document.querySelector("#toast-region"),
  sellDialog: document.querySelector("#sell-dialog"),
  sellForm: document.querySelector("#sell-form"),
  sellTitle: document.querySelector("#sell-dialog-title"),
  sellCopy: document.querySelector("#sell-dialog-copy"),
  sellQuantity: document.querySelector("#sell-quantity"),
  sellLimit: document.querySelector("#sell-limit"),
};

function buildSampleInventory() {
  const today = new Date();
  const daysAgo = (days) => toISO(addDays(today, -days));
  const daysAhead = (days) => toISO(addDays(today, days));
  const record = (name, potency, mrp, shop, stock, sales, lastOrderDaysAgo, batches) => ({
    id: `${slugify(name)}-${slugify(potency)}-${shop.replace(" ", "-").toLowerCase()}`,
    name,
    potency,
    mrp_per_piece: mrp,
    shop_id: shop,
    current_stock: stock,
    sales_history: sales.map((quantity_sold, index) => ({ week_label: `Week ${index + 1}`, quantity_sold })),
    batch_expiry: batches.map(([batch_id, quantity, daysUntilExpiry]) => ({ batch_id, quantity, expiry_date: daysAhead(daysUntilExpiry) })),
    last_order_date: daysAgo(lastOrderDaysAgo),
  });

  return [
    // Clear transfer scenario: Shop 1 needs stock, Shop 2 has a deep surplus.
    record("Paracetamol", "500mg", 1.5, "Shop 1", 8, [15, 14, 16, 15], 28, [["PCM-500-A1", 8, 290]]),
    record("Paracetamol", "500mg", 1.5, "Shop 2", 62, [10, 11, 12, 11], 24, [["PCM-500-B1", 62, 310]]),
    // Clear no-transfer reorder scenario: both shops are below their reorder points.
    record("Amoxicillin", "500mg", 6.5, "Shop 1", 6, [12, 11, 13, 12], 39, [["AMX-500-A1", 6, 130]]),
    record("Amoxicillin", "500mg", 6.5, "Shop 2", 8, [11, 12, 11, 13], 35, [["AMX-500-B1", 8, 125]]),
    // Recent order blocks a duplicate-order alert.
    record("Metformin", "1000mg", 4, "Shop 1", 10, [12, 11, 13, 12], 2, [["MET-1000-A2", 10, 285]]),
    record("Metformin", "1000mg", 4, "Shop 2", 19, [10, 9, 11, 10], 22, [["MET-1000-B1", 19, 310]]),
    // Near-expiry batch.
    record("Cough Syrup", "100ml", 45, "Shop 1", 11, [4, 3, 4, 3], 18, [["CS-100-A1", 11, 170]]),
    record("Cough Syrup", "100ml", 45, "Shop 2", 22, [4, 5, 4, 4], 20, [["CS-100-B3", 14, 19], ["CS-100-B4", 8, 320]]),
    record("Cetirizine", "10mg", 1.2, "Shop 1", 55, [8, 9, 7, 8], 25, [["CET-10-A1", 55, 310]]),
    record("Cetirizine", "10mg", 1.2, "Shop 2", 17, [8, 8, 9, 7], 20, [["CET-10-B1", 17, 295]]),
    record("ORS", "21g", 12, "Shop 1", 40, [15, 14, 16, 15], 30, [["ORS-21-A1", 40, 260]]),
    record("ORS", "21g", 12, "Shop 2", 13, [14, 15, 13, 14], 34, [["ORS-21-B1", 13, 230]]),
  ];
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (year && month && day) return new Date(year, month - 1, day);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysFromToday(dateString) {
  const date = parseDate(dateString);
  if (!date) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}

function formatDate(dateString) {
  const date = parseDate(dateString);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function formatVelocity(value) {
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function getVelocity(item) {
  const history = item.sales_history || [];
  if (!history.length) return 0;
  return history.reduce((sum, week) => sum + Number(week.quantity_sold || 0), 0) / history.length;
}

function getReorderPoint(item) {
  return getVelocity(item) * LEAD_TIME_WEEKS + SAFETY_BUFFER;
}

function getCounterpart(item) {
  return inventory.find((candidate) => candidate.shop_id !== item.shop_id && candidate.name.toLowerCase() === item.name.toLowerCase() && candidate.potency.toLowerCase() === item.potency.toLowerCase());
}

function getAnalysis(item) {
  const velocity = getVelocity(item);
  const reorderPoint = getReorderPoint(item);
  const counterpart = getCounterpart(item);
  const counterpartPoint = counterpart ? getReorderPoint(counterpart) : 0;
  const counterpartSurplus = counterpart ? Math.max(0, counterpart.current_stock - counterpartPoint) : 0;
  const orderAgeDays = daysFromToday(item.last_order_date);
  const recentOrder = orderAgeDays <= 0 && orderAgeDays >= -(LEAD_TIME_WEEKS * 7);
  const stock = Number(item.current_stock);
  const intro = `Selling ~${formatVelocity(velocity)}/week at ${item.shop_id}. Stock: ${stock}.`;

  if (stock <= reorderPoint && counterpart) {
    return {
      status: "transfer_available",
      velocity,
      reorderPoint,
      counterpart,
      counterpartSurplus,
      reasoning: `${intro} ${counterpart.shop_id} has ${Math.floor(counterpartSurplus)} units above its reorder point — transfer recommended instead of a new order.`,
    };
  }

  if (stock <= reorderPoint && recentOrder) {
    return {
      status: "reorder_soon",
      velocity,
      reorderPoint,
      counterpart,
      counterpartSurplus,
      reasoning: `${intro} Already ordered on ${formatDate(item.last_order_date)}, likely still pending — avoid a duplicate order.`,
    };
  }

  if (stock > reorderPoint * 1.5) {
    return {
      status: "sufficient",
      velocity,
      reorderPoint,
      counterpart,
      counterpartSurplus,
      reasoning: `${intro} Healthy coverage; reorder point is ${Math.ceil(reorderPoint)} units.`,
    };
  }

  if (stock > reorderPoint) {
    return {
      status: "reorder_soon",
      velocity,
      reorderPoint,
      counterpart,
      counterpartSurplus,
      reasoning: `${intro} Only ${Math.ceil(stock - reorderPoint)} units above the ${Math.ceil(reorderPoint)}-unit reorder point — plan a refill soon.`,
    };
  }

  return {
    status: "reorder_now",
    velocity,
    reorderPoint,
    counterpart,
    counterpartSurplus,
    reasoning: `${intro} At or below the ${Math.ceil(reorderPoint)}-unit reorder point. No surplus is available at the other shop.`,
  };
}

function visibleItems() {
  return activeView === "Both" ? inventory : inventory.filter((item) => item.shop_id === activeView);
}

function statusBadge(status) {
  return `<span class="status-badge ${status}">${statusMeta[status].label}</span>`;
}

function render() {
  renderSummary();
  renderTable();
  renderExpiryAlerts();
}

function renderSummary() {
  const items = visibleItems();
  const analyses = items.map((item) => getAnalysis(item));
  const expiryCount = getExpiryAlerts(items).length;
  const transferCount = analyses.filter((analysis) => analysis.status === "transfer_available").length;
  const reorderCount = analyses.filter((analysis) => analysis.status === "reorder_now").length;
  const totalUnits = items.reduce((sum, item) => sum + Number(item.current_stock), 0);
  const noun = activeView === "Both" ? "across two shops" : `at ${activeView}`;

  el.summary.innerHTML = [
    ["total", "Units on hand", totalUnits.toLocaleString("en-IN"), noun],
    ["transfer", "Transfer opportunities", transferCount, transferCount === 1 ? "move stock, not money" : "available cross-shop moves"],
    ["reorder", "Need urgent reorder", reorderCount, reorderCount === 1 ? "item needs action now" : "items need action now"],
    ["expiry", "Expiry risk", expiryCount, expiryCount === 1 ? "batch expires within 60 days" : "batches expire within 60 days"],
  ].map(([className, label, value, foot]) => `
    <article class="summary-card ${className}">
      <div class="summary-label">${label}</div>
      <div class="summary-value">${value}</div>
      <div class="summary-foot">${foot}</div>
    </article>`).join("");
}

function renderTable() {
  if (activeView === "Both") {
    renderComparisonTable();
    return;
  }

  const items = visibleItems().sort((a, b) => a.name.localeCompare(b.name));
  el.context.textContent = `${items.length} medicines · reorder points use 4-week average`;
  if (!items.length) {
    el.table.innerHTML = `<p class="empty-state">No inventory is loaded for ${activeView}. Upload a CSV or load the sample data.</p>`;
    return;
  }

  el.table.innerHTML = `
    <table>
      <thead><tr>
        <th>MEDICINE NAME</th><th>POTENCY</th><th>MRP / PIECE</th><th>SHOP</th><th>STOCK / AVAILABILITY</th><th>LAST ORDER DATE</th><th>STATUS</th><th>AGENT REASONING</th><th>ACTION</th>
      </tr></thead>
      <tbody>${items.map(renderStandardRow).join("")}</tbody>
    </table>`;
}

function renderStandardRow(item) {
  const analysis = getAnalysis(item);
  return `
    <tr>
      <td><div class="medicine-name">${escapeHtml(item.name)}</div></td>
      <td class="potency">${escapeHtml(item.potency)}</td>
      <td class="money">${formatMoney(item.mrp_per_piece)}</td>
      <td>${escapeHtml(item.shop_id)}</td>
      <td>
        <div class="stock-number">${item.current_stock} units</div>
        <div class="stock-subtext">reorder at ${Math.ceil(analysis.reorderPoint)}</div>
      </td>
      <td class="date-value">${formatDate(item.last_order_date)}</td>
      <td>${statusBadge(analysis.status)}</td>
      <td><div class="reasoning">${escapeHtml(analysis.reasoning)}</div></td>
      <td>${renderActions(item, analysis)}</td>
    </tr>`;
}

function renderActions(item, analysis) {
    return `
        <div class="row-actions">

            <button
                class="table-action"
                type="button"
                data-add-stock="${item.id}">
                + Add stock
            </button>

            <button
                class="table-action transfer-action"
                type="button"
                data-transfer-target="${item.id}">
                → Transfer stock
            </button>

            <button
                class="table-action sell-action"
                type="button"
                data-sell-stock="${item.id}">
                − Sell
            </button>

        </div>
    `;
}

function renderComparisonTable() {
  const grouped = new Map();
  inventory.forEach((item) => {
    const key = `${item.name.toLowerCase()}|${item.potency.toLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, { name: item.name, potency: item.potency, items: {} });
    grouped.get(key).items[item.shop_id] = item;
  });
  const groups = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  el.context.textContent = `${groups.length} matched medicines · compare availability before ordering`;

  el.table.innerHTML = `
    <table class="comparison-table">
      <thead><tr>
        <th>MEDICINE NAME</th><th>POTENCY</th><th>MRP / PIECE</th><th>SHOP 1 AVAILABILITY</th><th>SHOP 2 AVAILABILITY</th><th>AGENT DECISION</th><th>ACTION</th>
      </tr></thead>
      <tbody>${groups.map(renderComparisonRow).join("")}</tbody>
    </table>`;
}

function renderComparisonRow(group) {
  const shop1 = group.items["Shop 1"];
  const shop2 = group.items["Shop 2"];
  const analyses = [shop1, shop2].filter(Boolean).map((item) => ({ item, ...getAnalysis(item) }));
  const decision = chooseComparisonDecision(analyses);
  const mrp = shop1?.mrp_per_piece ?? shop2?.mrp_per_piece ?? 0;
  return `
    <tr>
      <td><div class="medicine-name">${escapeHtml(group.name)}</div></td>
      <td class="potency">${escapeHtml(group.potency)}</td>
      <td class="money">${formatMoney(mrp)}</td>
      <td>${renderAvailability(shop1)}</td>
      <td>${renderAvailability(shop2)}</td>
      <td>
        ${statusBadge(decision.status)}
        <div class="comparison-notice">${escapeHtml(decision.reasoning)}</div>
      </td>
      <td>${renderComparisonActions(shop1, shop2, decision)}</td>
    </tr>`;
}

function chooseComparisonDecision(analyses) {
  const transfer = analyses.find((analysis) => analysis.status === "transfer_available");
  if (transfer) return transfer;
  const urgent = analyses.find((analysis) => analysis.status === "reorder_now");
  if (urgent) return urgent;
  const soon = analyses.find((analysis) => analysis.status === "reorder_soon");
  return soon || analyses[0] || { status: "sufficient", reasoning: "No stock data loaded for either shop." };
}

function renderAvailability(item) {
  if (!item) return `<span class="potency">Not stocked</span>`;
  const analysis = getAnalysis(item);
  const percentage = Math.min(100, Math.max(8, (item.current_stock / Math.max(analysis.reorderPoint * 1.5, 1)) * 100));
  return `<div class="shop-availability">
    <span class="availability-number">${item.current_stock}</span>
    <span class="availability-label">reorder at ${Math.ceil(analysis.reorderPoint)}</span>
    <div class="availability-state ${analysis.status}"><span style="width:${percentage}%"></span></div>
  </div>`;
}

function renderComparisonActions(shop1, shop2, decision) {
  const stockButtons = [shop1, shop2].filter(Boolean).map((item) => `<button class="table-action" type="button" data-add-stock="${item.id}">+ ${item.shop_id}</button>`).join("");
  const transfer = decision.status === "transfer_available" ? `<button class="table-action transfer-action" type="button" data-transfer-target="${decision.item.id}">→ Transfer</button>` : "";
  return `<div class="row-actions">${stockButtons}${transfer}</div>`;
}

function getExpiryAlerts(items) {
  return items.flatMap((item) => (item.batch_expiry || []).map((batch) => ({ item, batch, days: daysFromToday(batch.expiry_date) })))
    .filter((entry) => entry.batch.quantity > 0 && entry.days <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.days - b.days);
}

function renderExpiryAlerts() {
  const alerts = getExpiryAlerts(visibleItems());
  el.expiryCount.textContent = alerts.length ? `${alerts.length} ${alerts.length === 1 ? "batch needs attention" : "batches need attention"}` : "All clear";
  if (!alerts.length) {
    el.expiryList.innerHTML = `<p class="empty-state">No stocked batches expire within the next ${EXPIRY_WARNING_DAYS} days in this view.</p>`;
    return;
  }
  el.expiryList.innerHTML = alerts.map(({ item, batch, days }) => {
    const urgency = days < 0 ? `<span class="urgency expired">Expired ${Math.abs(days)}d ago</span>` : days === 0 ? `<span class="urgency">Expires today</span>` : `<span class="urgency">Expires in ${days}d</span>`;
    return `<article class="expiry-item">
      <div class="expiry-icon">⌛</div>
      <div>
        <p class="expiry-name">${escapeHtml(item.name)} <span class="potency">${escapeHtml(item.potency)}</span></p>
        <div class="expiry-detail">${escapeHtml(item.shop_id)} · Batch ${escapeHtml(batch.batch_id)} · ${batch.quantity} units</div>
        <div class="expiry-meta">${urgency} · ${formatDate(batch.expiry_date)}</div>
      </div>
    </article>`;
  }).join("");
}

function openStockDialog(id) {
  const item = inventory.find((candidate) => candidate.id === id);
  if (!item) return;
  pendingStockId = id;
  el.stockTitle.textContent = `Add ${item.name} stock`;
  el.stockCopy.textContent = `Receive stock for ${item.potency} at ${item.shop_id}. Current on-hand stock is ${item.current_stock} units.`;
  el.stockQuantity.value = "";
  el.stockDialog.showModal();
  setTimeout(() => el.stockQuantity.focus(), 0);
}

function addStock(quantity) {
  const item = inventory.find((candidate) => candidate.id === pendingStockId);
  if (!item || quantity <= 0) return;
  const freshBatchNumber = (item.batch_expiry?.length || 0) + 1;
  item.current_stock += quantity;
  item.last_order_date = toISO(new Date());
  item.batch_expiry.push({
    batch_id: `NEW-${slugify(item.name).slice(0, 5).toUpperCase()}-${freshBatchNumber}`,
    quantity,
    expiry_date: toISO(addDays(new Date(), 365)),
  });
  render();
  showToast(`${quantity} units added to ${item.name} at ${item.shop_id}. Reorder status recalculated.`);
}

function openSellDialog(id) {
    const item = inventory.find((candidate) => candidate.id === id);

    if (!item) return;

    pendingSellId = id;

    el.sellTitle.textContent = `Sell ${item.name}`;

    el.sellCopy.innerHTML = `
        <b>Medicine:</b> ${item.name}<br>
        <b>Shop:</b> ${item.shop_id}<br>
        <b>Current Stock:</b> ${item.current_stock} units
    `;

    el.sellQuantity.value = 1;
    el.sellQuantity.max = item.current_stock;

    el.sellLimit.textContent =
        `You can sell up to ${item.current_stock} units.`;

    el.sellDialog.showModal();

    setTimeout(() => el.sellQuantity.focus(), 0);
}

function openTransferDialog(targetId) {
  const target = inventory.find((candidate) => candidate.id === targetId);
  if (!target) return;

  const analysis = getAnalysis(target);

  if (analysis.counterpartSurplus <= 0) {
    showToast(
      `${analysis.counterpart.shop_id} does not have enough surplus stock to transfer.`,
      "warning"
    );
    return;
  }

  const maxTransfer = Math.max(
    0,
    Math.floor(analysis.counterpartSurplus)
);

  if (maxTransfer <= 0) {
    showToast("Transfer is not required for this medicine.", "warning");
    return;
  }

  pendingTransfer = {
    targetId,
    sourceId: analysis.counterpart.id,
    maxTransfer
  };

  el.transferTitle.textContent = `Transfer ${target.name}`;

el.transferCopy.innerHTML = `
<b>Source Shop:</b> ${analysis.counterpart.shop_id}<br>
<b>Current Stock:</b> ${analysis.counterpart.current_stock} units<br>
<b>Reorder Point:</b> ${Math.ceil(getReorderPoint(analysis.counterpart))} units<br>
<b>Transferable Stock:</b> ${maxTransfer} units
`;

if (maxTransfer > 0) {
    el.transferQuantity.value = 1;
    el.transferQuantity.max = maxTransfer;
    el.transferLimit.textContent =
        `Select any quantity from 1 to ${maxTransfer} units.`;
} else {
    el.transferQuantity.value = 0;
    el.transferQuantity.max = 0;
    el.transferLimit.textContent =
        "No stock available for transfer.";
}

el.transferDialog.showModal();
setTimeout(() => el.transferQuantity.focus(), 0);
}

function transferStock(quantity) {
  if (!pendingTransfer || quantity <= 0 || quantity > pendingTransfer.maxTransfer) return;
  const target = inventory.find((candidate) => candidate.id === pendingTransfer.targetId);
  const source = inventory.find((candidate) => candidate.id === pendingTransfer.sourceId);
  if (!target || !source) return;

  let remaining = quantity;
  const moved = [];
  const batches = [...source.batch_expiry].sort((a, b) => parseDate(a.expiry_date) - parseDate(b.expiry_date));
  batches.forEach((batch) => {
    if (remaining <= 0 || batch.quantity <= 0) return;
    const taken = Math.min(batch.quantity, remaining);
    batch.quantity -= taken;
    remaining -= taken;
    moved.push({ batch_id: batch.batch_id, quantity: taken, expiry_date: batch.expiry_date });
  });
  const actualMoved = quantity - remaining;
  if (!actualMoved) return;
  source.current_stock -= actualMoved;
  target.current_stock += actualMoved;
  moved.forEach((batch) => {
    const matchingBatch = target.batch_expiry.find((existing) => existing.batch_id === batch.batch_id && existing.expiry_date === batch.expiry_date);
    if (matchingBatch) matchingBatch.quantity += batch.quantity;
    else target.batch_expiry.push(batch);
  });
  source.batch_expiry = source.batch_expiry.filter((batch) => batch.quantity > 0);
  render();
  showToast(`${actualMoved} units of ${target.name} transferred from ${source.shop_id} to ${target.shop_id}.`);
}

function sellMedicine(quantity) {

    const item = inventory.find(
        (candidate) => candidate.id === pendingSellId
    );

    if (!item) return;

    if (quantity < 1 || quantity > item.current_stock) {
        showToast("Invalid quantity.", "warning");
        return;
    }

    item.current_stock -= quantity;

    render();

    showToast(
        `${quantity} units of ${item.name} sold successfully.`
    );
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "warning" ? "warning" : ""}`;
  toast.textContent = message;
  el.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one medicine row.");
  const headers = rows.shift().map((header) => header.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])));
}

function csvValue(row, ...keys) {
  return keys.map((key) => row[key]).find((value) => value !== undefined && value !== "") || "";
}

function normalizeDate(value) {
  const parsed = parseDate(value);
  return parsed ? toISO(parsed) : toISO(addDays(new Date(), 365));
}

function buildInventoryFromCsv(rows) {
  const grouped = new Map();
  let defaultedShop = false;
  rows.forEach((row, index) => {
    const name = csvValue(row, "name", "medicine_name", "medicine");
    const potency = csvValue(row, "potency", "strength") || "—";
    if (!name) return;
    const suppliedShop = csvValue(row, "shop_id", "shop");
    const shop = suppliedShop || "Shop 1";
    if (!suppliedShop) defaultedShop = true;
    const key = `${name.toLowerCase()}|${potency.toLowerCase()}|${shop.toLowerCase()}`;
    const salesHistoryValue = csvValue(row, "sales_history");
    let history = [];
    try {
      if (salesHistoryValue) history = JSON.parse(salesHistoryValue);
    } catch { history = []; }
    if (!history.length) {
      history = [1, 2, 3, 4].map((week) => ({ week_label: `Week ${week}`, quantity_sold: Number(csvValue(row, `week${week}_sales`, `week_${week}_sales`) || 0) }));
    }
    const batchQuantity = Number(csvValue(row, "batch_quantity", "quantity", "current_stock") || 0);
    const batch = { batch_id: csvValue(row, "batch_id") || `UPLOAD-${index + 1}`, quantity: batchQuantity, expiry_date: normalizeDate(csvValue(row, "expiry_date", "batch_expiry_date")) };
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `${slugify(name)}-${slugify(potency)}-${slugify(shop)}-${index + 1}`,
        name,
        potency,
        mrp_per_piece: Number(csvValue(row, "mrp_per_piece", "mrp", "price") || 0),
        shop_id: shop,
        current_stock: Number(csvValue(row, "current_stock", "stock") || batchQuantity),
        sales_history: history,
        batch_expiry: [batch],
        last_order_date: normalizeDate(csvValue(row, "last_order_date")),
      });
    } else {
      grouped.get(key).batch_expiry.push(batch);
    }
  });
  const records = [...grouped.values()];
  if (!records.length) throw new Error("No valid medicine rows were found in this CSV.");
  return { records, defaultedShop };
}

function exportInventory() {
  const headers = ["name", "potency", "mrp_per_piece", "shop_id", "current_stock", "week1_sales", "week2_sales", "week3_sales", "week4_sales", "last_order_date", "batch_id", "batch_quantity", "expiry_date"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [headers.join(",")];
  inventory.forEach((item) => {
    const sales = item.sales_history || [];
    (item.batch_expiry || []).forEach((batch) => {
      lines.push([
        item.name, item.potency, item.mrp_per_piece, item.shop_id, item.current_stock,
        ...[0, 1, 2, 3].map((index) => sales[index]?.quantity_sold || 0),
        item.last_order_date, batch.batch_id, batch.quantity, batch.expiry_date,
      ].map(quote).join(","));
    });
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pharma-stock-sense-${toISO(new Date())}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Updated inventory CSV downloaded.");
}

el.tabs.forEach((tab) => tab.addEventListener("click", () => {
  activeView = tab.dataset.view;
  el.tabs.forEach((candidate) => {
    const isActive = candidate === tab;
    candidate.classList.toggle("active", isActive);
    candidate.setAttribute("aria-selected", String(isActive));
  });
  render();
}));

el.table.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-stock]");
  const transferButton = event.target.closest("[data-transfer-target]");
  const sellButton = event.target.closest("[data-sell-stock]");
  if (addButton) openStockDialog(addButton.dataset.addStock);
  if (transferButton) openTransferDialog(transferButton.dataset.transferTarget);
  if (sellButton) openSellDialog(sellButton.dataset.sellStock);
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
  button.closest("dialog").close();
}));

el.stockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const quantity = Number(el.stockQuantity.value);
  if (!Number.isInteger(quantity) || quantity < 1) return;
  addStock(quantity);
  el.stockDialog.close();
});

el.transferForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const quantity = Number(el.transferQuantity.value);
  if (!Number.isInteger(quantity) || quantity < 1 || !pendingTransfer || quantity > pendingTransfer.maxTransfer) {
    showToast(`Enter a whole number up to ${pendingTransfer?.maxTransfer || 0}.`, "warning");
    return;
  }
  transferStock(quantity);
  el.transferDialog.close();
});

el.sellForm.addEventListener("submit", (event) => {
    event.preventDefault();

    sellMedicine(Number(el.sellQuantity.value));

    el.sellDialog.close();
});

el.sample.addEventListener("click", () => {
  inventory = buildSampleInventory();
  activeView = "Both";
  el.tabs.forEach((tab) => {
    const isActive = tab.dataset.view === activeView;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  render();
  showToast("Two-shop demo data loaded — look for Paracetamol in comparison view.");
});

el.upload.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const { records, defaultedShop } = buildInventoryFromCsv(parseCsv(await file.text()));
    inventory = records;
    activeView = "Both";
    el.tabs.forEach((tab) => {
      const isActive = tab.dataset.view === activeView;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
    render();
    showToast(defaultedShop ? `Loaded ${records.length} medicines. No shop_id column found, so rows were assigned to Shop 1.` : `Loaded ${records.length} medicines from ${file.name}.`, defaultedShop ? "warning" : "success");
  } catch (error) {
    showToast(error.message || "That CSV could not be read.", "warning");
  } finally {
    event.target.value = "";
  }
});

el.export.addEventListener("click", exportInventory);
render();
