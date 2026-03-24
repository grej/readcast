const DEFAULT_SERVER = "http://127.0.0.1:8765";

const $ = (id) => document.getElementById(id);
let currentTab = null;
let serverUrl = DEFAULT_SERVER;
let currentPlugin = null;
let pluginOptionDefs = [];
let selectionText = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Load server URL
  const stored = await chrome.storage.local.get("readcastServer");
  serverUrl = stored.readcastServer || DEFAULT_SERVER;
  $("serverInput").value = serverUrl;

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  renderPageCard(tab);

  // Run init checks in parallel
  const checks = [
    checkServer(),
    checkSelection(tab),
    checkActivePlugin(tab),
    loadRecentArticles(),
  ];
  await Promise.allSettled(checks);

  // Wire up event listeners
  $("saveBtn").addEventListener("click", () => handleTriage(false));
  $("listenBtn").addEventListener("click", () => handleTriage(true));
  $("tagsToggle").addEventListener("click", toggleTags);
  $("serverInput").addEventListener("change", handleServerChange);
  $("doneBtn").addEventListener("click", () => window.close());
  $("logoLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: serverUrl });
  });
});

// --- Rendering ---

function renderPageCard(tab) {
  $("contentTitle").textContent = tab?.title || "Unknown page";
  $("contentDomain").textContent = domainFrom(tab?.url);
}

function renderSelectionCard(text) {
  $("contentLabel").className = "content-label selection";
  $("contentLabelText").textContent = "Selection detected";
  $("contentTitle").style.display = "none";
  $("contentDomain").style.display = "none";
  $("selectionQuote").textContent = text;
  $("selectionQuote").style.display = "block";
  $("selectionSource").textContent = `From ${domainFrom(currentTab?.url)}`;
  $("selectionSource").style.display = "block";
}

function renderPluginCard(plugin) {
  $("contentLabel").className = "content-label plugin";
  $("contentLabelText").textContent = `${plugin} plugin`;
  $("contentTitle").textContent = `Brief ${plugin}`;
  $("contentDomain").textContent = domainFrom(currentTab?.url);
  $("saveBtn").querySelector(".btn-label").textContent = `Brief ${plugin}`;
  $("tagsSection").style.display = "none";
  $("pluginOptions").style.display = "block";
}

// --- Plugin options ---

function renderPluginOptions(options) {
  pluginOptionDefs = options;
  const container = $("pluginOptions");
  container.innerHTML = "";
  if (!options.length) return;

  for (const opt of options) {
    const row = document.createElement("div");
    row.className = "opt-row";
    row.dataset.optId = opt.id;

    if (opt.label) {
      const label = document.createElement("div");
      label.className = "opt-label";
      label.textContent = opt.label;
      row.appendChild(label);
    }

    if (opt.type === "select") {
      const group = document.createElement("div");
      group.className = "opt-select";
      group.dataset.optId = opt.id;
      for (const choice of opt.choices) {
        const btn = document.createElement("button");
        btn.textContent = choice;
        btn.dataset.value = choice;
        if (choice === opt.default) btn.classList.add("active");
        btn.addEventListener("click", () => {
          group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          updateOptionVisibility();
        });
        group.appendChild(btn);
      }
      row.appendChild(group);
    } else if (opt.type === "slider") {
      const slider = document.createElement("div");
      slider.className = "opt-slider";
      const input = document.createElement("input");
      input.type = "range";
      input.min = opt.min;
      input.max = opt.max;
      input.value = opt.default;
      input.dataset.optId = opt.id;
      const valueLabel = document.createElement("span");
      valueLabel.className = "opt-slider-value";
      valueLabel.textContent = opt.default;
      input.addEventListener("input", () => {
        valueLabel.textContent = input.value;
      });
      slider.appendChild(input);
      slider.appendChild(valueLabel);
      row.appendChild(slider);
    } else if (opt.type === "toggle") {
      const toggleRow = document.createElement("div");
      toggleRow.className = "opt-toggle-row";
      const toggle = document.createElement("label");
      toggle.className = "opt-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = opt.default !== false;
      input.dataset.optId = opt.id;
      const track = document.createElement("span");
      track.className = "track";
      toggle.appendChild(input);
      toggle.appendChild(track);
      const text = document.createElement("span");
      text.textContent = opt.label || "";
      toggleRow.appendChild(toggle);
      toggleRow.appendChild(text);
      // For toggles the label is inline, remove the block label above
      const blockLabel = row.querySelector(".opt-label");
      if (blockLabel) blockLabel.remove();
      row.appendChild(toggleRow);
    }

    container.appendChild(row);
  }

  updateOptionVisibility();
}

function updateOptionVisibility() {
  for (const opt of pluginOptionDefs) {
    if (!opt.showWhen) continue;
    const row = $("pluginOptions").querySelector(`.opt-row[data-opt-id="${opt.id}"]`);
    if (!row) continue;
    // Find the select that controls visibility (first select option in the list)
    const selectEl = $("pluginOptions").querySelector(".opt-select");
    if (!selectEl) continue;
    const activeBtn = selectEl.querySelector("button.active");
    const currentValue = activeBtn?.dataset.value || "";
    row.style.display = currentValue === opt.showWhen ? "" : "none";
  }
}

function collectPluginOptions() {
  const opts = {};
  for (const opt of pluginOptionDefs) {
    if (opt.type === "select") {
      const group = $("pluginOptions").querySelector(`.opt-select[data-opt-id="${opt.id}"]`);
      const active = group?.querySelector("button.active");
      opts[opt.id] = active?.dataset.value || opt.default;
    } else if (opt.type === "slider") {
      const input = $("pluginOptions").querySelector(`input[type="range"][data-opt-id="${opt.id}"]`);
      opts[opt.id] = parseInt(input?.value || opt.default, 10);
    } else if (opt.type === "toggle") {
      const input = $("pluginOptions").querySelector(`input[type="checkbox"][data-opt-id="${opt.id}"]`);
      opts[opt.id] = input?.checked ?? opt.default;
    }
  }
  return opts;
}

function showSuccess(title, snippet, withAudio) {
  $("mainView").style.display = "none";
  $("successView").style.display = "block";
  $("successTitle").textContent = title;
  $("successSnippet").textContent = snippet;
  if (withAudio) {
    $("successEstimate").textContent = "Audio will be ready in ~3 min";
    $("successEstimate").style.display = "block";
  } else {
    $("successEstimate").style.display = "none";
  }
}

function showError(message) {
  const banner = $("errorBanner");
  banner.textContent = message;
  banner.style.display = "block";
}

function domainFrom(url) {
  try { return new URL(url).hostname; }
  catch { return url || ""; }
}

// --- Init checks ---

async function checkServer() {
  const dot = $("statusDot");
  const text = $("statusText");
  dot.className = "status-dot checking";
  text.textContent = "Checking…";

  try {
    const response = await fetch(`${serverUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const data = await response.json();
      const ready = data.kokoro_edge?.ready;
      dot.className = `status-dot ${ready ? "connected" : "checking"}`;
      text.textContent = ready ? "Ready" : "Connecting";
      $("saveBtn").disabled = false;
      $("listenBtn").disabled = false;
      return;
    }
  } catch {
    // not reachable
  }
  dot.className = "status-dot";
  text.textContent = "Offline";
  showError("Server offline — start with: pixi run readcast web");
}

async function checkSelection(tab) {
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "getSelection" });
    const text = response?.text?.trim();
    if (text) {
      selectionText = text;
      renderSelectionCard(text);
    }
  } catch {
    // content script not loaded
  }
}

async function checkActivePlugin(tab) {
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "getActivePlugin" });
    if (response?.plugin) {
      currentPlugin = response.plugin;
      renderPluginCard(response.plugin);
      // Fetch and render plugin-declared options
      try {
        const optResp = await chrome.tabs.sendMessage(tab.id, {
          type: "getPluginOptions", plugin: response.plugin,
        });
        renderPluginOptions(optResp?.options || []);
      } catch {
        // plugin has no options
      }
    }
  } catch {
    // content script not loaded
  }
}

async function loadRecentArticles() {
  try {
    const response = await fetch(`${serverUrl}/api/articles`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    const data = await response.json();
    const articles = (data.articles || []).slice(0, 5);
    if (!articles.length) return;

    const list = $("recentList");
    list.innerHTML = "";
    for (const article of articles) {
      const item = document.createElement("div");
      item.className = "recent-item";
      const title = document.createElement("span");
      title.className = "recent-title";
      title.textContent = article.title;
      const badge = document.createElement("span");
      const status = article.status || "added";
      badge.className = `recent-badge ${status}`;
      badge.textContent = statusLabel(status);
      item.appendChild(title);
      item.appendChild(badge);
      list.appendChild(item);
    }
    $("recentSection").style.display = "block";

    // Auto-refresh if in-progress
    if (articles.some((a) => a.status === "queued" || a.status === "synthesizing")) {
      setTimeout(loadRecentArticles, 2000);
    }
  } catch {
    // server not available
  }
}

function statusLabel(status) {
  const labels = { done: "Done", queued: "Queued", synthesizing: "Processing", failed: "Failed", added: "Saved" };
  return labels[status] || status;
}

// --- Tags ---

function toggleTags() {
  const input = $("tagsInput");
  const arrow = $("tagsArrow");
  const isOpen = input.classList.contains("visible");
  input.classList.toggle("visible");
  arrow.classList.toggle("open");
  if (!isOpen) input.focus();
}

// --- Triage handlers ---

async function handleTriage(withAudio) {
  const btn = withAudio ? $("listenBtn") : $("saveBtn");
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  // Disable the other button too
  const otherBtn = withAudio ? $("saveBtn") : $("listenBtn");
  otherBtn.disabled = true;

  try {
    if (currentPlugin) {
      await handlePlugin(withAudio);
    } else if (selectionText) {
      await handleSelection(withAudio);
    } else {
      await handlePage(withAudio);
    }
  } catch (err) {
    showError(err.message);
    btn.innerHTML = origHTML;
    btn.disabled = false;
    otherBtn.disabled = false;
  }
}

async function handlePlugin(withAudio) {
  const opts = collectPluginOptions();
  const scraped = await chrome.tabs.sendMessage(currentTab.id, {
    type: "scrapePlugin", plugin: currentPlugin, options: opts,
  });
  const data = scraped?.data || [];
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "runPlugin", plugin: currentPlugin, data, process: withAudio },
      (resp) => resp ? resolve(resp) : reject(new Error("No response from background")),
    );
  });
  if (!response.success) throw new Error(response.error || "Plugin failed");

  const label = data.comments?.length !== undefined
    ? `${data.comments.length} comments`
    : data.length !== undefined ? `${data.length} items` : "data";
  const title = withAudio ? "Queued for Audio" : "Saved to Knowledge Base";
  showSuccess(title, `Briefed ${currentPlugin}: ${label}`, withAudio);
}

async function handleSelection(withAudio) {
  const tags = getTags();
  await addArticle({ input: selectionText, process: withAudio, ...tags });
  const snippet = selectionText.length > 80 ? selectionText.slice(0, 80) + "…" : selectionText;
  const title = withAudio ? "Queued for Audio" : "Saved to Knowledge Base";
  showSuccess(title, snippet, withAudio);
}

async function handlePage(withAudio) {
  const tags = getTags();

  // Try smart extraction via content script
  let extracted = null;
  if (currentTab?.id) {
    try {
      extracted = await chrome.tabs.sendMessage(currentTab.id, { type: "extractArticle" });
    } catch {
      // not available
    }
  }

  if (extracted?.formattedText) {
    await addArticle({
      input: extracted.formattedText,
      source_url: currentTab.url,
      author: extracted.author || undefined,
      published_date: extracted.published_date || undefined,
      process: withAudio,
      ...tags,
    });
  } else {
    // Get rendered HTML and send URL + HTML
    let html = null;
    if (currentTab?.id) {
      try {
        const resp = await chrome.tabs.sendMessage(currentTab.id, { type: "getPageHTML" });
        html = resp?.html || null;
      } catch {
        // fall back to URL-only
      }
    }
    await addArticle({ input: currentTab.url, html, process: withAudio, ...tags });
  }

  const snippet = currentTab?.title || currentTab?.url || "";
  const title = withAudio ? "Queued for Audio" : "Saved to Knowledge Base";
  showSuccess(title, snippet, withAudio);
}

function getTags() {
  const raw = $("tagsInput").value.trim();
  if (!raw) return {};
  return { tags: raw.split(",").map((t) => t.trim()).filter(Boolean) };
}

// --- API ---

async function addArticle(payload) {
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
      // ignore
    }
    throw new Error(detail);
  }
  return response.json();
}

// --- Settings ---

async function handleServerChange() {
  const value = $("serverInput").value.trim().replace(/\/+$/, "");
  if (value) {
    serverUrl = value;
    await chrome.storage.local.set({ readcastServer: value });
    $("saveBtn").disabled = true;
    $("listenBtn").disabled = true;
    await checkServer();
  }
}
