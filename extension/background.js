// Badge management for content scripts
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) return;
  const tabId = sender.tab.id;

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
