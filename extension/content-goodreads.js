const API_BASE = "https://www.myhotlist.app";

(async function initGoodreadsOverlay() {
  // Extract Goodreads ID from URL like /book/show/12345-book-title
  const match = window.location.pathname.match(/\/book\/show\/(\d+)/);
  if (!match) return;
  const goodreadsId = match[1];

  // Scrape title + author from the page for fallback
  const title =
    document.querySelector('[data-testid="bookTitle"]')?.textContent?.trim() ||
    document.querySelector("h1#bookTitle")?.textContent?.trim() ||
    "";
  const author =
    document.querySelector('[data-testid="name"]')?.textContent?.trim() ||
    document.querySelector("a.authorName span")?.textContent?.trim() ||
    "";

  let data;
  try {
    const params = new URLSearchParams({ goodreads_id: goodreadsId });
    if (title) params.set("title", title);
    if (author) params.set("author", author);
    const res = await fetch(`${API_BASE}/api/books/lookup?${params}`);
    data = await res.json();
  } catch (err) {
    console.log("[Hotlist] API lookup failed:", err);
    data = { found: false };
  }

  injectWidget(data, goodreadsId, title, author);
  chrome.runtime.sendMessage({ type: "BOOK_PAGE_DETECTED" });
})();

function injectWidget(data, goodreadsId, title, author) {
  // Find the best insertion point — below the rating section
  const ratingSection =
    document.querySelector('[data-testid="ratingsCount"]')?.closest("div") ||
    document.querySelector(".RatingStatistics");

  const target = ratingSection
    ? ratingSection.parentNode
    : document.querySelector(".BookPage__mainContent") ||
      document.querySelector("#topcol");
  if (!target) return;

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

    // Show Goodreads rating comparison if we have Amazon data
    let ratingsHtml = "";
    if (book.amazonRating) {
      ratingsHtml = `<div class="hotlist-ratings-row">
        ${book.amazonRating ? `<span class="hotlist-rating-badge"><span class="hotlist-rating-source">Amazon</span> <span class="hotlist-rating-value">${book.amazonRating.toFixed(1)}</span></span>` : ""}
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
    // Book not in our database (and auto-provisioning didn't fire or failed)
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

  // "Add to Hotlist" button opens the book page on Hotlist
  widget.querySelector(".hotlist-btn-add")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const bookId = btn.dataset.bookId;
    if (bookId && data.found) {
      window.open(data.book.hotlistUrl, "_blank");
    } else {
      window.open(
        `${API_BASE}/search?q=${encodeURIComponent(btn.dataset.title + " " + btn.dataset.author)}`,
        "_blank"
      );
    }
  });

  // Insert after the rating section, or prepend to target
  if (ratingSection) {
    ratingSection.parentNode.insertBefore(widget, ratingSection.nextSibling);
  } else {
    target.prepend(widget);
  }
}

function escapeAttr(text) {
  return (text || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
