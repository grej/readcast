import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ─── Constants ──────────────────────────────────────────────
const PLAYBACK_RATES = [1.0, 1.25, 1.5, 1.75, 2.0];
const TYPE_BADGE = { collection: "◎", todo: "☐", playlist: "♫" };
const DEFAULT_COLORS = {
  collection: ["#a855f7", "rgba(168,85,247,0.12)"],
  todo: ["#ef9f27", "rgba(239,159,39,0.12)"],
  playlist: ["#6c8cff", "rgba(108,140,255,0.12)"],
};
const EMOJIS = ["📚","🧠","✉","🌍","⚡","🎧","📝","🔬","💼","🎯","🏗","🎓","⚔","🛡","📊","🧪"];
const TAG_CLS = {
  "ai-tools": ["#6c8cff", "rgba(108,140,255,0.1)"],
  "ai-research": ["#2dd4bf", "rgba(45,212,191,0.12)"],
  "email": ["#4ade80", "rgba(74,222,128,0.12)"],
  "geopolitics": ["#f87171", "rgba(248,113,113,0.12)"],
  "mil-tech": ["#ef9f27", "rgba(239,159,39,0.12)"],
  "reading": ["#a855f7", "rgba(168,85,247,0.12)"],
  "defense": ["#f87171", "rgba(248,113,113,0.12)"],
};

// ─── Utility functions ──────────────────────────────────────
function fmtDur(seconds) {
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

function timeAgo(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d`;
  } catch { return ""; }
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function tagColor(tag) {
  const entry = TAG_CLS[tag];
  if (entry) return entry;
  // fallback: accent blue
  return ["#6c8cff", "rgba(108,140,255,0.1)"];
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

async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    let detail = `Request failed (${response.status})`;
    try { const data = await response.json(); detail = data.detail || detail; } catch {}
    throw new Error(detail);
  }
  return null;
}

// ─── Design tokens (aligned to spec §8) ─────────────────────
const c = {
  bgRoot: "#08090d",
  bgPanel: "#0c0d12",
  bgSurface: "#13151d",
  bgHover: "#181b26",
  bgSelected: "#1a1d27",
  border: "#222538",
  borderLight: "#181a28",
  text: "#e4e5ea",
  textSecondary: "#a0a4b8",
  textMuted: "#6b7084",
  textDim: "#4a4d60",
  accent: "#6c8cff",
  accentBg: "rgba(108,140,255,0.1)",
  green: "#4ade80",
  greenBg: "rgba(74,222,128,0.12)",
  red: "#f87171",
  redBg: "rgba(248,113,113,0.12)",
  amber: "#ef9f27",
  amberBg: "rgba(239,159,39,0.12)",
  purple: "#a855f7",
  purpleBg: "rgba(168,85,247,0.12)",
  teal: "#2dd4bf",
  tealBg: "rgba(45,212,191,0.12)",
};

const font = {
  sans: "'DM Sans', 'Avenir Next', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};

// ─── Global styles ──────────────────────────────────────────
const globalStyles = `
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
@keyframes flashAccent { 0% { background: rgba(108,140,255,0.18); } 100% { background: transparent; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${c.bgRoot}; color: ${c.text}; font-family: ${font.sans}; height: 100vh; display: flex; overflow: hidden; }
::selection { background: rgba(108, 140, 255, 0.3); }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${c.border}; border-radius: 3px; }
input::placeholder { color: ${c.textMuted}; }
button { font-family: inherit; }
`;

// ═══════════════════════════════════════════════════════════════
// NAV SIDEBAR
// ═══════════════════════════════════════════════════════════════
function NavSidebar({ lists, activeListId, onSelectList, totalCount, onCreateList }) {
  const todoLists = lists.filter(l => l.type === "todo");
  const otherLists = lists.filter(l => l.type !== "todo");

  const navItem = (id, icon, label, typeBadge, count, listColor, listBg, isActive) => (
    <div
      key={id}
      onClick={() => onSelectList(id)}
      style={{
        padding: "7px 16px", display: "flex", alignItems: "center", gap: 9,
        cursor: "pointer", fontSize: 12, color: isActive ? (listColor || c.text) : c.textSecondary,
        transition: "background 0.06s", borderLeft: `2px solid ${isActive ? c.accent : "transparent"}`,
        background: isActive ? c.bgSelected : "transparent", fontWeight: isActive ? 600 : 400,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = c.bgSurface; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {typeBadge && (
        <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: listBg, color: listColor }}>{typeBadge}</span>
      )}
      <span style={{ fontSize: 10, color: c.textDim, fontFamily: font.mono }}>{count}</span>
    </div>
  );

  return (
    <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${c.border}`, display: "flex", flexDirection: "column", background: c.bgRoot, userSelect: "none" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.green }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Local Knowledge</span>
        <span style={{ fontSize: 10, color: c.textMuted, marginLeft: "auto" }}>{totalCount}</span>
      </div>

      {/* All Items */}
      <div style={{ padding: "6px 0" }}>
        {navItem(null, "⊙", "All items", null, totalCount, null, null, activeListId === null)}
      </div>

      <div style={{ height: 1, background: c.borderLight, margin: "2px 12px" }} />

      {/* Action items (todos) */}
      {todoLists.length > 0 && (
        <>
          <div style={{ padding: "6px 0" }}>
            <div style={{ padding: "4px 16px", fontSize: 9, fontWeight: 600, color: c.textDim, textTransform: "uppercase", letterSpacing: 0.8 }}>Action items</div>
            {todoLists.map(l => navItem(l.id, l.icon, l.name, TYPE_BADGE[l.type], l.item_count, l.color, l.bg, activeListId === l.id))}
          </div>
          <div style={{ height: 1, background: c.borderLight, margin: "2px 12px" }} />
        </>
      )}

      {/* Lists (collections + playlists) */}
      <div style={{ padding: "6px 0", flex: 1, overflow: "auto" }}>
        <div style={{ padding: "4px 16px", fontSize: 9, fontWeight: 600, color: c.textDim, textTransform: "uppercase", letterSpacing: 0.8 }}>Lists</div>
        {otherLists.map(l => navItem(l.id, l.icon, l.name, TYPE_BADGE[l.type], l.item_count, l.color, l.bg, activeListId === l.id))}
      </div>

      {/* + New list */}
      <div
        onClick={onCreateList}
        style={{ padding: "7px 16px", display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontSize: 11, color: c.textDim, transition: "0.1s" }}
        onMouseEnter={e => e.currentTarget.style.color = c.accent}
        onMouseLeave={e => e.currentTarget.style.color = c.textDim}
      >
        <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>+</span>
        New list
      </div>

      {/* Footer */}
      <div style={{ marginTop: "auto", padding: "10px 16px", borderTop: `1px solid ${c.borderLight}`, fontSize: 10, color: c.textDim, lineHeight: 1.8 }}>
        <kbd style={kbdStyle}>↑↓</kbd> navigate <kbd style={kbdStyle}>⏎</kbd> open<br />
        <kbd style={kbdStyle}>n</kbd> narrate <kbd style={kbdStyle}>s</kbd> summary <kbd style={kbdStyle}>e</kbd> done
      </div>
    </div>
  );
}

const kbdStyle = { fontFamily: font.mono, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: c.bgSurface, border: `1px solid ${c.border}`, color: c.textMuted };

// ═══════════════════════════════════════════════════════════════
// CREATE LIST MODAL
// ═══════════════════════════════════════════════════════════════
function CreateListModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("collection");
  const [icon, setIcon] = useState("📚");
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleCreate = () => {
    if (!name.trim()) return;
    const [color, bg] = DEFAULT_COLORS[type] || DEFAULT_COLORS.collection;
    onCreate({ name: name.trim(), type, icon, color, bg });
    onClose();
  };

  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${c.border}`, background: c.bgPanel, color: c.text, fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 8 };
  const selectStyle = { ...inputStyle, fontSize: 12, padding: "7px 10px" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: c.bgSurface, border: `1px solid ${c.border}`, borderRadius: 12, width: 360, overflow: "hidden", animation: "fadeIn 0.15s ease" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${c.border}`, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>Create new list</div>
        <div style={{ padding: "14px 18px" }}>
          <label style={{ fontSize: 12, color: c.textSecondary, display: "block", marginBottom: 4 }}>Name</label>
          <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Study Psychology" style={inputStyle} onFocus={e => e.target.style.borderColor = c.accent} onBlur={e => e.target.style.borderColor = c.border} onKeyDown={e => { if (e.key === "Enter") handleCreate(); }} />

          <label style={{ fontSize: 12, color: c.textSecondary, display: "block", marginBottom: 4 }}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={selectStyle}>
            <option value="collection">Collection — curated topic group</option>
            <option value="todo">Todo — action items with due dates</option>
            <option value="playlist">Playlist — audio narration queue</option>
          </select>

          <label style={{ fontSize: 12, color: c.textSecondary, display: "block", marginBottom: 4 }}>Icon</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setIcon(e)} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${icon === e ? c.accent : c.border}`, background: icon === e ? c.accentBg : c.bgPanel, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "0.1s", fontFamily: "inherit" }}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={handleCreate} style={{ ...btnStyle, background: c.accent, color: c.bgRoot, borderColor: c.accent }}>Create</button>
        </div>
      </div>
    </div>
  );
}

const btnStyle = { padding: "5px 12px", borderRadius: 6, border: `1px solid ${c.border}`, background: "rgba(255,255,255,0.03)", color: c.textMuted, fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "0.1s", whiteSpace: "nowrap" };

// ═══════════════════════════════════════════════════════════════
// DOC ROW (Collection / All Items)
// ═══════════════════════════════════════════════════════════════
function DocRow({ article, isFocused, showListBadges, onSelect }) {
  const rend = article.renditions || {};
  const audio = rend.audio;
  const memberships = article.list_memberships || [];
  const tags = article.tags || [];

  return (
    <div
      onClick={() => onSelect(article.id)}
      style={{
        padding: isFocused ? "9px 12px 9px 10px" : "9px 12px",
        borderBottom: `1px solid ${c.borderLight}`, cursor: "pointer",
        display: "flex", gap: 8, alignItems: "flex-start", transition: "background 0.06s",
        background: isFocused ? c.bgSelected : "transparent",
        borderLeft: isFocused ? `2px solid ${c.accent}` : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = c.bgHover; }}
      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = isFocused ? c.bgSelected : "transparent"; }}
    >
      <div style={{ flexShrink: 0, marginTop: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <AudioIndicator audio={audio} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, marginBottom: 2 }}>{article.title}</div>
        <div style={{ fontSize: 10, color: c.textMuted, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {tags.slice(0, 3).map(t => {
            const [tc, tbg] = tagColor(t);
            return <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: tbg, color: tc }}>{t}</span>;
          })}
          <span>{sourceLabel(article)} · {timeAgo(article.ingested_at)}</span>
        </div>
        {showListBadges && memberships.length > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
            {memberships.map(m => (
              <span key={m.id} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", background: m.bg, color: m.color }}>{m.icon} {m.name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AudioIndicator({ audio }) {
  if (!audio) return <span style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.textDim, borderRadius: 3 }}>♪</span>;
  if (audio.state === "generating" || audio.state === "queued") return <span style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.amber, borderRadius: 3, animation: "pulse 1.2s infinite" }}>◌</span>;
  return <span style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.accent, background: c.accentBg, borderRadius: 3 }}>♫</span>;
}

// ═══════════════════════════════════════════════════════════════
// TODO ROW
// ═══════════════════════════════════════════════════════════════
function TodoRow({ item, article, isFocused, onSelect, onToggleDone }) {
  if (!article) return null;
  const rend = article.renditions || {};
  const audioReady = rend.audio && rend.audio.state === "ready";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dueClass = "none", dueText = "no date";
  if (item.due) {
    const dd = new Date(item.due);
    const diff = Math.ceil((dd - today) / (1000 * 60 * 60 * 24));
    if (item.done) { dueClass = "ok"; dueText = item.due.slice(5); }
    else if (diff < 0) { dueClass = "overdue"; dueText = `overdue ${Math.abs(diff)}d`; }
    else if (diff <= 3) { dueClass = "soon"; dueText = `due in ${diff}d`; }
    else { dueClass = "ok"; dueText = item.due.slice(5); }
  }
  if (item.ai_suggested_due && !item.done && item.due) { dueClass = "ai"; dueText += " ✨"; }

  const dueColors = {
    overdue: { background: c.redBg, color: c.red },
    soon: { background: c.amberBg, color: c.amber },
    ok: { background: c.greenBg, color: c.green },
    ai: { border: `1px dashed ${c.amber}`, background: "transparent", color: c.amber, fontSize: 9 },
    none: { color: c.textDim, fontStyle: "italic", fontFamily: "inherit", fontSize: 10 },
  };

  return (
    <div
      onClick={() => onSelect(article.id)}
      style={{
        padding: isFocused ? "8px 12px 8px 10px" : "8px 12px",
        borderBottom: `1px solid ${c.borderLight}`, cursor: "pointer",
        display: "flex", gap: 9, alignItems: "center", transition: "background 0.06s",
        background: isFocused ? c.bgSelected : "transparent",
        borderLeft: isFocused ? `2px solid ${c.accent}` : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = c.bgHover; }}
      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = isFocused ? c.bgSelected : "transparent"; }}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggleDone(item); }}
        style={{
          width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${item.done ? c.green : "#444"}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, cursor: "pointer",
          transition: "0.12s", flexShrink: 0, background: item.done ? c.greenBg : "none",
          color: item.done ? c.green : "transparent", fontFamily: "inherit",
        }}
      >{item.done ? "✓" : ""}</button>
      <span style={{ fontSize: 12, flex: 1, lineHeight: 1.3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.35 : 1 }}>{article.title}</span>
      <span style={{ fontSize: 10, color: audioReady ? c.accent : c.textDim, flexShrink: 0 }}>♫</span>
      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, fontFamily: font.mono, flexShrink: 0, fontWeight: 500, ...dueColors[dueClass] }}>{dueText}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLAYLIST ROW
// ═══════════════════════════════════════════════════════════════
function PlaylistRow({ item, article, position, isPlaying, isFocused, onSelect }) {
  if (!article) return null;
  const rend = article.renditions || {};
  const rendition = item.use_summary ? rend.audio_summary : rend.audio;
  const aState = rendition ? (rendition.state === "ready" ? "ready" : "queued") : "missing";
  const dur = rendition && rendition.duration ? fmtDur(rendition.duration) : "--:--";

  const stateStyles = {
    ready: { background: c.accentBg, color: c.accent },
    missing: { background: c.redBg, color: c.red, fontSize: 9 },
    queued: { background: c.amberBg, color: c.amber },
  };

  return (
    <div
      onClick={() => onSelect(article.id)}
      style={{
        padding: isFocused ? "8px 12px 8px 10px" : "8px 12px",
        borderBottom: `1px solid ${c.borderLight}`, cursor: "pointer",
        display: "flex", gap: 8, alignItems: "center", transition: "background 0.06s",
        background: isPlaying ? "rgba(108,140,255,0.06)" : isFocused ? c.bgSelected : "transparent",
        borderLeft: isFocused ? `2px solid ${c.accent}` : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isFocused && !isPlaying) e.currentTarget.style.background = c.bgHover; }}
      onMouseLeave={e => { if (!isFocused && !isPlaying) e.currentTarget.style.background = isPlaying ? "rgba(108,140,255,0.06)" : "transparent"; }}
    >
      <span style={{ width: 20, fontSize: 11, color: isPlaying ? c.accent : c.textDim, textAlign: "center", fontFamily: font.mono, flexShrink: 0 }}>{isPlaying ? "▶" : position + 1}</span>
      <span style={{ cursor: "grab", color: c.textDim, fontSize: 14, flexShrink: 0, padding: "0 2px" }}>⠿</span>
      <span style={{ width: 22, height: 22, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0, ...stateStyles[aState] }}>
        {aState === "ready" ? "♫" : aState === "missing" ? "✕" : "◌"}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: isPlaying ? 600 : 400 }}>{article.title}</span>
      {item.use_summary && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: c.purpleBg, color: c.purple, flexShrink: 0, cursor: "pointer" }}>summary</span>}
      <span style={{ fontSize: 10, color: c.textDim, fontFamily: font.mono, flexShrink: 0 }}>{dur}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLAYER BAR (playlists)
// ═══════════════════════════════════════════════════════════════
function PlaylistPlayerBar({ article, isPlaying, currentTime, duration, onToggle, onSeek, onPrev, onNext, useSummary }) {
  if (!article) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: c.bgPanel, borderTop: `1px solid ${c.border}`, flexShrink: 0 }}>
      <button onClick={onPrev} style={pbSkipStyle}>⏮</button>
      <button onClick={onToggle} style={{ width: 28, height: 28, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", transition: "0.1s", background: c.accent, color: c.bgRoot, fontFamily: "inherit" }}>{isPlaying ? "⏸" : "▶"}</button>
      <button onClick={onNext} style={pbSkipStyle}>⏭</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.title}</div>
        <div style={{ fontSize: 9, color: c.textMuted }}>{useSummary ? "Summary · " : ""}{sourceLabel(article)}</div>
        <div onClick={onSeek} style={{ width: "100%", height: 3, background: c.border, borderRadius: 2, marginTop: 4, cursor: "pointer" }}>
          <div style={{ height: "100%", background: c.accent, borderRadius: 2, width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%", transition: "width 0.3s" }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: c.textDim, fontFamily: font.mono }}>{fmtDur(currentTime)} / {fmtDur(duration)}</span>
    </div>
  );
}

const pbSkipStyle = { width: 28, height: 28, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", transition: "0.1s", background: "transparent", color: c.textMuted, fontFamily: "inherit" };

// ═══════════════════════════════════════════════════════════════
// CENTER PANEL
// ═══════════════════════════════════════════════════════════════
function CenterPanel({ activeList, articles, listItems, focusedId, onSelectDoc, onToggleDone, playingIndex, audioState, onBatchNarrate, onPlayerToggle, onPlayerSeek, onPlayerPrev, onPlayerNext, search, onSearchChange }) {
  const isAll = !activeList;
  const listType = isAll ? "all" : activeList.type;
  const listColor = activeList?.color || c.textMuted;
  const listBg = activeList?.bg || c.accentBg;

  // For playlists, compute items needing narration
  const missingNarration = listType === "playlist" ? listItems.filter(item => {
    const art = item.article ? (typeof item.article === "object" ? item.article : null) : null;
    if (!art) return true;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return !r || r.state !== "ready";
  }).length : 0;

  // Sort todos: undone first (overdue → soon → comfortable → no date), then done
  const sortedItems = useMemo(() => {
    if (listType !== "todo") return listItems;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [...listItems].sort((a, b) => {
      if ((a.done ? 1 : 0) !== (b.done ? 1 : 0)) return a.done ? 1 : -1;
      if (!a.done) {
        const da = a.due ? new Date(a.due) : null, db = b.due ? new Date(b.due) : null;
        if (da && !db) return -1;
        if (!da && db) return 1;
        if (da && db) return da - db;
      }
      return 0;
    });
  }, [listItems, listType]);

  const displayItems = listType === "todo" ? sortedItems : listItems;

  // Compute total playlist duration
  const totalDuration = listType === "playlist" ? listItems.reduce((sum, item) => {
    const art = item.article;
    if (!art) return sum;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return sum + (r && r.duration ? r.duration : 0);
  }, 0) : 0;

  // Playing article for player bar
  const playingItem = listType === "playlist" && playingIndex != null && listItems[playingIndex] ? listItems[playingIndex] : null;
  const playingArticle = playingItem?.article || null;

  return (
    <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${c.border}`, display: "flex", flexDirection: "column", background: c.bgPanel }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 16, color: isAll ? c.textMuted : listColor }}>{isAll ? "⊙" : activeList.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{isAll ? "All Items" : activeList.name}</span>
        {isAll && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 500, background: c.accentBg, color: c.accent }}>{articles.length}</span>}
        {!isAll && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 500, background: listBg, color: listColor }}>{activeList.type}</span>}
        {listType === "playlist" && <span style={{ marginLeft: "auto", fontSize: 10, color: c.textDim, fontFamily: font.mono }}>{fmtDur(totalDuration)} total</span>}
        {listType === "collection" && !isAll && <button style={{ ...btnStyle, marginLeft: "auto", color: c.purple, borderColor: "rgba(168,85,247,0.3)", padding: "3px 8px", fontSize: 10 }}>⚡ Spock</button>}
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${c.borderLight}`, flexShrink: 0, position: "relative" }}>
        <span style={{ position: "absolute", left: 22, top: "50%", transform: "translateY(-50%)", color: c.textMuted, fontSize: 12, pointerEvents: "none" }}>⌕</span>
        <input
          value={search} onChange={e => onSearchChange(e.target.value)}
          placeholder={isAll ? "Search..." : `Search ${activeList?.name || ""}...`}
          style={{ width: "100%", padding: "7px 10px 7px 28px", borderRadius: 7, border: `1px solid ${c.border}`, background: c.bgSurface, color: c.text, fontSize: 12, fontFamily: "inherit", outline: "none" }}
          onFocus={e => e.target.style.borderColor = c.accent}
          onBlur={e => e.target.style.borderColor = c.border}
        />
      </div>

      {/* Batch narration banner (playlists) */}
      {listType === "playlist" && missingNarration > 0 && (
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, borderBottom: `1px solid ${c.borderLight}`, flexShrink: 0, background: "rgba(239,159,39,0.06)", color: c.amber }}>
          ⚠ {missingNarration} item{missingNarration > 1 ? "s" : ""} need narration
          <button onClick={onBatchNarrate} style={{ ...btnStyle, marginLeft: "auto", color: c.amber, borderColor: "rgba(239,159,39,0.3)", padding: "3px 8px", fontSize: 10 }}>Generate all</button>
        </div>
      )}

      {/* Doc list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isAll && articles.map(a => (
          <DocRow key={a.id} article={a} isFocused={focusedId === a.id} showListBadges={true} onSelect={onSelectDoc} />
        ))}
        {listType === "collection" && displayItems.map(item => {
          const art = item.article;
          if (!art) return null;
          return <DocRow key={art.id} article={art} isFocused={focusedId === art.id} showListBadges={false} onSelect={onSelectDoc} />;
        })}
        {listType === "todo" && displayItems.map(item => {
          const art = item.article;
          return <TodoRow key={item.doc_id} item={item} article={art} isFocused={focusedId === item.doc_id} onSelect={onSelectDoc} onToggleDone={onToggleDone} />;
        })}
        {listType === "playlist" && displayItems.map((item, idx) => {
          const art = item.article;
          return <PlaylistRow key={item.doc_id} item={item} article={art} position={idx} isPlaying={playingIndex === idx} isFocused={focusedId === item.doc_id} onSelect={onSelectDoc} />;
        })}
        {((isAll && articles.length === 0) || (!isAll && displayItems.length === 0)) && (
          <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: c.textDim }}>No items. Add docs from All Items.</div>
        )}
      </div>

      {/* Player bar (playlists only) */}
      {listType === "playlist" && playingArticle && (
        <PlaylistPlayerBar
          article={playingArticle} isPlaying={audioState.isPlaying}
          currentTime={audioState.currentTime} duration={audioState.duration}
          onToggle={onPlayerToggle} onSeek={onPlayerSeek} onPrev={onPlayerPrev} onNext={onPlayerNext}
          useSummary={playingItem?.use_summary}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════════
function DetailPanel({ article, lists, voices, onRefresh, onToggleListMembership }) {
  const [fullText, setFullText] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!article) return;
    setLoading(true);
    apiGet(`/api/articles/${article.id}/text`)
      .then(data => setFullText(data.text || ""))
      .catch(() => setFullText("(Could not load text)"))
      .finally(() => setLoading(false));
  }, [article?.id]);

  if (!article) return <div style={{ flex: 1, background: c.bgSurface }} />;

  const rend = article.renditions || {};
  const audio = rend.audio;
  const summary = rend.summary;
  const audioSummary = rend.audio_summary;
  const tags = article.tags || [];
  const memberships = article.list_memberships || [];
  const membershipIds = new Set(memberships.map(m => m.id));

  const handleGenerateRendition = async (type) => {
    try {
      await apiJson(`/api/docs/${article.id}/renditions/${type}`, "POST", {});
      if (onRefresh) onRefresh();
    } catch {}
  };

  const handleRemoveRendition = async (type) => {
    try {
      await apiDelete(`/api/docs/${article.id}/renditions/${type}`);
      if (onRefresh) onRefresh();
    } catch {}
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: c.bgSurface }}>
      {/* Header */}
      <div style={{ padding: "24px 24px 12px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
          {tags.map(t => {
            const [tc, tbg] = tagColor(t);
            return <span key={t} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 6, background: tbg, color: tc }}>{t}</span>;
          })}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: font.serif, lineHeight: 1.35, marginBottom: 8 }}>{article.title}</div>
        <div style={{ fontSize: 12, color: c.textMuted, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <span>{sourceLabel(article)}</span>
          <span>·</span>
          <span>{timeAgo(article.ingested_at)}</span>
          {audio && audio.duration && <><span>·</span><span>{fmtDur(audio.duration)}</span></>}
        </div>
        {article.source_url && (
          <a href={article.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: c.accent, textDecoration: "none", marginBottom: 16, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.source_url}</a>
        )}
      </div>

      {/* Renditions */}
      <div style={{ padding: "12px 24px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Renditions</div>

        <RenditionRow icon="♫" label="Audio narration" rendition={audio} onGenerate={() => handleGenerateRendition("audio")} onRemove={() => handleRemoveRendition("audio")} />
        <RenditionRow icon="📝" label="Summary" rendition={summary} isSummary onGenerate={() => handleGenerateRendition("summary")} onRemove={() => handleRemoveRendition("summary")} />
        <RenditionRow icon="🔊" label="Audio summary" rendition={audioSummary} disabled={!summary} onGenerate={() => handleGenerateRendition("audio_summary")} onRemove={() => handleRemoveRendition("audio_summary")} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
          <span style={{ fontSize: 11, color: c.textMuted }}>Voice:</span>
          <select style={{ flex: 1, background: c.bgSurface, border: `1px solid ${c.border}`, borderRadius: 5, padding: "4px 8px", color: c.text, fontSize: 11, fontFamily: "inherit", outline: "none" }}>
            {voices.map(v => <option key={v.name} value={v.name} selected={audio && audio.voice === v.name}>{voiceLabel(v.name)}</option>)}
          </select>
        </div>
      </div>

      {/* Summary display */}
      {summary && summary.text && (
        <div style={{ padding: "12px 24px", borderBottom: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Summary</div>
          <p style={{ fontSize: 13, color: c.textSecondary, lineHeight: 1.6, fontFamily: font.serif }}>{summary.text}</p>
        </div>
      )}

      {/* List assignment */}
      <div style={{ padding: "12px 24px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Lists</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {lists.map(l => {
            const isIn = membershipIds.has(l.id);
            return (
              <button
                key={l.id}
                onClick={() => onToggleListMembership(article.id, l.id, isIn)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: `1px solid ${isIn ? l.color : c.border}`,
                  background: isIn ? l.bg : "transparent", color: isIn ? l.color : c.textMuted,
                  fontSize: 11, fontWeight: isIn ? 600 : 500, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 4, transition: "0.1s",
                }}
              >
                {l.icon} {isIn ? "✓ " : "+ "}{l.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px", fontSize: 14, fontFamily: font.serif, lineHeight: 1.7, color: "#b8bac4" }}>
        {loading ? <span style={{ color: c.textDim }}>Loading...</span> : (
          fullText ? fullText.split("\n\n").filter(Boolean).map((p, i) => <p key={i} style={{ marginBottom: 12 }}>{p}</p>) : null
        )}
      </div>
    </div>
  );
}

function RenditionRow({ icon, label, rendition, isSummary, disabled, onGenerate, onRemove }) {
  const isReady = rendition && (isSummary ? true : rendition.state === "ready");
  const isGenerating = rendition && !isSummary && (rendition.state === "generating" || rendition.state === "queued");

  let statusText = "none";
  let statusClass = "none";
  if (isReady) {
    statusText = isSummary ? "ready" : `ready · ${fmtDur(rendition.duration)}`;
    statusClass = "ready";
  } else if (isGenerating) {
    statusText = "generating...";
    statusClass = "gen";
  }

  const statusColors = {
    ready: { background: c.greenBg, color: c.green },
    gen: { background: c.amberBg, color: c.amber },
    none: { background: c.bgPanel, color: c.textDim },
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
      <span style={{ fontSize: 12, color: c.textSecondary, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>{icon} {label}</span>
      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 500, ...statusColors[statusClass] }}>{statusText}</span>
      {isReady ? (
        <button onClick={onRemove} style={{ ...rendBtnStyle, color: c.red, borderColor: "rgba(248,113,113,0.2)" }}>Remove</button>
      ) : (
        <button onClick={onGenerate} disabled={disabled || isGenerating} style={{ ...rendBtnStyle, ...(disabled ? { opacity: 0.3 } : isGenerating ? { opacity: 0.5 } : {}) }} title={disabled ? "Generate summary first" : undefined}>Generate</button>
      )}
    </div>
  );
}

const rendBtnStyle = { padding: "4px 10px", borderRadius: 5, border: `1px solid ${c.border}`, background: "rgba(255,255,255,0.03)", color: c.textMuted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "0.1s" };

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
function ReadcastApp() {
  // Data
  const [articles, setArticles] = useState([]);
  const [lists, setLists] = useState([]);
  const [voices, setVoices] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [listItems, setListItems] = useState([]);
  const [focusedId, setFocusedId] = useState(null);
  const [search, setSearch] = useState("");
  const [showCreateList, setShowCreateList] = useState(false);

  // Audio playback
  const [playingIndex, setPlayingIndex] = useState(0);
  const [audioState, setAudioState] = useState({ isPlaying: false, currentTime: 0, duration: 0 });
  const audioRef = useRef(null);

  // Computed
  const activeList = useMemo(() => lists.find(l => l.id === activeListId) || null, [lists, activeListId]);
  const focusedArticle = useMemo(() => {
    if (!focusedId) return null;
    // Check list items first
    const fromItems = listItems.find(i => i.doc_id === focusedId || (i.article && i.article.id === focusedId));
    if (fromItems?.article) return fromItems.article;
    // Then all articles
    return articles.find(a => a.id === focusedId) || null;
  }, [focusedId, articles, listItems]);

  // ─── Data fetching ─────────────────────────────────────────
  const refreshArticles = useCallback(async (q = "") => {
    try {
      const suffix = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const data = await apiGet(`/api/articles${suffix}`);
      setArticles(data.articles || []);
    } catch {}
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const data = await apiGet("/api/lists");
      setLists(data.lists || []);
    } catch {}
  }, []);

  const refreshListItems = useCallback(async (listId) => {
    if (!listId) { setListItems([]); return; }
    try {
      const data = await apiGet(`/api/lists/${listId}/items`);
      setListItems(data.items || []);
    } catch {}
  }, []);

  const refreshVoices = useCallback(async () => {
    try {
      const data = await apiGet("/api/voices");
      setVoices(data.voices || []);
    } catch {}
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshArticles(search), refreshLists()]);
    if (activeListId) await refreshListItems(activeListId);
  }, [refreshArticles, refreshLists, refreshListItems, activeListId, search]);

  // Initial load
  useEffect(() => { refreshArticles(); refreshLists(); refreshVoices(); }, []);

  // Reload list items when active list changes
  useEffect(() => { refreshListItems(activeListId); }, [activeListId, refreshListItems]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => refreshArticles(search), 200);
    return () => clearTimeout(timeout);
  }, [search, refreshArticles]);

  // Poll while any articles are processing
  const hasActiveWork = articles.some(a => {
    const rend = a.renditions || {};
    const audio = rend.audio;
    return audio && (audio.state === "queued" || audio.state === "generating");
  });

  useEffect(() => {
    if (!hasActiveWork) return;
    const interval = setInterval(() => refreshAll(), 2000);
    return () => clearInterval(interval);
  }, [hasActiveWork, refreshAll]);

  // Auto-focus first doc
  useEffect(() => {
    if (!focusedId && articles.length > 0) setFocusedId(articles[0].id);
  }, [articles, focusedId]);

  // ─── Audio ─────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setAudioState(s => ({ ...s, currentTime: audio.currentTime }));
    const onMeta = () => setAudioState(s => ({ ...s, duration: audio.duration }));
    const onPlay = () => setAudioState(s => ({ ...s, isPlaying: true }));
    const onPause = () => setAudioState(s => ({ ...s, isPlaying: false }));
    const onEnded = () => { setAudioState(s => ({ ...s, isPlaying: false })); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => { audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("loadedmetadata", onMeta); audio.removeEventListener("play", onPlay); audio.removeEventListener("pause", onPause); audio.removeEventListener("ended", onEnded); };
  }, []);

  // ─── Actions ───────────────────────────────────────────────
  const handleSelectList = (id) => {
    setActiveListId(id);
    setSearch("");
    setPlayingIndex(0);
  };

  const handleCreateList = async (payload) => {
    try {
      const data = await apiJson("/api/lists", "POST", payload);
      await refreshLists();
      setActiveListId(data.list.id);
    } catch {}
  };

  const handleSelectDoc = (docId) => setFocusedId(docId);

  const handleToggleDone = async (item) => {
    if (!activeListId) return;
    try {
      await apiJson(`/api/lists/${activeListId}/items/${item.doc_id}`, "PUT", { done: !item.done });
      await refreshListItems(activeListId);
      await refreshLists();
    } catch {}
  };

  const handleToggleListMembership = async (docId, listId, isIn) => {
    try {
      if (isIn) {
        await apiDelete(`/api/lists/${listId}/items/${docId}`);
      } else {
        await apiJson(`/api/lists/${listId}/items`, "POST", { doc_id: docId });
      }
      await refreshAll();
    } catch {}
  };

  const handleBatchNarrate = async () => {
    if (!activeListId) return;
    try {
      await apiJson(`/api/lists/${activeListId}/batch-narrate`, "POST", {});
      await refreshAll();
    } catch {}
  };

  const handlePlayerToggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const handlePlayerSeek = (e) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  const handlePlayerPrev = () => setPlayingIndex(i => Math.max(0, i - 1));
  const handlePlayerNext = () => setPlayingIndex(i => Math.min(listItems.length - 1, i + 1));

  // ─── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (isTypingTarget(e.target)) return;

      const currentItems = activeListId ? listItems : articles;
      const ids = activeListId
        ? currentItems.map(i => i.doc_id || (i.article && i.article.id))
        : currentItems.map(a => a.id);
      const curIdx = ids.indexOf(focusedId);

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = Math.min(curIdx + 1, ids.length - 1);
        if (ids[next]) setFocusedId(ids[next]);
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = Math.max(curIdx - 1, 0);
        if (ids[prev]) setFocusedId(ids[prev]);
      }
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector("input[placeholder]")?.focus();
      }
      if (e.key === "Escape") {
        if (search) setSearch("");
        if (showCreateList) setShowCreateList(false);
      }
      if (e.key === "n" && focusedId) {
        apiJson(`/api/docs/${focusedId}/renditions/audio`, "POST", {}).then(() => refreshAll()).catch(() => {});
      }
      if (e.key === "s" && focusedId) {
        apiJson(`/api/docs/${focusedId}/renditions/summary`, "POST", {}).then(() => refreshAll()).catch(() => {});
      }
      if (e.key === "e" && activeList?.type === "todo") {
        const item = listItems.find(i => i.doc_id === focusedId);
        if (item) handleToggleDone(item);
      }
      // Number keys to switch lists
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        const allListIds = [null, ...lists.map(l => l.id)];
        if (num <= allListIds.length) handleSelectList(allListIds[num - 1]);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedId, activeListId, listItems, articles, lists, search, showCreateList, activeList]);

  return (
    <>
      <style>{globalStyles}</style>
      <audio ref={audioRef} preload="metadata" />
      <NavSidebar
        lists={lists} activeListId={activeListId} totalCount={articles.length}
        onSelectList={handleSelectList} onCreateList={() => setShowCreateList(true)}
      />
      <CenterPanel
        activeList={activeList} articles={articles} listItems={listItems}
        focusedId={focusedId} onSelectDoc={handleSelectDoc} onToggleDone={handleToggleDone}
        playingIndex={playingIndex} audioState={audioState}
        onBatchNarrate={handleBatchNarrate}
        onPlayerToggle={handlePlayerToggle} onPlayerSeek={handlePlayerSeek}
        onPlayerPrev={handlePlayerPrev} onPlayerNext={handlePlayerNext}
        search={search} onSearchChange={setSearch}
      />
      <DetailPanel
        article={focusedArticle} lists={lists} voices={voices}
        onRefresh={refreshAll} onToggleListMembership={handleToggleListMembership}
      />
      {showCreateList && <CreateListModal onClose={() => setShowCreateList(false)} onCreate={handleCreateList} />}
    </>
  );
}

// ─── Mount ──────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<ReadcastApp />);
