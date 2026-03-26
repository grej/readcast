import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ─── Design tokens (mapped from prototype :root vars) ──────
const C = {
  bg0: "#08090d",
  bg1: "#0c0d12",
  bg2: "#13151d",
  bg3: "#181b26",
  bg4: "#1a1d27",
  br: "#222538",
  br2: "#181a28",
  t1: "#e4e5ea",
  t2: "#a0a4b8",
  t3: "#6b7084",
  t4: "#4a4d60",
  acc: "#6c8cff",
  abg: "rgba(108,140,255,0.1)",
  grn: "#4ade80",
  gbg: "rgba(74,222,128,0.12)",
  red: "#f87171",
  rbg: "rgba(248,113,113,0.12)",
  amb: "#ef9f27",
  ambg: "rgba(239,159,39,0.12)",
  pur: "#a855f7",
  pbg: "rgba(168,85,247,0.12)",
  teal: "#2dd4bf",
  tbg: "rgba(45,212,191,0.12)",
};

const FONT = {
  sans: "'DM Sans', 'Avenir Next', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
};

const TAG_CLS = {
  "ai-tools": [C.acc, C.abg],
  "ai-research": [C.teal, C.tbg],
  email: [C.grn, C.gbg],
  geopolitics: [C.red, C.rbg],
  "mil-tech": [C.amb, C.ambg],
  reading: [C.pur, C.pbg],
  defense: [C.red, C.rbg],
};

const TYPE_BADGE = { collection: "\u25ce", todo: "\u2610", playlist: "\u266b" };
const DEFAULT_COLORS = {
  collection: [C.pur, C.pbg],
  todo: [C.amb, C.ambg],
  playlist: [C.acc, C.abg],
};
const EMOJIS = ["\ud83d\udcda","\ud83e\udde0","\u2709","\ud83c\udf0d","\u26a1","\ud83c\udfa7","\ud83d\udcdd","\ud83d\udd2c","\ud83d\udcbc","\ud83c\udfaf","\ud83c\udfd7","\ud83c\udf93","\u2694","\ud83d\udee1","\ud83d\udcca","\ud83e\uddea"];

// ─── Global CSS (injected once) ────────────────────────────
const globalCSS = `
@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
@keyframes fadeIn { from{opacity:0;transform:translateY(-3px);} to{opacity:1;transform:translateY(0);} }
@keyframes flashAcc { 0%{background:rgba(108,140,255,0.18);} 100%{background:transparent;} }
@keyframes bar1 { 0%,100%{height:3px} 50%{height:11px} }
@keyframes bar2 { 0%,100%{height:9px} 50%{height:3px} }
@keyframes bar3 { 0%,100%{height:5px} 50%{height:13px} }
@keyframes bar4 { 0%,100%{height:12px} 50%{height:5px} }
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${C.bg0};color:${C.t1};font-family:${FONT.sans};height:100vh;display:flex;flex-direction:column;overflow:hidden;}
#root{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
::selection{background:rgba(108,140,255,0.3);}
::-webkit-scrollbar{width:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:${C.br};border-radius:3px;}
input::placeholder{color:${C.t3};}
button{font-family:inherit;cursor:pointer;}
.flash{animation:flashAcc 0.4s ease;}
[data-testid="detail-panel"]{overflow-y:scroll !important;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.drawer{width:0;overflow:hidden;transition:width .2s ease;flex-shrink:0;display:flex;flex-direction:column;background:${C.bg1};border-left:1px solid ${C.br};}
.drawer.open{width:280px;}
`;

// ─── Utilities ─────────────────────────────────────────────
function fmtDur(seconds) {
  if (!seconds && seconds !== 0) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sourceLabel(article) {
  const raw = article.source || article.publication || article.source_url || article.source_file || "";
  if (!raw) return "Pasted";
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      const parts = host.split(".");
      if (parts.length >= 2) {
        const domain = parts[parts.length - 2];
        if (host === "github.com") return "Github";
        if (host === "x.com") return "x.com";
        if (host.includes("substack")) return "Substack";
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
      return host;
    }
  } catch {}
  if (raw.startsWith("plugin:")) return raw;
  if (raw.length <= 30 && !raw.includes("/")) return raw;
  return raw.split("/").pop() || raw || "Pasted";
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

function tagColor(tag) {
  return TAG_CLS[tag] || [C.acc, C.abg];
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function voiceLabel(name) {
  const parts = String(name || "").split("_");
  const displayName = parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : name;
  const accent = String(name || "").startsWith("b") ? "GB" : "US";
  const gender = String(name || "").charAt(1) === "f" ? "\u2640" : "\u2642";
  return `${displayName} ${gender} \u00b7 ${accent}`;
}

// ─── API helpers ───────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════
// ADD-TO-LIST POPOVER (portal rendered)
// ═══════════════════════════════════════════════════════════════
function AddToListPopover({ docId, x, y, lists, docTitle, articleMemberships, onToggle, onClose, onCreateList }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  const memberIds = new Set((articleMemberships || []).map(m => m.id));

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 200, background: C.bg4, border: `1px solid ${C.br}`,
      borderRadius: 8, padding: 4, minWidth: 190, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 200),
    }}>
      <div style={{ padding: "4px 10px", fontSize: 10, color: C.t4, pointerEvents: "none" }}>
        Add "{(docTitle || "").substring(0, 30)}{(docTitle || "").length > 30 ? "..." : ""}" to:
      </div>
      <div style={{ height: 1, background: C.br, margin: "3px 0" }} />
      {lists.map(l => {
        const inL = memberIds.has(l.id);
        return (
          <div key={l.id} onClick={(e) => { e.stopPropagation(); onToggle(docId, l.id, inL); onClose(); }}
            style={{
              padding: "6px 10px", borderRadius: 5, fontSize: 11, color: C.t2,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
              transition: "background 0.06s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.bg3}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: "center", color: l.color }}>{l.icon}</span>
            <span>{l.name}</span>
            {inL && <span style={{ marginLeft: "auto", color: C.grn, fontSize: 11 }}>{"\u2713"}</span>}
          </div>
        );
      })}
      <div style={{ height: 1, background: C.br, margin: "3px 0" }} />
      <div onClick={onCreateList}
        style={{ padding: "6px 10px", borderRadius: 5, fontSize: 11, color: C.t4, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "background 0.06s" }}
        onMouseEnter={e => e.currentTarget.style.background = C.bg3}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>+</span>
        <span>New list</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLAYLIST PICKER POPOVER (for split button in detail rbar)
// ═══════════════════════════════════════════════════════════════
function PlaylistPickerPopover({ docId, x, y, lists, articleMemberships, onToggle, onClose, onCreateList }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  const playlists = lists.filter(l => l.type === "playlist");
  const memberIds = new Set((articleMemberships || []).map(m => m.id));

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 200, background: C.bg4, border: `1px solid ${C.br}`,
      borderRadius: 8, padding: 4, minWidth: 190, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - 200),
    }}>
      <div style={{ padding: "4px 10px", fontSize: 10, color: C.t4, pointerEvents: "none" }}>Add to playlist:</div>
      <div style={{ height: 1, background: C.br, margin: "3px 0" }} />
      {playlists.map(l => {
        const inL = memberIds.has(l.id);
        return (
          <div key={l.id} onClick={(e) => { e.stopPropagation(); onToggle(docId, l.id, inL); onClose(); }}
            style={{
              padding: "6px 10px", borderRadius: 5, fontSize: 11, color: C.t2,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "background 0.06s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.bg3}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: "center", color: l.color }}>{l.icon}</span>
            <span>{l.name}</span>
            {inL && <span style={{ marginLeft: "auto", color: C.grn, fontSize: 11 }}>{"\u2713"}</span>}
          </div>
        );
      })}
      <div style={{ height: 1, background: C.br, margin: "3px 0" }} />
      <div onClick={onCreateList}
        style={{ padding: "6px 10px", borderRadius: 5, fontSize: 11, color: C.t4, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "background 0.06s" }}
        onMouseEnter={e => e.currentTarget.style.background = C.bg3}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>+</span>
        <span>New playlist</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CREATE LIST MODAL
// ═══════════════════════════════════════════════════════════════
function CreateListModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("collection");
  const [icon, setIcon] = useState("\ud83d\udcda");
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleCreate = () => {
    if (!name.trim()) return;
    const [color, bg] = DEFAULT_COLORS[type] || DEFAULT_COLORS.collection;
    onCreate({ name: name.trim(), type, icon, color, bg });
    onClose();
  };

  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.br}`, background: C.bg1, color: C.t1, fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 8 };
  const selectStyle = { ...inputStyle, fontSize: 12, padding: "7px 10px" };
  const btnStyle = { padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.br}`, background: "rgba(255,255,255,0.03)", color: C.t3, fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "0.1s", whiteSpace: "nowrap" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bg2, border: `1px solid ${C.br}`, borderRadius: 12, width: 360, overflow: "hidden", animation: "fadeIn 0.15s ease" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.br}`, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>Create new list</div>
        <div style={{ padding: "14px 18px" }}>
          <label style={{ fontSize: 12, color: C.t2, display: "block", marginBottom: 4 }}>Name</label>
          <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Study Psychology" style={inputStyle}
            onFocus={e => e.target.style.borderColor = C.acc} onBlur={e => e.target.style.borderColor = C.br}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }} />
          <label style={{ fontSize: 12, color: C.t2, display: "block", marginBottom: 4 }}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={selectStyle}>
            <option value="collection">Collection — curated topic group</option>
            <option value="todo">Todo — action items with due dates</option>
            <option value="playlist">Playlist — audio narration queue</option>
          </select>
          <label style={{ fontSize: 12, color: C.t2, display: "block", marginBottom: 4 }}>Icon</label>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setIcon(e)} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${icon === e ? C.acc : C.br}`, background: icon === e ? C.abg : C.bg1, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "0.1s", fontFamily: "inherit" }}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.br}`, display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={handleCreate} style={{ ...btnStyle, background: C.acc, color: C.bg0, borderColor: C.acc }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NAV SIDEBAR (collapsible, with sections)
// ═══════════════════════════════════════════════════════════════
function NavSidebar({ lists, activeListId, totalCount, onSelectList, onCreateList, collapsed, onToggleCollapse, playerPlaylistId, isPlaying, sections, onToggleSection }) {
  const todoLists = lists.filter(l => l.type === "todo");
  const otherLists = lists.filter(l => l.type === "collection" || l.type === "playlist");

  return (
    <div data-testid="nav-sidebar" style={{
      width: collapsed ? 0 : 210, flexShrink: 0,
      borderRight: collapsed ? "none" : `1px solid ${C.br}`,
      display: "flex", flexDirection: "column", background: C.bg0,
      userSelect: "none", overflowY: "auto", overflowX: "hidden",
      transition: "width 0.2s ease",
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Local Knowledge</span>
        <button data-testid="nav-collapse" onClick={onToggleCollapse} title="Collapse sidebar"
          style={{
            marginLeft: "auto", width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${C.br}`, background: C.bg1, color: C.t3,
            fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "0.1s", flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t2; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.bg1; e.currentTarget.style.color = C.t3; }}
        >{"\u25c2"}</button>
      </div>

      {/* Knowledge base section */}
      <NavSection label="Knowledge base" sectionKey="kb" open={sections.kb !== false} onToggle={() => onToggleSection("kb")}>
        <NavItem id={null} icon={"\u2299"} label="All items" count={totalCount}
          isActive={activeListId === null} onSelect={onSelectList} />
      </NavSection>

      <div style={{ height: 1, background: C.br2, margin: "3px 12px" }} />

      {/* Action items section */}
      {todoLists.length > 0 && (
        <>
          <NavSection label="Action items" sectionKey="action" open={sections.action !== false} onToggle={() => onToggleSection("action")}>
            {todoLists.map(l => {
              const undone = l.item_count != null ? l.item_count : 0;
              return (
                <NavItem key={l.id} id={l.id} icon={l.icon} label={l.name}
                  typeBadge={TYPE_BADGE[l.type]} listColor={l.color} listBg={l.bg}
                  count={undone} isActive={activeListId === l.id}
                  onSelect={onSelectList} />
              );
            })}
          </NavSection>
          <div style={{ height: 1, background: C.br2, margin: "3px 12px" }} />
        </>
      )}

      {/* Lists section (collections + playlists) */}
      <NavSection label="Lists" sectionKey="lists" open={sections.lists !== false} onToggle={() => onToggleSection("lists")}>
        {otherLists.map(l => {
          const isPlayingThis = playerPlaylistId === l.id && isPlaying;
          return (
            <NavItem key={l.id} id={l.id} icon={l.icon} label={l.name}
              typeBadge={TYPE_BADGE[l.type]} listColor={l.color} listBg={l.bg}
              count={l.item_count} isActive={activeListId === l.id}
              isPlayingDot={isPlayingThis} onSelect={onSelectList} />
          );
        })}
      </NavSection>

      {/* + New list */}
      <div onClick={onCreateList}
        style={{ padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: C.t4, transition: "0.1s" }}
        onMouseEnter={e => e.currentTarget.style.color = C.acc}
        onMouseLeave={e => e.currentTarget.style.color = C.t4}
      >
        <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>+</span>
        New list
      </div>

      {/* Footer */}
      <div style={{ marginTop: "auto", padding: "8px 14px", borderTop: `1px solid ${C.br2}`, fontSize: 10, color: C.t4, lineHeight: 1.8 }}>
        <Kbd>{"\u2191\u2193"}</Kbd> navigate <Kbd>{"\u23ce"}</Kbd> open<br />
        <Kbd>q</Kbd> queue <Kbd>e</Kbd> done <Kbd>n</Kbd> narrate<br />
        <Kbd>[</Kbd> toggle sidebar
      </div>
    </div>
  );
}

function Kbd({ children }) {
  return <kbd style={{ fontFamily: FONT.mono, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: C.bg2, border: `1px solid ${C.br}`, color: C.t3 }}>{children}</kbd>;
}

function NavSection({ label, open, onToggle, children }) {
  return (
    <div>
      <div onClick={onToggle}
        style={{
          padding: "5px 14px", display: "flex", alignItems: "center", gap: 6,
          cursor: "pointer", fontSize: 10, fontWeight: 600, color: C.t4,
          textTransform: "uppercase", letterSpacing: 0.7, userSelect: "none", transition: "color 0.1s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = C.t3}
        onMouseLeave={e => e.currentTarget.style.color = C.t4}
      >
        <span style={{ fontSize: 8, transition: "transform 0.15s", width: 12, textAlign: "center", transform: open ? "none" : "rotate(-90deg)" }}>{"\u25bc"}</span>
        {label}
      </div>
      <div style={{ overflow: "hidden", transition: "max-height 0.2s ease", maxHeight: open ? 600 : 0 }}>
        {children}
      </div>
    </div>
  );
}

function NavItem({ id, icon, label, typeBadge, listColor, listBg, count, isActive, isPlayingDot, onSelect }) {
  return (
    <div data-testid={id ? `nav-item-${id}` : "nav-item-all"} onClick={() => onSelect(id)}
      style={{
        padding: "6px 14px", display: "flex", alignItems: "center", gap: 8,
        cursor: "pointer", fontSize: 12, color: isActive ? (listColor || C.t1) : C.t2,
        transition: "background 0.06s",
        borderLeft: `2px solid ${isActive ? C.acc : "transparent"}`,
        background: isActive ? C.bg4 : "transparent",
        fontWeight: isActive ? 600 : 400,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.bg2; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? C.bg4 : "transparent"; }}
    >
      <span style={{ fontSize: 14, width: 18, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {isPlayingDot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.acc, flexShrink: 0, animation: "pulse 1.5s infinite" }} />}
      {typeBadge && (
        <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: listBg || C.abg, color: listColor || C.acc }}>{typeBadge}</span>
      )}
      {count != null && <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono }}>{count}</span>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NAV RAIL (shown when nav is collapsed)
// ═══════════════════════════════════════════════════════════════
function NavRail({ lists, activeListId, onSelectList, onExpandNav }) {
  return (
    <div data-testid="nav-rail" style={{
      width: 36, flexShrink: 0, borderRight: `1px solid ${C.br}`,
      background: C.bg0, display: "flex", flexDirection: "column",
      alignItems: "center", paddingTop: 10, gap: 4,
    }}>
      <button onClick={onExpandNav} title="Expand sidebar"
        style={{
          width: 28, height: 28, borderRadius: 6, border: "none",
          background: "transparent", color: C.t3, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "0.1s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = C.bg2; e.currentTarget.style.color = C.t2; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; }}
      >{"\u2630"}</button>
      <div style={{ height: 1, width: 20, background: C.br2, margin: "4px 0" }} />
      <RailBtn icon={"\u2299"} isActive={activeListId === null} color={C.acc} bg={C.abg}
        onClick={() => onSelectList(null)} title="All items" />
      {lists.map(l => (
        <RailBtn key={l.id} icon={l.icon} isActive={activeListId === l.id}
          color={l.color} bg={l.bg} onClick={() => onSelectList(l.id)} title={l.name} />
      ))}
    </div>
  );
}

function RailBtn({ icon, isActive, color, bg, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 28, height: 28, borderRadius: 6, border: "none",
        background: isActive ? bg : "transparent",
        color: isActive ? color : C.t3,
        fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", transition: "0.1s",
      }}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = C.bg2; e.currentTarget.style.color = C.t2; } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; } }}
    >{icon}</button>
  );
}

// ═══════════════════════════════════════════════════════════════
// CENTER PANEL
// ═══════════════════════════════════════════════════════════════
function CenterPanel({
  activeList, articles, listItems, focusedId, onSelectDoc, search, onSearchChange,
  onPlayNow, onAddToQueue, onShowATP, playerPlaylistId, playerIdx, isPlaying,
  audioCurrentTime, audioDuration, onPlayerToggle, onPlayerSeek, onPlayerPrev, onPlayerNext,
  onBatchNarrate, onLoadPlaylist, onToggleDone, onToggleDrawer,
}) {
  const isAll = !activeList;
  const listType = isAll ? "all" : activeList.type;
  const isPlaylistView = listType === "playlist";

  // For playlist hero
  const totalDuration = isPlaylistView ? listItems.reduce((sum, item) => {
    const art = item.article;
    if (!art) return sum;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return sum + (r && r.duration ? r.duration : 0);
  }, 0) : 0;

  const missingNarration = isPlaylistView ? listItems.filter(item => {
    const art = item.article;
    if (!art) return true;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return !r || r.state !== "ready";
  }).length : 0;

  // Currently playing state for playlist hero
  const isActivePlaylist = isPlaylistView && activeList && playerPlaylistId === activeList.id;
  const nowPlayingItem = isActivePlaylist && playerIdx != null && listItems[playerIdx] ? listItems[playerIdx] : null;
  const nowPlayingArticle = nowPlayingItem?.article || null;

  // Get the current playlist (for inQueue checks)
  // Playlist = whichever playlist is loaded in the player
  const currentPlaylistItems = useMemo(() => {
    // We need to know which items are in the player's playlist queue for inQ checks
    // This is provided via the parent, so we check from listItems if activeList is the player's playlist
    return [];
  }, []);

  // Sort todos: undone first (by due date), then done
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

  // Drag-and-drop state for playlist center view
  const [dragFrom, setDragFrom] = useState(null);

  return (
    <div data-testid="center-panel" style={{ width: 370, flexShrink: 0, borderRight: `1px solid ${C.br}`, display: "flex", flexDirection: "column", background: C.bg1, overflow: "hidden" }}>

      {isPlaylistView ? (
        <>
          {/* Playlist Hero */}
          <div data-testid="playlist-hero" style={{
            padding: 16, borderBottom: `1px solid ${C.br}`, flexShrink: 0,
            background: "linear-gradient(180deg, rgba(108,140,255,0.05) 0%, transparent 100%)",
          }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
              <div style={{
                width: 60, height: 60, borderRadius: 12,
                background: "linear-gradient(135deg, rgba(108,140,255,0.2), rgba(168,85,247,0.15))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, flexShrink: 0,
              }}>{activeList.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{activeList.name}</div>
                <div style={{ fontSize: 10, color: C.t3 }}>{listItems.length} items {"\u00b7"} {fmtDur(totalDuration)}</div>
              </div>
              <button data-testid="play-all-btn" onClick={() => onLoadPlaylist(activeList.id)}
                style={{
                  padding: "7px 16px", borderRadius: 6, border: `1px solid ${C.acc}`,
                  background: C.acc, color: C.bg0, fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  transition: "0.1s", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#8aa4ff"}
                onMouseLeave={e => e.currentTarget.style.background = C.acc}
              >{"\u25b6"} Play all</button>
              <button onClick={onToggleDrawer} title="Queue"
                style={{
                  width: 30, height: 26, borderRadius: 6, border: `1px solid ${C.br}`,
                  background: "transparent", color: C.t3, fontSize: 11,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "0.1s", cursor: "pointer", fontFamily: "inherit",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.abg; e.currentTarget.style.color = C.acc; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; }}
              >{"\u2261"}</button>
            </div>

            {/* Now playing section in hero */}
            {isActivePlaylist && nowPlayingArticle && (
              <>
                <div style={{ fontSize: 9, color: C.t4, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Now playing</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nowPlayingArticle.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={onPlayerPrev} style={bbSkipStyle}>{"\u23ee"}</button>
                  <button onClick={onPlayerToggle}
                    style={{ ...bbPlayStyle, width: 32, height: 32, fontSize: 12 }}
                  >{isPlaying ? "\u25ae\u25ae" : "\u25b6"}</button>
                  <button onClick={onPlayerNext} style={bbSkipStyle}>{"\u23ed"}</button>
                  <div onClick={onPlayerSeek} style={{ flex: 1, height: 4, background: C.br, borderRadius: 2, cursor: "pointer" }}>
                    <div style={{
                      height: "100%", background: C.acc, borderRadius: 2,
                      width: audioDuration > 0 ? `${(audioCurrentTime / audioDuration) * 100}%` : "0%",
                      transition: "width 0.3s",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono }}>{fmtDur(audioCurrentTime)} / {fmtDur(audioDuration)}</span>
                </div>
              </>
            )}
          </div>

          {/* Missing narration banner */}
          {missingNarration > 0 && (
            <div data-testid="narration-banner" style={{
              padding: "7px 12px", display: "flex", alignItems: "center", gap: 6,
              fontSize: 11, borderBottom: `1px solid ${C.br2}`, flexShrink: 0,
              background: "rgba(239,159,39,0.04)", color: C.amb,
            }}>
              {"\u26a0"} {missingNarration} item{missingNarration > 1 ? "s" : ""} need narration
              <button onClick={onBatchNarrate}
                style={{
                  marginLeft: "auto", padding: "3px 8px", borderRadius: 6,
                  border: `1px solid rgba(239,159,39,0.3)`, background: "rgba(255,255,255,0.03)",
                  color: C.amb, fontSize: 10, fontWeight: 600, fontFamily: "inherit",
                  cursor: "pointer", transition: "0.1s", whiteSpace: "nowrap",
                }}
              >Generate all</button>
            </div>
          )}

          {/* Tracklist header */}
          <div style={{ padding: "5px 12px", borderBottom: `1px solid ${C.br2}`, fontSize: 9, color: C.t4, display: "flex", flexShrink: 0 }}>
            <span>TRACKLIST</span><span style={{ flex: 1 }} /><span>Drag to reorder</span>
          </div>

          {/* Playlist rows */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {displayItems.map((item, idx) => {
              const art = item.article;
              if (!art) return null;
              const rend = art.renditions || {};
              const rendition = item.use_summary ? rend.audio_summary : rend.audio;
              const aState = rendition ? (rendition.state === "ready" ? "ready" : rendition.state === "generating" || rendition.state === "queued" ? "gen" : "miss") : "miss";
              const dur = rendition && rendition.duration ? fmtDur(rendition.duration) : "--:--";
              const isP = isActivePlaylist && playerIdx === idx;
              const isSel = focusedId === (item.doc_id || art.id);
              const tags = art.tags || [];

              return (
                <div key={item.doc_id || art.id}
                  data-drag-item={idx}
                  draggable
                  onDragStart={e => {
                    setDragFrom(idx);
                    e.dataTransfer.effectAllowed = "move";
                    e.currentTarget.style.opacity = "0.3";
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    // Clear all borders first
                    e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => el.style.borderTop = "");
                    e.currentTarget.style.borderTop = `2px solid ${C.acc}`;
                  }}
                  onDragEnd={e => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => {
                      el.style.borderTop = "";
                      el.style.opacity = "1";
                    });
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => {
                      el.style.borderTop = "";
                      el.style.opacity = "1";
                    });
                    if (dragFrom != null && dragFrom !== idx) {
                      handlePlaylistReorder(dragFrom, idx);
                    }
                    setDragFrom(null);
                  }}
                  onClick={() => onSelectDoc(item.doc_id || art.id)}
                  style={{
                    padding: isSel ? "7px 12px 7px 10px" : "7px 12px",
                    borderBottom: `1px solid ${C.br2}`, cursor: "pointer",
                    display: "flex", gap: 7, alignItems: "center", transition: "background 0.06s",
                    background: isP ? "rgba(108,140,255,0.04)" : isSel ? C.bg4 : "transparent",
                    borderLeft: isSel ? `2px solid ${C.acc}` : "2px solid transparent",
                  }}
                  onMouseEnter={e => { if (!isSel && !isP) e.currentTarget.style.background = C.bg3; }}
                  onMouseLeave={e => { if (!isSel && !isP) e.currentTarget.style.background = isP ? "rgba(108,140,255,0.04)" : "transparent"; }}
                >
                  <span style={{ width: 18, fontSize: 10, color: isP ? C.acc : C.t4, textAlign: "center", fontFamily: FONT.mono, flexShrink: 0 }}>{isP ? "\u25b6" : idx + 1}</span>
                  <span style={{ cursor: "grab", color: C.t4, fontSize: 12, flexShrink: 0 }}>{"\u2807"}</span>
                  <span style={{
                    width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: aState === "miss" ? 8 : 9, flexShrink: 0,
                    background: aState === "ready" ? C.abg : aState === "gen" ? C.ambg : C.rbg,
                    color: aState === "ready" ? C.acc : aState === "gen" ? C.amb : C.red,
                    ...(aState === "gen" ? { animation: "pulse 1.2s infinite" } : {}),
                  }}>{aState === "ready" ? "\u266b" : aState === "gen" ? "\u25cc" : "\u2715"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: isP ? 600 : 400, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</div>
                    <div style={{ fontSize: 10, color: C.t3, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                      {tags.slice(0, 3).map(t => {
                        const [tc, tbg] = tagColor(t);
                        return <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: tbg, color: tc }}>{t}</span>;
                      })}
                      <span>{sourceLabel(art)}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono, flexShrink: 0 }}>{dur}</span>
                  <span style={{ opacity: 0, fontSize: 13, color: C.red, cursor: "pointer", flexShrink: 0, width: 16, textAlign: "center", transition: "opacity 0.1s" }}
                    className="plrm-hover"
                    onClick={e => { e.stopPropagation(); onRemoveFromPlaylist && onRemoveFromPlaylist(item.doc_id || art.id); }}
                  >{"\u00d7"}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Normal list/all header */}
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 15, color: isAll ? undefined : activeList?.color }}>{isAll ? "\u2299" : activeList?.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{isAll ? "All Items" : activeList?.name}</span>
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 500, background: isAll ? C.abg : (activeList?.bg || C.abg), color: isAll ? C.acc : (activeList?.color || C.acc) }}>
              {isAll ? articles.length : (activeList?.type === "collection" || activeList?.type === "todo" ? displayItems.length : displayItems.length)}
            </span>
            {listType === "collection" && (
              <button style={{
                marginLeft: "auto", padding: "3px 8px", borderRadius: 6,
                border: `1px solid rgba(168,85,247,0.3)`, background: "rgba(255,255,255,0.03)",
                color: C.pur, fontSize: 10, fontWeight: 600, fontFamily: "inherit",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "0.1s", whiteSpace: "nowrap",
              }}>{"\u26a1"} Spock</button>
            )}
          </div>

          {/* Search */}
          <div style={{ padding: "7px 10px", borderBottom: `1px solid ${C.br2}`, flexShrink: 0, position: "relative" }}>
            <span style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", color: C.t3, fontSize: 12, pointerEvents: "none" }}>{"\u2315"}</span>
            <input data-testid="search-input" value={search} onChange={e => onSearchChange(e.target.value)}
              placeholder={isAll ? "Search..." : `Search ${activeList?.name || ""}...`}
              style={{
                width: "100%", padding: "6px 10px 6px 26px", borderRadius: 6,
                border: `1px solid ${C.br}`, background: C.bg2, color: C.t1,
                fontSize: 12, fontFamily: "inherit", outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = C.acc}
              onBlur={e => e.target.style.borderColor = C.br}
            />
          </div>

          {/* Todo batch narration banner */}
          {listType === "todo" && (() => {
            const missing = displayItems.filter(item => {
              const art = item.article;
              if (!art) return false;
              const rend = art.renditions || {};
              return !rend.audio || rend.audio.state !== "ready";
            });
            if (missing.length === 0) return null;
            return (
              <div style={{
                padding: "7px 12px", display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, borderBottom: `1px solid ${C.br2}`, flexShrink: 0,
                background: "rgba(239,159,39,0.04)", color: C.amb,
              }}>
                {"\u26a0"} {missing.length} item{missing.length > 1 ? "s" : ""} need narration
              </div>
            );
          })()}

          {/* Doc list */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {isAll && articles.map(a => (
              <DocRow key={a.id} article={a} isFocused={focusedId === a.id} showListBadges={true}
                onSelect={onSelectDoc} onPlayNow={onPlayNow} onAddToQueue={onAddToQueue} onShowATP={onShowATP}
                playerPlaylistId={playerPlaylistId} />
            ))}
            {listType === "collection" && displayItems.map(item => {
              const art = item.article;
              if (!art) return null;
              return <DocRow key={art.id} article={art} isFocused={focusedId === art.id} showListBadges={false}
                onSelect={onSelectDoc} onPlayNow={onPlayNow} onAddToQueue={onAddToQueue} onShowATP={onShowATP}
                playerPlaylistId={playerPlaylistId} />;
            })}
            {listType === "todo" && displayItems.map(item => {
              const art = item.article;
              if (!art) return null;
              return <TodoRow key={item.doc_id} item={item} article={art} isFocused={focusedId === item.doc_id}
                onSelect={onSelectDoc} onToggleDone={onToggleDone} />;
            })}
            {((isAll && articles.length === 0) || (!isAll && displayItems.length === 0)) && (
              <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: C.t4 }}>No items.</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  function handlePlaylistReorder(from, to) {
    // This is a UI signal; actual reorder is handled by parent via API
    // For now we don't have a direct prop - the parent needs to handle this
    // We'll call onPlaylistReorder if available
  }
}

// ═══════════════════════════════════════════════════════════════
// DOC ROW (for All Items / Collection views)
// ═══════════════════════════════════════════════════════════════
function DocRow({ article, isFocused, showListBadges, onSelect, onPlayNow, onAddToQueue, onShowATP, playerPlaylistId }) {
  const rend = article.renditions || {};
  const audio = rend.audio;
  const audioReady = audio && audio.state === "ready";
  const memberships = article.list_memberships || [];
  const tags = article.tags || [];

  // Check if this doc is in the player's playlist queue
  const inQueue = memberships.some(m => m.id === playerPlaylistId);

  return (
    <div data-testid={`doc-row-${article.id}`} onClick={() => onSelect(article.id)}
      className="doc-row-hover"
      style={{
        padding: isFocused ? "8px 10px 8px 8px" : "8px 10px",
        borderBottom: `1px solid ${C.br2}`, cursor: "pointer",
        display: "flex", gap: 7, alignItems: "flex-start", transition: "background 0.06s",
        background: isFocused ? C.bg4 : "transparent",
        borderLeft: isFocused ? `2px solid ${C.acc}` : "2px solid transparent",
        paddingLeft: isFocused ? 8 : 10,
      }}
      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = C.bg3; }}
      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = isFocused ? C.bg4 : "transparent"; }}
    >
      {/* Audio icon 26x26 */}
      <AudioIcon audio={audio} articleId={article.id} onPlayNow={onPlayNow} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, marginBottom: 2 }}>{article.title}</div>
        <div style={{ fontSize: 10, color: C.t3, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {tags.slice(0, 3).map(t => {
            const [tc, tbg] = tagColor(t);
            return <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: tbg, color: tc }}>{t}</span>;
          })}
          <span>{sourceLabel(article)} {"\u00b7"} {timeAgo(article.ingested_at)}</span>
        </div>
        {showListBadges && memberships.length > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 }}>
            {memberships.map(m => (
              <span key={m.id} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", background: m.bg || "rgba(107,112,132,0.12)", color: m.color || C.t3 }}>{m.icon} {m.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Right gutter actions */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0, flexDirection: "column", alignItems: "center", marginTop: 1 }}>
        {audioReady && (
          <GutterAction icon={"\u25b6"} tip="Play now" onClick={e => { e.stopPropagation(); onPlayNow(article.id); }} />
        )}
        {audioReady && (
          <GutterAction icon={inQueue ? "\u2611" : "\u2295"} tip={inQueue ? "In queue" : "Add to queue"} isInQueue={inQueue}
            onClick={e => { e.stopPropagation(); onAddToQueue(article.id); }} />
        )}
        <GutterAction icon={"\u2630"} tip="Add to list" onClick={e => { e.stopPropagation(); onShowATP(e, article.id); }} />
      </div>
    </div>
  );
}

// ─── Audio Icon (26x26, hover-to-play overlay) ─────────────
function AudioIcon({ audio, articleId, onPlayNow }) {
  const audioReady = audio && audio.state === "ready";
  const isGen = audio && (audio.state === "generating" || audio.state === "queued");

  const baseStyle = {
    width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 10, flexShrink: 0, marginTop: 1, background: "transparent", color: C.t4,
    border: "none", position: "relative", transition: "0.12s", cursor: audioReady ? "pointer" : "default",
  };

  if (audioReady) {
    return (
      <div className="aud-icon-wrap"
        style={{ ...baseStyle, color: C.acc, background: C.abg }}
        title={audio.duration ? fmtDur(audio.duration) : ""}
        onClick={e => { e.stopPropagation(); onPlayNow(articleId); }}
      >
        {"\u266b"}
        <div className="hover-play-overlay" style={{
          position: "absolute", inset: 0, borderRadius: 6,
          background: C.acc, color: C.bg0,
          display: "none", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700,
        }}>{"\u25b6"}</div>
      </div>
    );
  }
  if (isGen) {
    return <div style={{ ...baseStyle, color: C.amb, animation: "pulse 1.2s infinite" }}>{"\u25cc"}</div>;
  }
  return <div style={baseStyle}>{"\u266a"}</div>;
}

// ─── Gutter Action Button ──────────────────────────────────
function GutterAction({ icon, tip, isInQueue, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: 24, height: 20, borderRadius: 4, border: "none", fontSize: 9,
        display: "flex", alignItems: "center", justifyContent: "center", transition: "0.1s",
        background: isInQueue ? C.abg : hovered ? "rgba(255,255,255,0.06)" : "transparent",
        color: isInQueue ? C.acc : hovered ? C.t2 : C.t4,
        position: "relative",
      }}
    >
      {hovered && (
        <span style={{
          display: "block", position: "absolute", right: 28, top: "50%", transform: "translateY(-50%)",
          background: C.bg4, border: `1px solid ${C.br}`, borderRadius: 5,
          padding: "3px 8px", fontSize: 9, color: C.t2, whiteSpace: "nowrap", zIndex: 10, pointerEvents: "none",
        }}>{tip}</span>
      )}
      {icon}
    </button>
  );
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
  if (item.ai_suggested_due && !item.done && item.due) { dueClass = "ai"; dueText += " \u2728"; }

  const dueColors = {
    overdue: { background: C.rbg, color: C.red },
    soon: { background: C.ambg, color: C.amb },
    ok: { background: C.gbg, color: C.grn },
    ai: { border: `1px dashed ${C.amb}`, background: "transparent", color: C.amb, fontSize: 9 },
    none: { color: C.t4, fontStyle: "italic", fontFamily: "inherit", fontSize: 10 },
  };

  return (
    <div onClick={() => onSelect(article.id)}
      style={{
        padding: isFocused ? "8px 12px 8px 10px" : "8px 12px",
        borderBottom: `1px solid ${C.br2}`, cursor: "pointer",
        display: "flex", gap: 9, alignItems: "center", transition: "background 0.06s",
        background: isFocused ? C.bg4 : "transparent",
        borderLeft: isFocused ? `2px solid ${C.acc}` : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = C.bg3; }}
      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = isFocused ? C.bg4 : "transparent"; }}
    >
      <button onClick={e => { e.stopPropagation(); onToggleDone(item); }}
        style={{
          width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${item.done ? C.grn : "#444"}`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, cursor: "pointer",
          transition: "0.12s", flexShrink: 0, background: item.done ? C.gbg : "none",
          color: item.done ? C.grn : "transparent", fontFamily: "inherit",
        }}
      >{item.done ? "\u2713" : ""}</button>
      <span style={{ fontSize: 12, flex: 1, lineHeight: 1.3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.35 : 1 }}>{article.title}</span>
      <span style={{ fontSize: 10, color: audioReady ? C.acc : C.t4, flexShrink: 0 }}>{"\u266b"}</span>
      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, fontFamily: FONT.mono, flexShrink: 0, fontWeight: 500, ...dueColors[dueClass] }}>{dueText}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════════
function DetailPanel({ article, lists, voices, onRefresh, onToggleListMembership, onPlayNow, onAddToQueue, onShowPlaylistPicker, playerPlaylistId }) {
  const [fullText, setFullText] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!article) return;
    setLoading(true);
    setFullText(null);
    apiGet(`/api/articles/${article.id}/text`)
      .then(data => setFullText(data.text || ""))
      .catch(() => setFullText("(Could not load text)"))
      .finally(() => setLoading(false));
  }, [article?.id]);

  if (!article) return (
    <div data-testid="detail-panel" style={{ flex: 1, background: C.bg2, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, minHeight: 0 }}>
      <span style={{ fontSize: 12, color: C.t4 }}>Select an article to view details</span>
    </div>
  );

  const rend = article.renditions || {};
  const audio = rend.audio;
  const summary = rend.summary;
  const tags = article.tags || [];
  const memberships = article.list_memberships || [];
  const membershipIds = new Set(memberships.map(m => m.id));

  const audioReady = audio && audio.state === "ready";
  const audioGen = audio && (audio.state === "generating" || audio.state === "queued");
  const inQueue = memberships.some(m => m.id === playerPlaylistId);

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
    <div data-testid="detail-panel" style={{ flex: 1, overflowY: "scroll", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", background: C.bg2, minWidth: 0, minHeight: 0 }}>
      {/* Header: tags + list badges, title, meta */}
      <div style={{ padding: "20px 24px 12px", borderBottom: `1px solid ${C.br}` }}>
        {(tags.length > 0 || memberships.length > 0) && (
          <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
            {tags.map(t => {
              const [tc, tbg] = tagColor(t);
              return <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: tbg, color: tc }}>{t}</span>;
            })}
            {memberships.map(m => (
              <span key={m.id} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", background: m.bg || C.pbg, color: m.color || C.pur }}>{m.icon} {m.name}</span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: FONT.serif, lineHeight: 1.35, marginBottom: 6 }}>{article.title}</div>
        <div style={{ fontSize: 11, color: C.t3, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span>{sourceLabel(article)}</span>
          <span>{"\u00b7"}</span>
          <span>{timeAgo(article.ingested_at)}</span>
          {audio && audio.duration && <><span>{"\u00b7"}</span><span>{fmtDur(audio.duration)}</span></>}
        </div>
      </div>

      {/* Rendition bar */}
      <div style={{ padding: "10px 24px", borderBottom: `1px solid ${C.br}`, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {/* Audio state badge */}
        <span style={{
          fontSize: 10, padding: "3px 8px", borderRadius: 5, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 5,
          background: audioReady ? C.abg : audioGen ? C.ambg : C.bg1,
          color: audioReady ? C.acc : audioGen ? C.amb : C.t4,
        }}>
          {"\u266b"} {audioReady ? `Audio \u00b7 ${fmtDur(audio.duration)}` : audioGen ? "Generating..." : "No audio"}
        </span>

        {audioReady ? (
          <>
            {/* Play button */}
            <button onClick={() => onPlayNow(article.id)} title="Play now"
              style={{
                background: C.acc, color: C.bg0, borderColor: C.acc,
                borderRadius: "50%", width: 28, height: 28,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0, fontSize: 11, border: "none", flexShrink: 0, cursor: "pointer", transition: "0.1s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#8aa4ff"}
              onMouseLeave={e => e.currentTarget.style.background = C.acc}
            >{"\u25b6"}</button>

            {/* Split button: Queue + Playlist picker */}
            <div style={{ display: "flex", border: `1px solid ${C.br}`, borderRadius: 6, overflow: "hidden" }}>
              <button onClick={() => onAddToQueue(article.id)}
                style={{
                  padding: "3px 10px", borderRadius: 0, border: "none",
                  background: "rgba(255,255,255,0.03)", color: C.t3,
                  fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4, transition: "0.1s", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = C.t2; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = C.t3; }}
              >{inQueue ? "\u2713 Queued" : "+ Queue"}</button>
              <button onClick={e => onShowPlaylistPicker(e, article.id)}
                style={{
                  padding: "3px 10px", borderRadius: 0, border: "none",
                  borderLeft: `1px solid ${C.br}`,
                  background: "rgba(255,255,255,0.03)", color: C.acc,
                  fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4, transition: "0.1s", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              >{"\ud83c\udfa7"} {"\u25be"}</button>
            </div>
          </>
        ) : (
          !audioGen && (
            <button onClick={() => handleGenerateRendition("audio")}
              style={{
                padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.acc}`,
                background: C.acc, color: C.bg0, fontSize: 10, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer", transition: "0.1s", whiteSpace: "nowrap",
              }}
            >Generate narration</button>
          )
        )}

        <span style={{ flex: 1 }} />

        {/* Summary button */}
        <button onClick={() => summary ? null : handleGenerateRendition("summary")}
          style={{
            padding: "3px 8px", borderRadius: 6, border: "none",
            background: "none", color: C.t4, fontSize: 10, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            transition: "0.1s", whiteSpace: "nowrap",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.t2; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.t4; }}
        >{"\ud83d\udcdd"} Summary</button>
      </div>

      {/* List assignment */}
      <div style={{ padding: "10px 24px", borderBottom: `1px solid ${C.br}`, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.t4, marginRight: 4 }}>Lists:</span>
        {lists.map(l => {
          const isIn = membershipIds.has(l.id);
          return (
            <button key={l.id}
              onClick={() => onToggleListMembership(article.id, l.id, isIn)}
              style={{
                padding: "4px 9px", borderRadius: 6,
                border: `1px solid ${isIn ? (l.color || C.br) : C.br}`,
                background: isIn ? (l.bg || "transparent") : "transparent",
                color: isIn ? (l.color || C.t3) : C.t3,
                fontSize: 10, fontWeight: isIn ? 600 : 500, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4, transition: "0.1s",
              }}
              onMouseEnter={e => { if (!isIn) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { if (!isIn) e.currentTarget.style.background = "transparent"; }}
            >
              {l.icon} {isIn ? "\u2713 " : "+ "}{l.name}
            </button>
          );
        })}
      </div>

      {/* Summary text (if available) */}
      {summary && summary.text && (
        <div style={{ padding: "12px 24px", borderBottom: `1px solid ${C.br}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.t4, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Summary</div>
          <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.6, fontFamily: FONT.serif }}>{summary.text}</p>
        </div>
      )}

      {/* Body text */}
      <div style={{ padding: "16px 24px", fontSize: 14, fontFamily: FONT.serif, lineHeight: 1.7, color: "#b8bac4" }}>
        {loading ? <span style={{ color: C.t4 }}>Loading...</span> : (
          fullText ? fullText.split("\n\n").filter(Boolean).map((p, i) => <p key={i} style={{ marginBottom: 12 }}>{p}</p>) : null
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RIGHT DRAWER (queue controller)
// ═══════════════════════════════════════════════════════════════
function RightDrawer({ open, playlists, activePlaylistId, playlistItems, playerIdx, focusedId, onClose, onSwitchPlaylist, onSelectDoc, onRemoveItem, onReorder, onAddCurrentDoc }) {
  const activePlaylist = playlists.find(p => p.id === activePlaylistId);
  const [dragFrom, setDragFrom] = useState(null);

  // Compute total duration
  const totalDuration = playlistItems.reduce((sum, item) => {
    const art = item.article;
    if (!art) return sum;
    const rend = art.renditions || {};
    const r = item.use_summary ? rend.audio_summary : rend.audio;
    return sum + (r && r.duration ? r.duration : 0);
  }, 0);

  // Custom dropdown chevron SVG as data URI
  const chevronSvg = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1 5 5 9 1' fill='none' stroke='%236b7084' stroke-width='1.5'/%3E%3C/svg%3E\")";

  return (
    <div data-testid="right-drawer" className={open ? "drawer open" : "drawer"}>
      {/* Header */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.br}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <select data-testid="drawer-playlist-select" value={activePlaylistId || ""}
          onChange={e => onSwitchPlaylist(e.target.value)}
          style={{
            background: "transparent", border: "none", color: C.t1,
            fontSize: 12, fontWeight: 600, fontFamily: "inherit", outline: "none",
            cursor: "pointer", maxWidth: 140,
            appearance: "none", WebkitAppearance: "none",
            paddingRight: 12, backgroundImage: chevronSvg,
            backgroundRepeat: "no-repeat", backgroundPosition: "right center",
          }}
        >
          {playlists.map(p => (
            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono }}>{playlistItems.length} {"\u00b7"} {fmtDur(totalDuration)}</span>
        <span style={{ flex: 1 }} />
        <button data-testid="drawer-close" onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: 5, border: "none",
            background: "transparent", color: C.t3, fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center", transition: "0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.bg3; e.currentTarget.style.color = C.t2; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; }}
        >{"\u2715"}</button>
      </div>

      {/* Track list */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {playlistItems.map((item, idx) => {
          const art = item.article;
          if (!art) return null;
          const rend = art.renditions || {};
          const rendition = item.use_summary ? rend.audio_summary : rend.audio;
          const dur = rendition && rendition.duration ? fmtDur(rendition.duration) : "--:--";
          const isP = playerIdx === idx;

          return (
            <div key={item.doc_id || art.id}
              data-drag-item={idx}
              draggable
              onDragStart={e => {
                setDragFrom(idx);
                e.dataTransfer.effectAllowed = "move";
                e.currentTarget.style.opacity = "0.3";
              }}
              onDragOver={e => {
                e.preventDefault();
                e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => el.style.borderTop = "");
                e.currentTarget.style.borderTop = `2px solid ${C.acc}`;
              }}
              onDragEnd={e => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => {
                  el.style.borderTop = "";
                  el.style.opacity = "1";
                });
              }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.parentNode.querySelectorAll("[data-drag-item]").forEach(el => {
                  el.style.borderTop = "";
                  el.style.opacity = "1";
                });
                if (dragFrom != null && dragFrom !== idx) {
                  onReorder(dragFrom, idx);
                }
                setDragFrom(null);
              }}
              onClick={() => onSelectDoc(item.doc_id || art.id)}
              style={{
                padding: "6px 10px", display: "flex", gap: 6, alignItems: "center",
                borderBottom: `1px solid ${C.br2}`, transition: "background 0.06s",
                cursor: "pointer", fontSize: 11,
                background: isP ? "rgba(108,140,255,0.05)" : "transparent",
              }}
              onMouseEnter={e => { if (!isP) e.currentTarget.style.background = C.bg3; }}
              onMouseLeave={e => { if (!isP) e.currentTarget.style.background = isP ? "rgba(108,140,255,0.05)" : "transparent"; }}
            >
              <span style={{ width: 16, fontSize: 10, color: isP ? C.acc : C.t4, textAlign: "center", fontFamily: FONT.mono, flexShrink: 0 }}>{isP ? "\u25b6" : idx + 1}</span>
              <span style={{ cursor: "grab", color: C.t4, fontSize: 11, flexShrink: 0 }}>{"\u2807"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isP ? C.t1 : C.t2, fontWeight: isP ? 500 : 400 }}>{art.title}</span>
              <span style={{ fontSize: 9, color: C.t4, fontFamily: FONT.mono, flexShrink: 0 }}>{dur}</span>
              <span style={{ opacity: 0, fontSize: 12, color: C.red, cursor: "pointer", flexShrink: 0, width: 14, textAlign: "center" }}
                className="dwi-rm-hover"
                onClick={e => { e.stopPropagation(); onRemoveItem(item.doc_id || art.id); }}
              >{"\u00d7"}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: "8px 10px", borderTop: `1px solid ${C.br}`, display: "flex", gap: 6, flexShrink: 0 }}>
        <button onClick={onAddCurrentDoc}
          style={{
            flex: 1, justifyContent: "center",
            padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.br}`,
            background: "rgba(255,255,255,0.03)", color: C.t3,
            fontSize: 10, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4, transition: "0.1s", whiteSpace: "nowrap",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = C.t2; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = C.t3; }}
        >+ Add current doc</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOTTOM BAR
// ═══════════════════════════════════════════════════════════════
const bbSkipStyle = {
  width: 26, height: 26, borderRadius: "50%", border: "none",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 10, transition: "0.1s", background: "transparent", color: C.t3, cursor: "pointer",
};

const bbPlayStyle = {
  width: 26, height: 26, borderRadius: "50%", border: "none",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 10, transition: "0.1s", background: C.acc, color: C.bg0, cursor: "pointer",
};

function BottomBar({ article, playlist, isPlaying, currentTime, duration, playerIdx, drawerOpen, onTogglePlay, onPrev, onNext, onSeek, onToggleDrawer, onGoToPlaylist }) {
  const queueToggle = (
    <button data-testid="queue-toggle" onClick={onToggleDrawer} title="Queue"
      style={{
        width: 30, height: 26, borderRadius: 6,
        border: `1px solid ${drawerOpen ? "rgba(108,140,255,0.3)" : C.br}`,
        background: drawerOpen ? C.abg : "transparent",
        color: drawerOpen ? C.acc : C.t3,
        fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
        transition: "0.1s", cursor: "pointer",
      }}
      onMouseEnter={e => { if (!drawerOpen) { e.currentTarget.style.background = C.abg; e.currentTarget.style.color = C.acc; e.currentTarget.style.borderColor = "rgba(108,140,255,0.3)"; } }}
      onMouseLeave={e => { if (!drawerOpen) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; e.currentTarget.style.borderColor = C.br; } }}
    >{"\u2261"}</button>
  );

  if (!playlist) {
    return (
      <div data-testid="bottom-bar" style={{
        height: 50, flexShrink: 0, borderTop: `1px solid ${C.br}`,
        background: C.bg1, display: "flex", alignItems: "center",
        padding: "0 14px", gap: 10,
      }}>
        <span style={{ fontSize: 11, color: C.t4, flex: 1 }}>{"\u266b"} No playlist selected</span>
        {queueToggle}
      </div>
    );
  }

  const trackTitle = article ? article.title : "Select a track";

  return (
    <div data-testid="bottom-bar" style={{
      height: 50, flexShrink: 0, borderTop: `1px solid ${C.br}`,
      background: C.bg1, display: "flex", alignItems: "center",
      padding: "0 14px", gap: 10,
    }}>
      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button data-testid="player-prev" onClick={onPrev} style={bbSkipStyle}
          onMouseEnter={e => e.currentTarget.style.color = C.t2}
          onMouseLeave={e => e.currentTarget.style.color = C.t3}
        >{"\u23ee"}</button>
        <button data-testid="player-play" onClick={onTogglePlay}
          style={bbPlayStyle}
          onMouseEnter={e => e.currentTarget.style.background = "#8aa4ff"}
          onMouseLeave={e => e.currentTarget.style.background = C.acc}
        >{isPlaying ? "\u25ae\u25ae" : "\u25b6"}</button>
        <button data-testid="player-next" onClick={onNext} style={bbSkipStyle}
          onMouseEnter={e => e.currentTarget.style.color = C.t2}
          onMouseLeave={e => e.currentTarget.style.color = C.t3}
        >{"\u23ed"}</button>
      </div>

      {/* Playback indicator */}
      {isPlaying && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14, flexShrink: 0, marginRight: 2 }}>
          <div style={{ width: 3, background: C.acc, borderRadius: 1, animation: "bar1 0.7s ease-in-out infinite" }} />
          <div style={{ width: 3, background: C.acc, borderRadius: 1, animation: "bar2 0.6s ease-in-out infinite 0.1s" }} />
          <div style={{ width: 3, background: C.acc, borderRadius: 1, animation: "bar3 0.8s ease-in-out infinite 0.2s" }} />
          <div style={{ width: 3, background: C.acc, borderRadius: 1, animation: "bar4 0.65s ease-in-out infinite 0.15s" }} />
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trackTitle}</div>
        <div style={{ fontSize: 9, color: C.t3, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: C.acc, cursor: "pointer" }}
            onClick={onGoToPlaylist}
            onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
            onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
          >{playlist.icon} {playlist.name}</span>
          <span>{"\u00b7"} {(playerIdx || 0) + 1}/{playlist.item_count || "?"}</span>
        </div>
        <div data-testid="player-progress" onClick={onSeek} style={{ width: "100%", height: 3, background: C.br, borderRadius: 2, cursor: "pointer", marginTop: 2 }}>
          <div style={{ height: "100%", background: C.acc, borderRadius: 2, width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%", transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Time */}
      <span style={{ fontSize: 10, color: C.t4, fontFamily: FONT.mono, whiteSpace: "nowrap" }}>{fmtDur(currentTime)} / {fmtDur(duration)}</span>

      {/* Queue toggle */}
      {queueToggle}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOVER STYLES (injected CSS for pseudo-class effects)
// ═══════════════════════════════════════════════════════════════
const hoverCSS = `
.doc-row-hover:hover .aud-icon-wrap .hover-play-overlay { display:flex !important; }
.doc-row-hover:hover .dacts-btn { opacity:1; }
.plrm-hover { transition: opacity 0.1s; }
div:hover > .plrm-hover { opacity:1 !important; }
.dwi-rm-hover { transition: opacity 0.1s; }
div:hover > .dwi-rm-hover { opacity:1 !important; }
`;

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

  // Nav state
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sections, setSections] = useState({ kb: true, action: true, lists: true });

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPlaylistId, setDrawerPlaylistId] = useState(null);
  const [drawerItems, setDrawerItems] = useState([]);

  // Audio playback
  const [playerPlaylistId, setPlayerPlaylistId] = useState(null);
  const [playerIdx, setPlayerIdx] = useState(0);
  const [audioState, setAudioState] = useState({ isPlaying: false, currentTime: 0, duration: 0 });
  const audioRef = useRef(null);

  // Popover state
  const [atpPopover, setAtpPopover] = useState(null); // { docId, x, y }
  const [playlistPicker, setPlaylistPicker] = useState(null); // { docId, x, y }

  // Computed
  const activeList = useMemo(() => lists.find(l => l.id === activeListId) || null, [lists, activeListId]);
  const focusedArticle = useMemo(() => {
    if (!focusedId) return null;
    const fromItems = listItems.find(i => i.doc_id === focusedId || (i.article && i.article.id === focusedId));
    if (fromItems?.article) return fromItems.article;
    return articles.find(a => a.id === focusedId) || null;
  }, [focusedId, articles, listItems]);

  // The playlist currently loaded in the player
  const playerPlaylist = useMemo(() => lists.find(l => l.id === playerPlaylistId) || null, [lists, playerPlaylistId]);

  // Playlists for drawer
  const allPlaylists = useMemo(() => lists.filter(l => l.type === "playlist"), [lists]);

  // The effective drawer playlist ID (defaults to player's playlist)
  const effectiveDrawerPlaylistId = drawerPlaylistId || playerPlaylistId;

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

  const refreshDrawerItems = useCallback(async (listId) => {
    if (!listId) { setDrawerItems([]); return; }
    try {
      const data = await apiGet(`/api/lists/${listId}/items`);
      setDrawerItems(data.items || []);
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
    if (effectiveDrawerPlaylistId) await refreshDrawerItems(effectiveDrawerPlaylistId);
  }, [refreshArticles, refreshLists, refreshListItems, refreshDrawerItems, activeListId, effectiveDrawerPlaylistId, search]);

  // Initial load — auto-load first playlist into player (Spotify model)
  useEffect(() => {
    refreshArticles();
    refreshVoices();
    refreshLists().then(() => {});
  }, []);

  // Once lists load, auto-select first playlist into the player
  useEffect(() => {
    if (playerPlaylistId) return; // already loaded
    const firstPlaylist = lists.find(l => l.type === "playlist");
    if (firstPlaylist) {
      setPlayerPlaylistId(firstPlaylist.id);
      setDrawerPlaylistId(firstPlaylist.id);
      refreshDrawerItems(firstPlaylist.id);
    }
  }, [lists]);

  // Reload list items when active list changes
  useEffect(() => { refreshListItems(activeListId); }, [activeListId, refreshListItems]);

  // Reload drawer items when drawer playlist changes
  useEffect(() => {
    if (effectiveDrawerPlaylistId) refreshDrawerItems(effectiveDrawerPlaylistId);
  }, [effectiveDrawerPlaylistId, refreshDrawerItems]);

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
    const onEnded = () => {
      setAudioState(s => ({ ...s, isPlaying: false }));
      // Auto-advance to next track
      handlePlayerNext();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  // Load audio when player playlist or index changes
  useEffect(() => {
    if (!playerPlaylistId || !drawerItems.length) return;
    const item = drawerItems[playerIdx];
    if (!item?.article) return;
    const rend = item.article.renditions || {};
    const rendition = item.use_summary ? rend.audio_summary : rend.audio;
    if (rendition && rendition.state === "ready" && item.article.audio_url) {
      const audio = audioRef.current;
      if (audio && !audio.src.endsWith(item.article.audio_url)) {
        audio.src = item.article.audio_url;
        audio.load();
      }
    }
  }, [playerPlaylistId, playerIdx, drawerItems]);

  // ─── Actions ───────────────────────────────────────────────
  const handleSelectList = async (id) => {
    setActiveListId(id);
    setSearch("");
    // If selecting a playlist, auto-load it into the player so bottom bar + drawer work
    const list = lists.find(l => l.id === id);
    if (list && list.type === "playlist") {
      setPlayerPlaylistId(id);
      setPlayerIdx(0);
      await refreshDrawerItems(id);
    }
  };

  const handleCreateList = async (payload) => {
    try {
      const data = await apiJson("/api/lists", "POST", payload);
      await refreshLists();
      if (data?.list?.id) setActiveListId(data.list.id);
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
    if (audio.paused) {
      try { await audio.play(); } catch {}
    } else {
      audio.pause();
    }
  };

  const handlePlayerSeek = (e) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = pct * audio.duration;
  };

  const handlePlayerPrev = () => {
    setPlayerIdx(i => Math.max(0, i - 1));
    setAudioState(s => ({ ...s, currentTime: 0 }));
  };

  const handlePlayerNext = () => {
    setPlayerIdx(i => {
      const max = (drawerItems.length || 1) - 1;
      return Math.min(i + 1, max);
    });
    setAudioState(s => ({ ...s, currentTime: 0 }));
  };

  const handlePlayNow = async (docId) => {
    // If we have a player playlist, add to it and play
    if (playerPlaylistId) {
      // Check if already in the playlist
      const idx = drawerItems.findIndex(i => (i.doc_id || i.article?.id) === docId);
      if (idx >= 0) {
        setPlayerIdx(idx);
        setAudioState(s => ({ ...s, currentTime: 0 }));
      } else {
        // Add to playlist after current track, then play
        try {
          await apiJson(`/api/lists/${playerPlaylistId}/items`, "POST", { doc_id: docId });
          await refreshDrawerItems(playerPlaylistId);
          await refreshAll();
          setPlayerIdx(playerIdx + 1);
          setAudioState(s => ({ ...s, currentTime: 0 }));
        } catch {}
      }
      // Start playing
      setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 100);
    } else {
      // No playlist loaded - find first playlist and load it
      const firstPlaylist = allPlaylists[0];
      if (firstPlaylist) {
        setPlayerPlaylistId(firstPlaylist.id);
        setDrawerPlaylistId(firstPlaylist.id);
        try {
          await apiJson(`/api/lists/${firstPlaylist.id}/items`, "POST", { doc_id: docId });
          await refreshDrawerItems(firstPlaylist.id);
          await refreshAll();
        } catch {}
      }
    }
  };

  const handleAddToQueue = async (docId) => {
    if (!playerPlaylistId) {
      // Auto-select first playlist
      const firstPlaylist = allPlaylists[0];
      if (!firstPlaylist) return;
      setPlayerPlaylistId(firstPlaylist.id);
      setDrawerPlaylistId(firstPlaylist.id);
      setDrawerOpen(true);
      try {
        await apiJson(`/api/lists/${firstPlaylist.id}/items`, "POST", { doc_id: docId });
        await refreshDrawerItems(firstPlaylist.id);
        await refreshAll();
      } catch {}
      return;
    }
    // Check if already in queue
    const already = drawerItems.some(i => (i.doc_id || i.article?.id) === docId);
    if (already) return;
    try {
      await apiJson(`/api/lists/${playerPlaylistId}/items`, "POST", { doc_id: docId });
      await refreshDrawerItems(playerPlaylistId);
      await refreshAll();
    } catch {}
  };

  const handleLoadPlaylist = async (listId) => {
    setPlayerPlaylistId(listId);
    setDrawerPlaylistId(listId);
    setPlayerIdx(0);
    setAudioState(s => ({ ...s, currentTime: 0 }));
    await refreshDrawerItems(listId);
    setDrawerOpen(true);
    setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 200);
  };

  const handleDrawerSwitchPlaylist = async (listId) => {
    setDrawerPlaylistId(listId);
    setPlayerPlaylistId(listId);
    setPlayerIdx(0);
    setAudioState(s => ({ ...s, currentTime: 0 }));
    await refreshDrawerItems(listId);
  };

  const handleDrawerRemoveItem = async (docId) => {
    if (!effectiveDrawerPlaylistId) return;
    try {
      await apiDelete(`/api/lists/${effectiveDrawerPlaylistId}/items/${docId}`);
      await refreshDrawerItems(effectiveDrawerPlaylistId);
      await refreshAll();
    } catch {}
  };

  const handleDrawerReorder = async (fromIdx, toIdx) => {
    if (!effectiveDrawerPlaylistId) return;
    // Optimistic reorder
    const newItems = [...drawerItems];
    const [moved] = newItems.splice(fromIdx, 1);
    newItems.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    setDrawerItems(newItems);
    // Adjust player index
    if (fromIdx === playerIdx) {
      setPlayerIdx(toIdx > fromIdx ? toIdx - 1 : toIdx);
    } else if (fromIdx < playerIdx && toIdx > playerIdx) {
      setPlayerIdx(p => p - 1);
    } else if (fromIdx > playerIdx && toIdx <= playerIdx) {
      setPlayerIdx(p => p + 1);
    }
    // Persist to server
    try {
      const ids = newItems.map(i => i.doc_id || i.article?.id);
      await apiJson(`/api/lists/${effectiveDrawerPlaylistId}/items/reorder`, "PUT", { ids });
    } catch {}
  };

  const handleAddCurrentDocToDrawer = async () => {
    if (!focusedId || !effectiveDrawerPlaylistId) return;
    const already = drawerItems.some(i => (i.doc_id || i.article?.id) === focusedId);
    if (already) return;
    try {
      await apiJson(`/api/lists/${effectiveDrawerPlaylistId}/items`, "POST", { doc_id: focusedId });
      await refreshDrawerItems(effectiveDrawerPlaylistId);
      await refreshAll();
    } catch {}
  };

  const handleShowATP = (e, docId) => {
    setAtpPopover({ docId, x: e.clientX, y: e.clientY });
  };

  const handleShowPlaylistPicker = (e, docId) => {
    setPlaylistPicker({ docId, x: e.clientX, y: e.clientY });
  };

  const handleGoToPlaylist = () => {
    if (playerPlaylistId) {
      setActiveListId(playerPlaylistId);
      setSearch("");
    }
  };

  const handleToggleSection = (key) => {
    setSections(s => ({ ...s, [key]: !s[key] }));
  };

  // Now playing article (for bottom bar)
  const nowPlayingArticle = useMemo(() => {
    if (!playerPlaylistId || !drawerItems.length) return null;
    const item = drawerItems[playerIdx];
    return item?.article || null;
  }, [playerPlaylistId, playerIdx, drawerItems]);

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
        if (atpPopover) { setAtpPopover(null); return; }
        if (playlistPicker) { setPlaylistPicker(null); return; }
        if (search) setSearch("");
        if (showCreateList) setShowCreateList(false);
      }
      if (e.key === " " && playerPlaylistId) {
        e.preventDefault();
        handlePlayerToggle();
      }
      if (e.key === "n" && focusedId) {
        apiJson(`/api/docs/${focusedId}/renditions/audio`, "POST", {}).then(() => refreshAll()).catch(() => {});
      }
      if (e.key === "e" && activeList?.type === "todo") {
        const item = listItems.find(i => i.doc_id === focusedId);
        if (item) handleToggleDone(item);
      }
      if (e.key === "[") {
        setNavCollapsed(c => !c);
      }
      if (e.key === "]") {
        setDrawerOpen(d => !d);
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
  }, [focusedId, activeListId, listItems, articles, lists, search, showCreateList, activeList, atpPopover, playlistPicker, playerPlaylistId]);

  // Get the focused article's memberships for popovers
  const atpArticle = useMemo(() => {
    if (!atpPopover) return null;
    const fromItems = listItems.find(i => (i.doc_id === atpPopover.docId) || (i.article && i.article.id === atpPopover.docId));
    if (fromItems?.article) return fromItems.article;
    return articles.find(a => a.id === atpPopover.docId) || null;
  }, [atpPopover, articles, listItems]);

  const pickerArticle = useMemo(() => {
    if (!playlistPicker) return null;
    const fromItems = listItems.find(i => (i.doc_id === playlistPicker.docId) || (i.article && i.article.id === playlistPicker.docId));
    if (fromItems?.article) return fromItems.article;
    return articles.find(a => a.id === playlistPicker.docId) || null;
  }, [playlistPicker, articles, listItems]);

  return (
    <>
      <style>{globalCSS}</style>
      <style>{hoverCSS}</style>
      <audio data-testid="audio-element" ref={audioRef} preload="metadata" />

      {/* Main app area: flex row, flex:1 */}
      <div id="app" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Nav rail (when collapsed) */}
        {navCollapsed && (
          <NavRail lists={lists} activeListId={activeListId}
            onSelectList={handleSelectList}
            onExpandNav={() => setNavCollapsed(false)} />
        )}

        {/* Nav sidebar */}
        <NavSidebar lists={lists} activeListId={activeListId} totalCount={articles.length}
          onSelectList={handleSelectList} onCreateList={() => setShowCreateList(true)}
          collapsed={navCollapsed} onToggleCollapse={() => setNavCollapsed(true)}
          playerPlaylistId={playerPlaylistId} isPlaying={audioState.isPlaying}
          sections={sections} onToggleSection={handleToggleSection} />

        {/* Center panel */}
        <CenterPanel
          activeList={activeList} articles={articles} listItems={listItems}
          focusedId={focusedId} onSelectDoc={handleSelectDoc} search={search} onSearchChange={setSearch}
          onPlayNow={handlePlayNow} onAddToQueue={handleAddToQueue} onShowATP={handleShowATP}
          playerPlaylistId={playerPlaylistId} playerIdx={playerIdx}
          isPlaying={audioState.isPlaying}
          audioCurrentTime={audioState.currentTime} audioDuration={audioState.duration}
          onPlayerToggle={handlePlayerToggle} onPlayerSeek={handlePlayerSeek}
          onPlayerPrev={handlePlayerPrev} onPlayerNext={handlePlayerNext}
          onBatchNarrate={handleBatchNarrate} onLoadPlaylist={handleLoadPlaylist}
          onToggleDone={handleToggleDone} onToggleDrawer={() => setDrawerOpen(d => !d)}
        />

        {/* Detail panel */}
        <DetailPanel
          article={focusedArticle} lists={lists} voices={voices}
          onRefresh={refreshAll} onToggleListMembership={handleToggleListMembership}
          onPlayNow={handlePlayNow} onAddToQueue={handleAddToQueue}
          onShowPlaylistPicker={handleShowPlaylistPicker}
          playerPlaylistId={playerPlaylistId}
        />

        {/* Right drawer — sibling of nav/center/detail so all panels compress */}
        <RightDrawer
          open={drawerOpen && allPlaylists.length > 0}
          playlists={allPlaylists}
          activePlaylistId={effectiveDrawerPlaylistId}
          playlistItems={drawerItems}
          playerIdx={playerIdx}
          focusedId={focusedId}
          onClose={() => setDrawerOpen(false)}
          onSwitchPlaylist={handleDrawerSwitchPlaylist}
          onSelectDoc={handleSelectDoc}
          onRemoveItem={handleDrawerRemoveItem}
          onReorder={handleDrawerReorder}
          onAddCurrentDoc={handleAddCurrentDocToDrawer}
        />
      </div>

      {/* Bottom bar (outside #app, at viewport bottom) */}
      <div id="bbar-container" style={{ flexShrink: 0 }}>
        <BottomBar
          article={nowPlayingArticle}
          playlist={playerPlaylist}
          isPlaying={audioState.isPlaying}
          currentTime={audioState.currentTime}
          duration={audioState.duration}
          playerIdx={playerIdx}
          drawerOpen={drawerOpen}
          onTogglePlay={handlePlayerToggle}
          onPrev={handlePlayerPrev}
          onNext={handlePlayerNext}
          onSeek={handlePlayerSeek}
          onToggleDrawer={() => setDrawerOpen(d => !d)}
          onGoToPlaylist={handleGoToPlaylist}
        />
      </div>

      {/* Modals / Popovers */}
      {showCreateList && <CreateListModal onClose={() => setShowCreateList(false)} onCreate={handleCreateList} />}

      {atpPopover && atpArticle && (
        <AddToListPopover
          docId={atpPopover.docId} x={atpPopover.x} y={atpPopover.y}
          lists={lists} docTitle={atpArticle.title}
          articleMemberships={atpArticle.list_memberships}
          onToggle={handleToggleListMembership}
          onClose={() => setAtpPopover(null)}
          onCreateList={() => { setAtpPopover(null); setShowCreateList(true); }}
        />
      )}

      {playlistPicker && pickerArticle && (
        <PlaylistPickerPopover
          docId={playlistPicker.docId} x={playlistPicker.x} y={playlistPicker.y}
          lists={lists} articleMemberships={pickerArticle.list_memberships}
          onToggle={handleToggleListMembership}
          onClose={() => setPlaylistPicker(null)}
          onCreateList={() => { setPlaylistPicker(null); setShowCreateList(true); }}
        />
      )}
    </>
  );
}

// ─── Scroll passthrough for WKWebView/Tauri ────────────────
document.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: true, capture: false });

// ─── Mount ──────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<ReadcastApp />);
