const DEFAULT_SERVER = "http://127.0.0.1:8765";

const $ = (id) => document.getElementById(id);
let currentTab = null;
let serverUrl = DEFAULT_SERVER;

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved server URL
  const stored = await chrome.storage.local.get("readcastServer");
  serverUrl = stored.readcastServer || DEFAULT_SERVER;
  $("serverInput").value = serverUrl;

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  $("pageTitle").textContent = tab?.title || "Unknown page";
  $("pageUrl").textContent = tab?.url || "";

  // Check server connectivity
  await checkServer();

  // Check for text selection on the page
  if (tab?.id) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || "",
      });
      if (result?.result?.trim()) {
        $("addSelectionBtn").disabled = false;
        $("addSelectionBtn").title = `Add selected text (${result.result.trim().length} chars)`;
      }
    } catch {
      // Can't access this page (e.g. chrome:// URLs)
    }
  }

  // Event listeners
  $("addPageBtn").addEventListener("click", handleAddPage);
  $("addSelectionBtn").addEventListener("click", handleAddSelection);
  $("serverInput").addEventListener("change", handleServerChange);
});

async function checkServer() {
  const dot = $("statusDot");
  const text = $("statusText");
  dot.className = "status-dot checking";
  text.textContent = "Checking...";

  try {
    const response = await fetch(`${serverUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json();
      const kokoroReady = data.kokoro_edge?.ready;
      dot.className = `status-dot ${kokoroReady ? "connected" : "checking"}`;
      text.textContent = kokoroReady ? "Ready" : "Server up, TTS warming";
      $("addPageBtn").disabled = false;
      return true;
    }
  } catch {
    // Server not reachable
  }

  dot.className = "status-dot";
  text.textContent = "Offline";
  showFeedback("Start readcast server first: pixi run readcast web", "error");
  return false;
}

async function handleAddPage() {
  if (!currentTab?.url) return;
  const btn = $("addPageBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  try {
    // Try to get rendered HTML from the page
    let html = null;
    if (currentTab.id) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => document.documentElement.outerHTML,
        });
        html = result?.result || null;
      } catch {
        // Fall back to URL-only
      }
    }

    const tags = parseTags($("tagsInput").value);
    await addToReadcast({
      input: currentTab.url,
      html,
      process: true,
      ...(tags.length ? {} : {}),
    });

    showFeedback("Added to Readcast!", "success");
    btn.textContent = "Added";
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    showFeedback(err.message, "error");
    btn.textContent = "Add Page";
    btn.disabled = false;
  }
}

async function handleAddSelection() {
  if (!currentTab?.id) return;
  const btn = $("addSelectionBtn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => window.getSelection()?.toString() || "",
    });
    const text = result?.result?.trim();
    if (!text) {
      showFeedback("No text selected on the page.", "error");
      btn.textContent = "Add Selection";
      btn.disabled = false;
      return;
    }

    await addToReadcast({ input: text, process: true });
    showFeedback("Selection added!", "success");
    btn.textContent = "Added";
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    showFeedback(err.message, "error");
    btn.textContent = "Add Selection";
    btn.disabled = false;
  }
}

async function handleServerChange() {
  const value = $("serverInput").value.trim().replace(/\/+$/, "");
  if (value) {
    serverUrl = value;
    await chrome.storage.local.set({ readcastServer: value });
    $("addPageBtn").disabled = true;
    await checkServer();
  }
}

async function addToReadcast(payload) {
  const response = await fetch(`${serverUrl}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = `Server error (${response.status})`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // ignore parse error
    }
    throw new Error(detail);
  }

  return response.json();
}

function parseTags(value) {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function showFeedback(message, type) {
  const el = $("feedback");
  el.textContent = message;
  el.className = `feedback ${type}`;
  el.style.display = "block";
}
