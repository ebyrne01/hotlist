const API_BASE = "https://www.myhotlist.app";

let currentUrl = null;
let currentTabId = null;
let lastScanResult = null;

// ── State management ──

function showState(stateId) {
  document.querySelectorAll(".state").forEach((el) => el.classList.add("hidden"));
  document.getElementById(stateId)?.classList.remove("hidden");
}

// ── URL helpers ──

function isHarvestable(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("goodreads.com/list/show/") ||
    lower.includes("goodreads.com/list/tag/") ||
    lower.includes("goodreads.com/genres/") ||
    lower.includes("goodreads.com/shelf/show/") ||
    lower.includes("amazon.com/gp/new-releases/") ||
    lower.includes("amazon.com/gp/bestsellers/") ||
    lower.includes("amazon.com/best-sellers") ||
    lower.includes("amazon.com/gp/bestsellers") ||
    lower.includes("coming-soon") ||
    lower.includes("p_n_publication_date") ||
    lower.includes("p_n_date") ||
    (lower.includes("amazon.com") && lower.includes("rh=n:")) ||
    lower.includes("zgbs/") ||
    lower.includes("romance.io/new") ||
    lower.includes("romance.io/top") ||
    lower.includes("romance.io/finder") ||
    lower.includes("shereadsromancebooks.com") ||
    lower.includes("thenerddaily.com") ||
    lower.includes("gabriellesands.com") ||
    lower.includes("booklistqueen.com") ||
    lower.includes("momneedsachapter.com") ||
    lower.includes("popvortex.com")
  );
}

function getParserForUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes("goodreads.com/list/") || lower.includes("goodreads.com/genres/") || lower.includes("goodreads.com/shelf/")) return "goodreads-list";
  if (lower.includes("amazon.com/") || lower.includes("amazon.com")) return "amazon-list";
  if (lower.includes("romance.io/")) return "romanceio";
  return "generic-links";
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + "..." : u.pathname;
    return u.hostname + path;
  } catch {
    return url.slice(0, 50);
  }
}

// ── Initialize popup ──

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.url) {
    showState("state-default");
    await refreshBatchDisplay();
    return;
  }

  currentUrl = tab.url;
  currentTabId = tab.id;

  if (isHarvestable(currentUrl)) {
    showState("state-ready");
    const readyUrl = document.getElementById("readyUrl");
    if (readyUrl) readyUrl.textContent = truncateUrl(currentUrl);
  } else {
    showState("state-default");
  }

  await refreshBatchDisplay();
});

// ── Source picker — always visible, navigates tab ──

const sourcePicker = document.getElementById("sourcePicker");

sourcePicker?.addEventListener("change", () => {
  const url = sourcePicker.value;
  if (url && currentTabId) {
    chrome.tabs.update(currentTabId, { url });
    window.close();
  }
});

// ── Scan button ──

document.getElementById("scanBtn")?.addEventListener("click", () => {
  showState("state-harvest");
  scanPage(currentTabId, getParserForUrl(currentUrl));
});

// ── Page scanning ──

async function scanPage(tabId, parserName) {
  const statusEl = document.getElementById("harvestStatus");
  const warningEl = document.getElementById("harvestWarning");
  const sampleEl = document.getElementById("harvestSample");
  const summaryEl = document.getElementById("harvestSummary");
  const harvestBtn = document.getElementById("harvestBtn");

  statusEl.textContent = "Scanning page...";
  warningEl.classList.add("hidden");
  sampleEl.innerHTML = "";
  summaryEl.classList.add("hidden");
  harvestBtn.disabled = true;

  try {
    // Fetch parser source files
    const [utilsSrc, parserSrc] = await Promise.all([
      fetch(chrome.runtime.getURL("parsers/utils.js")).then((r) => r.text()),
      fetch(chrome.runtime.getURL(`parsers/${parserName}.js`)).then((r) => r.text()),
    ]);

    // Strip the leading comment block, then prepend "return" so new Function() captures the IIFE value.
    const parserBody = parserSrc.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
    const combinedCode = utilsSrc + "\nreturn " + parserBody;

    // Inject and execute in the page context
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (code) => {
        return new Function(code)();
      },
      args: [combinedCode],
      world: "MAIN",
    });

    const result = results?.[0]?.result;
    if (!result || !result.books) {
      statusEl.textContent = "Could not scan this page.";
      return;
    }

    lastScanResult = result;
    const { books, confidence } = result;

    if (books.length === 0) {
      statusEl.textContent = "No books found on this page.";
      return;
    }

    // Count new vs already in batch
    const { harvestBatch = [] } = await chrome.storage.local.get("harvestBatch");
    const batchKeys = new Set(harvestBatch.map((b) => dedupKeyLocal(b)).filter(Boolean));
    const newCount = books.filter((b) => {
      const key = dedupKeyLocal(b);
      return !key || !batchKeys.has(key);
    }).length;

    statusEl.textContent = `Found ${books.length} books`;
    document.getElementById("harvestCount").textContent = `${books.length} books`;
    document.getElementById("harvestNew").textContent =
      newCount < books.length ? `(${newCount} new)` : "";
    summaryEl.classList.remove("hidden");

    // Confidence warning
    if (confidence === "low" || confidence === "none") {
      warningEl.textContent = `Low confidence — only found ${books.length} books. Page layout may have changed.`;
      warningEl.classList.remove("hidden");
    }

    // Preview first 3 books
    for (const book of books.slice(0, 3)) {
      const card = document.createElement("div");
      card.className = "book-card";
      card.setAttribute("role", "listitem");

      const title = book.title || `Book (GR #${book.goodreadsId || book.asin || "?"})`;
      const formatBadge = book.format
        ? `<span class="format-badge">${formatIcon(book.format)}</span>`
        : "";

      card.innerHTML = `
        ${book.coverUrl ? `<img class="book-cover" src="${book.coverUrl}" alt="">` : '<div class="book-cover"></div>'}
        <div class="book-info">
          <div class="book-title">${escapeHtml(title)}${formatBadge}</div>
          ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ""}
          <div class="book-meta">
            ${book.goodreadsRating ? `<span class="book-rating">${book.goodreadsRating.toFixed(1)} ★</span>` : ""}
            ${book.amazonRating ? `<span class="book-rating">AMZ ${book.amazonRating.toFixed(1)}</span>` : ""}
            ${book.romanceIoSpice ? `<span class="book-spice">${"🌶️".repeat(book.romanceIoSpice)}</span>` : ""}
          </div>
        </div>
      `;
      sampleEl.appendChild(card);
    }

    harvestBtn.disabled = false;
  } catch (err) {
    console.error("[Harvester] Scan failed:", err);
    statusEl.textContent = "Scan failed — try refreshing the page.";
  }
}

function formatIcon(format) {
  switch (format) {
    case "kindle": return "📱";
    case "audiobook": return "🎧";
    case "hardcover": return "📖";
    case "paperback": return "📖";
    default: return "";
  }
}

// ── Batch management ──

let writeLock = false;

async function updateBatch(newBooks) {
  while (writeLock) await new Promise((r) => setTimeout(r, 50));
  writeLock = true;
  try {
    const { harvestBatch = [] } = await chrome.storage.local.get("harvestBatch");
    const batchMap = new Map();
    for (const book of harvestBatch) {
      const key = dedupKeyLocal(book);
      if (key) batchMap.set(key, book);
    }

    let added = 0;
    let merged = 0;
    for (const book of newBooks) {
      const key = dedupKeyLocal(book);
      if (!key) {
        harvestBatch.push(book);
        added++;
        continue;
      }
      const existing = batchMap.get(key);
      if (existing) {
        Object.assign(existing, mergeBooksLocal(existing, book));
        merged++;
      } else {
        batchMap.set(key, book);
        harvestBatch.push(book);
        added++;
      }
    }

    await chrome.storage.local.set({
      harvestBatch,
      batchUpdatedAt: Date.now(),
    });
    return { added, merged, total: harvestBatch.length };
  } finally {
    writeLock = false;
  }
}

function normalizeForDedupLocal(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

function dedupKeyLocal(book) {
  if (book.goodreadsId) return `gr:${book.goodreadsId}`;
  if (book.asin) return `asin:${book.asin}`;
  const normTitle = normalizeForDedupLocal(book.title);
  const authorLast = (book.author || "").trim().split(/\s+/).pop()?.toLowerCase();
  if (normTitle && authorLast) return `ta:${normTitle}::${authorLast}`;
  return null;
}

function mergeBooksLocal(existing, incoming) {
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (incoming[key] != null && merged[key] == null) {
      merged[key] = incoming[key];
    }
  }
  if (incoming.goodreadsId && !merged.goodreadsId) merged.goodreadsId = incoming.goodreadsId;
  if (incoming.asin && !merged.asin) merged.asin = incoming.asin;
  return merged;
}

// ── Batch display (always visible) ──

async function refreshBatchDisplay() {
  const { harvestBatch = [], batchUpdatedAt } = await chrome.storage.local.get([
    "harvestBatch",
    "batchUpdatedAt",
  ]);
  const countEl = document.getElementById("batchCount");
  const ageEl = document.getElementById("batchAge");
  const exportBtn = document.getElementById("exportCsvBtn");
  const uploadBtn = document.getElementById("uploadBtn");

  if (countEl) countEl.textContent = `${harvestBatch.length} book${harvestBatch.length !== 1 ? "s" : ""} in batch`;
  if (exportBtn) exportBtn.disabled = harvestBatch.length === 0;
  if (uploadBtn) uploadBtn.disabled = harvestBatch.length === 0;

  if (ageEl) {
    if (batchUpdatedAt) {
      const days = Math.floor((Date.now() - batchUpdatedAt) / 86400000);
      ageEl.textContent = days > 0 ? `started ${days}d ago` : "updated today";
    } else {
      ageEl.textContent = "";
    }
  }
}

// ── Add to Batch button ──

document.getElementById("harvestBtn")?.addEventListener("click", async () => {
  if (!lastScanResult || !lastScanResult.books.length) return;

  const harvestBtn = document.getElementById("harvestBtn");
  harvestBtn.disabled = true;
  harvestBtn.textContent = "Adding...";

  let books = lastScanResult.books;

  if (document.getElementById("skipAudiobooks")?.checked) {
    books = books.filter((b) => b.format !== "audiobook");
  }

  const result = await updateBatch(books);
  harvestBtn.textContent = `+${result.added} added, ${result.merged} merged`;
  await refreshBatchDisplay();

  chrome.runtime.sendMessage({ type: "HARVEST_COMPLETE", tabId: currentTabId });

  setTimeout(() => {
    harvestBtn.textContent = "Add to Batch";
    harvestBtn.disabled = false;
  }, 2000);
});

// ── Export CSV ──

function exportBatch(books) {
  if (document.getElementById("skipAudiobooks")?.checked) {
    books = books.filter((b) => b.format !== "audiobook");
  }
  if (books.length === 0) return;

  const columns = [
    "title", "author", "isbn13", "goodreads_id", "asin",
    "series_name", "series_position", "cover_url",
    "goodreads_rating", "goodreads_rating_count",
    "amazon_rating", "amazon_rating_count",
    "romanceio_spice", "format", "source", "harvested_at",
  ];

  const rows = [columns.join(",")];
  for (const book of books) {
    const row = [
      book.title, book.author, book.isbn13, book.goodreadsId, book.asin,
      book.seriesName, book.seriesPosition, book.coverUrl,
      book.goodreadsRating, book.goodreadsRatingCount,
      book.amazonRating, book.amazonRatingCount,
      book.romanceIoSpice, book.format, book.source, book.harvestedAt,
    ].map((v) => csvEscape(v));
    rows.push(row.join(","));
  }

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hotlist-harvest-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("exportCsvBtn")?.addEventListener("click", async () => {
  const { harvestBatch = [] } = await chrome.storage.local.get("harvestBatch");
  exportBatch(harvestBatch);
});

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ── Upload to Hotlist ──

document.getElementById("uploadBtn")?.addEventListener("click", async () => {
  const uploadBtn = document.getElementById("uploadBtn");
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";

  try {
    const { harvestBatch = [], harvestApiKey } = await chrome.storage.local.get(["harvestBatch", "harvestApiKey"]);
    let books = harvestBatch;

    if (document.getElementById("skipAudiobooks")?.checked) {
      books = books.filter((b) => b.format !== "audiobook");
    }

    if (books.length === 0) return;

    // Prompt for API key on first use
    let apiKey = harvestApiKey;
    if (!apiKey) {
      apiKey = prompt("Enter your Hotlist harvest API key (CRON_SECRET):");
      if (!apiKey) {
        uploadBtn.textContent = "Upload to Hotlist";
        uploadBtn.disabled = false;
        return;
      }
      await chrome.storage.local.set({ harvestApiKey: apiKey });
    }

    const res = await fetch(`${API_BASE}/api/seed/harvest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ books }),
    });

    if (res.status === 401 || res.status === 403) {
      // Key is wrong — clear it so they can re-enter
      await chrome.storage.local.remove("harvestApiKey");
      uploadBtn.textContent = "Bad API key — try again";
      setTimeout(() => { uploadBtn.textContent = "Upload to Hotlist"; uploadBtn.disabled = false; }, 3000);
      return;
    }

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    uploadBtn.textContent = `+${data.added || 0} added, ${data.skipped || 0} skipped`;

    await chrome.storage.local.set({ harvestBatch: [], batchUpdatedAt: null });
    await refreshBatchDisplay();

    setTimeout(() => { uploadBtn.textContent = "Upload to Hotlist"; uploadBtn.disabled = true; }, 5000);
  } catch (err) {
    console.error("[Harvester] Upload failed:", err);
    uploadBtn.textContent = "Upload failed — use CSV";
    setTimeout(() => { uploadBtn.textContent = "Upload to Hotlist"; uploadBtn.disabled = false; }, 3000);
  }
});

// ── Clear batch ──

document.getElementById("clearBatchBtn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!confirm("Clear all harvested books? This can't be undone.")) return;
  await chrome.storage.local.set({ harvestBatch: [], batchUpdatedAt: null });
  await refreshBatchDisplay();
});

// ── Retry handler ──

document.getElementById("retryBtn")?.addEventListener("click", () => {
  if (currentUrl && isHarvestable(currentUrl)) {
    showState("state-harvest");
    scanPage(currentTabId, getParserForUrl(currentUrl));
  } else {
    showState("state-default");
  }
});

// ── Utilities ──

function escapeHtml(text) {
  const el = document.createElement("span");
  el.textContent = text || "";
  return el.innerHTML;
}
