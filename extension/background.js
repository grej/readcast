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

// -- Plugin execution --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "runPlugin") {
    handleRunPlugin(message.plugin, message.data, message.process).then(sendResponse);
    return true; // async response
  }
});

async function handleRunPlugin(pluginName, scrapedData, process = true) {
  const server = await getServer();
  try {
    const response = await fetch(`${server}/api/plugins/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plugin_name: pluginName,
        scraped_data: scrapedData,
        process: process,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.detail || `Server error (${response.status})` };
    }
    const result = await response.json();
    return { success: true, analysis: result.analysis, article_id: result.article_id };
  } catch (err) {
    return { success: false, error: "Could not connect to readcast server" };
  }
}

async function getServer() {
  const result = await chrome.storage.local.get("readcastServer");
  return result.readcastServer || DEFAULT_SERVER;
}
