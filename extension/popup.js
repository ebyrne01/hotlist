const API_BASE = "https://www.myhotlist.app";

const STATUS_MESSAGES = {
  downloading: "Downloading video...",
  transcribing: "Transcribing audio...",
  scanning: "Scanning for book covers...",
  extracting: "Finding book mentions...",
  identifying: "Matching to our database...",
  done: "Done!",
};

const STATUS_PROGRESS = {
  downloading: 15,
  transcribing: 35,
  scanning: 55,
  extracting: 75,
  identifying: 90,
  done: 100,
};

let currentUrl = null;
let currentTabId = null;

// ── State management ──

function showState(stateId) {
  document.querySelectorAll(".state").forEach((el) => el.classList.add("hidden"));
  document.getElementById(stateId)?.classList.remove("hidden");
}

// ── URL helpers ──

function isVideoUrl(url) {
  const lower = url.toLowerCase();
  return (
    (lower.includes("tiktok.com/") && lower.includes("/video/")) ||
    lower.includes("instagram.com/reel") ||
    lower.includes("instagram.com/p/") ||
    lower.includes("youtube.com/watch") ||
    lower.includes("youtube.com/shorts/") ||
    lower.includes("youtu.be/")
  );
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
    return;
  }

  currentUrl = tab.url;
  currentTabId = tab.id;
  const lower = currentUrl.toLowerCase();

  if (isVideoUrl(currentUrl)) {
    showState("state-ready");
    document.getElementById("urlPreview").textContent = truncateUrl(currentUrl);
  } else if (
    lower.includes("goodreads.com/book/") ||
    lower.includes("amazon.com/dp/") ||
    lower.includes("amazon.com/gp/product/")
  ) {
    showState("state-book-page");
  } else {
    showState("state-default");
  }
});

// ── Grab handler (existing video feature) ──

document.getElementById("grabBtn")?.addEventListener("click", async () => {
  if (!currentUrl) return;

  showState("state-processing");
  const statusText = document.getElementById("statusText");
  const progressFill = document.getElementById("progressFill");

  try {
    const res = await fetch(`${API_BASE}/api/grab`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl }),
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";

    // Cached response comes back as JSON directly
    if (contentType.includes("application/json")) {
      const data = await res.json();
      progressFill.style.width = "100%";
      renderResults(data);
      return;
    }

    // Streaming response — read line by line
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status) {
            statusText.textContent = STATUS_MESSAGES[msg.status] || msg.status;
            const progress = STATUS_PROGRESS[msg.status] || 0;
            progressFill.style.width = progress + "%";
            progressFill.parentElement.setAttribute("aria-valuenow", progress);
          }
          if (msg.result) {
            progressFill.style.width = "100%";
            renderResults(msg.result);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  } catch (err) {
    console.error("[Hotlist popup] Grab failed:", err);
    document.getElementById("errorText").textContent =
      "Could not process this video. Try pasting the link on Hotlist instead.";
    showState("state-error");
  }
});

document.getElementById("retryBtn")?.addEventListener("click", () => {
  showState("state-ready");
});

// ── Render video results (existing) ──

function renderResults(result) {
  if (!result.success) {
    document.getElementById("errorText").textContent =
      result.error === "video_unavailable"
        ? "Couldn't download this video. The link may be private or expired."
        : "Something went wrong. Try pasting the link on Hotlist.";
    showState("state-error");
    return;
  }

  const bookList = document.getElementById("bookList");
  bookList.innerHTML = "";

  const books = result.books || [];
  const matchedBooks = books.filter((b) => b.matched);

  if (matchedBooks.length === 0) {
    bookList.innerHTML = '<p class="book-unmatched">No books found in this video.</p>';
    showState("state-results");
    return;
  }

  for (const entry of books) {
    if (entry.matched) {
      const book = entry.book;
      const gr = book.ratings?.find((r) => r.source === "goodreads");
      const spice = book.compositeSpice;
      const spiceLevel = spice ? Math.round(spice.score) : 0;

      const card = document.createElement("div");
      card.className = "book-card";
      card.setAttribute("role", "listitem");
      card.innerHTML = `
        ${book.coverUrl ? `<img class="book-cover" src="${book.coverUrl}" alt="Cover of ${escapeHtml(book.title)}">` : '<div class="book-cover"></div>'}
        <div class="book-info">
          <div class="book-title">${escapeHtml(book.title)}</div>
          <div class="book-author">${escapeHtml(book.author)}</div>
          <div class="book-meta">
            ${gr?.rating ? `<span class="book-rating">${gr.rating.toFixed(1)} ★</span>` : ""}
            ${spiceLevel > 0 ? `<span class="book-spice" role="img" aria-label="Spice level ${spiceLevel} out of 5">${"🌶️".repeat(spiceLevel)}</span>` : ""}
          </div>
        </div>
      `;
      bookList.appendChild(card);
    } else {
      const el = document.createElement("p");
      el.className = "book-unmatched";
      el.textContent = `"${entry.title || "Unknown"}" — not found`;
      bookList.appendChild(el);
    }
  }

  // "Open on Hotlist" button links to the BookTok page with this URL
  const openBtn = document.getElementById("openHotlistBtn");
  openBtn.href = `${API_BASE}/booktok?url=${encodeURIComponent(currentUrl)}`;

  showState("state-results");
}

// ── Utilities ──

function escapeHtml(text) {
  const el = document.createElement("span");
  el.textContent = text || "";
  return el.innerHTML;
}
