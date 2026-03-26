import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ─── Design tokens ──────────────────────────────────────────
const C = {
  bg0: "#08090d", bg1: "#0c0d12", bg2: "#13151d", bg3: "#181b26", bg4: "#1e2130",
  br: "#222538", br2: "#181a28", br3: "#2a2d42",
  t1: "#e4e5ea", t2: "#a0a4b8", t3: "#6b7084", t4: "#4a4d60", t5: "#363849",
  acc: "#6c8cff", acc2: "#5474e8", abg: "rgba(108,140,255,0.1)", abr: "rgba(108,140,255,0.25)",
  grn: "#4ade80", gbg: "rgba(74,222,128,0.1)",
  red: "#f87171", rbg: "rgba(248,113,113,0.1)",
  amb: "#ef9f27", ambg: "rgba(239,159,39,0.1)",
  pur: "#a78bfa", pbg: "rgba(167,139,250,0.1)",
  teal: "#2dd4bf", tbg: "rgba(45,212,191,0.1)",
  rose: "#fb7185", rosebg: "rgba(251,113,133,0.1)",
  sky: "#38bdf8", skybg: "rgba(56,189,248,0.1)",
};
const FONT = {
  sans: "'DM Sans', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', monospace",
};

// Type definitions — stable rail items
const TYPES = [
  { key: "all", icon: "\u2299", label: "All Items" },
  { key: "action", icon: "\u2610", label: "Action Items", listType: "todo" },
  { key: "collection", icon: "\u25ce", label: "Collections", listType: "collection" },
  { key: "playlist", icon: "\u266b", label: "Playlists", listType: "playlist" },
];

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const EMOJIS = ["\ud83d\udccc","\ud83d\udcda","\ud83c\udfaf","\ud83d\udd2c","\ud83d\udca1","\ud83c\udfd7","\ud83d\udcca","\ud83c\udfa8","\ud83e\uddea","\ud83d\uddfa","\u270f\ufe0f","\ud83d\udd16","\ud83c\udf93","\ud83d\udce1","\ud83d\udee0","\u2709","\ud83e\udde0","\ud83c\udf0d","\ud83c\udfa7","\u26a1","\ud83d\udcd6","\ud83d\udd2e"];

const COLOR_CLASSES = {
  "on-amb": { border: "rgba(239,159,39,0.3)", color: C.amb, bg: C.ambg },
  "on-pur": { border: "rgba(167,139,250,0.25)", color: C.pur, bg: C.pbg },
  "on-red": { border: "rgba(248,113,113,0.25)", color: C.red, bg: C.rbg },
  "on-teal": { border: "rgba(45,212,191,0.25)", color: C.teal, bg: C.tbg },
  "on-acc": { border: C.abr, color: C.acc, bg: C.abg },
  "on-sky": { border: "rgba(56,189,248,0.25)", color: C.sky, bg: C.skybg },
  "on-rose": { border: "rgba(251,113,133,0.25)", color: C.rose, bg: C.rosebg },
  "on-grn": { border: "rgba(74,222,128,0.25)", color: C.grn, bg: C.gbg },
};

// ─── Global CSS ─────────────────────────────────────────────
const globalCSS = `
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes fadeIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@keyframes flashAcc{0%{background:rgba(108,140,255,0.18)}100%{background:transparent}}
@keyframes b1{0%,100%{height:3px}50%{height:10px}}
@keyframes b2{0%,100%{height:8px}50%{height:3px}}
@keyframes b3{0%,100%{height:5px}50%{height:12px}}
@keyframes popIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:${C.bg0};color:${C.t1};font-family:${FONT.sans};overflow:hidden;-webkit-font-smoothing:antialiased}
#root{display:flex;flex-direction:column;height:100%;overflow:hidden}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select{font-family:inherit}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.br};border-radius:2px}
::selection{background:rgba(108,140,255,0.3)}
.eq{display:flex;align-items:flex-end;gap:1px;height:14px}
.eq span{width:2px;background:${C.acc};border-radius:1px}
.eq span:nth-child(1){animation:b1 .8s infinite}
.eq span:nth-child(2){animation:b2 .7s infinite}
.eq span:nth-child(3){animation:b3 .9s infinite}
`;

// ─── Utilities ──────────────────────────────────────────────
function fmtDur(seconds) {
  if (!seconds && seconds !== 0) return "\u2014";
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60), s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtSpeed(s) { return s === 1 ? "1\u00d7" : s + "\u00d7"; }

function sourceLabel(article) {
  const raw = article.source || article.publication || article.source_url || article.source_file || "";
  if (!raw) return "Pasted";
  try {
    if (raw.startsWith("http")) {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      const parts = host.split(".");
      if (parts.length >= 2) {
        const domain = parts[parts.length - 2];
        if (host === "github.com") return "Github";
        if (host === "x.com") return "x.com";
        if (host.includes("substack")) return "Substack";
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
    }
  } catch {}
  if (raw.startsWith("plugin:")) return raw;
  if (raw.length <= 30 && !raw.includes("/")) return raw;
  return raw.split("/").pop() || raw || "Pasted";
}

function timeAgo(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso), now = new Date(), diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    return `${Math.floor(diffH / 24)}d`;
  } catch { return ""; }
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function listsOfType(lists, typeKey) {
  const t = TYPES.find(x => x.key === typeKey);
  if (!t || !t.listType) return [];
  return lists.filter(l => l.type === t.listType);
}

function totalDurSecs(items) {
  return items.reduce((sum, item) => {
    const art = item.article || item;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return sum + (r && r.duration ? r.duration : 0);
  }, 0);
}

function listColorClass(list) {
  // Map list color to a pill color class name
  if (!list) return null;
  const c = list.color || "";
  if (c.includes("amb") || c.includes("ef9f")) return "on-amb";
  if (c.includes("pur") || c.includes("a855") || c.includes("a78b")) return "on-pur";
  if (c.includes("red") || c.includes("f871")) return "on-red";
  if (c.includes("teal") || c.includes("2dd4")) return "on-teal";
  if (c.includes("sky") || c.includes("38bd")) return "on-sky";
  if (c.includes("rose") || c.includes("fb71")) return "on-rose";
  if (c.includes("4ade") || c.includes("grn")) return "on-grn";
  return "on-acc";
}

// ─── API helpers ────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) { let d = `Request failed (${r.status})`; try { d = (await r.json()).detail || d; } catch {} throw new Error(d); }
  return r.json();
}
async function apiJson(path, method, body) {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { let d = `Request failed (${r.status})`; try { d = (await r.json()).detail || d; } catch {} throw new Error(d); }
  return r.status === 204 ? null : r.json();
}
async function apiDelete(path) {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok && r.status !== 204) { let d = `Request failed (${r.status})`; try { d = (await r.json()).detail || d; } catch {} throw new Error(d); }
  return null;
}

// ═════════════════════════════════════════════════════════════
// NAV RAIL — 4 fixed type buttons
// ═════════════════════════════════════════════════════════════
function NavRail({ railType, onNavType, lists }) {
  const hasDueItems = lists.some(l => l.type === "todo" && l.item_count > 0);
  return (
    <div data-testid="nav-rail" style={{
      width: 40, flexShrink: 0, borderRight: `1px solid ${C.br}`,
      background: C.bg0, display: "flex", flexDirection: "column",
      alignItems: "center", paddingTop: 10, gap: 2,
    }}>
      {TYPES.map((t, i) => {
        const isOn = railType === t.key;
        const matching = t.listType ? lists.filter(l => l.type === t.listType) : [];
        const count = matching.length;
        return (
          <React.Fragment key={t.key}>
            <button data-testid={`rail-${t.key}`} onClick={() => onNavType(t.key)} title={t.label}
              style={{
                width: 30, height: 30, borderRadius: 7, border: "none", position: "relative",
                background: isOn ? C.abg : "transparent", color: isOn ? C.acc : C.t4,
                fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: ".12s", flexShrink: 0,
              }}
              onMouseEnter={e => { if (!isOn) { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t2; } }}
              onMouseLeave={e => { if (!isOn) { e.currentTarget.style.background = isOn ? C.abg : "transparent"; e.currentTarget.style.color = isOn ? C.acc : C.t4; } }}
            >
              {t.icon}
              {t.key === "action" && hasDueItems && (
                <span style={{ position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "50%", background: C.amb }} />
              )}
              {count > 1 && (
                <span style={{ position: "absolute", bottom: 2, right: 1, fontSize: 7, fontWeight: 700, color: isOn ? C.acc : C.t4, fontFamily: FONT.mono }}>{count}</span>
              )}
            </button>
            {i === 0 && <div style={{ width: 20, height: 1, background: C.br2, margin: "4px 0", flexShrink: 0 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// CHOOSER VIEW — cards for each list of a type
// ═════════════════════════════════════════════════════════════
function ChooserView({ typeInfo, matchingLists, onSelectList, onCreateList, playerPlaylistId, listItemCounts }) {
  const gradients = {
    playlist: "linear-gradient(135deg,rgba(108,140,255,0.15),rgba(167,139,250,0.1))",
    collection: "linear-gradient(135deg,rgba(167,139,250,0.12),rgba(45,212,191,0.08))",
    todo: "linear-gradient(135deg,rgba(239,159,39,0.12),rgba(248,113,113,0.08))",
  };
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 42 }}>
        <span style={{ fontSize: 14 }}>{typeInfo.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{typeInfo.label}</span>
        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: C.abg, color: C.acc, fontFamily: FONT.mono }}>{matchingLists.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "4px 0" }}>
        {matchingLists.map(l => {
          const isActive = l.id === playerPlaylistId;
          return (
            <div key={l.id} onClick={() => onSelectList(l.id)}
              style={{
                padding: 12, margin: "6px 10px", borderRadius: 10,
                border: `1px solid ${isActive ? C.acc : C.br}`,
                background: isActive ? "rgba(108,140,255,0.06)" : C.bg3,
                cursor: "pointer", display: "flex", gap: 12, alignItems: "center", transition: ".12s",
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = C.t4; e.currentTarget.style.background = C.bg4; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = C.br; e.currentTarget.style.background = C.bg3; } }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0, background: gradients[l.type] || gradients.collection }}>{l.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{l.name}</div>
                <div style={{ fontSize: 10, color: C.t3 }}>{l.item_count || 0} items</div>
              </div>
              {isActive && <div className="eq" style={{ flexShrink: 0 }}><span /><span /><span /></div>}
              <span style={{ color: C.t5, fontSize: 14, flexShrink: 0 }}>{"\u203a"}</span>
            </div>
          );
        })}
        {/* New list card */}
        <div onClick={() => onCreateList(typeInfo.listType)}
          style={{
            padding: 12, margin: "6px 10px", borderRadius: 10,
            border: `1px dashed ${C.t5}`, background: "transparent",
            cursor: "pointer", display: "flex", gap: 12, alignItems: "center", transition: ".12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.t4; e.currentTarget.style.background = C.bg3; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.t5; e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, background: C.bg2, color: C.t4 }}>+</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.t3 }}>New {typeInfo.listType || "list"}</div>
            <div style={{ fontSize: 10, color: C.t4 }}>Create a new {typeInfo.listType === "playlist" ? "ordered playlist" : typeInfo.listType === "todo" ? "action list" : "collection"}</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════
// CENTER PANEL
// ═════════════════════════════════════════════════════════════
function CenterPanel({
  railType, activeList, lists, articles, listItems, focusedId, search,
  onSelectDoc, onSearchChange, onSelectList, onBackToChooser, onCreateList,
  playerPlaylistId, playerIdx, isPlaying, audioCurrentTime, audioDuration,
  onPlayerToggle, onPlayerSeek, onPlayerPrev, onPlayerNext,
  onBatchNarrate, onLoadPlaylist, onToggleDone, onPlayNow, onAddToQueue,
  editing, onToggleEditing, onRenameList, onDeleteList,
  speed, onCycleSpeed, onRemoveFromList,
}) {
  const typeInfo = TYPES.find(t => t.key === railType);
  const matching = typeInfo?.listType ? lists.filter(l => l.type === typeInfo.listType) : [];
  const list = activeList ? lists.find(l => l.id === activeList) : null;
  const showChooser = railType !== "all" && !activeList;
  const showBack = list && matching.length > 1;

  // Playlist view
  if (list && list.type === "playlist") {
    const docs = listItems;
    const totalSecs = totalDurSecs(docs);
    const needsNarr = docs.filter(i => { const r = (i.article?.renditions || {}).audio; return !r || r.state !== "ready"; }).length;
    const isActivePlaylist = playerPlaylistId === list.id;
    const isNon1 = speed !== 1;

    return (
      <div data-testid="center-panel" style={{ width: 350, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>
        {/* Playlist hero */}
        <div data-testid="playlist-hero" style={{ padding: "14px 12px 10px", borderBottom: `1px solid ${C.br}`, background: "linear-gradient(180deg,rgba(108,140,255,0.06) 0%,transparent 100%)", flexShrink: 0 }}>
          {showBack && <div style={{ fontSize: 10, color: C.acc, cursor: "pointer", marginBottom: 6, display: "flex", alignItems: "center", gap: 3 }} onClick={onBackToChooser}>{"\u2039"} All {typeInfo.label}</div>}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: 9, background: "linear-gradient(135deg,rgba(108,140,255,0.2),rgba(167,139,250,0.15))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{list.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 1 }}>{list.name}</div>
              <div style={{ fontSize: 10, color: C.t3 }}>
                {docs.length} tracks {"\u00b7"} {fmtDur(totalSecs)}
                {isNon1 && <span style={{ color: C.acc }}> ({fmtDur(Math.round(totalSecs / speed))} at {fmtSpeed(speed)})</span>}
                {needsNarr > 0 && <span style={{ color: C.amb }}> {"\u00b7"} {needsNarr} unnarrated</span>}
              </div>
            </div>
            <button data-testid="play-all-btn" onClick={() => onLoadPlaylist(list.id)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{"\u25b6"} Play all</button>
            <button onClick={onCycleSpeed} style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${isNon1 ? C.abr : C.br}`, background: isNon1 ? C.abg : C.bg3, color: isNon1 ? C.acc : C.t2, fontSize: 9, fontWeight: 600, fontFamily: FONT.mono, cursor: "pointer", minWidth: 34, textAlign: "center" }}>{fmtSpeed(speed)}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={onToggleEditing} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${editing ? C.acc : C.br}`, background: editing ? C.acc : "transparent", color: editing ? C.bg0 : C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editing ? "\u2713 Done" : "\u270e Edit"}</button>
            {editing && <>
              <button onClick={onRenameList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{"\u270f"} Rename</button>
              <button onClick={onDeleteList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid rgba(248,113,113,0.2)`, background: "transparent", color: C.red, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", marginLeft: "auto" }}>{"\ud83d\uddd1"} Delete</button>
            </>}
            {!editing && needsNarr > 0 && <button onClick={() => onBatchNarrate(list.id)} style={{ padding: "2px 6px", borderRadius: 5, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 8, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{"\ud83c\udf99"} Generate {needsNarr}</button>}
          </div>
        </div>
        {editing ? (
          <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.br}`, background: "rgba(108,140,255,0.04)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.acc, textTransform: "uppercase", letterSpacing: 0.5 }}>Edit mode</span>
            <span style={{ fontSize: 9, color: C.t4, marginLeft: "auto" }}>Click {"\u00d7"} to remove</span>
          </div>
        ) : (
          <div style={{ padding: "4px 12px", borderBottom: `1px solid ${C.br2}`, fontSize: 8, color: C.t5, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", flexShrink: 0 }}>
            <span>TRACKLIST</span><span style={{ flex: 1 }} /><span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>drag to reorder</span>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {docs.map((item, idx) => {
            const art = item.article; if (!art) return null;
            const rend = art.renditions || {};
            const r = item.use_summary ? rend.audio_summary : rend.audio;
            const aState = r ? (r.state === "ready" ? "ready" : "gen") : "miss";
            const isP = isActivePlaylist && playerIdx === idx;
            const isSel = focusedId === (item.doc_id || art.id);
            return (
              <div key={item.doc_id || art.id} onClick={() => onSelectDoc(item.doc_id || art.id)}
                style={{
                  padding: "7px 12px", borderBottom: `1px solid ${C.br2}`, cursor: "pointer",
                  display: "flex", gap: 7, alignItems: "center", transition: "background .06s",
                  background: isP ? "rgba(108,140,255,0.04)" : isSel ? C.bg4 : "transparent",
                  borderLeft: isSel ? `2px solid ${C.acc}` : "2px solid transparent",
                }}
                onMouseEnter={e => { if (!isSel && !isP) e.currentTarget.style.background = C.bg3; }}
                onMouseLeave={e => { if (!isSel && !isP) e.currentTarget.style.background = isP ? "rgba(108,140,255,0.04)" : "transparent"; }}
              >
                <span style={{ width: 18, fontSize: 10, color: isP ? C.acc : C.t4, textAlign: "center", fontFamily: FONT.mono, flexShrink: 0 }}>{isP ? "\u25b6" : idx + 1}</span>
                <span style={{ cursor: "grab", color: C.t5, fontSize: 12, flexShrink: 0 }}>{"\u2807"}</span>
                <span style={{ width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, flexShrink: 0, background: aState === "ready" ? C.abg : aState === "gen" ? C.ambg : C.rbg, color: aState === "ready" ? C.acc : aState === "gen" ? C.amb : C.red }}>{aState === "ready" ? "\u266b" : aState === "gen" ? "\u25cc" : "\u2715"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: isP || isSel ? 600 : 400, color: isP ? C.t1 : C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</div>
                </div>
                <span style={{ fontSize: 9, color: C.t4, fontFamily: FONT.mono, flexShrink: 0 }}>{fmtDur(r?.duration)}</span>
                <span style={{ fontSize: 13, color: C.red, cursor: "pointer", flexShrink: 0, width: 16, textAlign: "center", opacity: editing ? 0.4 : 0, transition: "opacity .1s" }}
                  onClick={e => { e.stopPropagation(); onRemoveFromList(item.doc_id || art.id, list.id); }}
                  onMouseEnter={e => { if (editing) e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={e => { if (editing) e.currentTarget.style.opacity = "0.4"; }}
                >{"\u00d7"}</span>
              </div>
            );
          })}
          {docs.length === 0 && <div style={{ padding: 24, textAlign: "center", color: C.t4, fontSize: 11 }}>Empty playlist. Browse All Items and use the list pills to add tracks.</div>}
        </div>
      </div>
    );
  }

  // Action list view
  if (list && list.type === "todo") {
    const docs = [...listItems].sort((a, b) => {
      if (a.due && b.due) return a.due < b.due ? -1 : 1;
      return a.due ? -1 : 1;
    });
    return (
      <div data-testid="center-panel" style={{ width: 350, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 42, background: "rgba(239,159,39,0.03)" }}>
          {showBack && <span style={{ fontSize: 10, color: C.acc, cursor: "pointer", marginRight: 4 }} onClick={onBackToChooser}>{"\u2039"}</span>}
          <span style={{ fontSize: 14 }}>{list.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{list.name}</span>
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: C.ambg, color: C.amb, fontFamily: FONT.mono }}>{docs.length}</span>
          <button onClick={onToggleEditing} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${editing ? C.acc : C.br}`, background: editing ? C.acc : "transparent", color: editing ? C.bg0 : C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editing ? "\u2713 Done" : "\u270e Edit"}</button>
        </div>
        {editing && (
          <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.br}`, background: "rgba(108,140,255,0.04)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.acc, textTransform: "uppercase", letterSpacing: 0.5 }}>Edit mode</span>
            <button onClick={onRenameList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{"\u270f"} Rename</button>
            <button onClick={onDeleteList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid rgba(248,113,113,0.2)`, background: "transparent", color: C.red, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", marginLeft: "auto" }}>{"\ud83d\uddd1"} Delete</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {docs.map(item => {
            const art = item.article; if (!art) return null;
            const isSel = focusedId === (item.doc_id || art.id);
            return (
              <div key={item.doc_id || art.id} onClick={() => onSelectDoc(item.doc_id || art.id)}
                style={{ padding: "7px 10px", borderBottom: `1px solid ${C.br2}`, cursor: "pointer", display: "flex", gap: 7, alignItems: "center", transition: "background .06s", background: isSel ? C.bg4 : "transparent", borderLeft: isSel ? `2px solid ${C.acc}` : "2px solid transparent" }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = C.bg3; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: isSel ? 600 : 500, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</div>
                  <div style={{ fontSize: 9, color: C.t3, marginTop: 1 }}>{sourceLabel(art)} {"\u00b7"} {timeAgo(art.ingested_at)}{item.due ? <> {"\u00b7"} <span style={{ color: C.amb, fontWeight: 500 }}>due {item.due}</span></> : ""}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); onToggleDone(item); }} style={{ padding: "2px 5px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 8, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>{"\u2713"} Done</button>
              </div>
            );
          })}
          {docs.length === 0 && <div style={{ padding: 24, textAlign: "center", color: C.t4, fontSize: 11 }}>All done! {"\ud83c\udf89"}</div>}
        </div>
      </div>
    );
  }

  // Collection view
  if (list && list.type === "collection") {
    const docs = listItems;
    const needsNarr = docs.filter(i => { const r = (i.article?.renditions || {}).audio; return !r || r.state !== "ready"; }).length;
    return (
      <div data-testid="center-panel" style={{ width: 350, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 42 }}>
          {showBack && <span style={{ fontSize: 10, color: C.acc, cursor: "pointer", marginRight: 4 }} onClick={onBackToChooser}>{"\u2039"}</span>}
          <span style={{ fontSize: 14 }}>{list.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{list.name}</span>
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: list.bg || C.pbg, color: list.color || C.pur, fontFamily: FONT.mono }}>{docs.length}</span>
          <button onClick={onToggleEditing} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${editing ? C.acc : C.br}`, background: editing ? C.acc : "transparent", color: editing ? C.bg0 : C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editing ? "\u2713 Done" : "\u270e Edit"}</button>
        </div>
        {editing && (
          <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.br}`, background: "rgba(108,140,255,0.04)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.acc, textTransform: "uppercase", letterSpacing: 0.5 }}>Edit mode</span>
            <button onClick={onRenameList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{"\u270f"} Rename</button>
            <button onClick={onDeleteList} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid rgba(248,113,113,0.2)`, background: "transparent", color: C.red, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", marginLeft: "auto" }}>{"\ud83d\uddd1"} Delete</button>
          </div>
        )}
        {!editing && needsNarr > 0 && (
          <div style={{ padding: "5px 12px", borderBottom: `1px solid ${C.br2}`, display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.amb, flexShrink: 0, background: "rgba(239,159,39,0.03)" }}>
            {"\ud83c\udf99"} {needsNarr} need narration
            <button onClick={() => onBatchNarrate(list.id)} style={{ padding: "2px 6px", borderRadius: 5, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 8, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", marginLeft: "auto" }}>Generate all</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {docs.map(item => {
            const art = item.article; if (!art) return null;
            return <DocRow key={art.id} article={art} isFocused={focusedId === art.id} onSelect={onSelectDoc} onPlayNow={onPlayNow} showRemove={editing} onRemove={() => onRemoveFromList(art.id, list.id)} />;
          })}
          {docs.length === 0 && <div style={{ padding: 24, textAlign: "center", color: C.t4, fontSize: 11 }}>Empty. Use list pills on any doc to add items.</div>}
        </div>
      </div>
    );
  }

  // Chooser view
  if (showChooser) {
    return (
      <div data-testid="center-panel" style={{ width: 350, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>
        <ChooserView typeInfo={typeInfo} matchingLists={matching} onSelectList={onSelectList} onCreateList={onCreateList} playerPlaylistId={playerPlaylistId} />
      </div>
    );
  }

  // All Items view (default)
  const dueCount = articles.filter(a => {
    const mems = a.list_memberships || [];
    return mems.some(m => { const l = lists.find(ll => ll.id === m.id); return l && l.type === "todo"; });
  }).length;
  const narrCount = articles.filter(a => { const r = (a.renditions || {}).audio; return !r || r.state !== "ready"; }).length;

  let filtered = articles;
  if (search) {
    const q = search.toLowerCase();
    filtered = articles.filter(a => (a.title || "").toLowerCase().includes(q) || sourceLabel(a).toLowerCase().includes(q));
  }

  return (
    <div data-testid="center-panel" style={{ width: 350, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 42 }}>
        <span style={{ fontSize: 14 }}>{"\u2299"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>All Items</span>
        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: C.abg, color: C.acc, fontFamily: FONT.mono }}>{articles.length}</span>
      </div>
      {/* Orientation chips */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
        {dueCount > 0 && <div onClick={() => onSelectList(null, "action")} style={{ padding: "3px 8px", borderRadius: 5, fontSize: 9, fontWeight: 600, background: C.ambg, color: C.amb, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>{"\u2709"} {dueCount} due</div>}
        {narrCount > 0 && <div style={{ padding: "3px 8px", borderRadius: 5, fontSize: 9, fontWeight: 600, background: "rgba(108,140,255,0.08)", color: C.acc, display: "flex", alignItems: "center", gap: 4 }}>{"\ud83c\udf99"} {narrCount} unnarrated <button onClick={() => onBatchNarrate(null)} style={{ padding: "1px 5px", borderRadius: 3, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 7, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", marginLeft: 2 }}>Gen all</button></div>}
      </div>
      {/* Search */}
      <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.br2}`, flexShrink: 0, position: "relative" }}>
        <span style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: C.t5, pointerEvents: "none" }}>{"\u2315"}</span>
        <input data-testid="search-input" value={search} onChange={e => onSearchChange(e.target.value)}
          placeholder="Search documents..." style={{ width: "100%", padding: "5px 8px 5px 26px", borderRadius: 6, border: `1px solid ${C.br}`, background: C.bg3, color: C.t1, fontSize: 11, fontFamily: "inherit", outline: "none" }}
          onFocus={e => e.target.style.borderColor = C.acc} onBlur={e => e.target.style.borderColor = C.br}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {filtered.map(a => <DocRow key={a.id} article={a} isFocused={focusedId === a.id} onSelect={onSelectDoc} onPlayNow={onPlayNow} lists={lists} />)}
        {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: C.t4, fontSize: 11 }}>No results</div>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// DOC ROW
// ═════════════════════════════════════════════════════════════
function DocRow({ article, isFocused, onSelect, onPlayNow, lists, showRemove, onRemove }) {
  const rend = article.renditions || {};
  const audio = rend.audio;
  const audioReady = audio && audio.state === "ready";
  const tags = article.tags || [];
  const memberships = article.list_memberships || [];

  return (
    <div data-testid={`doc-row-${article.id}`} onClick={() => onSelect(article.id)}
      style={{
        padding: "7px 10px", borderBottom: `1px solid ${C.br2}`, cursor: "pointer",
        display: "flex", gap: 7, alignItems: "flex-start", transition: "background .06s",
        background: isFocused ? C.bg4 : "transparent",
        borderLeft: isFocused ? `2px solid ${C.acc}` : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = C.bg3; }}
      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = isFocused ? C.bg4 : "transparent"; }}
    >
      <div style={{ width: 20, height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, flexShrink: 0, marginTop: 1, background: audioReady ? C.abg : C.bg3, color: audioReady ? C.acc : C.t4 }}>{audioReady ? "\u266b" : "\u266a"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: isFocused ? 600 : 500, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.title}</div>
        <div style={{ fontSize: 9, color: C.t3, marginTop: 1 }}>
          {sourceLabel(article)} {"\u00b7"} {timeAgo(article.ingested_at)}
          {audio?.duration ? <> {"\u00b7"} <span style={{ fontFamily: FONT.mono }}>{fmtDur(audio.duration)}</span></> : ""}
        </div>
        {memberships.length > 0 && (
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginTop: 2 }}>
            {memberships.map(m => <span key={m.id} style={{ fontSize: 7.5, padding: "2px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", background: m.bg || C.abg, color: m.color || C.acc }}>{m.icon}</span>)}
          </div>
        )}
      </div>
      {showRemove && (
        <button style={{ fontSize: 13, color: C.red, cursor: "pointer", background: "none", border: "none", padding: 2, flexShrink: 0 }} onClick={e => { e.stopPropagation(); onRemove(); }}>{"\u00d7"}</button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═════════════════════════════════════════════════════════════
function DetailPanel({ article, lists, onRefresh, onToggleListMembership, onPlayNow, playerPlaylistId }) {
  const [fullText, setFullText] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!article) return;
    setLoading(true); setFullText(null);
    apiGet(`/api/articles/${article.id}/text`)
      .then(data => setFullText(data.text || ""))
      .catch(() => setFullText("(Could not load text)"))
      .finally(() => setLoading(false));
  }, [article?.id]);

  if (!article) return (
    <div data-testid="detail-panel" style={{ flex: 1, background: C.bg2, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, minHeight: 0 }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 28, marginBottom: 8 }}>{"\ud83d\udcc4"}</div><div style={{ fontSize: 12, color: C.t4 }}>Select a document</div></div>
    </div>
  );

  const rend = article.renditions || {};
  const audio = rend.audio;
  const audioReady = audio && audio.state === "ready";
  const audioGen = audio && (audio.state === "generating" || audio.state === "queued");
  const memberships = article.list_memberships || [];
  const membershipIds = new Set(memberships.map(m => m.id));

  // Play context
  const inPlaylists = lists.filter(l => l.type === "playlist" && membershipIds.has(l.id));
  let playLabel = "\u25b6 Play";
  if (inPlaylists.length === 1) playLabel = `\u25b6 Play in ${inPlaylists[0].name}`;

  const handleGenerateRendition = async (type) => {
    try { await apiJson(`/api/docs/${article.id}/renditions/${type}`, "POST", {}); if (onRefresh) onRefresh(); } catch {}
  };

  return (
    <div data-testid="detail-panel" style={{ flex: 1, overflowY: "scroll", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", background: C.bg2, minWidth: 0, minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${C.br}` }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 4 }}>{article.title}</div>
        <div style={{ fontSize: 10, color: C.t3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>{sourceLabel(article)}</span><span>{"\u00b7"}</span><span>{timeAgo(article.ingested_at)}</span>
          {audio?.duration && <><span>{"\u00b7"}</span><span style={{ fontFamily: FONT.mono }}>{fmtDur(audio.duration)}</span></>}
        </div>
      </div>
      {/* Metadata */}
      {(article.source_url || article.author || article.publication || article.published_date || article.word_count) && (
        <div style={{ padding: "8px 24px", borderBottom: `1px solid ${C.br2}`, display: "flex", flexDirection: "column", gap: 4 }}>
          {article.source_url && (
            <div style={{ fontSize: 10, color: C.t3, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: C.t4, flexShrink: 0 }}>Source:</span>
              <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                style={{ color: C.acc, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
              >{article.source_url}</a>
            </div>
          )}
          <div style={{ fontSize: 10, color: C.t3, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {article.author && <span><span style={{ color: C.t4 }}>By</span> {article.author}</span>}
            {article.publication && <span><span style={{ color: C.t4 }}>in</span> {article.publication}</span>}
            {article.published_date && <span><span style={{ color: C.t4 }}>published</span> {article.published_date}</span>}
            {article.word_count > 0 && <span style={{ fontFamily: FONT.mono }}>{article.word_count.toLocaleString()} words</span>}
          </div>
        </div>
      )}
      {/* Rendition bar */}
      <div style={{ padding: "8px 24px", borderBottom: `1px solid ${C.br}`, display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        {audioReady ? (
          <>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: C.abg, color: C.acc, fontWeight: 500 }}>{"\u266b"} {fmtDur(audio.duration)}</span>
            <button onClick={() => onPlayNow(article.id)} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{playLabel}</button>
          </>
        ) : audioGen ? (
          <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: C.ambg, color: C.amb, fontWeight: 500, animation: "pulse 1.2s infinite" }}>{"\u25cc"} Generating...</span>
        ) : (
          <>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: C.bg1, color: C.t4 }}>{"\u266a"} No audio</span>
            <button onClick={() => handleGenerateRendition("audio")} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Generate narration</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => handleGenerateRendition("summary")} style={{ padding: "3px 6px", border: "none", background: "none", color: C.t4, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>{"\ud83d\udcdd"} Summary</button>
      </div>
      {/* List pills — functional toggles */}
      <div style={{ padding: "10px 24px", borderBottom: `1px solid ${C.br}`, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.t4, marginRight: 2 }}>Lists:</span>
        {lists.map(l => {
          const isIn = membershipIds.has(l.id);
          const cls = COLOR_CLASSES[listColorClass(l)] || COLOR_CLASSES["on-acc"];
          return (
            <button key={l.id} onClick={() => onToggleListMembership(article.id, l.id, isIn)}
              style={{
                fontSize: 9, padding: "3px 8px", borderRadius: 10, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 3, transition: ".12s", fontFamily: "inherit",
                border: `1px solid ${isIn ? cls.border : C.br}`,
                background: isIn ? cls.bg : "transparent",
                color: isIn ? cls.color : C.t3,
              }}
            >{l.icon} {isIn ? l.name : `+ ${l.name}`}</button>
          );
        })}
      </div>
      {/* Body text */}
      <div style={{ padding: "16px 24px", fontFamily: FONT.serif, fontSize: 14, lineHeight: 1.75, color: "#b8bac4" }}>
        {loading ? <span style={{ color: C.t4 }}>Loading...</span> : (
          fullText ? fullText.split("\n\n").filter(Boolean).map((p, i) => <p key={i} style={{ marginBottom: 10 }}>{p}</p>) : null
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// QUEUE PEEK POPOVER (replaces RightDrawer)
// ═════════════════════════════════════════════════════════════
function QueuePeekPopover({ items, playlist, playerIdx, onJumpTo, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  if (!playlist) return null;
  return (
    <div ref={ref} style={{
      position: "absolute", bottom: "calc(100% + 6px)", right: 14, width: 280,
      background: C.bg1, border: `1px solid ${C.br}`, borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 50, overflow: "hidden",
      animation: "popIn .15s ease", maxHeight: 320, display: "flex", flexDirection: "column",
    }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.acc }}>{playlist.icon} {playlist.name}</span>
        <span style={{ fontSize: 9, color: C.t4, fontFamily: FONT.mono, marginLeft: "auto" }}>{items.length} tracks</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", maxHeight: 240 }}>
        {items.map((item, i) => {
          const art = item.article || item;
          const isNow = i === playerIdx;
          const rend = art.renditions || {};
          const r = item.use_summary ? rend.audio_summary : rend.audio;
          return (
            <div key={item.doc_id || art.id} onClick={() => onJumpTo(i)}
              style={{ padding: "5px 10px", display: "flex", gap: 6, alignItems: "center", fontSize: 10, borderBottom: `1px solid ${C.br2}`, transition: "background .06s", cursor: "pointer", background: isNow ? "rgba(108,140,255,0.05)" : "transparent" }}
              onMouseEnter={e => { if (!isNow) e.currentTarget.style.background = C.bg3; }}
              onMouseLeave={e => { if (!isNow) e.currentTarget.style.background = isNow ? "rgba(108,140,255,0.05)" : "transparent"; }}
            >
              <span style={{ width: 16, fontSize: 9, color: isNow ? C.acc : C.t4, textAlign: "center", fontFamily: FONT.mono, flexShrink: 0 }}>{isNow ? "\u25b6" : i + 1}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isNow ? C.t1 : C.t2, fontWeight: isNow ? 600 : 400 }}>{art.title}</span>
              <span style={{ fontSize: 8, color: C.t4, fontFamily: FONT.mono, flexShrink: 0 }}>{fmtDur(r?.duration)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// SPEED POPOVER
// ═════════════════════════════════════════════════════════════
function SpeedPopover({ speed, onSetSpeed, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: "absolute", bottom: "calc(100% + 6px)", right: 0,
      background: C.bg1, border: `1px solid ${C.br}`, borderRadius: 8,
      padding: 4, display: "flex", flexDirection: "column", gap: 1,
      zIndex: 50, minWidth: 52, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", animation: "popIn .12s ease",
    }}>
      {SPEEDS.map(s => (
        <button key={s} onClick={() => onSetSpeed(s)} style={{
          padding: "4px 8px", borderRadius: 5, fontSize: 10, fontWeight: speed === s ? 700 : 500,
          fontFamily: FONT.mono, color: speed === s ? C.acc : C.t3, background: speed === s ? C.abg : "none",
          border: "none", cursor: "pointer", textAlign: "center", width: "100%", transition: ".08s",
        }}
          onMouseEnter={e => { if (speed !== s) { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t1; } }}
          onMouseLeave={e => { if (speed !== s) { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.t3; } }}
        >{fmtSpeed(s)}</button>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// BOTTOM BAR
// ═════════════════════════════════════════════════════════════
function BottomBar({ article, playlist, isPlaying, currentTime, duration, playerIdx, playerItems, speed, speedOpen, queuePeek, onTogglePlay, onPrev, onNext, onSeek, onToggleQueuePeek, onToggleSpeedPop, onSetSpeed, onGoToPlaylist }) {
  const isNon1 = speed !== 1;

  if (!playlist) {
    return (
      <div data-testid="bottom-bar" style={{ height: 48, flexShrink: 0, borderTop: `1px solid ${C.br}`, background: C.bg1, display: "flex", alignItems: "center", padding: "0 14px", gap: 10 }}>
        <span style={{ fontSize: 11, color: C.t4, flex: 1 }}>{"\u266b"} No playlist selected</span>
      </div>
    );
  }

  const trackTitle = article ? article.title : "Select a track";
  const trackNum = (playerIdx || 0) + 1;
  const trackTotal = playlist.item_count || playerItems.length || "?";
  const skipStyle = { width: 26, height: 26, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, background: "transparent", color: C.t3, cursor: "pointer", transition: ".1s" };
  const playStyle = { ...skipStyle, background: C.acc, color: C.bg0 };

  return (
    <div data-testid="bottom-bar" style={{ height: 48, flexShrink: 0, borderTop: `1px solid ${C.br}`, background: C.bg1, display: "flex", alignItems: "center", padding: "0 14px", gap: 10, position: "relative" }}>
      {/* Transport */}
      <div style={{ display: "flex", gap: 4 }}>
        <button data-testid="player-prev" onClick={onPrev} style={skipStyle} onMouseEnter={e => e.currentTarget.style.color = C.t2} onMouseLeave={e => e.currentTarget.style.color = C.t3}>{"\u23ee"}</button>
        <button data-testid="player-play" onClick={onTogglePlay} style={playStyle} onMouseEnter={e => e.currentTarget.style.background = C.acc2} onMouseLeave={e => e.currentTarget.style.background = C.acc}>{isPlaying ? "\u25ae\u25ae" : "\u25b6"}</button>
        <button data-testid="player-next" onClick={onNext} style={skipStyle} onMouseEnter={e => e.currentTarget.style.color = C.t2} onMouseLeave={e => e.currentTarget.style.color = C.t3}>{"\u23ed"}</button>
      </div>
      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trackTitle}</div>
        <div style={{ fontSize: 9, color: C.t3, display: "flex", gap: 6, alignItems: "center" }}>
          {playlist && <span style={{ color: C.acc, cursor: "pointer" }} onClick={onGoToPlaylist}>{playlist.icon} {playlist.name}</span>}
          <span>{"\u00b7"} {trackNum}/{trackTotal}</span>
        </div>
        <div data-testid="player-progress" onClick={onSeek} style={{ width: "100%", height: 3, background: C.br, borderRadius: 2, cursor: "pointer", marginTop: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", background: C.acc, borderRadius: 2, width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%", transition: "width .3s" }} />
        </div>
      </div>
      {/* Time */}
      <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono, whiteSpace: "nowrap" }}>
        {isNon1 ? <><span style={{ color: C.t5, textDecoration: "line-through", marginRight: 3 }}>{fmtDur(duration)}</span>{fmtDur(duration ? Math.round(duration / speed) : 0)}</> : `${fmtDur(currentTime)} / ${fmtDur(duration)}`}
      </span>
      {/* Speed */}
      <div style={{ position: "relative" }}>
        <button onClick={e => { e.stopPropagation(); onToggleSpeedPop(); }} style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${isNon1 ? C.abr : C.br}`, background: isNon1 ? C.abg : C.bg3, color: isNon1 ? C.acc : C.t2, fontSize: 10, fontWeight: 600, fontFamily: FONT.mono, cursor: "pointer", minWidth: 34, textAlign: "center" }}>{fmtSpeed(speed)}</button>
        {speedOpen && <SpeedPopover speed={speed} onSetSpeed={onSetSpeed} onClose={onToggleSpeedPop} />}
      </div>
      {/* Queue peek */}
      <div style={{ position: "relative" }}>
        <button data-testid="queue-toggle" onClick={e => { e.stopPropagation(); onToggleQueuePeek(); }} style={{
          width: 28, height: 26, borderRadius: 6, border: `1px solid ${queuePeek ? C.abr : C.br}`,
          background: queuePeek ? C.abg : "transparent", color: queuePeek ? C.acc : C.t3,
          fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", transition: ".1s", cursor: "pointer",
        }}>{"\u2261"}</button>
        {queuePeek && <QueuePeekPopover items={playerItems} playlist={playlist} playerIdx={playerIdx} onJumpTo={(idx) => { onToggleQueuePeek(); }} onClose={onToggleQueuePeek} />}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// CREATE LIST MODAL
// ═════════════════════════════════════════════════════════════
function CreateListModal({ onClose, onCreate, presetType }) {
  const [name, setName] = useState("");
  const [type, setType] = useState(presetType || "collection");
  const [icon, setIcon] = useState("\ud83d\udccc");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: C.bg1, border: `1px solid ${C.br}`, borderRadius: 12, width: 380, padding: 20, animation: "popIn .15s ease" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Create new list</h3>
        <label style={{ fontSize: 10, fontWeight: 600, color: C.t3, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 4 }}>Type</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 14 }}>
          {[["collection", "\u25ce", "Collection", "Unordered group"], ["playlist", "\u266b", "Playlist", "Ordered, playable"], ["todo", "\u2610", "Action", "Due dates, done"]].map(([t, ic, lb, desc]) => (
            <div key={t} onClick={() => setType(t)} style={{ padding: "10px 8px", borderRadius: 8, border: `1px solid ${type === t ? C.acc : C.br}`, background: type === t ? C.abg : C.bg3, cursor: "pointer", textAlign: "center", transition: ".12s" }}>
              <div style={{ fontSize: 18, marginBottom: 3 }}>{ic}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: C.t2 }}>{lb}</div>
              <div style={{ fontSize: 8, color: C.t4, marginTop: 1 }}>{desc}</div>
            </div>
          ))}
        </div>
        <label style={{ fontSize: 10, fontWeight: 600, color: C.t3, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 4 }}>Name</label>
        <input ref={inputRef} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekend Deep Dives" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.br}`, background: C.bg3, color: C.t1, fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 14 }} onFocus={e => e.target.style.borderColor = C.acc} onBlur={e => e.target.style.borderColor = C.br} />
        <label style={{ fontSize: 10, fontWeight: 600, color: C.t3, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 4 }}>Icon</label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
          {EMOJIS.map(ic => (
            <div key={ic} onClick={() => setIcon(ic)} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${icon === ic ? C.acc : C.br}`, background: icon === ic ? C.abg : C.bg3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, transition: ".1s" }}>{ic}</div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.br}`, background: "transparent", color: C.t3, fontSize: 9, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { if (name.trim()) onCreate({ name: name.trim(), type, icon }); }} style={{ padding: "5px 16px", borderRadius: 5, border: `1px solid ${C.acc}`, background: C.acc, color: C.bg0, fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// TOAST
// ═════════════════════════════════════════════════════════════
function ToastContainer({ toasts, onUndo, onDismiss }) {
  if (!toasts.length) return null;
  const t = toasts[toasts.length - 1];
  return (
    <div style={{ position: "fixed", bottom: 60, left: "50%", transform: "translateX(-50%)", zIndex: 200, pointerEvents: "auto" }}>
      <div style={{ padding: "6px 10px 6px 14px", borderRadius: 8, background: C.bg4, border: `1px solid ${C.br3}`, fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, animation: "toastIn .2s ease", whiteSpace: "nowrap" }}>
        <span>{t.message}</span>
        {t.undoFn && <button onClick={() => onUndo(t.id)} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.abr}`, background: C.abg, color: C.acc, fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0, marginLeft: "auto", fontFamily: "inherit" }}>Undo</button>}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════
function ReadcastApp() {
  // Data
  const [articles, setArticles] = useState([]);
  const [lists, setLists] = useState([]);
  const [voices, setVoices] = useState([]);
  const [listItems, setListItems] = useState([]);
  const [focusedId, setFocusedId] = useState(null);
  const [search, setSearch] = useState("");

  // Navigation — type-based
  const [railType, setRailType] = useState("all");
  const [activeList, setActiveList] = useState(null);
  const [editing, setEditing] = useState(false);

  // Player
  const [playerPlaylistId, setPlayerPlaylistId] = useState(null);
  const [playerIdx, setPlayerIdx] = useState(0);
  const [playerItems, setPlayerItems] = useState([]);
  const [audioState, setAudioState] = useState({ isPlaying: false, currentTime: 0, duration: 0 });
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1.0);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [queuePeek, setQueuePeek] = useState(false);

  // Modals & toasts
  const [showCreateList, setShowCreateList] = useState(false);
  const [createListPresetType, setCreateListPresetType] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Computed
  const activeListObj = useMemo(() => lists.find(l => l.id === activeList) || null, [lists, activeList]);
  const focusedArticle = useMemo(() => {
    if (!focusedId) return null;
    const fromItems = listItems.find(i => i.doc_id === focusedId || (i.article && i.article.id === focusedId));
    if (fromItems?.article) return fromItems.article;
    return articles.find(a => a.id === focusedId) || null;
  }, [focusedId, articles, listItems]);
  const playerPlaylist = useMemo(() => lists.find(l => l.id === playerPlaylistId) || null, [lists, playerPlaylistId]);
  const nowPlayingArticle = useMemo(() => {
    if (!playerPlaylistId || !playerItems.length) return null;
    const item = playerItems[playerIdx];
    return item?.article || null;
  }, [playerPlaylistId, playerIdx, playerItems]);

  // ─── Toast helper ──────────────────────────────────────────
  const addToast = useCallback((message, undoFn = null) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, undoFn }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  const handleUndo = useCallback((toastId) => {
    setToasts(prev => {
      const t = prev.find(x => x.id === toastId);
      if (t?.undoFn) t.undoFn();
      return prev.filter(x => x.id !== toastId);
    });
  }, []);

  // ─── Data fetching ─────────────────────────────────────────
  const refreshArticles = useCallback(async (q = "") => {
    try {
      const suffix = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const data = await apiGet(`/api/articles${suffix}`);
      setArticles(data.articles || []);
    } catch {}
  }, []);
  const refreshLists = useCallback(async () => {
    try { const data = await apiGet("/api/lists"); setLists(data.lists || []); } catch {}
  }, []);
  const refreshListItems = useCallback(async (listId) => {
    if (!listId) { setListItems([]); return; }
    try { const data = await apiGet(`/api/lists/${listId}/items`); setListItems(data.items || []); } catch {}
  }, []);
  const refreshPlayerItems = useCallback(async (listId) => {
    if (!listId) { setPlayerItems([]); return; }
    try { const data = await apiGet(`/api/lists/${listId}/items`); setPlayerItems(data.items || []); } catch {}
  }, []);
  const refreshVoices = useCallback(async () => {
    try { const data = await apiGet("/api/voices"); setVoices(data.voices || []); } catch {}
  }, []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshArticles(search), refreshLists()]);
    if (activeList) await refreshListItems(activeList);
    if (playerPlaylistId) await refreshPlayerItems(playerPlaylistId);
  }, [refreshArticles, refreshLists, refreshListItems, refreshPlayerItems, activeList, playerPlaylistId, search]);

  // Initial load
  useEffect(() => { refreshArticles(); refreshLists(); refreshVoices(); }, []);

  // Auto-load first playlist into player
  useEffect(() => {
    if (playerPlaylistId) return;
    const firstPlaylist = lists.find(l => l.type === "playlist");
    if (firstPlaylist) {
      setPlayerPlaylistId(firstPlaylist.id);
      refreshPlayerItems(firstPlaylist.id);
    }
  }, [lists]);

  // Reload list items when active list changes
  useEffect(() => { refreshListItems(activeList); }, [activeList, refreshListItems]);

  // Reload player items when player playlist changes
  useEffect(() => { if (playerPlaylistId) refreshPlayerItems(playerPlaylistId); }, [playerPlaylistId, refreshPlayerItems]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => refreshArticles(search), 200);
    return () => clearTimeout(timeout);
  }, [search, refreshArticles]);

  // Auto-focus first article
  useEffect(() => {
    if (articles.length > 0 && !focusedId) setFocusedId(articles[0].id);
  }, [articles, focusedId]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current; if (!audio) return;
    const onTime = () => setAudioState(s => ({ ...s, currentTime: audio.currentTime }));
    const onMeta = () => setAudioState(s => ({ ...s, duration: audio.duration }));
    const onPlay = () => setAudioState(s => ({ ...s, isPlaying: true }));
    const onPause = () => setAudioState(s => ({ ...s, isPlaying: false }));
    const onEnded = () => { setAudioState(s => ({ ...s, isPlaying: false })); handlePlayerNext(); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => { audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("loadedmetadata", onMeta); audio.removeEventListener("play", onPlay); audio.removeEventListener("pause", onPause); audio.removeEventListener("ended", onEnded); };
  }, []);

  // Load audio when player index changes
  useEffect(() => {
    if (!playerPlaylistId || !playerItems.length) return;
    const item = playerItems[playerIdx]; if (!item?.article) return;
    const rend = item.article.renditions || {};
    const rendition = item.use_summary ? rend.audio_summary : rend.audio;
    if (rendition && rendition.state === "ready" && item.article.audio_url) {
      const audio = audioRef.current;
      if (audio && !audio.src.endsWith(item.article.audio_url)) {
        const shouldResume = wasPlayingRef.current;
        audio.src = item.article.audio_url;
        audio.load();
        if (shouldResume) {
          const onCanPlay = () => { audio.play().catch(() => {}); audio.removeEventListener("canplay", onCanPlay); };
          audio.addEventListener("canplay", onCanPlay);
        }
        wasPlayingRef.current = false;
      }
    }
  }, [playerPlaylistId, playerIdx, playerItems]);

  // Apply playback speed
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);

  // ─── Navigation handlers ───────────────────────────────────
  const handleNavType = (typeKey) => {
    setRailType(typeKey); setEditing(false); setSearch("");
    if (typeKey === "all") { setActiveList(null); return; }
    const matching = listsOfType(lists, typeKey);
    setActiveList(matching.length === 1 ? matching[0].id : null);
  };

  const handleSelectList = (listId, navToType) => {
    if (navToType) { handleNavType(navToType); return; }
    setActiveList(listId); setEditing(false);
    const list = lists.find(l => l.id === listId);
    if (list && list.type === "playlist") {
      setPlayerPlaylistId(listId);
      setPlayerIdx(0);
      refreshPlayerItems(listId);
    }
  };

  const handleBackToChooser = () => { setActiveList(null); setEditing(false); };
  const handleSelectDoc = (docId) => setFocusedId(docId);

  // ─── Player handlers ──────────────────────────────────────
  const handlePlayerToggle = () => {
    const audio = audioRef.current; if (!audio) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  };
  const wasPlayingRef = useRef(false);
  const handlePlayerPrev = () => {
    wasPlayingRef.current = !audioRef.current?.paused;
    setPlayerIdx(i => Math.max(i - 1, 0));
    setAudioState(s => ({ ...s, currentTime: 0 }));
  };
  const handlePlayerNext = () => {
    wasPlayingRef.current = !audioRef.current?.paused;
    setPlayerIdx(i => Math.min(i + 1, (playerItems.length || 1) - 1));
    setAudioState(s => ({ ...s, currentTime: 0 }));
  };
  const handlePlayerSeek = (e) => {
    const audio = audioRef.current; if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  };
  const handleCycleSpeed = () => { setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]); };

  // ─── List/doc handlers ─────────────────────────────────────
  const handleToggleListMembership = async (docId, listId, isIn) => {
    try {
      if (isIn) {
        await apiDelete(`/api/lists/${listId}/items/${docId}`);
        const l = lists.find(x => x.id === listId);
        addToast(`Removed from ${l?.name || "list"}`, async () => {
          await apiJson(`/api/lists/${listId}/items`, "POST", { doc_id: docId });
          await refreshAll();
        });
      } else {
        await apiJson(`/api/lists/${listId}/items`, "POST", { doc_id: docId });
        const l = lists.find(x => x.id === listId);
        addToast(`Added to ${l?.name || "list"}`);
      }
      await refreshAll();
    } catch {}
  };

  const handleToggleDone = async (item) => {
    if (!activeList) return;
    try {
      await apiJson(`/api/lists/${activeList}/items/${item.doc_id}`, "PUT", { done: !item.done });
      addToast(item.done ? "Marked as not done" : "Marked as done");
      await refreshAll();
    } catch {}
  };

  const handleRemoveFromList = async (docId, listId) => {
    try {
      await apiDelete(`/api/lists/${listId}/items/${docId}`);
      const l = lists.find(x => x.id === listId);
      addToast(`Removed from ${l?.name || "list"}`, async () => {
        await apiJson(`/api/lists/${listId}/items`, "POST", { doc_id: docId });
        await refreshAll();
      });
      await refreshAll();
    } catch {}
  };

  const handlePlayNow = async (docId) => {
    if (playerPlaylistId) {
      const idx = playerItems.findIndex(i => (i.doc_id || i.article?.id) === docId);
      if (idx >= 0) {
        setPlayerIdx(idx);
        setAudioState(s => ({ ...s, currentTime: 0 }));
      }
      setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 100);
    }
  };

  const handleLoadPlaylist = async (listId) => {
    setPlayerPlaylistId(listId);
    setPlayerIdx(0);
    await refreshPlayerItems(listId);
    setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 200);
  };

  const handleBatchNarrate = async (listId) => {
    try {
      if (listId) {
        await apiJson(`/api/lists/${listId}/batch-narrate`, "POST", {});
      } else {
        // Narrate all unnarrated articles
        for (const a of articles) {
          const r = (a.renditions || {}).audio;
          if (!r || r.state !== "ready") {
            await apiJson(`/api/docs/${a.id}/renditions/audio`, "POST", {});
          }
        }
      }
      addToast("Narration queued");
      await refreshAll();
    } catch {}
  };

  const handleCreateList = async (payload) => {
    try {
      const data = await apiJson("/api/lists", "POST", payload);
      await refreshLists();
      if (data?.list?.id) {
        const t = TYPES.find(x => x.listType === payload.type);
        if (t) setRailType(t.key);
        setActiveList(data.list.id);
      }
      setShowCreateList(false);
      addToast(`Created "${payload.name}"`);
    } catch {}
  };

  const handleDeleteList = async () => {
    if (!activeList) return;
    const l = lists.find(x => x.id === activeList);
    if (!l || !confirm(`Delete "${l.name}"?`)) return;
    try {
      await apiDelete(`/api/lists/${activeList}`);
      setActiveList(null); setEditing(false);
      await refreshAll();
      addToast(`Deleted "${l.name}"`);
    } catch {}
  };

  const handleGoToPlaylist = () => {
    if (playerPlaylistId) {
      const pl = lists.find(l => l.id === playerPlaylistId);
      if (pl) {
        const t = TYPES.find(x => x.listType === pl.type);
        if (t) setRailType(t.key);
        setActiveList(playerPlaylistId);
      }
    }
  };

  // ─── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (isTypingTarget(e.target)) return;
      const currentItems = activeList ? listItems : articles;
      const ids = activeList ? currentItems.map(i => i.doc_id || (i.article && i.article.id)) : currentItems.map(a => a.id);
      const curIdx = ids.indexOf(focusedId);

      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const next = Math.min(curIdx + 1, ids.length - 1); if (ids[next]) setFocusedId(ids[next]); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); const prev = Math.max(curIdx - 1, 0); if (ids[prev]) setFocusedId(ids[prev]); }
      if (e.key === "/") { e.preventDefault(); document.querySelector("input[placeholder]")?.focus(); }
      if (e.key === "Escape") { if (search) setSearch(""); if (showCreateList) setShowCreateList(false); }
      if (e.key === " " && playerPlaylistId) { e.preventDefault(); handlePlayerToggle(); }
      if (e.key === "]") { setQueuePeek(q => !q); setSpeedOpen(false); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedId, activeList, listItems, articles, search, showCreateList, playerPlaylistId]);

  // ─── Render ────────────────────────────────────────────────
  return (
    <>
      <style>{globalCSS}</style>
      <audio data-testid="audio-element" ref={audioRef} preload="metadata" />

      {/* Main area */}
      <div id="app" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <NavRail railType={railType} onNavType={handleNavType} lists={lists} />

        <CenterPanel
          railType={railType} activeList={activeList} lists={lists} articles={articles}
          listItems={listItems} focusedId={focusedId} search={search}
          onSelectDoc={handleSelectDoc} onSearchChange={setSearch}
          onSelectList={handleSelectList} onBackToChooser={handleBackToChooser}
          onCreateList={(presetType) => { setCreateListPresetType(presetType); setShowCreateList(true); }}
          playerPlaylistId={playerPlaylistId} playerIdx={playerIdx}
          isPlaying={audioState.isPlaying}
          audioCurrentTime={audioState.currentTime} audioDuration={audioState.duration}
          onPlayerToggle={handlePlayerToggle} onPlayerSeek={handlePlayerSeek}
          onPlayerPrev={handlePlayerPrev} onPlayerNext={handlePlayerNext}
          onBatchNarrate={handleBatchNarrate} onLoadPlaylist={handleLoadPlaylist}
          onToggleDone={handleToggleDone} onPlayNow={handlePlayNow} onAddToQueue={() => {}}
          editing={editing} onToggleEditing={() => setEditing(e => !e)}
          onRenameList={() => {}} onDeleteList={handleDeleteList}
          speed={speed} onCycleSpeed={handleCycleSpeed}
          onRemoveFromList={handleRemoveFromList}
        />

        <DetailPanel
          article={focusedArticle} lists={lists} voices={voices}
          onRefresh={refreshAll} onToggleListMembership={handleToggleListMembership}
          onPlayNow={handlePlayNow} playerPlaylistId={playerPlaylistId}
        />
      </div>

      {/* Player bar */}
      <BottomBar
        article={nowPlayingArticle} playlist={playerPlaylist}
        isPlaying={audioState.isPlaying} currentTime={audioState.currentTime}
        duration={audioState.duration} playerIdx={playerIdx} playerItems={playerItems}
        speed={speed} speedOpen={speedOpen} queuePeek={queuePeek}
        onTogglePlay={handlePlayerToggle} onPrev={handlePlayerPrev} onNext={handlePlayerNext}
        onSeek={handlePlayerSeek}
        onToggleQueuePeek={() => { setQueuePeek(q => !q); setSpeedOpen(false); }}
        onToggleSpeedPop={() => { setSpeedOpen(s => !s); setQueuePeek(false); }}
        onSetSpeed={(s) => { setSpeed(s); setSpeedOpen(false); }}
        onGoToPlaylist={handleGoToPlaylist}
      />

      {/* Modals */}
      {showCreateList && <CreateListModal onClose={() => setShowCreateList(false)} onCreate={handleCreateList} presetType={createListPresetType} />}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onUndo={handleUndo} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}

// ─── Scroll passthrough for WKWebView ───────────────────────
document.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: true, capture: false });

// ─── Mount ──────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<ReadcastApp />);
