// Badge management for content scripts and popup
chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id || message.tabId;
  if (!tabId) return;

  switch (message.type) {
    case "VIDEO_PAGE_DETECTED":
      chrome.action.setBadgeText({ tabId, text: " " });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#d4430e" });
      break;
    case "BOOK_PAGE_DETECTED":
      chrome.action.setBadgeText({ tabId, text: " " });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#d4430e" });
      break;
    default:
      chrome.action.setBadgeText({ tabId, text: "" });
      break;
  }
});
