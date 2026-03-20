import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const PLAYBACK_RATES = [1.0, 1.25, 1.5, 1.75, 2.0];

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

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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

function ExtensionIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 3.5a2.5 2.5 0 015 0V5h-5zM3.5 13.5a2.5 2.5 0 010-5H5v5z" />
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function DownloadIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13M5 12l7 7 7-7" />
      <path d="M5 20h14" />
    </svg>
  );
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
    <div style={styles.addPanel} role="presentation">
      <div style={styles.extensionPanelInner} role="dialog" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={styles.addTitle}>Browser Extension</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">✕</button>
        </div>

        <div style={styles.extensionBrowserRow}>
          {Object.entries(BROWSERS).map(([key, b]) => (
            <button
              key={key}
              onClick={() => setBrowser(key)}
              style={browser === key ? styles.voiceChipActive : styles.voiceChip}
            >
              {b.name}
            </button>
          ))}
        </div>

        <div style={styles.extensionStep}>
          <div style={styles.extensionStepNumber}>1</div>
          <div style={styles.extensionStepBody}>
            <div style={styles.extensionStepTitle}>Download the extension</div>
            <div style={styles.extensionStepDetail}>
              <a href="/api/extension.zip" download style={styles.extensionDownloadBtn}>
                <DownloadIcon size={15} />
                <span>Download Extension</span>
              </a>
              <div style={{ marginTop: 8 }}>Unzip the file after downloading.</div>
            </div>
          </div>
        </div>

        <div style={styles.extensionStep}>
          <div style={styles.extensionStepNumber}>2</div>
          <div style={styles.extensionStepBody}>
            <div style={styles.extensionStepTitle}>Open your extensions page</div>
            <div style={styles.extensionStepDetail}>
              Copy and paste this into your address bar:
              <div style={{ marginTop: 6 }}>
                <code style={styles.extensionCode}>{info.url}</code>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
                Browsers block direct links to this page for security.
              </div>
            </div>
          </div>
        </div>

        <div style={styles.extensionStep}>
          <div style={styles.extensionStepNumber}>3</div>
          <div style={styles.extensionStepBody}>
            <div style={styles.extensionStepTitle}>Load the extension</div>
            <div style={styles.extensionStepDetail}>
              Enable <strong>Developer mode</strong> (top-right toggle), click{" "}
              <strong>Load unpacked</strong>, and select the extracted{" "}
              <code style={styles.extensionCode}>readcast-extension</code> folder.
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handlePreview = async () => {
    if (!inputValue.trim()) return;
    setPreviewing(true);
    try {
      const result = await onPreview({ input: inputValue.trim() });
      setPreview(result);
    } finally {
      setPreviewing(false);
    }
  };

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
    <div style={styles.addPanel} role="presentation">
      <div style={styles.addPanelInner} role="dialog" aria-modal="true" aria-labelledby="add-article-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 id="add-article-title" style={styles.addTitle}>New Article</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close add article dialog">✕</button>
        </div>

        <label style={styles.fieldLabel}>URL or text</label>
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            setPreview(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/article or paste plain text..."
          rows={5}
          style={styles.urlInput}
          aria-label="Article URL or pasted text"
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
            aria-label="Change default voice"
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
                aria-label={`Set default voice to ${voiceLabel(voiceOption.name)}`}
              >
                {voiceLabel(voiceOption.name)}
              </button>
            ))}
          </div>
        ) : null}

        {preview ? (
          <div style={styles.previewCard}>
            <div style={styles.previewMetaRow}>
              <div>
                <div style={styles.previewTitle}>{preview.article.title}</div>
                <div style={styles.previewMeta}>
                  {preview.source}
                  <span style={styles.metaDot}>·</span>
                  {preview.article.estimated_read_min}m read
                  <span style={styles.metaDot}>·</span>
                  {preview.article.word_count} words
                </div>
              </div>
            </div>
            <div style={styles.previewBody}>
              {preview.chunks.slice(0, 5).map((chunk) => (
                <p key={`${chunk.idx}-${chunk.chunk_type}`} style={styles.previewParagraph}>{chunk.text}</p>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div style={styles.errorText}>{error}</div> : null}

        <div style={styles.submitActions}>
          <button
            onClick={handlePreview}
            disabled={!inputValue.trim() || previewing}
            style={{ ...styles.secondaryBtn, opacity: !inputValue.trim() || previewing ? 0.5 : 1 }}
            aria-label="Preview extracted article text"
          >
            {previewing ? <SpinnerIcon /> : preview ? "Refresh Preview" : "Preview"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || submitting}
            style={{ ...styles.submitBtnCompact, opacity: !inputValue.trim() || submitting ? 0.5 : 1 }}
            aria-label="Add article and start processing"
          >
            {submitting ? <SpinnerIcon /> : "Add & Process"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditableField({ value, placeholder, onSave, style, inputStyle }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "").trim()) {
      onSave(trimmed);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } }}
        style={{ ...styles.editableInput, ...inputStyle }}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{ ...styles.editableText, ...style, cursor: "pointer" }}
      title="Click to edit"
    >
      {value || <span style={{ opacity: 0.3 }}>{placeholder}</span>}
    </span>
  );
}

function ArticleDetail({ article, voices, onReprocess, onClose, onRefresh }) {
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
    apiGet(`/api/articles/${article.id}/text`)
      .then((data) => setFullText(data.text || ""))
      .catch(() => setFullText("(Could not load text)"))
      .finally(() => setLoading(false));
    apiGet(`/api/articles/${article.id}/entities`)
      .then((data) => setEntities(data.entities || []))
      .catch(() => setEntities([]));
  }, [article.id]);

  const handleMetaSave = async (field, value) => {
    try {
      await apiJson(`/api/articles/${article.id}`, "PUT", { [field]: value });
      if (onRefresh) onRefresh();
    } catch {}
  };

  const handleRemoveParagraph = (index) => {
    setRemovedIndices((prev) => new Set([...prev, index]));
  };

  const handleUndoRemove = (index) => {
    setRemovedIndices((prev) => { const next = new Set(prev); next.delete(index); return next; });
  };

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
    } catch (err) {
      setMessage("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReprocess = async () => {
    if (reprocessing) return;
    setReprocessing(true);
    try {
      await onReprocess(article.id, reprocessVoice);
      setTextModified(false);
      setMessage("");
    } finally {
      setReprocessing(false);
    }
  };

  const canRenarrate = reprocessVoice !== article.voice || textModified;

  return (
    <div style={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
      <div style={styles.detailHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditableField
            value={article.title}
            placeholder="Title"
            onSave={(v) => handleMetaSave("title", v)}
            style={styles.detailTitle}
            inputStyle={{ ...styles.detailTitle, width: "100%" }}
          />
          <div style={styles.detailMeta}>
            <EditableField
              value={article.author}
              placeholder="Author"
              onSave={(v) => handleMetaSave("author", v)}
            />
            <span style={styles.metaDot}>·</span>
            <EditableField
              value={article.publication}
              placeholder="Publication"
              onSave={(v) => handleMetaSave("publication", v)}
            />
            <span style={styles.metaDot}>·</span>
            <EditableField
              value={article.published_date}
              placeholder="Date"
              onSave={(v) => handleMetaSave("published_date", v)}
            />
            <span style={styles.metaDot}>·</span>
            <span>{liveWordCount} words</span>
          </div>
          {article.source_url ? (
            <a href={article.source_url} target="_blank" rel="noopener noreferrer" style={styles.detailLink}>
              {article.source_url}
            </a>
          ) : null}
        </div>
        <button onClick={onClose} style={styles.closeBtn} aria-label="Close detail view">✕</button>
      </div>

      <div style={styles.detailVoiceRow}>
        <span style={styles.detailVoiceLabel}>Voice:</span>
        <select
          value={reprocessVoice}
          onChange={(e) => setReprocessVoice(e.target.value)}
          style={styles.detailVoiceSelect}
        >
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{voiceLabel(v.name)}</option>
          ))}
        </select>
        <button
          onClick={handleReprocess}
          disabled={reprocessing || !canRenarrate}
          style={{
            ...styles.detailReprocessBtn,
            opacity: reprocessing || !canRenarrate ? 0.5 : 1,
          }}
        >
          {reprocessing ? "Reprocessing..." : "Renarrate"}
        </button>
      </div>

      {entities.length > 0 ? (
        <div style={styles.entitySection}>
          <div style={styles.entitySectionTitle}>Entities</div>
          <div style={styles.entityList}>
            {entities.map((e) => (
              <span key={e.id} style={styles.entityTag} title={e.entity_type}>
                {e.name}
                <span style={styles.entityType}>{e.entity_type}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <div style={styles.detailMessage}>{message}</div> : null}

      <div style={styles.detailTextWrap}>
        {loading ? (
          <div style={styles.detailLoading}>Loading text...</div>
        ) : (
          <div style={styles.detailText}>
            {paragraphs.map((para, i) => {
              const removed = removedIndices.has(i);
              if (removed) {
                return (
                  <div key={i} style={styles.removedParagraph}>
                    <span style={styles.removedText}>{para.slice(0, 80)}...</span>
                    <button onClick={() => handleUndoRemove(i)} style={styles.undoBtn}>Undo</button>
                  </div>
                );
              }
              return (
                <div key={i} style={styles.paragraphRow}>
                  <button
                    onClick={() => handleRemoveParagraph(i)}
                    style={styles.removeParagraphBtn}
                    title="Remove this paragraph from narration"
                    aria-label="Remove paragraph"
                  >
                    ×
                  </button>
                  <p style={styles.detailParagraph}>{para}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {removedIndices.size > 0 ? (
        <div style={styles.detailSaveBar}>
          <span style={styles.detailSaveInfo}>{removedIndices.size} paragraph{removedIndices.size > 1 ? "s" : ""} removed</span>
          <button onClick={handleSaveText} disabled={saving} style={{ ...styles.detailReprocessBtn, opacity: saving ? 0.5 : 1 }}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ArticleCard({ article, isActive, isExpanded, selectionMode, selected, onPlay, onToggleSelect, onDetailToggle }) {
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
        ...(isExpanded ? styles.cardExpanded : {}),
      }}
      role="button"
      tabIndex={0}
      aria-label={`${article.title}, ${statusText}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selectionMode) {
            onToggleSelect(article.id);
          } else {
            onDetailToggle(article.id);
          }
        }
      }}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect(article.id);
          return;
        }
        onDetailToggle(article.id);
      }}
    >
      <div style={styles.cardLeft}>
        <div
          style={styles.cardPlayArea}
          onClick={(e) => {
            if (!selectionMode && canPlay) {
              e.stopPropagation();
              onPlay(article);
            }
          }}
        >
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
        {article.listened_at ? <span style={styles.listenedBadge}>Listened</span> : null}
        <span style={styles.voiceTag}>{article.voice || "default"}</span>
      </div>
    </div>
  );
}

function PlayerBar({ article, isPlaying, currentTime, duration, playbackRate, playbackRates, onToggle, onSeek, onPlaybackRateChange }) {
  if (!article) return null;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={styles.playerBar}>
      <div style={styles.playerProgress} onClick={onSeek}>
        <div style={{ ...styles.playerProgressFill, width: `${percent}%` }} />
      </div>
      <div style={styles.playerInner}>
        <button onClick={onToggle} style={styles.playerPlayBtn} aria-label={isPlaying ? "Pause audio" : "Play audio"}>
          {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <div style={styles.playerInfo}>
          <div style={styles.playerTitle}>{article.title}</div>
          <div style={styles.playerSource}>{sourceLabel(article)}</div>
        </div>
        <label style={styles.speedControl}>
          <span style={styles.speedLabel}>Speed</span>
          <select
            value={String(playbackRate)}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
            style={styles.speedSelect}
            aria-label="Playback speed"
          >
            {(playbackRates.length ? playbackRates : PLAYBACK_RATES).map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate}x
              </option>
            ))}
          </select>
        </label>
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
  const [addError, setAddError] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [showExtension, setShowExtension] = useState(false);
  const [daemonMessage, setDaemonMessage] = useState("");
  const [daemonState, setDaemonState] = useState("offline");
  const [detailId, setDetailId] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const audioRef = useRef(null);
  const searchRef = useRef(null);
  const listenedFiredRef = useRef(null);

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
      setPlaybackRate(Number(data.preferences?.playback_rate || 1.0));
      setPlaybackRates(data.preferences?.available_playback_rates || PLAYBACK_RATES);
    } catch (error) {
      setDaemonError(error.message);
    }
  }

  async function refreshStatus() {
    try {
      const data = await apiGet("/api/status");
      setDaemonConnected(Boolean(data.kokoro_edge?.connected));
      setDaemonState(data.kokoro_edge?.state || "offline");
      setDaemonMessage(data.kokoro_edge?.message || "");
      setDaemonError(data.kokoro_edge?.error || "");
    } catch (error) {
      setDaemonConnected(false);
      setDaemonState("offline");
      setDaemonMessage("");
      setDaemonError(error.message);
    }
  }

  useEffect(() => {
    refreshArticles("");
    refreshVoices();
    refreshPreferences();
    refreshStatus();
    apiGet("/api/update-check").then((data) => {
      if (data.update_available) setUpdateInfo(data);
    }).catch(() => {});
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (showExtension && event.key === "Escape") {
        setShowExtension(false);
        return;
      }
      if (showAdd && event.key === "Escape") {
        setAddError("");
        setShowAdd(false);
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setShowAdd(true);
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        handleToggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdd, showExtension, activeArticle, playbackRate]);

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

  async function handlePreview(payload) {
    setAddError("");
    try {
      const data = await apiJson("/api/preview", "POST", payload);
      return data.preview;
    } catch (error) {
      setAddError(error.message);
      throw error;
    }
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
    listenedFiredRef.current = null;
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

  async function handleReprocess(articleId, voice) {
    await apiJson(`/api/articles/${articleId}/reprocess`, "POST", { voice });
    refreshArticles(search);
    refreshStatus();
  }

  function handleDetailToggle(articleId) {
    setDetailId((current) => (current === articleId ? null : articleId));
  }

  async function handleCopyFeed() {
    const feedUrl = new URL("/feed.xml", window.location.href).toString();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(feedUrl);
    } else {
      window.prompt("Copy feed URL", feedUrl);
    }
    setFeedCopied(true);
    window.setTimeout(() => setFeedCopied(false), 1500);
  }

  return (
    <div style={styles.root}>
      <style>{globalStyles}</style>
      <audio ref={audioRef} preload="metadata" />

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>readcast</h1>
          <div style={styles.daemonBadge} aria-label={`kokoro-edge status: ${daemonState}`}>
            <div style={{ ...styles.statusDot, background: daemonState === "ready" ? "#5cb85c" : daemonConnected ? "#d4af37" : "#d9534f" }} />
            <span style={styles.daemonLabel}>kokoro-edge</span>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button onClick={handleCopyFeed} style={styles.headerBtn} aria-label="Copy podcast feed URL">
            <span>{feedCopied ? "Feed Copied" : "Copy Feed"}</span>
          </button>
          <button onClick={() => setShowExtension(true)} style={styles.headerBtn} aria-label="Browser extension setup">
            <ExtensionIcon size={15} />
            <span>Extension</span>
          </button>
          <button onClick={handleSelectionModeToggle} style={selectionMode ? styles.headerBtnActive : styles.headerBtn}>
            <CheckIcon size={15} />
            <span>{selectionMode ? "Done" : "Select"}</span>
          </button>
          <button onClick={() => setShowAdd(true)} style={styles.addBtn} aria-label="Add article">
            <PlusIcon size={16} />
            <span>Add Article</span>
          </button>
        </div>
      </header>

      {daemonError || daemonState !== "ready" ? (
        <div style={{ ...styles.banner, ...(daemonError ? styles.bannerError : styles.bannerInfo) }}>
          {daemonError || daemonMessage}
        </div>
      ) : null}
      {deleteError ? <div style={{ ...styles.banner, ...styles.bannerError }}>{deleteError}</div> : null}

      {updateInfo && !updateDismissed ? (
        <div style={{ ...styles.banner, ...styles.bannerUpdate }}>
          <span>
            readcast {updateInfo.latest} is available (you have {updateInfo.current}).
            {" "}Run <code style={styles.updateCode}>pixi global upgrade readcast</code> to update.
          </span>
          <button onClick={() => setUpdateDismissed(true)} style={styles.updateDismiss} aria-label="Dismiss">✕</button>
        </div>
      ) : null}

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
          ref={searchRef}
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search articles..."
          style={styles.searchInput}
          aria-label="Search articles"
        />
        {search ? <button onClick={() => setSearch("")} style={styles.searchClear} aria-label="Clear search">✕</button> : null}
      </div>

      <div style={styles.library}>
        {!articles.length ? (
          <div style={styles.empty}>
            {search ? "No articles match your search." : (
              <>
                No articles yet. Add one with the{" "}
                <span
                  onClick={() => setShowExtension(true)}
                  style={{ color: c.accent, cursor: "pointer", textDecoration: "underline" }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setShowExtension(true); }}
                >
                  browser extension
                </span>{" "}
                or the Add Article button above.
              </>
            )}
          </div>
        ) : (
          articles.map((article) => (
            <React.Fragment key={article.id}>
              <ArticleCard
                article={article}
                isActive={activeId === article.id}
                isExpanded={detailId === article.id}
                selectionMode={selectionMode}
                selected={selectedIds.includes(article.id)}
                onPlay={handlePlay}
                onToggleSelect={handleToggleSelect}
                onDetailToggle={handleDetailToggle}
              />
              {detailId === article.id ? (
                <ArticleDetail
                  article={article}
                  voices={voices}
                  onReprocess={handleReprocess}
                  onClose={() => setDetailId(null)}
                  onRefresh={() => refreshArticles(search)}
                />
              ) : null}
            </React.Fragment>
          ))
        )}
      </div>

      <PlayerBar
        article={activeArticle}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        playbackRate={playbackRate}
        playbackRates={playbackRates}
        onToggle={handleToggle}
        onSeek={handleSeek}
        onPlaybackRateChange={handleSavePlaybackRate}
      />

      {showAdd ? (
        <AddPanel
          voices={voices}
          defaultVoice={defaultVoice}
          onAdd={handleAdd}
          onPreview={handlePreview}
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

      {showExtension ? (
        <ExtensionPanel onClose={() => setShowExtension(false)} />
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
[style*="editableText"]:hover, span[title="Click to edit"]:hover { border-bottom-color: rgba(255,255,255,0.2) !important; }
div[style]:hover > button[aria-label="Remove paragraph"] { color: rgba(217, 83, 79, 0.7) !important; }
div[style]:hover > button[aria-label="Remove paragraph"]:hover { color: rgba(217, 83, 79, 1) !important; }
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
  bannerInfo: {
    border: `1px solid rgba(92, 184, 92, 0.25)`,
    background: "rgba(92, 184, 92, 0.08)",
    color: "#cfe8cf",
  },
  bannerUpdate: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: `1px solid rgba(212, 149, 106, 0.3)`,
    background: "rgba(212, 149, 106, 0.08)",
    color: "#e8cdb8",
  },
  updateCode: {
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(0,0,0,0.3)",
    fontFamily: "'DM Sans', monospace",
    fontSize: 12,
  },
  updateDismiss: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.4)",
    cursor: "pointer",
    fontSize: 14,
    padding: "0 4px",
    fontFamily: "inherit",
    flexShrink: 0,
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
  listenedBadge: {
    fontSize: 10,
    fontFamily: "'DM Sans', sans-serif",
    color: "#7ec88b",
    background: "rgba(126,200,139,0.12)",
    padding: "2px 7px",
    borderRadius: 4,
    letterSpacing: "0.03em",
    marginRight: 6,
    fontWeight: 600,
    textTransform: "uppercase",
  },
  entitySection: {
    padding: "8px 16px",
    borderBottom: `1px solid ${c.border}`,
  },
  entitySectionTitle: {
    fontSize: 11,
    color: c.textMuted,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  },
  entityList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  entityTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: c.textSecondary,
    background: "rgba(255,255,255,0.06)",
    padding: "3px 8px",
    borderRadius: 4,
  },
  entityType: {
    fontSize: 10,
    color: c.textMuted,
    fontStyle: "italic",
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
  cardExpanded: {
    background: "rgba(255,255,255,0.03)",
    borderBottom: "none",
    borderRadius: "10px 10px 0 0",
  },
  detailPanel: {
    padding: "0 16px 16px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "0 0 10px 10px",
    borderBottom: `1px solid ${c.border}`,
    marginBottom: 2,
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  detailTitle: {
    fontFamily: c.serif,
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1.3,
    marginBottom: 6,
  },
  detailMeta: {
    fontSize: 12,
    color: c.textMuted,
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "center",
  },
  detailLink: {
    display: "block",
    fontSize: 12,
    color: c.accent,
    marginTop: 6,
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detailDescription: {
    fontSize: 13,
    color: c.textMuted,
    marginTop: 8,
    lineHeight: 1.5,
    fontStyle: "italic",
  },
  detailVoiceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: c.surface,
    borderRadius: 8,
    marginBottom: 12,
  },
  detailVoiceLabel: {
    fontSize: 12,
    color: c.textMuted,
    fontWeight: 500,
  },
  detailVoiceSelect: {
    flex: 1,
    background: "rgba(255,255,255,0.06)",
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: "5px 8px",
    color: c.text,
    fontSize: 12,
    fontFamily: c.sans,
    outline: "none",
  },
  detailReprocessBtn: {
    padding: "5px 14px",
    borderRadius: 6,
    border: "none",
    background: c.accent,
    color: "#141416",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  detailTextWrap: {
    maxHeight: 400,
    overflowY: "auto",
    borderRadius: 8,
    background: c.surface,
    padding: "16px 20px",
  },
  detailLoading: {
    color: c.textMuted,
    fontSize: 13,
    textAlign: "center",
    padding: 20,
  },
  detailText: {
    fontFamily: c.serif,
    fontSize: 15,
    lineHeight: 1.7,
    color: c.text,
  },
  detailParagraph: {
    marginBottom: 14,
    flex: 1,
  },
  editableText: {
    borderBottom: "1px dashed transparent",
    transition: "border-color 0.15s",
  },
  editableInput: {
    background: "rgba(255,255,255,0.06)",
    border: `1px solid ${c.accent}`,
    borderRadius: 4,
    padding: "2px 6px",
    color: c.text,
    fontSize: "inherit",
    fontFamily: "inherit",
    fontWeight: "inherit",
    outline: "none",
  },
  paragraphRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    position: "relative",
  },
  removeParagraphBtn: {
    background: "none",
    border: "none",
    color: "rgba(217, 83, 79, 0)",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    padding: "0 4px",
    lineHeight: "1.7",
    flexShrink: 0,
    transition: "color 0.15s",
  },
  removedParagraph: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
    marginBottom: 8,
  },
  removedText: {
    flex: 1,
    fontSize: 13,
    color: c.textMuted,
    textDecoration: "line-through",
    opacity: 0.5,
  },
  undoBtn: {
    background: "none",
    border: `1px solid ${c.border}`,
    borderRadius: 4,
    color: c.accent,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: c.sans,
    padding: "2px 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  detailSaveBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    marginTop: 10,
    background: c.surface,
    borderRadius: 8,
  },
  detailSaveInfo: {
    fontSize: 12,
    color: c.textMuted,
  },
  detailMessage: {
    fontSize: 12,
    color: c.accent,
    padding: "8px 12px",
    background: c.accentDim,
    borderRadius: 8,
    marginBottom: 10,
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
  speedControl: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  speedLabel: {
    fontSize: 12,
    color: c.textMuted,
  },
  speedSelect: {
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: "rgba(255,255,255,0.04)",
    color: c.text,
    fontSize: 12,
    padding: "6px 8px",
    fontFamily: c.sans,
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
  previewCard: {
    marginTop: 18,
    padding: "14px 16px",
    borderRadius: 12,
    border: `1px solid ${c.border}`,
    background: "rgba(255,255,255,0.03)",
  },
  previewMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  previewTitle: {
    fontFamily: c.serif,
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  previewMeta: {
    marginTop: 6,
    fontSize: 12,
    color: c.textMuted,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
  },
  previewBody: {
    marginTop: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  previewParagraph: {
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 1.55,
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
  submitActions: {
    display: "flex",
    gap: 10,
    marginTop: 24,
  },
  submitBtnCompact: {
    flex: 1,
    padding: "12px 0",
    borderRadius: 8,
    border: "none",
    background: c.accent,
    color: "#141416",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  extensionPanelInner: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflow: "auto",
  },
  extensionBrowserRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 22,
  },
  extensionStep: {
    display: "flex",
    gap: 14,
    marginBottom: 20,
  },
  extensionStepNumber: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: c.accentDim,
    color: c.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  extensionStepBody: {
    flex: 1,
  },
  extensionStepTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 6,
  },
  extensionStepDetail: {
    fontSize: 13,
    color: c.textMuted,
    lineHeight: 1.5,
  },
  extensionCode: {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 4,
    background: "rgba(0,0,0,0.3)",
    fontFamily: "'DM Sans', monospace",
    fontSize: 13,
    color: c.accent,
    letterSpacing: "0.02em",
    userSelect: "all",
  },
  extensionDownloadBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: c.accent,
    color: "#141416",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: c.sans,
    cursor: "pointer",
    textDecoration: "none",
  },
};

createRoot(document.getElementById("root")).render(<ReadcastApp />);
