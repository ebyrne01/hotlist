/**
 * Hotlist Book Harvester — Background Service Worker
 * Minimal: badge management for harvest completion.
 */

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "HARVEST_COMPLETE" && msg.tabId) {
    chrome.action.setBadgeText({ text: "✓", tabId: msg.tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#2e7d32", tabId: msg.tabId });

    // Clear badge after 3 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "", tabId: msg.tabId });
    }, 3000);
  }
});
