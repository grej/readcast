chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getPageHTML") {
    sendResponse({ html: document.documentElement.outerHTML });
  }
  if (message.type === "getSelection") {
    sendResponse({ text: window.getSelection()?.toString() || "" });
  }
});
