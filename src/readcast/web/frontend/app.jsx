import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {}
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
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function PlayIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function PlusIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
      <rect x="2" y="8" width="3" height="8" rx="1" />
      <rect x="7" y="4" width="3" height="16" rx="1" />
      <rect x="12" y="6" width="3" height="12" rx="1" />
      <rect x="17" y="9" width="3" height="6" rx="1" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        border: "2px solid rgba(255,255,255,0.2)",
        borderTop: "2px solid #fff",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}

function DeleteConfirmPanel({ count, deleting, onConfirm, onClose }) {
  return (
    <div style={styles.addPanel}>
      <div style={styles.confirmPanelInner}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={styles.addTitle}>Delete {count} {count === 1 ? "article" : "articles"}?</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <p style={styles.confirmBody}>
          This deletes the full record and any generated audio for the selected {count === 1 ? "article" : "articles"}.
          This cannot be undone.
        </p>
        <div style={styles.confirmActions}>
          <button onClick={onClose} style={styles.secondaryBtn} disabled={deleting}>Cancel</button>
          <button onClick={onConfirm} style={{ ...styles.dangerBtn, opacity: deleting ? 0.6 : 1 }} disabled={deleting}>
            {deleting ? <SpinnerIcon /> : <><TrashIcon size={15} /><span>Delete</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPanel({ voices, defaultVoice, onAdd, onClose, onSaveDefaultVoice, error }) {
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;
    setSubmitting(true);
    try {
      await onAdd({ input: inputValue.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDefaultVoiceChange = async (voiceName) => {
    if (!voiceName || voiceName === defaultVoice) {
      setShowVoicePicker(false);
      return;
    }
    setSavingDefault(true);
    try {
      await onSaveDefaultVoice(voiceName);
      setShowVoicePicker(false);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") onClose();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={styles.addPanel}>
      <div style={styles.addPanelInner}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={styles.addTitle}>New Article</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <label style={styles.fieldLabel}>URL or text</label>
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/article or paste plain text..."
          rows={5}
          style={styles.urlInput}
        />

        <label style={styles.fieldLabel}>Default voice</label>
        <div style={styles.defaultVoiceRow}>
          <div>
            <div style={styles.defaultVoiceName}>{voiceLabel(defaultVoice || "af_sky")}</div>
            <div style={styles.defaultVoiceHelp}>New articles use this automatically.</div>
          </div>
          <button
            onClick={() => setShowVoicePicker((current) => !current)}
            style={showVoicePicker ? styles.secondaryBtnActive : styles.secondaryBtn}
            disabled={savingDefault}
          >
            {showVoicePicker ? "Hide voices" : "Change default"}
          </button>
        </div>

        {showVoicePicker ? (
          <div style={styles.voiceGrid}>
            {voices.map((voiceOption) => (
              <button
                key={voiceOption.name}
                onClick={() => handleDefaultVoiceChange(voiceOption.name)}
                style={{
                  ...styles.voiceChip,
                  ...(defaultVoice === voiceOption.name ? styles.voiceChipActive : {}),
                  opacity: savingDefault ? 0.6 : 1,
                }}
                disabled={savingDefault}
              >
                {voiceLabel(voiceOption.name)}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div style={styles.errorText}>{error}</div> : null}

        <button
          onClick={handleSubmit}
          disabled={!inputValue.trim() || submitting}
          style={{ ...styles.submitBtn, opacity: !inputValue.trim() || submitting ? 0.5 : 1 }}
        >
          {submitting ? <SpinnerIcon /> : "Add & Process"}
        </button>
      </div>
    </div>
  );
}

function ArticleCard({ article, isActive, selectionMode, selected, onPlay, onToggleSelect }) {
  const isProcessing = article.status === "queued" || article.status === "synthesizing";
  const isFailed = article.status === "failed";
  const canPlay = !isProcessing && !isFailed && article.audio_url;
  const statusText = isProcessing
    ? article.status === "queued"
      ? "Queued..."
      : "Processing..."
    : isFailed
      ? "Failed"
      : formatDuration(article.audio_duration_sec);

  return (
    <div
      style={{
        ...styles.card,
        ...(isActive ? styles.cardActive : {}),
        ...(isFailed ? styles.cardFailed : {}),
        ...(selected ? styles.cardSelected : {}),
      }}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect(article.id);
          return;
        }
        if (canPlay) {
          onPlay(article);
        }
      }}
    >
      <div style={styles.cardLeft}>
        <div style={styles.cardPlayArea}>
          {selectionMode ? (
            <div style={{ ...styles.selectDot, ...(selected ? styles.selectDotActive : {}) }}>
              {selected ? <CheckIcon size={12} /> : null}
            </div>
          ) : isProcessing ? (
            <div style={styles.processingDot} />
          ) : isFailed ? (
            <div style={styles.failedGlyph}>!</div>
          ) : isActive ? (
            <WaveformIcon />
          ) : (
            <PlayIcon size={14} />
          )}
        </div>
        <div style={styles.cardInfo}>
          <div style={styles.cardTitle}>{article.title}</div>
          <div style={styles.cardMeta}>
            {sourceLabel(article)}
            <span style={styles.metaDot}>·</span>
            {formatDate(article.ingested_at)}
            <span style={styles.metaDot}>·</span>
            <span style={{ color: isFailed ? "#f0b8b6" : isProcessing ? "#d4956a" : undefined }}>
              {statusText}
            </span>
          </div>
          {isFailed && article.error_message ? <div style={styles.cardError}>{article.error_message}</div> : null}
        </div>
      </div>
      <div style={styles.cardRight}>
        <span style={styles.voiceTag}>{article.voice || "default"}</span>
      </div>
    </div>
  );
}

function PlayerBar({ article, isPlaying, currentTime, duration, onToggle, onSeek }) {
  if (!article) return null;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={styles.playerBar}>
      <div style={styles.playerProgress} onClick={onSeek}>
        <div style={{ ...styles.playerProgressFill, width: `${percent}%` }} />
      </div>
      <div style={styles.playerInner}>
        <button onClick={onToggle} style={styles.playerPlayBtn}>
          {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <div style={styles.playerInfo}>
          <div style={styles.playerTitle}>{article.title}</div>
          <div style={styles.playerSource}>{sourceLabel(article)}</div>
        </div>
        <div style={styles.playerTime}>
          {formatDuration(currentTime)} / {formatDuration(duration || article.audio_duration_sec)}
        </div>
      </div>
    </div>
  );
}

function ReadcastApp() {
  const [articles, setArticles] = useState([]);
  const [voices, setVoices] = useState([]);
  const [defaultVoice, setDefaultVoice] = useState("af_sky");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [daemonError, setDaemonError] = useState("");
  const [addError, setAddError] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const audioRef = useRef(null);

  const activeArticle = useMemo(() => articles.find((article) => article.id === activeId) || null, [articles, activeId]);
  const hasActiveWork = articles.some((article) => article.status === "queued" || article.status === "synthesizing");
  const selectedCount = selectedIds.length;

  async function refreshArticles(query = search) {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    const data = await apiGet(`/api/articles${suffix}`);
    setArticles(data.articles || []);
  }

  async function refreshVoices() {
    try {
      const data = await apiGet("/api/voices");
      setVoices(data.voices || []);
    } catch (error) {
      setDaemonError(error.message);
    }
  }

  async function refreshPreferences() {
    try {
      const data = await apiGet("/api/preferences");
      setDefaultVoice(data.preferences?.default_voice || "af_sky");
    } catch (error) {
      setDaemonError(error.message);
    }
  }

  async function refreshStatus() {
    try {
      const data = await apiGet("/api/status");
      setDaemonConnected(Boolean(data.kokoro_edge?.connected));
      setDaemonError(data.kokoro_edge?.error || "");
    } catch (error) {
      setDaemonConnected(false);
      setDaemonError(error.message);
    }
  }

  useEffect(() => {
    refreshArticles("");
    refreshVoices();
    refreshPreferences();
    refreshStatus();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refreshArticles(search);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => articles.some((article) => article.id === id)));
  }, [articles]);

  useEffect(() => {
    if (!hasActiveWork) return undefined;
    const interval = window.setInterval(() => {
      refreshArticles(search);
      refreshStatus();
    }, 1500);
    return () => window.clearInterval(interval);
  }, [hasActiveWork, search]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
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

  async function handleAdd(payload) {
    setAddError("");
    try {
      await apiJson("/api/articles", "POST", { ...payload, process: true });
      setShowAdd(false);
      refreshArticles(search);
      refreshStatus();
    } catch (error) {
      setAddError(error.message);
      throw error;
    }
  }

  async function handleSaveDefaultVoice(voice) {
    setAddError("");
    const data = await apiJson("/api/preferences", "PUT", { default_voice: voice });
    setDefaultVoice(data.preferences?.default_voice || voice);
    await refreshArticles(search);
  }

  function handleToggleSelect(articleId) {
    setSelectedIds((current) =>
      current.includes(articleId) ? current.filter((id) => id !== articleId) : [...current, articleId],
    );
  }

  function handleSelectionModeToggle() {
    setDeleteError("");
    setShowDeleteConfirm(false);
    setSelectionMode((current) => {
      if (current) {
        setSelectedIds([]);
      }
      return !current;
    });
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length) {
      return;
    }
    setDeleteError("");
    setDeleting(true);
    try {
      for (const articleId of selectedIds) {
        await apiJson(`/api/articles/${articleId}`, "DELETE");
        if (articleId === activeId) {
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          }
          setActiveId(null);
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
        }
      }
      setSelectedIds([]);
      setShowDeleteConfirm(false);
      setSelectionMode(false);
      await refreshArticles(search);
      await refreshStatus();
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handlePlay(article) {
    const audio = audioRef.current;
    if (!audio || !article.audio_url) return;

    if (activeId === article.id) {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
      return;
    }

    setActiveId(article.id);
    setCurrentTime(0);
    setDuration(article.audio_duration_sec || 0);
    audio.src = article.audio_url;
    await audio.play();
  }

  async function handleToggle() {
    const audio = audioRef.current;
    if (!audio || !activeArticle) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }

  function handleSeek(event) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = percent * duration;
    setCurrentTime(audio.currentTime);
  }

  return (
    <div style={styles.root}>
      <style>{globalStyles}</style>
      <audio ref={audioRef} preload="metadata" />

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>readcast</h1>
          <div style={styles.daemonBadge}>
            <div style={{ ...styles.statusDot, background: daemonConnected ? "#5cb85c" : "#d9534f" }} />
            <span style={styles.daemonLabel}>kokoro-edge</span>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button onClick={handleSelectionModeToggle} style={selectionMode ? styles.headerBtnActive : styles.headerBtn}>
            <CheckIcon size={15} />
            <span>{selectionMode ? "Done" : "Select"}</span>
          </button>
          <button onClick={() => setShowAdd(true)} style={styles.addBtn}>
            <PlusIcon size={16} />
            <span>Add Article</span>
          </button>
        </div>
      </header>

      {daemonError ? <div style={styles.banner}>{daemonError}</div> : null}
      {deleteError ? <div style={{ ...styles.banner, ...styles.bannerError }}>{deleteError}</div> : null}

      {selectionMode ? (
        <div style={styles.bulkBar}>
          <div style={styles.bulkText}>
            {selectedCount ? `${selectedCount} selected` : "Select articles to delete"}
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{ ...styles.dangerBtn, opacity: selectedCount ? 1 : 0.45 }}
            disabled={!selectedCount}
          >
            <TrashIcon size={15} />
            <span>Delete</span>
          </button>
        </div>
      ) : null}

      <div style={styles.searchWrap}>
        <SearchIcon />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search articles..."
          style={styles.searchInput}
        />
        {search ? <button onClick={() => setSearch("")} style={styles.searchClear}>✕</button> : null}
      </div>

      <div style={styles.library}>
        {!articles.length ? (
          <div style={styles.empty}>
            {search ? "No articles match your search." : "No articles yet. Add one to get started."}
          </div>
        ) : (
          articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              isActive={activeId === article.id}
              selectionMode={selectionMode}
              selected={selectedIds.includes(article.id)}
              onPlay={handlePlay}
              onToggleSelect={handleToggleSelect}
            />
          ))
        )}
      </div>

      <PlayerBar
        article={activeArticle}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        onToggle={handleToggle}
        onSeek={handleSeek}
      />

      {showAdd ? (
        <AddPanel
          voices={voices}
          defaultVoice={defaultVoice}
          onAdd={handleAdd}
          onSaveDefaultVoice={handleSaveDefaultVoice}
          onClose={() => {
            setAddError("");
            setShowAdd(false);
          }}
          error={addError}
        />
      ) : null}

      {showDeleteConfirm ? (
        <DeleteConfirmPanel
          count={selectedCount}
          deleting={deleting}
          onConfirm={handleDeleteSelected}
          onClose={() => {
            setDeleteError("");
            setShowDeleteConfirm(false);
          }}
        />
      ) : null}
    </div>
  );
}

const globalStyles = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=DM+Sans:wght@400;500;600&display=swap');
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #141416; color: #e8e4df; }
::selection { background: rgba(212, 149, 106, 0.3); }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
textarea::placeholder, input::placeholder { color: rgba(255,255,255,0.25); }
`;

const c = {
  bg: "#141416",
  surface: "#1c1c20",
  border: "rgba(255,255,255,0.06)",
  text: "#e8e4df",
  textMuted: "rgba(255,255,255,0.4)",
  accent: "#d4956a",
  accentDim: "rgba(212, 149, 106, 0.12)",
  serif: "'Source Serif 4', Georgia, serif",
  sans: "'DM Sans', -apple-system, sans-serif",
};

const styles = {
  root: {
    fontFamily: c.sans,
    background: c.bg,
    color: c.text,
    minHeight: "100vh",
    maxWidth: 720,
    margin: "0 auto",
    paddingBottom: 100,
    position: "relative",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "28px 24px 12px",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 16 },
  headerActions: { display: "flex", alignItems: "center", gap: 10 },
  logo: {
    fontFamily: c.serif,
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: c.text,
  },
  daemonBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 20,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${c.border}`,
    fontSize: 11,
    fontWeight: 500,
    color: c.textMuted,
  },
  statusDot: { width: 6, height: 6, borderRadius: "50%" },
  daemonLabel: { fontFamily: "'DM Sans', monospace", letterSpacing: "0.02em" },
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: c.accent,
    color: "#141416",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  headerBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: "rgba(255,255,255,0.04)",
    color: c.textMuted,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  headerBtnActive: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${c.accent}`,
    background: c.accentDim,
    color: c.accent,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  banner: {
    margin: "0 24px 12px",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid rgba(217, 83, 79, 0.4)`,
    background: "rgba(217, 83, 79, 0.12)",
    color: "#f0b8b6",
    fontSize: 13,
  },
  bannerError: {
    border: `1px solid rgba(217, 83, 79, 0.4)`,
    background: "rgba(217, 83, 79, 0.12)",
    color: "#f0b8b6",
  },
  bulkBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    margin: "0 24px 10px",
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${c.border}`,
  },
  bulkText: {
    fontSize: 13,
    color: c.textMuted,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "16px 24px 8px",
    padding: "10px 14px",
    borderRadius: 10,
    background: c.surface,
    border: `1px solid ${c.border}`,
    color: c.textMuted,
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    color: c.text,
    fontSize: 14,
    fontFamily: c.sans,
  },
  searchClear: {
    background: "none",
    border: "none",
    color: c.textMuted,
    cursor: "pointer",
    fontSize: 13,
    padding: "2px 4px",
  },
  library: {
    padding: "8px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  empty: {
    textAlign: "center",
    color: c.textMuted,
    fontSize: 14,
    padding: "48px 0",
  },
  card: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: 10,
    cursor: "pointer",
    background: "transparent",
    borderBottom: `1px solid ${c.border}`,
  },
  cardActive: {
    background: c.accentDim,
    borderBottom: "1px solid transparent",
  },
  cardSelected: {
    background: "rgba(255,255,255,0.04)",
    borderBottom: "1px solid transparent",
  },
  cardLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  cardPlayArea: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "rgba(255,255,255,0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: c.textMuted,
  },
  selectDot: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: `1px solid ${c.textMuted}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#141416",
  },
  selectDotActive: {
    background: c.accent,
    border: `1px solid ${c.accent}`,
  },
  cardInfo: { minWidth: 0 },
  cardTitle: {
    fontFamily: c.serif,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.35,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  cardMeta: {
    fontSize: 12,
    color: c.textMuted,
    marginTop: 3,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
  },
  metaDot: { margin: "0 6px", opacity: 0.4 },
  cardRight: { flexShrink: 0, marginLeft: 12 },
  voiceTag: {
    fontSize: 11,
    fontFamily: "'DM Sans', monospace",
    color: c.textMuted,
    background: "rgba(255,255,255,0.04)",
    padding: "3px 8px",
    borderRadius: 4,
    letterSpacing: "0.02em",
  },
  processingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: c.accent,
    animation: "pulse 1.5s ease-in-out infinite",
  },
  cardFailed: {
    border: "1px solid rgba(217, 83, 79, 0.18)",
  },
  failedGlyph: {
    color: "#f0b8b6",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1,
  },
  cardError: {
    marginTop: 6,
    color: "#f0b8b6",
    fontSize: 12,
    lineHeight: 1.4,
    maxWidth: "70ch",
  },
  playerBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    background: "rgba(28, 28, 32, 0.95)",
    backdropFilter: "blur(20px)",
    borderTop: `1px solid ${c.border}`,
    zIndex: 100,
  },
  playerProgress: { height: 3, background: "rgba(255,255,255,0.06)", cursor: "pointer" },
  playerProgressFill: { height: "100%", background: c.accent, transition: "width 0.1s linear" },
  playerInner: {
    maxWidth: 720,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 24px 14px",
  },
  playerPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "none",
    background: c.accent,
    color: "#141416",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  playerInfo: { flex: 1, minWidth: 0 },
  playerTitle: {
    fontFamily: c.serif,
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  playerSource: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  playerTime: {
    fontSize: 12,
    fontFamily: "'DM Sans', monospace",
    color: c.textMuted,
    flexShrink: 0,
    letterSpacing: "0.02em",
  },
  addPanel: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
    padding: 24,
  },
  addPanelInner: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflow: "auto",
  },
  confirmPanelInner: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 460,
  },
  addTitle: {
    fontFamily: c.serif,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: c.textMuted,
    fontSize: 18,
    cursor: "pointer",
    padding: "4px 8px",
  },
  fieldLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: c.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 8,
    marginTop: 16,
  },
  urlInput: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: "rgba(0,0,0,0.3)",
    color: c.text,
    fontSize: 14,
    fontFamily: c.sans,
    resize: "vertical",
    outline: "none",
    lineHeight: 1.5,
  },
  voiceGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  defaultVoiceRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid ${c.border}`,
    background: "rgba(255,255,255,0.03)",
  },
  defaultVoiceName: {
    fontFamily: c.serif,
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  defaultVoiceHelp: {
    marginTop: 4,
    fontSize: 12,
    color: c.textMuted,
  },
  voiceChip: {
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${c.border}`,
    background: "rgba(0,0,0,0.2)",
    color: c.textMuted,
    fontSize: 12,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  voiceChipActive: {
    background: c.accentDim,
    borderColor: c.accent,
    color: c.accent,
  },
  errorText: {
    marginTop: 14,
    color: "#f0b8b6",
    fontSize: 13,
    lineHeight: 1.45,
  },
  confirmBody: {
    color: c.textMuted,
    fontSize: 14,
    lineHeight: 1.6,
  },
  confirmActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 22,
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: "rgba(255,255,255,0.04)",
    color: c.text,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  secondaryBtnActive: {
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${c.accent}`,
    background: c.accentDim,
    color: c.accent,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
  },
  dangerBtn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    background: "#b14c46",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtn: {
    width: "100%",
    padding: "12px 0",
    borderRadius: 8,
    border: "none",
    background: c.accent,
    color: "#141416",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
    marginTop: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
};

createRoot(document.getElementById("root")).render(<ReadcastApp />);
