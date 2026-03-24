import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ─── Constants ──────────────────────────────────────────────
const PLAYBACK_RATES = [1.0, 1.25, 1.5, 1.75, 2.0];

// ─── Utility functions ──────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function voiceLabel(name) {
  const parts = String(name || "").split("_");
  const displayName = parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : name;
  const accent = String(name || "").startsWith("b") ? "GB" : "US";
  const gender = String(name || "").charAt(1) === "f" ? "♀" : "♂";
  return `${displayName} ${gender} · ${accent}`;
}

function sourceLabel(article) {
  return article.source || article.publication || article.source_url || article.source_file || "Pasted Text";
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// ─── API helpers ────────────────────────────────────────────
async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { const data = await response.json(); detail = data.detail || detail; } catch {}
    throw new Error(detail);
  }
  return response.json();
}

async function apiJson(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { const data = await response.json(); detail = data.detail || detail; } catch {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

// ─── Design tokens ──────────────────────────────────────────
const font = {
  sans: "'DM Sans', 'Avenir Next', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
  serif: "'Source Serif 4', Georgia, serif",
};

const c = {
  bg: "#0c0d12",
  bgDeep: "#08090d",
  surface: "#13151d",
  surfaceRaised: "#1a1d27",
  surfaceHover: "#1e2130",
  border: "#222538",
  borderLight: "#2c3048",
  text: "#e4e5ea",
  textSecondary: "#a0a4b8",
  textMuted: "#6b7084",
  textDim: "#464b5e",
  accent: "#6c8cff",
  accentDim: "rgba(108,140,255,0.10)",
  accentMed: "rgba(108,140,255,0.20)",
  green: "#4ade80",
  greenDim: "rgba(74,222,128,0.10)",
  amber: "#f59e0b",
  amberDim: "rgba(245,158,11,0.10)",
  purple: "#a78bfa",
  purpleDim: "rgba(167,139,250,0.10)",
  red: "#f87171",
  redDim: "rgba(248,113,113,0.10)",
  cyan: "#22d3ee",
  cyanDim: "rgba(34,211,238,0.10)",
};

const globalStyles = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${c.bgDeep}; color: ${c.text}; }
::selection { background: rgba(108, 140, 255, 0.3); }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${c.border}; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: ${c.borderLight}; }
textarea::placeholder, input::placeholder { color: ${c.textDim}; }
span[title="Click to edit"]:hover { border-bottom-color: ${c.textMuted} !important; }
div[style]:hover > button[aria-label="Remove paragraph"] { color: ${c.red}88 !important; }
div[style]:hover > button[aria-label="Remove paragraph"]:hover { color: ${c.red} !important; }
`;

// ─── Shared style objects ───────────────────────────────────
const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24,
};
const modalInner = {
  background: c.surfaceRaised, border: `1px solid ${c.borderLight}`, borderRadius: 16,
  padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto",
};
const modalTitle = { fontFamily: font.serif, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: c.text };
const closeBtn = { background: "none", border: "none", color: c.textMuted, fontSize: 18, cursor: "pointer", padding: "4px 8px" };
const fieldLabel = { display: "block", fontSize: 12, fontWeight: 600, color: c.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, marginTop: 16 };
const secondaryBtn = { padding: "10px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.bg, color: c.text, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" };
const secondaryBtnActive = { ...secondaryBtn, border: `1px solid ${c.accent}`, background: c.accentDim, color: c.accent };
const dangerBtn = { padding: "10px 14px", borderRadius: 8, border: "none", background: "#b14c46", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };
const voiceChipBase = { padding: "6px 12px", borderRadius: 6, border: `1px solid ${c.border}`, background: c.bg, color: c.textMuted, fontSize: 12, fontFamily: font.sans, cursor: "pointer" };
const voiceChipActive = { ...voiceChipBase, background: c.accentDim, borderColor: c.accent, color: c.accent };

// ─── Time & filter helpers ──────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function withinRange(dateStr, range) {
  if (range === "all") return true;
  if (!dateStr) return false;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (range === "7d") return days <= 7;
  if (range === "30d") return days <= 30;
  return true;
}

function buildTagIndex(articles) {
  const index = {};
  articles.forEach((a) => {
    (a.tags || []).forEach((t) => {
      if (!index[t]) index[t] = { tag: t, count: 0, isProject: t.startsWith("project:") };
      index[t].count++;
    });
  });
  return Object.values(index).sort((a, b) => {
    if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
    return b.count - a.count;
  });
}

function findSimilar(doc, allDocs) {
  const docTags = doc.tags || [];
  if (docTags.length === 0) return [];
  return allDocs
    .filter((d) => d.id !== doc.id)
    .map((d) => {
      const tags = d.tags || [];
      const tagOverlap = tags.filter((t) => docTags.includes(t)).length;
      const projectMatch = tags.some((t) => t.startsWith("project:") && docTags.includes(t)) ? 0.15 : 0;
      const score = Math.min(0.99, tagOverlap * 0.18 + projectMatch);
      return { ...d, score };
    })
    .filter((d) => d.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// ─── Status helpers ─────────────────────────────────────────
function statusColor(status) {
  if (status === "done" || status === "added") return c.green;
  if (status === "queued" || status === "synthesizing") return c.amber;
  if (status === "failed") return c.red;
  return c.textDim;
}

function statusLabel(status) {
  const map = { done: "done", added: "saved", queued: "queued", synthesizing: "processing", failed: "failed" };
  return map[status] || status || "unknown";
}

function statusBg(status) {
  if (status === "done" || status === "added") return c.greenDim;
  if (status === "queued" || status === "synthesizing") return c.amberDim;
  if (status === "failed") return c.redDim;
  return c.bg;
}

// ─── SVG Icons ──────────────────────────────────────────────
function PlayIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>;
}
function SearchIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>;
}
function PlusIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
function CheckIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}
function TrashIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
}
function WaveformIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.5"><rect x="2" y="8" width="3" height="8" rx="1" /><rect x="7" y="4" width="3" height="16" rx="1" /><rect x="12" y="6" width="3" height="12" rx="1" /><rect x="17" y="9" width="3" height="6" rx="1" /></svg>;
}
function SpinnerIcon() {
  return <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.2)", borderTop: `2px solid ${c.text}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />;
}
function ExtensionIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 3.5a2.5 2.5 0 015 0V5h-5zM3.5 13.5a2.5 2.5 0 010-5H5v5z" /><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}
function DownloadIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M5 12l7 7 7-7" /><path d="M5 20h14" /></svg>;
}

// ─── Small UI Components ────────────────────────────────────
function FilterChip({ tag, onRemove }) {
  const isProject = tag.startsWith("project:");
  const display = isProject ? tag.replace("project:", "") : tag;
  const chipColor = isProject ? c.purple : c.accent;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 5px 3px 9px", borderRadius: 6, background: isProject ? c.purpleDim : c.accentDim, color: chipColor, border: `1px solid ${chipColor}33`, fontSize: 11, fontWeight: 500 }}>
      {isProject && <span style={{ fontSize: 9, opacity: 0.6 }}>⬡</span>}
      {display}
      <span
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ width: 16, height: 16, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 10, color: chipColor }}
        onMouseEnter={(e) => e.target.style.background = `${chipColor}22`}
        onMouseLeave={(e) => e.target.style.background = "transparent"}
      >×</span>
    </span>
  );
}

function StatusDot({ status }) {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(status), display: "inline-block", flexShrink: 0 }} />;
}

function StatusBadge({ status }) {
  const col = statusColor(status);
  return <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 4, color: col, background: statusBg(status), border: `1px solid ${col}22` }}>{statusLabel(status)}</span>;
}

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return null;
  const pct = Math.round(score * 100);
  const color = pct > 60 ? c.green : pct > 30 ? c.amber : c.textDim;
  return (
    <span style={{ fontSize: 10, fontFamily: font.mono, fontWeight: 600, color, padding: "2px 6px", borderRadius: 4, background: `${color}15`, border: `1px solid ${color}22`, minWidth: 36, textAlign: "center", display: "inline-block" }}>
      .{String(pct).padStart(2, "0")}
    </span>
  );
}

// ─── Tag Dropdown ───────────────────────────────────────────
function TagDropdown({ allTags, activeFilters, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const available = allTags.filter((t) =>
    !activeFilters.includes(t.tag) &&
    (query === "" || t.tag.toLowerCase().includes(query.toLowerCase()))
  );
  const projectTags = available.filter((t) => t.isProject);
  const topicTags = available.filter((t) => !t.isProject);

  return (
    <div style={{ position: "absolute", top: "100%", left: 0, width: 240, background: c.surfaceRaised, border: `1px solid ${c.borderLight}`, borderRadius: 10, marginTop: 4, zIndex: 50, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", maxHeight: 300, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${c.border}` }}>
        <input
          ref={ref} type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && available.length > 0) { onAdd(available[0].tag); setQuery(""); }
          }}
          placeholder="Search tags..."
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.border}`, background: c.bg, color: c.text, fontSize: 12, fontFamily: font.sans, outline: "none", boxSizing: "border-box" }}
        />
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {projectTags.length > 0 && <>
          <div style={{ padding: "8px 12px 4px", fontSize: 9, fontWeight: 700, color: c.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Projects</div>
          {projectTags.map((t) => <TagItem key={t.tag} tag={t} onAdd={onAdd} />)}
        </>}
        {topicTags.length > 0 && <>
          <div style={{ padding: "8px 12px 4px", fontSize: 9, fontWeight: 700, color: c.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>Topics</div>
          {topicTags.map((t) => <TagItem key={t.tag} tag={t} onAdd={onAdd} />)}
        </>}
        {available.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: c.textDim, textAlign: "center" }}>
            {query ? "No matches" : "All tags active"}
          </div>
        )}
      </div>
    </div>
  );
}

function TagItem({ tag, onAdd }) {
  const [h, setH] = useState(false);
  const display = tag.isProject ? tag.tag.replace("project:", "") : tag.tag;
  return (
    <div
      onClick={() => onAdd(tag.tag)}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", cursor: "pointer", background: h ? c.surfaceHover : "transparent", transition: "background 0.08s" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {tag.isProject && <span style={{ fontSize: 10, color: c.purple, opacity: 0.5 }}>⬡</span>}
        <span style={{ fontSize: 12, color: h ? c.text : c.textSecondary }}>{display}</span>
      </div>
      <span style={{ fontSize: 10, color: c.textDim, padding: "1px 6px", borderRadius: 3, background: c.bg }}>{tag.count}</span>
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────
function DeleteConfirmPanel({ count, deleting, onConfirm, onClose }) {
  return (
    <div style={modalOverlay}>
      <div style={{ ...modalInner, maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={modalTitle}>Delete {count} {count === 1 ? "article" : "articles"}?</h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <p style={{ color: c.textMuted, fontSize: 14, lineHeight: 1.6 }}>
          This deletes the full record and any generated audio for the selected {count === 1 ? "article" : "articles"}. This cannot be undone.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={secondaryBtn} disabled={deleting}>Cancel</button>
          <button onClick={onConfirm} style={{ ...dangerBtn, opacity: deleting ? 0.6 : 1 }} disabled={deleting}>
            {deleting ? <SpinnerIcon /> : <><TrashIcon size={15} /><span>Delete</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

const BROWSERS = {
  chrome:  { name: "Chrome",  url: "chrome://extensions" },
  brave:   { name: "Brave",   url: "brave://extensions" },
  edge:    { name: "Edge",    url: "edge://extensions" },
  opera:   { name: "Opera",   url: "opera://extensions" },
  vivaldi: { name: "Vivaldi", url: "vivaldi://extensions" },
};

function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Brave")) return "brave";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "opera";
  if (ua.includes("Vivaldi")) return "vivaldi";
  if (ua.includes("Chrome/")) return "chrome";
  return "chrome";
}

function ExtensionPanel({ onClose }) {
  const [browser, setBrowser] = useState(detectBrowser);
  const info = BROWSERS[browser] || BROWSERS.chrome;

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={modalOverlay} role="presentation">
      <div style={modalInner} role="dialog" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={modalTitle}>Browser Extension</h2>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
          {Object.entries(BROWSERS).map(([key, b]) => (
            <button key={key} onClick={() => setBrowser(key)} style={browser === key ? voiceChipActive : voiceChipBase}>{b.name}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.accentDim, color: c.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.text }}>Download the extension</div>
            <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.5 }}>
              <a href="/api/extension.zip" download style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, border: "none", background: c.accent, color: c.bgDeep, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer", textDecoration: "none" }}>
                <DownloadIcon size={15} /><span>Download Extension</span>
              </a>
              <div style={{ marginTop: 8 }}>Unzip the file after downloading.</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.accentDim, color: c.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.text }}>Open your extensions page</div>
            <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.5 }}>
              Copy and paste this into your address bar:
              <div style={{ marginTop: 6 }}>
                <code style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, background: c.bg, fontFamily: font.mono, fontSize: 13, color: c.accent, letterSpacing: "0.02em", userSelect: "all" }}>{info.url}</code>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>Browsers block direct links to this page for security.</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.accentDim, color: c.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.text }}>Load the extension</div>
            <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.5 }}>
              Enable <strong>Developer mode</strong> (top-right toggle), click <strong>Load unpacked</strong>, and select the extracted <code style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, background: c.bg, fontFamily: font.mono, fontSize: 13, color: c.accent }}>readcast-extension</code> folder.
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: c.textMuted, lineHeight: 1.5 }}>
          The extension adds right-click menus to send any page or text selection to readcast.
        </div>
      </div>
    </div>
  );
}

function AddPanel({ voices, defaultVoice, onAdd, onPreview, onClose, onSaveDefaultVoice, error }) {
  const [inputValue, setInputValue] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handlePreview = async () => {
    if (!inputValue.trim()) return;
    setPreviewing(true);
    try { const result = await onPreview({ input: inputValue.trim() }); setPreview(result); }
    finally { setPreviewing(false); }
  };

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;
    setSubmitting(true);
    try { await onAdd({ input: inputValue.trim() }); }
    finally { setSubmitting(false); }
  };

  const handleDefaultVoiceChange = async (voiceName) => {
    if (!voiceName || voiceName === defaultVoice) { setShowVoicePicker(false); return; }
    setSavingDefault(true);
    try { await onSaveDefaultVoice(voiceName); setShowVoicePicker(false); }
    finally { setSavingDefault(false); }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") onClose();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); handleSubmit(); }
  };

  return (
    <div style={modalOverlay} role="presentation">
      <div style={modalInner} role="dialog" aria-modal="true" aria-labelledby="add-article-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 id="add-article-title" style={modalTitle}>New Article</h2>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        <label style={fieldLabel}>URL or text</label>
        <textarea
          ref={inputRef} value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setPreview(null); }}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/article or paste plain text..."
          rows={5}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.bg, color: c.text, fontSize: 14, fontFamily: font.sans, resize: "vertical", outline: "none", lineHeight: 1.5 }}
          aria-label="Article URL or pasted text"
        />

        <label style={fieldLabel}>Default voice</label>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.border}`, background: c.surface }}>
          <div>
            <div style={{ fontFamily: font.serif, fontSize: 16, fontWeight: 600, color: c.text }}>{voiceLabel(defaultVoice || "af_sky")}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: c.textMuted }}>New articles use this automatically.</div>
          </div>
          <button onClick={() => setShowVoicePicker((v) => !v)} style={showVoicePicker ? secondaryBtnActive : secondaryBtn} disabled={savingDefault}>
            {showVoicePicker ? "Hide voices" : "Change default"}
          </button>
        </div>

        {showVoicePicker && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {voices.map((v) => (
              <button key={v.name} onClick={() => handleDefaultVoiceChange(v.name)}
                style={{ ...voiceChipBase, ...(defaultVoice === v.name ? { background: c.accentDim, borderColor: c.accent, color: c.accent } : {}), opacity: savingDefault ? 0.6 : 1 }}
                disabled={savingDefault}
              >{voiceLabel(v.name)}</button>
            ))}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, border: `1px solid ${c.border}`, background: c.surface }}>
            <div style={{ fontFamily: font.serif, fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: c.text }}>{preview.article.title}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: c.textMuted, display: "flex", flexWrap: "wrap", alignItems: "center" }}>
              {preview.source}<span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
              {preview.article.estimated_read_min}m read<span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
              {preview.article.word_count} words
            </div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {preview.chunks.slice(0, 5).map((chunk) => (
                <p key={`${chunk.idx}-${chunk.chunk_type}`} style={{ fontSize: 13, color: c.textSecondary, lineHeight: 1.55 }}>{chunk.text}</p>
              ))}
            </div>
          </div>
        )}

        {error && <div style={{ marginTop: 14, color: c.red, fontSize: 13, lineHeight: 1.45 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button onClick={handlePreview} disabled={!inputValue.trim() || previewing}
            style={{ ...secondaryBtn, opacity: !inputValue.trim() || previewing ? 0.5 : 1 }}>
            {previewing ? <SpinnerIcon /> : preview ? "Refresh Preview" : "Preview"}
          </button>
          <button onClick={handleSubmit} disabled={!inputValue.trim() || submitting}
            style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: c.accent, color: c.bgDeep, fontSize: 14, fontWeight: 600, fontFamily: font.sans, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: !inputValue.trim() || submitting ? 0.5 : 1 }}>
            {submitting ? <SpinnerIcon /> : "Add & Process"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditableField ──────────────────────────────────────────
function EditableField({ value, placeholder, onSave, style: wrapStyle, inputStyle }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "").trim()) onSave(trimmed);
  };

  if (editing) {
    return (
      <input ref={inputRef} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } }}
        style={{ background: c.surface, border: `1px solid ${c.accent}`, borderRadius: 4, padding: "2px 6px", color: c.text, fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit", outline: "none", ...inputStyle }}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span onClick={() => setEditing(true)} style={{ borderBottom: "1px dashed transparent", transition: "border-color 0.15s", cursor: "pointer", ...wrapStyle }} title="Click to edit">
      {value || <span style={{ opacity: 0.3 }}>{placeholder}</span>}
    </span>
  );
}

// ─── Reading Pane ───────────────────────────────────────────
function ReadingPane({ article, articles, voices, onReprocess, onRefresh, onAddFilter, onFindSimilar, onPlay, onSelectDoc, activeId, isPlaying }) {
  const [fullText, setFullText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reprocessVoice, setReprocessVoice] = useState(article.voice || "");
  const [reprocessing, setReprocessing] = useState(false);
  const [removedIndices, setRemovedIndices] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [textModified, setTextModified] = useState(false);
  const [message, setMessage] = useState("");
  const [entities, setEntities] = useState([]);

  const paragraphs = useMemo(() => (fullText || "").split("\n\n").filter(Boolean), [fullText]);
  const activeParagraphs = useMemo(() => paragraphs.filter((_, i) => !removedIndices.has(i)), [paragraphs, removedIndices]);
  const liveWordCount = useMemo(() => activeParagraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0), [activeParagraphs]);

  useEffect(() => {
    setLoading(true);
    setRemovedIndices(new Set());
    setTextModified(false);
    setMessage("");
    setReprocessVoice(article.voice || "");
    apiGet(`/api/articles/${article.id}/text`)
      .then((data) => setFullText(data.text || ""))
      .catch(() => setFullText("(Could not load text)"))
      .finally(() => setLoading(false));
    apiGet(`/api/articles/${article.id}/entities`)
      .then((data) => setEntities(data.entities || []))
      .catch(() => setEntities([]));
  }, [article.id]);

  const handleMetaSave = async (field, value) => {
    try { await apiJson(`/api/articles/${article.id}`, "PUT", { [field]: value }); if (onRefresh) onRefresh(); } catch {}
  };

  const handleRemoveParagraph = (index) => { setRemovedIndices((prev) => new Set([...prev, index])); };
  const handleUndoRemove = (index) => { setRemovedIndices((prev) => { const next = new Set(prev); next.delete(index); return next; }); };

  const handleSaveText = async () => {
    setSaving(true);
    try {
      const newText = activeParagraphs.join("\n\n");
      await apiJson(`/api/articles/${article.id}/text`, "PUT", { text: newText });
      setFullText(newText);
      setRemovedIndices(new Set());
      setTextModified(true);
      setMessage("Text updated. Renarrate to update audio.");
      if (onRefresh) onRefresh();
    } catch (err) { setMessage("Failed to save: " + err.message); }
    finally { setSaving(false); }
  };

  const handleReprocess = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    try { await onReprocess(article.id, reprocessVoice); setTextModified(false); setMessage(""); }
    finally { setReprocessing(false); }
  };

  const isProcessingStatus = article.status === "queued" || article.status === "synthesizing";
  const isFailed = article.status === "failed";
  const hasAudio = !isProcessingStatus && !isFailed && article.audio_url;
  const canRenarrate = !isProcessingStatus && (!article.audio_url || reprocessVoice !== article.voice || textModified);
  const articleTags = article.tags || [];
  const wordCount = removedIndices.size > 0 ? liveWordCount : (article.word_count || liveWordCount);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 680 }}>
      {/* 1. Status + type + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <StatusBadge status={article.status} />
        <span style={{ fontSize: 11, color: c.textDim }}>{article.type || "article"}</span>
        <span style={{ color: c.textDim }}>·</span>
        <span style={{ fontSize: 11, color: c.textDim }}>{timeAgo(article.ingested_at)}</span>
        {article.listened_at && <>
          <span style={{ color: c.textDim }}>·</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: c.green, background: c.greenDim, padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>Listened</span>
        </>}
        {article.score != null && <>
          <span style={{ color: c.textDim }}>·</span>
          <ScoreBadge score={article.score} />
        </>}
      </div>

      {/* 2. Title */}
      <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: font.serif, color: c.text, lineHeight: 1.35, margin: "0 0 12px" }}>
        <EditableField value={article.title} placeholder="Title" onSave={(v) => handleMetaSave("title", v)} style={{ fontSize: 22, fontWeight: 700, fontFamily: font.serif }} inputStyle={{ fontSize: 22, fontWeight: 700, fontFamily: font.serif, width: "100%" }} />
      </h1>

      {/* 3. Meta */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.textMuted, marginBottom: 4, flexWrap: "wrap" }}>
        <span>{sourceLabel(article)}</span>
        <span style={{ color: c.textDim }}>·</span>
        <span style={{ fontFamily: font.mono, fontSize: 11, color: c.textDim }}>{(article.id || "").slice(0, 8)}</span>
        <span style={{ color: c.textDim }}>·</span>
        <span>{(wordCount || 0).toLocaleString()} words</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.textMuted, marginBottom: 12, flexWrap: "wrap" }}>
        <EditableField value={article.author} placeholder="Author" onSave={(v) => handleMetaSave("author", v)} />
        <span style={{ color: c.textDim }}>·</span>
        <EditableField value={article.publication} placeholder="Publication" onSave={(v) => handleMetaSave("publication", v)} />
        <span style={{ color: c.textDim }}>·</span>
        <EditableField value={article.published_date} placeholder="Date" onSave={(v) => handleMetaSave("published_date", v)} />
      </div>

      {/* 4. Source URL */}
      {article.source_url && (
        <a href={article.source_url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 12, color: c.accent, marginBottom: 16, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {article.source_url}
        </a>
      )}

      {/* 5. Tags */}
      {articleTags.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${c.border}` }}>
          {articleTags.map((t) => {
            const isP = t.startsWith("project:");
            const display = isP ? t.replace("project:", "") : t;
            return (
              <span key={t} onClick={() => onAddFilter(t)} style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                background: isP ? c.purpleDim : c.accentDim, color: isP ? c.purple : c.accent,
                border: `1px solid ${(isP ? c.purple : c.accent) + "33"}`,
                cursor: "pointer", fontWeight: isP ? 600 : 400, transition: "all 0.1s",
              }}
                onMouseEnter={(e) => e.target.style.background = isP ? c.purple + "22" : c.accentMed}
                onMouseLeave={(e) => e.target.style.background = isP ? c.purpleDim : c.accentDim}
              >{isP ? "⬡ " : "#"}{display}</span>
            );
          })}
        </div>
      )}

      {/* 6. Entities */}
      {entities.length > 0 && (
        <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 11, color: c.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Entities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {entities.map((e) => (
              <span key={e.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: c.textSecondary, background: c.surface, padding: "3px 8px", borderRadius: 4 }} title={e.entity_type}>
                {e.name}
                <span style={{ fontSize: 10, color: c.textDim, fontStyle: "italic" }}>{e.entity_type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {isFailed && article.error_message && (
        <div style={{ fontSize: 12, color: c.red, padding: "8px 12px", background: c.redDim, borderRadius: 8, marginBottom: 12 }}>{article.error_message}</div>
      )}

      {/* Status message */}
      {message && <div style={{ fontSize: 12, color: c.accent, padding: "8px 12px", background: c.accentDim, borderRadius: 8, marginBottom: 12 }}>{message}</div>}

      {/* 7. Full article text */}
      <div style={{ borderRadius: 8, background: c.bg, padding: "16px 20px", marginBottom: 12 }}>
        {loading ? (
          <div style={{ color: c.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>Loading text...</div>
        ) : (
          <div style={{ fontFamily: font.serif, fontSize: 15, lineHeight: 1.7, color: c.text }}>
            {paragraphs.map((para, i) => {
              const removed = removedIndices.has(i);
              if (removed) {
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", marginBottom: 8 }}>
                    <span style={{ flex: 1, fontSize: 13, color: c.textMuted, textDecoration: "line-through", opacity: 0.5 }}>{para.slice(0, 80)}...</span>
                    <button onClick={() => handleUndoRemove(i)} style={{ background: "none", border: `1px solid ${c.border}`, borderRadius: 4, color: c.accent, fontSize: 11, fontWeight: 600, fontFamily: font.sans, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>Undo</button>
                  </div>
                );
              }
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, position: "relative" }}>
                  <button onClick={() => handleRemoveParagraph(i)} style={{ background: "none", border: "none", color: "rgba(248,113,113,0)", fontSize: 18, fontWeight: 700, cursor: "pointer", padding: "0 4px", lineHeight: "1.7", flexShrink: 0, transition: "color 0.15s" }} title="Remove this paragraph from narration" aria-label="Remove paragraph">×</button>
                  <p style={{ marginBottom: 14, flex: 1 }}>{para}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 8. Save bar */}
      {removedIndices.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", marginBottom: 12, background: c.surface, borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: c.textMuted }}>{removedIndices.size} paragraph{removedIndices.size > 1 ? "s" : ""} removed</span>
          <button onClick={handleSaveText} disabled={saving} style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: c.accent, color: c.bgDeep, fontSize: 12, fontWeight: 600, fontFamily: font.sans, cursor: "pointer", opacity: saving ? 0.5 : 1 }}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}

      {/* 9. Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => onFindSimilar(article)} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
          border: `1px solid ${c.cyan}33`, background: c.cyanDim, color: c.cyan,
          fontSize: 12, fontWeight: 500, fontFamily: font.sans, cursor: "pointer", transition: "all 0.12s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = c.cyan + "22"}
          onMouseLeave={(e) => e.currentTarget.style.background = c.cyanDim}
        >◎ Find Similar</button>

        {hasAudio && (
          <button onClick={() => onPlay(article)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
            border: `1px solid ${c.border}`, background: "transparent", color: c.textSecondary,
            fontSize: 12, fontWeight: 500, fontFamily: font.sans, cursor: "pointer",
          }}>
            {activeId === article.id && isPlaying ? <><PauseIcon size={14} /> Pause</> : <><PlayIcon size={14} /> Listen</>}
          </button>
        )}
      </div>

      {/* 10. Voice + Renarrate */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.bg, borderRadius: 8, marginBottom: 24 }}>
        <span style={{ fontSize: 12, color: c.textMuted, fontWeight: 500 }}>Voice:</span>
        <select value={reprocessVoice} onChange={(e) => setReprocessVoice(e.target.value)} style={{ flex: 1, background: c.surface, border: `1px solid ${c.border}`, borderRadius: 6, padding: "5px 8px", color: c.text, fontSize: 12, fontFamily: font.sans, outline: "none" }}>
          {voices.map((v) => <option key={v.name} value={v.name}>{voiceLabel(v.name)}</option>)}
        </select>
        <button onClick={handleReprocess} disabled={reprocessing || !canRenarrate || isProcessingStatus} style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: c.accent, color: c.bgDeep, fontSize: 12, fontWeight: 600, fontFamily: font.sans, cursor: "pointer", whiteSpace: "nowrap", opacity: reprocessing || !canRenarrate || isProcessingStatus ? 0.5 : 1 }}>
          {reprocessing || isProcessingStatus ? "Processing..." : !article.audio_url ? "Generate Audio" : "Renarrate"}
        </button>
      </div>

      {/* 11. Related by Tags */}
      {(() => {
        if (articleTags.length === 0) return null;
        const related = articles
          .filter((d) => d.id !== article.id && (d.tags || []).some((t) => articleTags.includes(t)))
          .slice(0, 3);
        if (related.length === 0) return null;
        return (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Related by Tags</div>
            {related.map((d) => (
              <div key={d.id} onClick={() => onSelectDoc(d.id)}
                style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.border}`, marginBottom: 5, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", transition: "background 0.1s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = c.surfaceHover}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <StatusDot status={d.status} />
                <div style={{ flex: 1, fontSize: 12, color: c.text, fontWeight: 500 }}>{d.title}</div>
                <span style={{ fontSize: 10, color: c.textDim, fontFamily: font.mono }}>{(d.id || "").slice(0, 8)}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Document List Item ─────────────────────────────────────
function DocumentListItem({ article, isSelected, selectionMode, isChecked, activeFilters, onSelect, onToggleCheck, onAddFilter }) {
  const tags = article.tags || [];
  const visibleTags = tags.filter((t) => !activeFilters.includes(t));
  const hasScore = article.score != null;

  return (
    <div
      id={`doc-${article.id}`}
      onClick={() => selectionMode ? onToggleCheck(article.id) : onSelect(article.id)}
      style={{
        padding: "12px 14px", borderBottom: `1px solid ${c.border}`,
        borderLeft: `2px solid ${isSelected ? c.accent : "transparent"}`,
        background: isSelected ? c.surfaceRaised : "transparent",
        cursor: "pointer", transition: "all 0.08s",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = `${c.surface}88`; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "start", gap: 8, marginBottom: 5 }}>
        {selectionMode && (
          <div style={{ width: 18, height: 18, borderRadius: "50%", border: `1px solid ${isChecked ? c.accent : c.textMuted}`, display: "flex", alignItems: "center", justifyContent: "center", background: isChecked ? c.accent : "transparent", color: c.bgDeep, flexShrink: 0, marginTop: 2 }}>
            {isChecked && <CheckIcon size={12} />}
          </div>
        )}
        {hasScore && <ScoreBadge score={article.score} />}
        <div style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 600 : 500, color: c.text, lineHeight: 1.4 }}>{article.title}</div>
        <StatusDot status={article.status} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: visibleTags.length > 0 ? 6 : 0, paddingLeft: selectionMode ? 26 : hasScore ? 44 : 0 }}>
        <span style={{ fontSize: 10, color: c.textDim }}>{article.type || "article"}</span>
        <span style={{ fontSize: 10, color: c.textDim }}>·</span>
        <span style={{ fontSize: 10, color: c.textDim }}>{sourceLabel(article)}</span>
        <span style={{ fontSize: 10, color: c.textDim }}>·</span>
        <span style={{ fontSize: 10, color: c.textDim }}>{timeAgo(article.ingested_at)}</span>
      </div>
      {visibleTags.length > 0 && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", paddingLeft: selectionMode ? 26 : hasScore ? 44 : 0 }}>
          {visibleTags.slice(0, 4).map((t) => {
            const isP = t.startsWith("project:");
            const display = isP ? t.replace("project:", "") : t;
            return (
              <span key={t}
                onClick={(e) => { e.stopPropagation(); onAddFilter(t); }}
                style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: isP ? c.purpleDim : c.bg, color: isP ? c.purple : c.textMuted, border: `1px solid ${isP ? c.purple + "22" : c.border}`, cursor: "pointer", fontWeight: isP ? 600 : 400, transition: "all 0.1s" }}
                onMouseEnter={(e) => { e.target.style.color = isP ? c.purple : c.accent; e.target.style.borderColor = (isP ? c.purple : c.accent) + "44"; }}
                onMouseLeave={(e) => { e.target.style.color = isP ? c.purple : c.textMuted; e.target.style.borderColor = isP ? c.purple + "22" : c.border; }}
              >{isP ? "⬡ " : ""}{display}</span>
            );
          })}
          {visibleTags.length > 4 && <span style={{ fontSize: 9, color: c.textDim }}>+{visibleTags.length - 4}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Player Bar ─────────────────────────────────────────────
function PlayerBar({ article, isPlaying, currentTime, duration, playbackRate, playbackRates, onToggle, onSeek, onPlaybackRateChange }) {
  if (!article) return null;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(19,21,29,0.95)", backdropFilter: "blur(20px)", borderTop: `1px solid ${c.border}`, zIndex: 100 }}>
      <div style={{ height: 3, background: c.border, cursor: "pointer" }} onClick={onSeek}>
        <div style={{ height: "100%", background: c.accent, transition: "width 0.1s linear", width: `${percent}%` }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px 14px" }}>
        <button onClick={onToggle} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: c.accent, color: c.bgDeep, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: font.serif, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: c.text }}>{article.title}</div>
          <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{sourceLabel(article)}</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: c.textMuted }}>Speed</span>
          <select value={String(playbackRate)} onChange={(e) => onPlaybackRateChange(Number(e.target.value))} style={{ borderRadius: 8, border: `1px solid ${c.border}`, background: c.bg, color: c.text, fontSize: 12, padding: "6px 8px", fontFamily: font.sans }} aria-label="Playback speed">
            {(playbackRates.length ? playbackRates : PLAYBACK_RATES).map((rate) => (
              <option key={rate} value={String(rate)}>{rate}x</option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, fontFamily: font.mono, color: c.textMuted, flexShrink: 0 }}>
          {formatDuration(currentTime)} / {formatDuration(duration || article.audio_duration_sec)}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────
function ReadcastApp() {
  // Existing state
  const [articles, setArticles] = useState([]);
  const [voices, setVoices] = useState([]);
  const [defaultVoice, setDefaultVoice] = useState("af_sky");
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [playbackRates, setPlaybackRates] = useState(PLAYBACK_RATES);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [daemonError, setDaemonError] = useState("");
  const [daemonState, setDaemonState] = useState("offline");
  const [daemonMessage, setDaemonMessage] = useState("");
  const [addError, setAddError] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [showExtension, setShowExtension] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // New state
  const [selectedId, setSelectedId] = useState(null);
  const [activeFilters, setActiveFilters] = useState([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [sortMode, setSortMode] = useState("auto");
  const [timeRange, setTimeRange] = useState("all");
  const [similarMode, setSimilarMode] = useState(null);

  const audioRef = useRef(null);
  const searchRef = useRef(null);
  const listenedFiredRef = useRef(null);
  const dropdownRef = useRef(null);

  // Computed
  const activeArticle = useMemo(() => articles.find((a) => a.id === activeId) || null, [articles, activeId]);
  const hasActiveWork = articles.some((a) => a.status === "queued" || a.status === "synthesizing");
  const selectedCount = selectedIds.length;
  const tagIndex = useMemo(() => buildTagIndex(articles), [articles]);
  const isSearching = search.trim().length > 0;
  const effectiveSort = sortMode === "auto" ? (isSearching ? "relevance" : "date") : sortMode;
  const indexedCount = articles.filter((a) => a.status === "done").length;

  const filteredResults = useMemo(() => {
    if (similarMode) {
      const sourceDoc = articles.find((d) => d.id === similarMode);
      if (sourceDoc) return findSimilar(sourceDoc, articles);
      return [];
    }
    let pool = [...articles];
    if (activeFilters.length > 0) {
      pool = pool.filter((d) => activeFilters.every((f) => (d.tags || []).includes(f)));
    }
    pool = pool.filter((d) => withinRange(d.ingested_at, timeRange));
    if (effectiveSort === "date") {
      pool.sort((a, b) => new Date(b.ingested_at) - new Date(a.ingested_at));
    }
    return pool;
  }, [articles, activeFilters, timeRange, effectiveSort, similarMode]);

  const selectedDoc = useMemo(() => {
    return filteredResults.find((d) => d.id === selectedId) || articles.find((d) => d.id === selectedId) || null;
  }, [filteredResults, articles, selectedId]);

  // Auto-select first result
  useEffect(() => {
    if (filteredResults.length > 0 && (!selectedId || !filteredResults.find((d) => d.id === selectedId))) {
      setSelectedId(filteredResults[0].id);
    } else if (filteredResults.length === 0) {
      setSelectedId(null);
    }
  }, [filteredResults]);

  // ─── Data fetching ────────────────────────
  async function refreshArticles(query = search) {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    const data = await apiGet(`/api/articles${suffix}`);
    setArticles(data.articles || []);
  }

  async function refreshVoices() {
    try { const data = await apiGet("/api/voices"); setVoices(data.voices || []); }
    catch (error) { setDaemonError(error.message); }
  }

  async function refreshPreferences() {
    try {
      const data = await apiGet("/api/preferences");
      setDefaultVoice(data.preferences?.default_voice || "af_sky");
      setPlaybackRate(Number(data.preferences?.playback_rate || 1.0));
      setPlaybackRates(data.preferences?.available_playback_rates || PLAYBACK_RATES);
    } catch (error) { setDaemonError(error.message); }
  }

  async function refreshStatus() {
    try {
      const data = await apiGet("/api/status");
      setDaemonConnected(Boolean(data.kokoro_edge?.connected));
      setDaemonState(data.kokoro_edge?.state || "offline");
      setDaemonMessage(data.kokoro_edge?.message || "");
      setDaemonError(data.kokoro_edge?.error || "");
    } catch (error) {
      setDaemonConnected(false); setDaemonState("offline"); setDaemonMessage(""); setDaemonError(error.message);
    }
  }

  // Initial load
  useEffect(() => {
    refreshArticles("");
    refreshVoices();
    refreshPreferences();
    refreshStatus();
    apiGet("/api/update-check").then((data) => { if (data.update_available) setUpdateInfo(data); }).catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    const timeout = window.setTimeout(() => { refreshArticles(search); }, 200);
    return () => window.clearTimeout(timeout);
  }, [search]);

  // Clean selectedIds on article change
  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => articles.some((a) => a.id === id)));
  }, [articles]);

  // Poll when active work
  useEffect(() => {
    if (!hasActiveWork) return undefined;
    const interval = window.setInterval(() => { refreshArticles(search); refreshStatus(); }, 1500);
    return () => window.clearInterval(interval);
  }, [hasActiveWork, search]);

  // Close tag dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setTagDropdownOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Audio event listeners ────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
      if (activeId && audio.duration > 0 && audio.currentTime / audio.duration > 0.8 && listenedFiredRef.current !== activeId) {
        listenedFiredRef.current = activeId;
        apiJson(`/api/articles/${activeId}/listened`, "POST", { complete: true }).catch(() => {});
      }
    };
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, []);

  useEffect(() => { const audio = audioRef.current; if (audio) audio.playbackRate = playbackRate; }, [playbackRate]);

  // ─── Keyboard shortcuts ───────────────────
  useEffect(() => {
    const onKeyDown = (event) => {
      if (showExtension && event.key === "Escape") { setShowExtension(false); return; }
      if (showAdd && event.key === "Escape") { setAddError(""); setShowAdd(false); return; }
      if (tagDropdownOpen && event.key === "Escape") { setTagDropdownOpen(false); return; }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setShowAdd(true); return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return; }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setShowAdd(true); return; }
      if (event.key === " ") {
        event.preventDefault();
        const audio = audioRef.current;
        if (audio && activeArticle) { audio.paused ? audio.play() : audio.pause(); }
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        const audio = audioRef.current;
        if (audio && activeArticle) { audio.paused ? audio.play() : audio.pause(); }
        return;
      }
      if (event.key === "Escape") {
        if (similarMode) { setSimilarMode(null); return; }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (filteredResults.length === 0) return;
        const idx = filteredResults.findIndex((d) => d.id === selectedId);
        const next = event.key === "ArrowDown"
          ? (idx < filteredResults.length - 1 ? idx + 1 : 0)
          : (idx > 0 ? idx - 1 : filteredResults.length - 1);
        setSelectedId(filteredResults[next].id);
        setTimeout(() => { document.getElementById(`doc-${filteredResults[next].id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdd, showExtension, tagDropdownOpen, similarMode, activeArticle, filteredResults, selectedId]);

  // ─── Handlers ─────────────────────────────
  async function handleAdd(payload) {
    setAddError("");
    try { await apiJson("/api/articles", "POST", { ...payload, process: true }); setShowAdd(false); refreshArticles(search); refreshStatus(); }
    catch (error) { setAddError(error.message); throw error; }
  }

  async function handlePreview(payload) {
    setAddError("");
    try { return (await apiJson("/api/preview", "POST", payload)).preview; }
    catch (error) { setAddError(error.message); throw error; }
  }

  async function handleSaveDefaultVoice(voice) {
    setAddError("");
    const data = await apiJson("/api/preferences", "PUT", { default_voice: voice });
    setDefaultVoice(data.preferences?.default_voice || voice);
    setPlaybackRate(Number(data.preferences?.playback_rate || playbackRate));
    setPlaybackRates(data.preferences?.available_playback_rates || PLAYBACK_RATES);
    await refreshArticles(search);
  }

  async function handleSavePlaybackRate(rate) {
    const data = await apiJson("/api/preferences", "PUT", { playback_rate: rate });
    setPlaybackRate(Number(data.preferences?.playback_rate || rate));
    setPlaybackRates(data.preferences?.available_playback_rates || PLAYBACK_RATES);
  }

  function handleToggleSelect(articleId) {
    setSelectedIds((current) => current.includes(articleId) ? current.filter((id) => id !== articleId) : [...current, articleId]);
  }

  function handleSelectionModeToggle() {
    setDeleteError(""); setShowDeleteConfirm(false);
    setSelectionMode((current) => { if (current) setSelectedIds([]); return !current; });
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length) return;
    setDeleteError(""); setDeleting(true);
    try {
      for (const articleId of selectedIds) {
        await apiJson(`/api/articles/${articleId}`, "DELETE");
        if (articleId === activeId) {
          const audio = audioRef.current;
          if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
          setActiveId(null); setIsPlaying(false); setCurrentTime(0); setDuration(0);
        }
      }
      setSelectedIds([]); setShowDeleteConfirm(false); setSelectionMode(false);
      await refreshArticles(search); await refreshStatus();
    } catch (error) { setDeleteError(error.message); }
    finally { setDeleting(false); }
  }

  async function handlePlay(article) {
    const audio = audioRef.current;
    if (!audio || !article.audio_url) return;
    if (activeId === article.id) { audio.paused ? await audio.play() : audio.pause(); return; }
    setActiveId(article.id); setCurrentTime(0); setDuration(article.audio_duration_sec || 0);
    listenedFiredRef.current = null;
    audio.src = article.audio_url; await audio.play();
  }

  function handleSeek(event) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = percent * duration; setCurrentTime(audio.currentTime);
  }

  async function handleReprocess(articleId, voice) {
    await apiJson(`/api/articles/${articleId}/reprocess`, "POST", { voice });
    refreshArticles(search); refreshStatus();
  }

  async function handleCopyFeed() {
    const feedUrl = new URL("/feed.xml", window.location.href).toString();
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(feedUrl); }
    else { window.prompt("Copy feed URL", feedUrl); }
    setFeedCopied(true); window.setTimeout(() => setFeedCopied(false), 1500);
  }

  // Filter helpers
  const addFilter = (tag) => {
    if (similarMode) setSimilarMode(null);
    if (!activeFilters.includes(tag)) setActiveFilters((prev) => [...prev, tag]);
  };
  const removeFilter = (tag) => setActiveFilters((prev) => prev.filter((f) => f !== tag));
  const clearAll = () => { setActiveFilters([]); setSearch(""); setTimeRange("all"); setSimilarMode(null); setSortMode("auto"); };
  const handleFindSimilar = (doc) => { setSimilarMode(doc.id); setActiveFilters([]); setSearch(""); setTimeRange("all"); };
  const hasActiveScope = activeFilters.length > 0 || isSearching || timeRange !== "all" || similarMode;

  // ─── Render ───────────────────────────────
  return (
    <div style={{ height: "100vh", background: c.bgDeep, fontFamily: font.sans, display: "flex", flexDirection: "column", color: c.text }}>
      <style>{globalStyles}</style>
      <audio ref={audioRef} preload="metadata" />

      {/* ─── Top Bar ──────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: `1px solid ${c.border}`, background: c.bg, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: daemonState === "ready" ? c.green : daemonConnected ? c.amber : c.red }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Local Knowledge</span>
        </div>
        <span style={{ fontSize: 11, color: c.textDim }}>{articles.length} docs · {indexedCount} indexed</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleCopyFeed} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: "rgba(255,255,255,0.04)", color: c.textMuted, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" }}>
          <span>{feedCopied ? "Feed Copied" : "Copy Feed"}</span>
        </button>
        <button onClick={() => setShowExtension(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: "rgba(255,255,255,0.04)", color: c.textMuted, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" }}>
          <ExtensionIcon size={15} /><span>Ext</span>
        </button>
        <button onClick={handleSelectionModeToggle} style={selectionMode ? { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${c.accent}`, background: c.accentDim, color: c.accent, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" } : { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: "rgba(255,255,255,0.04)", color: c.textMuted, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" }}>
          <CheckIcon size={15} /><span>{selectionMode ? "Done" : "Select"}</span>
        </button>
        <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: c.accent, color: c.bgDeep, fontSize: 13, fontWeight: 600, fontFamily: font.sans, cursor: "pointer" }}>
          <PlusIcon size={16} /><span>Add</span>
        </button>
      </div>

      {/* ─── Banners ─────────────────────────── */}
      {(daemonError || daemonState !== "ready") && (
        <div style={{ padding: "10px 20px", fontSize: 13, background: daemonError ? c.redDim : c.greenDim, color: daemonError ? c.red : c.green, borderBottom: `1px solid ${(daemonError ? c.red : c.green) + "22"}`, flexShrink: 0 }}>
          {daemonError || daemonMessage}
        </div>
      )}
      {deleteError && (
        <div style={{ padding: "10px 20px", fontSize: 13, background: c.redDim, color: c.red, borderBottom: `1px solid ${c.red}22`, flexShrink: 0 }}>{deleteError}</div>
      )}
      {updateInfo && !updateDismissed && (
        <div style={{ padding: "10px 20px", fontSize: 13, background: c.amberDim, color: c.amber, borderBottom: `1px solid ${c.amber}22`, flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            readcast {updateInfo.latest} is available (you have {updateInfo.current}).
            {" "}Run <code style={{ padding: "2px 6px", borderRadius: 4, background: c.bg, fontFamily: font.mono, fontSize: 12 }}>pixi global upgrade readcast</code> to update.
          </span>
          <button onClick={() => setUpdateDismissed(true)} style={{ background: "none", border: "none", color: c.textMuted, cursor: "pointer", fontSize: 14, padding: "0 4px", fontFamily: "inherit", flexShrink: 0 }} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ─── Filter Bar ──────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", borderBottom: `1px solid ${c.border}`, background: c.surface, flexShrink: 0, flexWrap: "wrap", minHeight: 44 }}>
        {similarMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 5px 3px 10px", borderRadius: 6, background: c.cyanDim, border: `1px solid ${c.cyan}33`, fontSize: 11, color: c.cyan, fontWeight: 500 }}>
            ◎ Similar to: {(articles.find((d) => d.id === similarMode)?.title || "").slice(0, 35)}...
            <span onClick={() => setSimilarMode(null)} style={{ cursor: "pointer", padding: "0 4px", fontSize: 10 }}
              onMouseEnter={(e) => e.target.style.background = `${c.cyan}22`}
              onMouseLeave={(e) => e.target.style.background = "transparent"}>×</span>
          </div>
        )}
        {!similarMode && activeFilters.map((f) => <FilterChip key={f} tag={f} onRemove={() => removeFilter(f)} />)}
        {!similarMode && (
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button onClick={() => setTagDropdownOpen(!tagDropdownOpen)} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
              border: `1px dashed ${tagDropdownOpen ? c.accent + "66" : c.border}`,
              background: tagDropdownOpen ? c.accentDim : "transparent",
              color: tagDropdownOpen ? c.accent : c.textMuted,
              fontSize: 11, fontFamily: font.sans, cursor: "pointer", transition: "all 0.12s",
            }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>+</span>
              {activeFilters.length === 0 ? "Filter by tag" : "Add"}
            </button>
            {tagDropdownOpen && <TagDropdown allTags={tagIndex} activeFilters={activeFilters} onAdd={addFilter} onClose={() => setTagDropdownOpen(false)} />}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {!similarMode && (
          <div style={{ display: "flex", gap: 1, borderRadius: 6, overflow: "hidden", border: `1px solid ${c.border}` }}>
            {[["7d", "7d"], ["30d", "30d"], ["all", "All"]].map(([val, label]) => (
              <button key={val} onClick={() => setTimeRange(val)} style={{
                padding: "3px 9px", border: "none", fontSize: 10, fontFamily: font.sans,
                background: timeRange === val ? c.accentDim : c.bg,
                color: timeRange === val ? c.accent : c.textDim,
                cursor: "pointer", fontWeight: timeRange === val ? 600 : 400,
              }}>{label}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 1, borderRadius: 6, overflow: "hidden", border: `1px solid ${c.border}` }}>
          {[["auto", "Auto"], ["date", "Date"], ["relevance", "Score"]].map(([val, label]) => (
            <button key={val} onClick={() => setSortMode(val)} style={{
              padding: "3px 9px", border: "none", fontSize: 10, fontFamily: font.sans,
              background: sortMode === val ? c.accentDim : c.bg,
              color: sortMode === val ? c.accent : c.textDim,
              cursor: "pointer", fontWeight: sortMode === val ? 600 : 400,
            }}>
              {label}
              {val === "auto" && <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 2 }}>({isSearching ? "rel" : "date"})</span>}
            </button>
          ))}
        </div>
        {hasActiveScope && <>
          <span style={{ fontSize: 10, color: c.textMuted }}>{filteredResults.length} result{filteredResults.length !== 1 ? "s" : ""}</span>
          <button onClick={clearAll} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${c.border}`, background: "transparent", color: c.textMuted, fontSize: 10, fontFamily: font.sans, cursor: "pointer" }}>Clear</button>
        </>}
      </div>

      {/* ─── Bulk bar ────────────────────────── */}
      {selectionMode && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 20px", background: c.surface, borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: c.textMuted }}>{selectedCount ? `${selectedCount} selected` : "Select articles to delete"}</span>
          <button onClick={() => setShowDeleteConfirm(true)} style={{ ...dangerBtn, opacity: selectedCount ? 1 : 0.45 }} disabled={!selectedCount}>
            <TrashIcon size={15} /><span>Delete</span>
          </button>
        </div>
      )}

      {/* ─── Main: List + Reader ─────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left pane */}
        <div style={{ width: 400, flexShrink: 0, borderRight: `1px solid ${c.border}`, display: "flex", flexDirection: "column", background: c.bg }}>
          {/* Search */}
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${c.border}` }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.textDim, pointerEvents: "none" }}>
                <SearchIcon size={14} />
              </span>
              <input
                ref={searchRef} type="text" value={search}
                onChange={(e) => { setSearch(e.target.value); if (similarMode) setSimilarMode(null); }}
                placeholder={activeFilters.length > 0 ? `Search within ${filteredResults.length} docs...` : "Search all documents..."}
                style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: 13, fontFamily: font.sans, outline: "none" }}
                onFocus={(e) => e.target.style.borderColor = c.accent + "55"}
                onBlur={(e) => e.target.style.borderColor = c.border}
                aria-label="Search articles"
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: c.textMuted, cursor: "pointer", fontSize: 13, padding: "2px 4px" }} aria-label="Clear search">✕</button>
              )}
            </div>
          </div>

          {/* Document list */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {filteredResults.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.2 }}>∅</div>
                <div style={{ fontSize: 13, color: c.textMuted }}>
                  {search ? "No documents match" : articles.length === 0 ? (
                    <>
                      No articles yet. Add one with the{" "}
                      <span onClick={() => setShowExtension(true)} style={{ color: c.accent, cursor: "pointer", textDecoration: "underline" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setShowExtension(true); }}>browser extension</span>
                      {" "}or the Add button above.
                    </>
                  ) : "No documents match"}
                </div>
                {(search || activeFilters.length > 0) && (
                  <div style={{ fontSize: 11, color: c.textDim, marginTop: 4 }}>Try broader terms or remove a filter</div>
                )}
              </div>
            ) : (
              filteredResults.map((article) => (
                <DocumentListItem
                  key={article.id}
                  article={article}
                  isSelected={selectedId === article.id}
                  selectionMode={selectionMode}
                  isChecked={selectedIds.includes(article.id)}
                  activeFilters={activeFilters}
                  onSelect={setSelectedId}
                  onToggleCheck={handleToggleSelect}
                  onAddFilter={addFilter}
                />
              ))
            )}
          </div>
        </div>

        {/* Right pane */}
        <div style={{ flex: 1, overflow: "auto", background: c.surface }}>
          {selectedDoc ? (
            <ReadingPane
              article={selectedDoc}
              articles={articles}
              voices={voices}
              onReprocess={handleReprocess}
              onRefresh={() => refreshArticles(search)}
              onAddFilter={addFilter}
              onFindSimilar={handleFindSimilar}
              onPlay={handlePlay}
              onSelectDoc={setSelectedId}
              activeId={activeId}
              isPlaying={isPlaying}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 32, opacity: 0.12 }}>📄</div>
              <div style={{ fontSize: 14, color: c.textDim }}>Select a document</div>
            </div>
          )}
        </div>
      </div>

      {/* Player spacer */}
      {activeArticle && <div style={{ height: 72, flexShrink: 0 }} />}

      {/* ─── Player Bar ──────────────────────── */}
      <PlayerBar
        article={activeArticle}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        playbackRate={playbackRate}
        playbackRates={playbackRates}
        onToggle={() => { const audio = audioRef.current; if (audio && activeArticle) { audio.paused ? audio.play() : audio.pause(); } }}
        onSeek={handleSeek}
        onPlaybackRateChange={handleSavePlaybackRate}
      />

      {/* ─── Modals ──────────────────────────── */}
      {showAdd && (
        <AddPanel voices={voices} defaultVoice={defaultVoice} onAdd={handleAdd} onPreview={handlePreview} onSaveDefaultVoice={handleSaveDefaultVoice} onClose={() => { setAddError(""); setShowAdd(false); }} error={addError} />
      )}
      {showDeleteConfirm && (
        <DeleteConfirmPanel count={selectedCount} deleting={deleting} onConfirm={handleDeleteSelected} onClose={() => { setDeleteError(""); setShowDeleteConfirm(false); }} />
      )}
      {showExtension && <ExtensionPanel onClose={() => setShowExtension(false)} />}
    </div>
  );
}

// ─── Bootstrap ──────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<ReadcastApp />);
