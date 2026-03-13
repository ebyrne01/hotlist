const API_BASE = "https://www.myhotlist.app";

async function initAmazonOverlay() {
  // Only run on book pages — check breadcrumbs for "Books" or "Kindle"
  if (!isBookPage()) return;

  const asin = extractAsin();
  const isbn = extractIsbn();
  const title = extractTitle();
  const author = extractAuthor();

  if (!asin && !isbn && !title) return;

  const params = new URLSearchParams();
  if (asin) params.set("asin", asin);
  if (isbn) params.set("isbn", isbn);
  if (title) params.set("title", title);
  if (author) params.set("author", author);

  let data;
  try {
    const res = await fetch(`${API_BASE}/api/books/lookup?${params}`);
    data = await res.json();
  } catch (err) {
    console.log("[Hotlist] API lookup failed:", err);
    data = { found: false };
  }

  injectWidget(data, title, author);
  chrome.runtime.sendMessage({ type: "BOOK_PAGE_DETECTED" });
}

// Run on initial load
initAmazonOverlay();

function isBookPage() {
  const breadcrumbs = document.querySelector(
    "#wayfinding-breadcrumbs_container, .a-breadcrumb"
  );
  if (breadcrumbs) {
    const text = breadcrumbs.textContent.toLowerCase();
    if (text.includes("books") || text.includes("kindle")) return true;
  }
  // Fallback: check for Kindle format selector or "Reading age" detail
  if (document.querySelector("#tmm-grid-swatch-KINDLE")) return true;
  if (document.querySelector("#rpiCategory")) {
    const cat = document.querySelector("#rpiCategory").textContent.toLowerCase();
    if (cat.includes("book")) return true;
  }
  return false;
}

function extractAsin() {
  // From URL: /dp/ASIN or /gp/product/ASIN
  const match = window.location.pathname.match(
    /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/
  );
  return match ? match[1] : null;
}

function extractIsbn() {
  // Look in detail section for ISBN-13 or ISBN-10
  const details = document.querySelectorAll(
    "#detailBullets_feature_div li, #productDetailsTable .content li, .detail-bullet-list .a-list-item"
  );
  for (const li of details) {
    const text = li.textContent;
    const isbnMatch = text.match(/ISBN[- ]?13\s*:\s*([\d-]+)/);
    if (isbnMatch) return isbnMatch[1].replace(/-/g, "");
    const isbn10Match = text.match(/ISBN[- ]?10\s*:\s*([\dX-]+)/i);
    if (isbn10Match) return isbn10Match[1].replace(/-/g, "");
  }
  return null;
}

function extractTitle() {
  const el = document.querySelector("#productTitle, #ebooksProductTitle");
  return el ? el.textContent.trim() : null;
}

function extractAuthor() {
  const el = document.querySelector(
    ".author a, #bylineInfo .author a, #bylineInfo a.contributorNameID"
  );
  return el ? el.textContent.trim() : null;
}

function injectWidget(data, title, author) {
  // Insert below the review summary section
  const reviewSection =
    document.querySelector("#averageCustomerReviews") ||
    document.querySelector("#reviewsMedley");
  const target = reviewSection
    ? reviewSection.parentNode
    : document.querySelector("#centerCol") ||
      document.querySelector("#dp-container");
  if (!target) return;

  // Don't inject twice
  if (document.querySelector(".hotlist-overlay")) return;

  const widget = document.createElement("div");
  widget.className = "hotlist-overlay";

  if (data.found) {
    const book = data.book;

    const spiceHtml = book.spiceLevel
      ? `<div class="hotlist-spice">
           <span class="hotlist-spice-peppers">${"\uD83C\uDF36\uFE0F".repeat(Math.min(5, book.spiceLevel))}</span>
           ${book.heatLabel ? `<span class="hotlist-heat-label">${book.heatLabel}</span>` : ""}
           ${book.spiceAttribution ? `<span class="hotlist-spice-source">${book.spiceAttribution}</span>` : ""}
         </div>`
      : `<div class="hotlist-spice"><span class="hotlist-spice-unknown">Spice level unknown</span></div>`;

    const tropesHtml =
      book.tropes.length > 0
        ? `<div class="hotlist-tropes">${book.tropes.map((t) => `<span class="hotlist-trope-pill">${t}</span>`).join("")}</div>`
        : "";

    // Show Goodreads rating on Amazon (the cross-site value-add)
    let ratingsHtml = "";
    if (book.goodreadsRating) {
      ratingsHtml = `<div class="hotlist-ratings-row">
        <span class="hotlist-rating-badge">
          <span class="hotlist-rating-source">Goodreads</span>
          <span class="hotlist-rating-value">${book.goodreadsRating.toFixed(1)}</span>
          ${book.goodreadsRatingCount ? `<span class="hotlist-rating-count">(${formatCount(book.goodreadsRatingCount)})</span>` : ""}
        </span>
      </div>`;
    }

    widget.innerHTML = `
      <div class="hotlist-header">
        <span class="hotlist-wordmark">Hotlist</span>
        <span class="hotlist-fire">\uD83D\uDD25</span>
      </div>
      ${spiceHtml}
      ${tropesHtml}
      ${ratingsHtml}
      <div class="hotlist-actions">
        <a href="${book.hotlistUrl}" target="_blank" class="hotlist-btn-view">View on Hotlist \u2192</a>
        <button class="hotlist-btn-add" data-book-id="${book.id}" data-title="${escapeAttr(book.title)}" data-author="${escapeAttr(book.author)}">+ Add to Hotlist</button>
      </div>
    `;
  } else {
    const searchQuery = encodeURIComponent(
      (title || "") + (author ? " " + author : "")
    );
    widget.innerHTML = `
      <div class="hotlist-header">
        <span class="hotlist-wordmark">Hotlist</span>
        <span class="hotlist-fire">\uD83D\uDD25</span>
      </div>
      <div class="hotlist-spice"><span class="hotlist-spice-unknown">Not in Hotlist yet</span></div>
      <div class="hotlist-actions">
        <a href="${API_BASE}/search?q=${searchQuery}" target="_blank" class="hotlist-btn-view">Search on Hotlist \u2192</a>
      </div>
    `;
  }

  widget.querySelector(".hotlist-btn-add")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (data.found) {
      window.open(data.book.hotlistUrl, "_blank");
    } else {
      window.open(
        `${API_BASE}/search?q=${encodeURIComponent(btn.dataset.title + " " + btn.dataset.author)}`,
        "_blank"
      );
    }
  });

  if (reviewSection) {
    reviewSection.parentNode.insertBefore(widget, reviewSection.nextSibling);
  } else {
    target.prepend(widget);
  }
}

// SPA navigation handling — Amazon uses client-side routing for "also bought" clicks
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Remove old overlay and re-run
    document.querySelector(".hotlist-overlay")?.remove();
    initAmazonOverlay();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

function escapeAttr(text) {
  return (text || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(0) + "K";
  return n.toString();
}
