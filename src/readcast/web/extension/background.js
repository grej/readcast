const DEFAULT_SERVER = "http://127.0.0.1:8765";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "readcast-add-selection",
    title: "Add selection to Readcast",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "readcast-add-page",
    title: "Add page to Readcast",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const server = await getServer();

  if (info.menuItemId === "readcast-add-selection" && info.selectionText) {
    await addToReadcast(server, { input: info.selectionText, source_url: tab?.url });
    return;
  }

  if (info.menuItemId === "readcast-add-page" && tab?.id) {
    try {
      // Try smart extraction via content script
      const extracted = await chrome.tabs.sendMessage(tab.id, { type: "extractArticle" });

      if (extracted?.formattedText) {
        await addToReadcast(server, {
          input: extracted.formattedText,
          source_url: tab.url,
          author: extracted.author || undefined,
          published_date: extracted.published_date || undefined,
        });
        return;
      }

      // Fall back to URL + HTML
      const htmlResponse = await chrome.tabs.sendMessage(tab.id, { type: "getPageHTML" });
      await addToReadcast(server, {
        input: tab.url,
        html: htmlResponse?.html || null,
      });
    } catch {
      await addToReadcast(server, { input: tab.url });
    }
  }
});

async function addToReadcast(server, payload) {
  try {
    const response = await fetch(`${server}/api/articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, process: true }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error("Readcast error:", data.detail || response.statusText);
    }
  } catch (err) {
    console.error("Readcast: could not connect to server", err);
  }
}

async function getServer() {
  const result = await chrome.storage.local.get("readcastServer");
  return result.readcastServer || DEFAULT_SERVER;
}
