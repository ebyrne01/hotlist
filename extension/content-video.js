// Detect video pages on TikTok, Instagram, YouTube
function checkPage() {
  const url = window.location.href.toLowerCase();
  const isVideo =
    (url.includes("tiktok.com/") && url.includes("/video/")) ||
    url.includes("instagram.com/reel") ||
    url.includes("instagram.com/p/") ||
    url.includes("youtube.com/watch") ||
    url.includes("youtube.com/shorts/") ||
    url.includes("youtu.be/");

  chrome.runtime.sendMessage({
    type: isVideo ? "VIDEO_PAGE_DETECTED" : "NOT_SPECIAL_PAGE",
  });
}

checkPage();

// SPA navigation detection (TikTok, YouTube use client-side routing)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    checkPage();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
