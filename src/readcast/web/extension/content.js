// Store selection before it's lost when popup opens
let lastSelection = "";
document.addEventListener("selectionchange", () => {
  const text = window.getSelection()?.toString()?.trim();
  if (text) {
    lastSelection = text;
  }
});

// -- Plugin system -----------------------------------------------------------

const PLUGIN_MATCHES = [
  { name: "gmail", patterns: ["*://mail.google.com/*"], hostCheck: (h) => h === "mail.google.com" },
];

let activePlugin = null;

function checkPlugins() {
  const host = window.location.hostname;
  for (const plugin of PLUGIN_MATCHES) {
    if (plugin.hostCheck(host)) {
      activePlugin = plugin.name;
      return;
    }
  }
}

// Run plugin check after a short delay to let plugin scripts register
setTimeout(checkPlugins, 100);

// -- Message listeners -------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getPageHTML") {
    sendResponse({ html: document.documentElement.outerHTML });
  }
  if (message.type === "getSelection") {
    const current = window.getSelection()?.toString()?.trim();
    sendResponse({ text: current || lastSelection });
  }
  if (message.type === "extractArticle") {
    sendResponse(extractArticle());
  }
  if (message.type === "getActivePlugin") {
    sendResponse({ plugin: activePlugin });
  }
  if (message.type === "scrapePlugin") {
    const plugin = globalThis.__readcastPlugins?.[message.plugin];
    if (plugin && typeof plugin.scrape === "function") {
      sendResponse({ data: plugin.scrape(message.limit) });
    } else {
      sendResponse({ data: null });
    }
  }
  return true; // keep message channel open for async
});

function extractArticle() {
  const url = window.location.href;
  const host = window.location.hostname;

  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    return extractTwitterArticle(url);
  }

  return extractGenericArticle(url);
}

function extractTwitterArticle(url) {
  const result = { url, source: "twitter" };

  const titleEl = document.querySelector('[data-testid="twitter-article-title"]');
  if (titleEl) {
    result.title = titleEl.textContent.trim();
  }

  const userNameEl = document.querySelector('[data-testid="User-Name"]');
  if (userNameEl) {
    const displayName = userNameEl.querySelector("a span span")?.textContent?.trim();
    const links = userNameEl.querySelectorAll("a");
    let handleText = "";
    for (const a of links) {
      const h = a.textContent.trim();
      if (h.startsWith("@")) {
        handleText = h;
        break;
      }
    }
    result.author = displayName || "";
    result.handle = handleText;
  }

  const bodyEl = document.querySelector('[data-testid="twitterArticleRichTextView"]');
  if (bodyEl) {
    const parts = [];
    const blocks = bodyEl.querySelectorAll("[data-block]");
    for (const block of blocks) {
      const isHeader = block.closest("h2, h3") || block.closest(".longform-header-two");
      const textSpans = block.querySelectorAll('[data-text="true"]');
      let blockText = "";
      for (const span of textSpans) {
        blockText += span.textContent;
      }
      blockText = blockText.trim();
      if (!blockText) continue;

      if (isHeader) {
        parts.push("\n## " + blockText + "\n");
      } else {
        parts.push(blockText);
      }
    }
    result.text = parts.join("\n\n");
  }

  // Fallback: regular tweets/threads
  if (!result.text) {
    const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
    const parts = [];
    for (const el of tweetTexts) {
      const text = el.textContent.trim();
      if (text) parts.push(text);
    }
    result.text = parts.join("\n\n");
  }

  const timeEl = document.querySelector("time[datetime]");
  if (timeEl) {
    result.published_date = timeEl.getAttribute("datetime");
  }

  if (result.text) {
    let formatted = "";
    if (result.title) formatted += result.title + "\n\n";
    if (result.author) {
      formatted += "By " + result.author;
      if (result.handle) formatted += " (" + result.handle + ")";
      formatted += "\n\n";
    }
    formatted += result.text;
    result.formattedText = formatted;
  }

  return result;
}

function extractGenericArticle(url) {
  return { url, source: "web" };
}
