/**
 * FilePreviewModal.tsx
 * Full-screen file preview + editor modal.
 * Fully theme-aware: adapts topbar, status bar, surfaces, and text to dark/light.
 *
 * Read mode  → SyntaxHighlighter (highlight.js, lazy, theme-aware)
 * Edit mode  → CodeEditor (CodeMirror 6, lazy, theme-aware via Compartment)
 * Binary     → native <img>, <video>, <audio>, <iframe>
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Download,
  Loader2,
  File as FallbackIcon,
  Pencil,
  Save,
  X as XIcon,
  CheckCircle2,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  ExternalLink,
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { downloadFileToBuffer, downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { updateFileLocal, addFile, deleteTelegramMessage } from "@/lib/storage/metadataStore";
import { uploadFileToTelegram } from "@/lib/telegram/uploader";
import { useFileStore } from "@/stores/fileStore";
import { Button } from "@/components/ui/button";
import { marked } from "marked";
import { isEditableFile } from "@/lib/files/editableTypes";
import { detectLang } from "@/lib/files/langDetect";
import { useDarkMode } from "@/hooks/useDarkMode";
import { SyntaxHighlighter } from "./SyntaxHighlighter";
import { CodeEditor } from "./CodeEditor";
import { toast } from "sonner";
import { open as openUrl } from "@tauri-apps/plugin-shell";

// ─── O2 Code Editor — runnable language map ────────────────────────────────
// Maps our hljsLang alias → O2's route value.
// Only languages O2 can actually execute/render are listed here.
const O2_LANG_MAP: Record<string, string> = {
  python:     "python",
  javascript: "javascript",
  typescript: "typescript",
  cpp:        "cpp",
  c:          "c",
  java:       "java",
  rust:       "rust",
  go:         "go",
  php:        "php",
  ruby:       "ruby",
  sql:        "sql",
  html:       "html",
};

// ─── File-type icon ────────────────────────────────────────────────────────

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-purple-500 shrink-0" />;
  if (mime.startsWith("video/")) return <Film className="h-4 w-4 text-pink-500 shrink-0" />;
  if (mime.startsWith("audio/")) return <Music className="h-4 w-4 text-teal-500 shrink-0" />;
  if (["csv", "xls", "xlsx"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (isEditableFile({ mime, name } as TeleFile)) return <FileCode2 className="h-4 w-4 text-blue-500 shrink-0" />;
  return <FileText className="h-4 w-4 text-slate-400 shrink-0" />;
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  file: TeleFile | null;
  initialEditMode?: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────

export function FilePreviewModal({ file, initialEditMode = false, onClose }: Props) {
  const isDark = useDarkMode();

  // ── Download / load state ────────────────────────────────────────────────
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState<string | null>(null);
  const [contentUrl, setContentUrl]   = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [markdownHtml, setMarkdownHtml] = useState<string | null>(null);

  // ── Edit state ──────────────────────────────────────────────────────────
  const [isEditMode, setIsEditMode]   = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving]       = useState(false);
  const [saveStatus, setSaveStatus]   = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cursorPos, setCursorPos]     = useState({ line: 1, col: 1 });

  // ── Theme-derived surface colors ─────────────────────────────────────────
  const colors = useMemo(() => isDark ? {
    bg:         "#0d1117",
    topbar:     "#0d1117",
    statusbar:  "#161b22",
    border:     "#1e293b",
    text:       "#e2e8f0",
    muted:      "#64748b",
    hover:      "rgba(255,255,255,0.06)",
    badgeBg:    "#1e293b",
    badgeText:  "#64748b",
    badgeBdr:   "#334155",
    editBadgeBg:"rgba(59,130,246,0.15)",
    editBadgeText:"#60a5fa",
    editBadgeBdr:"rgba(59,130,246,0.3)",
    progressTrack:"#1e293b",
    errorBg:    "rgba(239,68,68,0.08)",
    errorBdr:   "rgba(239,68,68,0.2)",
    errorText:  "#f87171",
    fallbackBg: "#111827",
    fallbackBdr:"#1e293b",
    dotGrid:    "#1e293b",
  } : {
    bg:         "#ffffff",
    topbar:     "#ffffff",
    statusbar:  "#f6f8fa",
    border:     "#e2e8f0",
    text:       "#1e293b",
    muted:      "#64748b",
    hover:      "rgba(0,0,0,0.05)",
    badgeBg:    "#f0f4f8",
    badgeText:  "#64748b",
    badgeBdr:   "#e2e8f0",
    editBadgeBg:"rgba(37,99,235,0.08)",
    editBadgeText:"#2563eb",
    editBadgeBdr:"rgba(37,99,235,0.25)",
    progressTrack:"#e2e8f0",
    errorBg:    "rgba(239,68,68,0.06)",
    errorBdr:   "rgba(239,68,68,0.18)",
    errorText:  "#dc2626",
    fallbackBg: "#f8fafc",
    fallbackBdr:"#e2e8f0",
    dotGrid:    "#e2e8f0",
  }, [isDark]);

  // ── Update lastOpenedAt ──────────────────────────────────────────────────
  useEffect(() => {
    if (file) {
      const store = useFileStore.getState();
      store.setFiles(updateFileLocal(store.files, file.id, { lastOpenedAt: Date.now() }));
    }
  }, [file]);

  // ── Load file on change ──────────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      if (contentUrl) URL.revokeObjectURL(contentUrl);
      setContentUrl(null); setTextContent(null); setMarkdownHtml(null);
      setError(null); setIsEditMode(false); setEditContent(""); setSaveStatus("idle");
      return;
    }

    let current = true;

    (async () => {
      setLoading(true); setProgress(0); setError(null);
      setTextContent(null); setContentUrl(null); setMarkdownHtml(null);

      try {
        const buffer = await downloadFileToBuffer(
          file.channelId, file.messageId,
          (pct) => { if (current) setProgress(pct); }
        );
        if (!current) return;

        const mimeLower = file.mime.toLowerCase();
        const isTextMime = (
          mimeLower.startsWith("text/") ||
          mimeLower.includes("javascript") || mimeLower.includes("typescript") ||
          mimeLower.includes("json") || mimeLower.includes("xml") ||
          mimeLower.includes("yaml") || mimeLower.includes("x-sh") ||
          mimeLower.includes("x-python")
        );

        if (isTextMime || isEditableFile(file)) {
          let text = new TextDecoder().decode(buffer);
          // Normalize line endings to LF (\n) to ensure consistent line counting and rendering
          text = text.replace(/\r\n|\r/g, "\n");
          if (!current) return;
          setTextContent(text);

          if (mimeLower === "text/markdown" || file.name.endsWith(".md")) {
            const html = await marked.parse(text);
            if (current) setMarkdownHtml(html);
          }

          if (initialEditMode && current) {
            setEditContent(text);
            setIsEditMode(true);
          }
        } else {
          const blob = new Blob([buffer], { type: file.mime });
          if (current) setContentUrl(URL.createObjectURL(blob));
        }
      } catch (err: any) {
        if (current) setError(err.message || "Failed to download file.");
      } finally {
        if (current) setLoading(false);
      }
    })();

    return () => { current = false; };
  }, [file]);

  useEffect(() => () => { if (contentUrl) URL.revokeObjectURL(contentUrl); }, [contentUrl]);

  // ── Handlers (memoized) ──────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (file) downloadFileFromTelegram(file.channelId, file.messageId, file.name);
  }, [file]);

  const handleEnterEdit = useCallback(() => {
    setEditContent(textContent ?? "");
    setIsEditMode(true);
    setSaveStatus("idle");
  }, [textContent]);

  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false);
    setEditContent("");
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    if (!file || isSaving) return;
    setIsSaving(true); setSaveStatus("saving");

    try {
      const bytes = new TextEncoder().encode(editContent);
      const newFile = new File([bytes], file.name, { type: file.mime });

      const message = await uploadFileToTelegram(
        file.channelId, file.name, bytes.length, newFile, () => {}
      );

      try { await deleteTelegramMessage(file.channelId, file.messageId); } catch { /* best-effort */ }

      const updated: TeleFile = { ...file, messageId: message.id, size: bytes.length, uploadedAt: Date.now() };
      const updatedFiles = await addFile(file.channelId, updated);
      useFileStore.getState().setFiles(updatedFiles);

      setTextContent(editContent);
      if (file.name.endsWith(".md")) {
        setMarkdownHtml(await marked.parse(editContent));
      } else {
        setMarkdownHtml(null);
      }

      setIsEditMode(false);
      setEditContent("");
      setSaveStatus("saved");
      toast.success(`"${file.name}" saved successfully!`);
    } catch (err: any) {
      setSaveStatus("error");
      toast.error(`Save failed: ${err.message ?? "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  }, [file, editContent, isSaving]);

  // ── O2 Code Editor integration ──────────────────────────────────────────
  const handleOpenInO2 = useCallback(async () => {
    const code = isEditMode ? editContent : (textContent ?? "");
    const lInfo = detectLang(file?.name ?? "");
    const o2Lang = O2_LANG_MAP[lInfo.hljsLang];
    if (!o2Lang) return;
    // Encode code as UTF-8 base64 for URL transport
    const encoded = btoa(unescape(encodeURIComponent(code)));
    const url = `https://o2code.vercel.app/${o2Lang}?code=${encoded}&run=true`;
    
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL in native browser:", err);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [file, textContent, editContent, isEditMode]);

  if (!file) return null;

  // ── Derived state ─────────────────────────────────────────────────────────
  const langInfo   = detectLang(file.name);
  const isImage    = file.mime.startsWith("image/");
  const isVideo    = file.mime.startsWith("video/");
  const isAudio    = file.mime.startsWith("audio/");
  const isPdf      = file.mime === "application/pdf";
  const isMarkdown = markdownHtml !== null && !isEditMode;
  const isCode     = textContent !== null && !isMarkdown;
  const canEdit    = isEditableFile(file) && !loading && !error && textContent !== null;
  // Only show O2 button when we have a runnable language loaded
  const canRunInO2 = textContent !== null && !loading && !error &&
    O2_LANG_MAP[langInfo.hljsLang] !== undefined;

  const statusParts: string[] = [];
  if (langInfo.displayName && !isImage && !isVideo && !isAudio && !isPdf)
    statusParts.push(langInfo.displayName);
  if (textContent !== null) {
    const lc = (isEditMode ? editContent : textContent).split("\n").length;
    statusParts.push(`${lc.toLocaleString()} lines`);
  }
  statusParts.push("UTF-8");
  if (isEditMode) statusParts.push(`Ln ${cursorPos.line}, Col ${cursorPos.col}`);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col animate-in fade-in duration-150"
      style={{ background: colors.bg, color: colors.text }}
    >
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between pl-4 pr-3 shrink-0"
        style={{
          height: "44px",
          background: colors.topbar,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {/* Left: icon + name + badges */}
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-4">
          <FileTypeIcon mime={file.mime} name={file.name} />
          <span
            className="text-[13px] font-semibold truncate tracking-tight"
            style={{ color: colors.text }}
          >
            {file.name}
          </span>

          {langInfo.displayName && !isImage && !isVideo && !isAudio && !isPdf && (
            <span
              className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
              style={{
                background: colors.badgeBg,
                color: colors.badgeText,
                border: `1px solid ${colors.badgeBdr}`,
              }}
            >
              {langInfo.displayName}
            </span>
          )}

          {isEditMode && (
            <span
              className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-widest"
              style={{
                background: colors.editBadgeBg,
                color: colors.editBadgeText,
                border: `1px solid ${colors.editBadgeBdr}`,
              }}
            >
              Editing
            </span>
          )}

          {saveStatus === "saved" && !isEditMode && (
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-500"
            >
              <CheckCircle2 className="h-3 w-3" />
              Saved
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="flex items-center gap-1 h-7 px-3 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors duration-150 disabled:opacity-50"
                style={{ color: colors.muted }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <XIcon className="h-3.5 w-3.5" />
                Cancel
              </button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7 px-3 text-[12px] font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer disabled:opacity-50 transition-colors duration-150"
              >
                {isSaving
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                  : <><Save className="h-3.5 w-3.5 mr-1.5" />Save</>
                }
              </Button>
            </>
          ) : (
            <>
              {/* O2 Code Runner button — shown for runnable languages */}
              {canRunInO2 && (
                <button
                  onClick={handleOpenInO2}
                  title="Run in O2 Code Editor"
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-all duration-150"
                  style={{ color: isDark ? "#34d399" : "#059669" }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = isDark ? "rgba(52,211,153,0.12)" : "rgba(5,150,105,0.08)";
                  }}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Run</span>
                </button>
              )}

              {canEdit && (
                <button
                  onClick={handleEnterEdit}
                  title="Edit file"
                  className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-semibold rounded-lg cursor-pointer transition-colors duration-150"
                  style={{ color: colors.muted }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              <button
                onClick={handleDownload}
                title="Download"
                className="flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150"
                style={{ color: colors.muted }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150 ml-0.5 hover:text-red-500"
            style={{ color: colors.muted }}
            onMouseEnter={e => (e.currentTarget.style.background = colors.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative" style={{ background: colors.bg }}>

        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
            <div className="flex flex-col items-center gap-1.5">
              <span
                className="text-[10px] font-bold font-mono uppercase tracking-widest"
                style={{ color: colors.muted }}
              >
                Loading…
              </span>
              <div
                className="w-36 h-1 rounded-full overflow-hidden"
                style={{ background: colors.progressTrack }}
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span
                className="text-[10px] font-mono"
                style={{ color: colors.muted }}
              >
                {progress}%
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div
              className="rounded-2xl px-6 py-4 text-[13px] font-semibold max-w-sm text-center"
              style={{
                background: colors.errorBg,
                border: `1px solid ${colors.errorBdr}`,
                color: colors.errorText,
              }}
            >
              {error}
            </div>
            <button
              onClick={handleDownload}
              className="px-5 py-2 rounded-xl text-[12px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors duration-150 cursor-pointer"
            >
              Download Instead
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && (
          <div className="absolute inset-0">

            {/* IMAGE */}
            {isImage && contentUrl && (
              <div
                className="w-full h-full flex items-center justify-center p-6"
                style={{
                  backgroundImage: `radial-gradient(circle at center, ${colors.dotGrid} 1px, transparent 1px)`,
                  backgroundSize: "20px 20px",
                }}
              >
                <img
                  src={contentUrl}
                  alt={file.name}
                  className="max-w-full max-h-full object-contain select-text"
                  style={{ borderRadius: "8px", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
                />
              </div>
            )}

            {/* VIDEO */}
            {isVideo && contentUrl && (
              <div className="w-full h-full flex items-center justify-center p-4">
                <video
                  src={contentUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-full"
                  style={{ borderRadius: "8px", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
                />
              </div>
            )}

            {/* AUDIO */}
            {isAudio && contentUrl && (
              <div className="w-full h-full flex items-center justify-center p-4">
                <div
                  className="flex flex-col items-center gap-6 p-8 rounded-3xl max-w-sm w-full"
                  style={{
                    background: isDark ? "#111827" : "#f8fafc",
                    border: `1px solid ${colors.border}`,
                    boxShadow: "0 25px 60px rgba(0,0,0,0.2)",
                  }}
                >
                  <div
                    className="h-20 w-20 rounded-full flex items-center justify-center text-teal-500"
                    style={{
                      background: isDark ? "#0d1f1d" : "#f0fdf4",
                      border: `1px solid ${isDark ? "rgba(20,184,166,0.3)" : "rgba(20,184,166,0.4)"}`,
                    }}
                  >
                    <Music className="h-8 w-8" />
                  </div>
                  <div className="text-center min-w-0 w-full">
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: colors.text }}
                    >
                      {file.name}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: colors.muted }}>Audio Track</p>
                  </div>
                  <audio src={contentUrl} controls autoPlay className="w-full" />
                </div>
              </div>
            )}

            {/* PDF */}
            {isPdf && contentUrl && (
              <iframe
                src={contentUrl}
                title={file.name}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: "white" }}
              />
            )}

            {/* MARKDOWN */}
            {isMarkdown && (
              <div
                className="absolute inset-0 overflow-y-auto px-8 py-8 md:px-16 pointer-events-auto select-text"
                style={{
                  scrollbarWidth: "thin",
                  scrollbarColor: isDark ? "#334155 transparent" : "#cbd5e1 transparent",
                  background: colors.bg,
                }}
              >
                <div
                  className="prose prose-sm max-w-3xl mx-auto leading-relaxed"
                  style={{ color: colors.text }}
                  dangerouslySetInnerHTML={{ __html: markdownHtml! }}
                />
              </div>
            )}

            {/* CODE — Edit Mode */}
            {isCode && isEditMode && (
              <CodeEditor
                value={editContent}
                onChange={setEditContent}
                fileName={file.name}
                onCursorChange={setCursorPos}
                className="absolute inset-0"
              />
            )}

            {/* CODE — Read Mode */}
            {isCode && !isEditMode && (
              <SyntaxHighlighter
                code={textContent!}
                fileName={file.name}
                className="absolute inset-0"
              />
            )}

            {/* UNSUPPORTED */}
            {!isImage && !isVideo && !isAudio && !isPdf && !isMarkdown && !isCode && (
              <div className="w-full h-full flex items-center justify-center p-4">
                <div
                  className="flex flex-col items-center gap-4 text-center max-w-xs p-8 rounded-2xl"
                  style={{ background: colors.fallbackBg, border: `1px solid ${colors.fallbackBdr}` }}
                >
                  <FallbackIcon
                    className="h-14 w-14"
                    style={{ color: colors.muted }}
                    strokeWidth={1.5}
                  />
                  <div>
                    <h4
                      className="text-sm font-bold mb-1"
                      style={{ color: colors.text }}
                    >
                      Preview not available
                    </h4>
                    <p className="text-xs leading-relaxed" style={{ color: colors.muted }}>
                      Can't preview{" "}
                      <code
                        className="text-[11px] font-mono px-1 py-0.5 rounded"
                        style={{ background: colors.badgeBg, color: colors.badgeText }}
                      >
                        {file.mime}
                      </code>{" "}
                      files.
                    </p>
                  </div>
                  <button
                    onClick={handleDownload}
                    className="px-5 py-2 rounded-xl text-[12px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors duration-150 cursor-pointer"
                  >
                    Download to View
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      {(isCode || isMarkdown) && !loading && !error && (
        <div
          className="flex items-center justify-between px-4 shrink-0 select-none"
          style={{
            height: "24px",
            background: colors.statusbar,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <div className="flex items-center gap-3">
            {statusParts.map((part, i) => (
              <span key={i} className="text-[11px] font-mono" style={{ color: colors.muted }}>
                {part}
              </span>
            ))}
          </div>
          {isEditMode && (
            <span className="text-[11px] font-mono" style={{ color: isDark ? "#374151" : "#94a3b8" }}>
              Tab: 2 spaces · UTF-8 · LF
            </span>
          )}
        </div>
      )}
    </div>
  );
}
