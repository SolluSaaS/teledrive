/**
 * FilePreviewModal.tsx
 * Full-screen file preview + editor modal.
 * Fully theme-aware: adapts topbar, status bar, surfaces, and text to dark/light.
 *
 * Read mode  → SyntaxHighlighter (highlight.js, lazy, theme-aware)
 * Edit mode  → CodeEditor (CodeMirror 6, lazy, theme-aware via Compartment)
 * Binary     → native <img>, <video>, <audio>, <iframe>
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Grid3X3,
  Info,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { downloadFileToBuffer, downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { updateFileLocal, addFile, deleteTelegramMessage } from "@/lib/storage/metadataStore";
import { uploadFileToTelegram } from "@/lib/telegram/uploader";
import { readOfflineCache } from "@/lib/storage/offlineStorage";
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

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function sanitizeHtml(html: string): string {
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  clean = clean.replace(/on\w+\s*=\s*(['"])(?:(?!\1).)*\1/gi, "");
  clean = clean.replace(/on\w+\s*=\s*[^>\s]+/gi, "");
  clean = clean.replace(/href\s*=\s*(['"])javascript:(?:(?!\1).)*\1/gi, 'href="#"');
  clean = clean.replace(/src\s*=\s*(['"])javascript:(?:(?!\1).)*\1/gi, "");
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  clean = clean.replace(/<embed\b[^>]*>/gi, "");
  clean = clean.replace(/<object\b[^>]*>/gi, "");
  return clean;
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

  // ── Image preview states ──────────────────────────────────────────────────
  const [zoom, setZoom]               = useState(1);
  const [pan, setPan]                 = useState({ x: 0, y: 0 });
  const [rotation, setRotation]       = useState(0);
  const [showGrid, setShowGrid]       = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [dimensions, setDimensions]   = useState<{ width: number; height: number } | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragStart, setDragStart]     = useState({ x: 0, y: 0 });

  // ── Video preview states & refs ──────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoVolume, setVideoVolume] = useState(1);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [showVideoControls, setShowVideoControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // ── Audio preview states & refs ──────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState(1);
  const [showAudioSpeedMenu, setShowAudioSpeedMenu] = useState(false);

  // Video autohide controls effect
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!file || !file.mime.startsWith("video/")) return;
    const handleMouseMove = () => {
      setShowVideoControls(true);
      lastActiveRef.current = Date.now();
    };
    const container = videoContainerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", () => setShowVideoControls(false));
    }
    const interval = setInterval(() => {
      if (Date.now() - lastActiveRef.current > 2000 && isVideoPlaying) {
        setShowVideoControls(false);
        setShowSpeedMenu(false);
      }
    }, 500);
    return () => {
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
      }
      clearInterval(interval);
    };
  }, [file, isVideoPlaying]);

  // Video fullscreen handler
  const handleVideoFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const doc = document as any;
    const cElem = container as any;
    const vElem = video as any;

    const isFS = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    const requestFSOnVideo = () => {
      try {
        if (vElem.requestFullscreen) {
          vElem.requestFullscreen().catch((err: any) => {
            console.error("video.requestFullscreen failed:", err);
          });
        } else if (vElem.webkitRequestFullscreen) {
          vElem.webkitRequestFullscreen();
        } else if (vElem.webkitRequestFullScreen) {
          vElem.webkitRequestFullScreen();
        } else if (vElem.webkitEnterFullscreen) {
          try {
            vElem.webkitEnterFullscreen();
          } catch (e) {
            console.error("webkitEnterFullscreen threw:", e);
          }
        }
      } catch (err) {
        console.error("All video fullscreen methods failed:", err);
      }
    };

    if (!isFS) {
      try {
        if (cElem.requestFullscreen) {
          cElem.requestFullscreen().catch((err: any) => {
            console.warn("Container fullscreen rejected, trying video directly:", err);
            requestFSOnVideo();
          });
        } else if (cElem.webkitRequestFullscreen) {
          cElem.webkitRequestFullscreen();
        } else if (cElem.webkitRequestFullScreen) {
          cElem.webkitRequestFullScreen();
        } else if (cElem.mozRequestFullScreen) {
          cElem.mozRequestFullScreen();
        } else if (cElem.msRequestFullscreen) {
          cElem.msRequestFullscreen();
        } else {
          requestFSOnVideo();
        }
      } catch (err) {
        console.warn("Container fullscreen threw error, trying video directly:", err);
        requestFSOnVideo();
      }
    } else {
      try {
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(console.error);
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.webkitCancelFullScreen) {
          doc.webkitCancelFullScreen();
        } else if (doc.mozCancelFullScreen) {
          doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
      } catch (err) {
        console.error("Failed to exit fullscreen:", err);
      }
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as any;
      const isFS = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      );
      setIsVideoFullscreen(isFS);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("mozfullscreenchange", onFullscreenChange);
    document.addEventListener("MSFullscreenChange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("mozfullscreenchange", onFullscreenChange);
      document.removeEventListener("MSFullscreenChange", onFullscreenChange);
    };
  }, []);

  // Video control handlers
  const togglePlayVideo = useCallback(() => {
    if (!videoRef.current) return;
    if (isVideoPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(console.error);
    }
  }, [isVideoPlaying]);

  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    setVideoCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleVideoLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return;
    setVideoDuration(videoRef.current.duration);
  }, []);

  const handleVideoSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.currentTime = val;
    setVideoCurrentTime(val);
  }, []);

  const handleVideoVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    setVideoVolume(val);
    if (val > 0) {
      videoRef.current.muted = false;
      setIsVideoMuted(false);
    }
  }, []);

  const toggleVideoMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !isVideoMuted;
    videoRef.current.muted = nextMuted;
    setIsVideoMuted(nextMuted);
  }, [isVideoMuted]);

  const handleVideoSpeedChange = useCallback((speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setVideoSpeed(speed);
    setShowSpeedMenu(false);
  }, []);

  const skipVideo = useCallback((amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.min(
      Math.max(videoRef.current.currentTime + amount, 0),
      videoRef.current.duration || 0
    );
  }, []);

  // Audio control handlers
  const togglePlayAudio = useCallback(() => {
    if (!audioRef.current) return;
    if (isAudioPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
  }, [isAudioPlaying]);

  const handleAudioTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    setAudioCurrentTime(audioRef.current.currentTime);
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setAudioDuration(audioRef.current.duration);
  }, []);

  const handleAudioSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const val = parseFloat(e.target.value);
    audioRef.current.currentTime = val;
    setAudioCurrentTime(val);
  }, []);

  const handleAudioVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const val = parseFloat(e.target.value);
    audioRef.current.volume = val;
    setAudioVolume(val);
    if (val > 0) {
      audioRef.current.muted = false;
      setIsAudioMuted(false);
    }
  }, []);

  const toggleAudioMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = !isAudioMuted;
    audioRef.current.muted = nextMuted;
    setIsAudioMuted(nextMuted);
  }, [isAudioMuted]);

  const handleAudioSpeedChange = useCallback((speed: number) => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = speed;
    setAudioSpeed(speed);
    setShowAudioSpeedMenu(false);
  }, []);

  const skipAudio = useCallback((amount: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(
      Math.max(audioRef.current.currentTime + amount, 0),
      audioRef.current.duration || 0
    );
  }, []);

  const zoomIn = useCallback(() => setZoom(z => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - 0.25, 0.25)), []);
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);
  const rotateClockwise = useCallback(() => setRotation(r => (r + 90) % 360), []);
  const rotateCounterClockwise = useCallback(() => setRotation(r => (r - 90) % 360), []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click drag
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Only zoom when over the image container
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => Math.min(Math.max(z * factor, 0.25), 4));
  }, []);

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
        let buffer: Uint8Array;
        if (file.offline) {
          setProgress(50);
          try {
            buffer = await readOfflineCache(file.id);
            setProgress(100);
            console.log(`[FilePreviewModal] Loaded "${file.name}" from local offline cache.`);
          } catch (offlineErr) {
            console.warn(`[FilePreviewModal] Failed to read offline cache for "${file.name}", falling back to download:`, offlineErr);
            buffer = await downloadFileToBuffer(
              file.channelId, file.messageId,
              (pct) => { if (current) setProgress(pct); }
            );
          }
        } else {
          buffer = await downloadFileToBuffer(
            file.channelId, file.messageId,
            (pct) => { if (current) setProgress(pct); }
          );
        }
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
            if (current) setMarkdownHtml(sanitizeHtml(html));
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
        if (current) {
          if (!navigator.onLine && !file.offline) {
            setError("You are currently offline, and this file has not been marked as 'Available offline'. Connect to the internet to open it.");
          } else {
            setError(err.message || "Failed to download file.");
          }
        }
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
        file.channelId, file.name, bytes.length, newFile, file.folderPath ?? "/", () => {}
      );

      try { await deleteTelegramMessage(file.channelId, file.messageId); } catch { /* best-effort */ }

      const updated: TeleFile = { ...file, messageId: message.id, size: bytes.length, uploadedAt: Date.now() };
      const updatedFiles = await addFile(file.channelId, updated);
      useFileStore.getState().setFiles(updatedFiles);

      setTextContent(editContent);
      if (file.name.endsWith(".md")) {
        setMarkdownHtml(sanitizeHtml(await marked.parse(editContent)));
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
              {isImage && (
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  title="Toggle details"
                  className={`flex items-center justify-center h-7 w-8 rounded-lg cursor-pointer transition-colors duration-150 ${showDetails ? "text-blue-500 bg-blue-500/10 dark:bg-blue-500/20" : ""}`}
                  style={{ color: showDetails ? undefined : colors.muted }}
                  onMouseEnter={e => { if (!showDetails) e.currentTarget.style.background = colors.hover; }}
                  onMouseLeave={e => { if (!showDetails) e.currentTarget.style.background = "transparent"; }}
                >
                  <Info className="h-4 w-4" />
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
              <div className="w-full h-full flex relative overflow-hidden">
                {/* Main Viewport */}
                <div
                  className="flex-1 h-full flex items-center justify-center p-6 relative overflow-hidden select-none cursor-grab active:cursor-grabbing"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  style={{
                    backgroundImage: showGrid
                      ? `radial-gradient(circle at center, ${colors.dotGrid} 1px, transparent 1px)`
                      : "none",
                    backgroundSize: "20px 20px",
                    backgroundColor: showGrid ? (isDark ? "#080c10" : "#fafafa") : colors.bg,
                  }}
                >
                  <div
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                      transition: isDragging ? "none" : "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <img
                      src={contentUrl}
                      alt={file.name}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                      }}
                      className="max-w-[85vw] max-h-[80vh] object-contain pointer-events-none"
                      style={{
                        boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
                        borderRadius: "4px",
                      }}
                    />
                  </div>

                  {/* Floating bottom controls bar (glassmorphic pill) */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-xl backdrop-blur-md bg-white/75 dark:bg-slate-900/70 border-slate-200/50 dark:border-slate-800/40 text-slate-700 dark:text-slate-250 z-20">
                    <button
                      onClick={zoomOut}
                      title="Zoom Out"
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <span className="text-[11px] font-mono font-bold min-w-[40px] text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={zoomIn}
                      title="Zoom In"
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={resetZoom}
                      title="Zoom Fit / Reset"
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={rotateCounterClockwise}
                      title="Rotate Counter-Clockwise"
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4 -scale-x-100" />
                    </button>
                    <button
                      onClick={rotateClockwise}
                      title="Rotate Clockwise"
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      onClick={() => setShowGrid(!showGrid)}
                      title="Toggle Grid Background"
                      className={`p-1 rounded-lg transition-colors cursor-pointer ${showGrid ? "text-blue-500" : ""}`}
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Info Panel */}
                {showDetails && (
                  <div
                    className="w-64 border-l flex flex-col shrink-0 animate-in slide-in-from-right duration-250"
                    style={{
                      background: isDark ? "#0f131a" : "#fafafa",
                      borderColor: colors.border,
                    }}
                  >
                    <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: colors.border }}>
                      <span className="text-[12px] font-bold uppercase tracking-wider text-slate-400">File Details</span>
                      <button
                        onClick={() => setShowDetails(false)}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="p-4 flex flex-col gap-4 overflow-y-auto text-[12px]">
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Name</div>
                        <div className="font-semibold break-all text-slate-700 dark:text-slate-300">{file.name}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Dimensions</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {dimensions ? `${dimensions.width} × ${dimensions.height} px` : "Loading..."}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">File Size</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">{formatSize(file.size)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Mime Type</div>
                        <div className="font-mono text-slate-750 dark:text-slate-400">{file.mime}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Path</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px] bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-800/50 inline-block">{file.folderPath}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Uploaded At</div>
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {new Date(file.uploadedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* VIDEO */}
            {isVideo && contentUrl && (
              <div
                ref={videoContainerRef}
                className="w-full h-full flex items-center justify-center p-4 relative bg-black select-none group"
              >
                {/* Native Video Element */}
                <video
                  ref={videoRef}
                  src={contentUrl}
                  autoPlay
                  onClick={togglePlayVideo}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  className="max-w-full max-h-full cursor-pointer shadow-2xl rounded-lg"
                  style={{ maxHeight: "calc(100vh - 120px)" }}
                />

                {/* Big Centered Play/Pause Overlay Button */}
                <div
                  onClick={togglePlayVideo}
                  className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-300 ${
                    !isVideoPlaying || showVideoControls ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <button className="h-16 w-16 flex items-center justify-center rounded-full bg-black/50 border border-white/20 text-white backdrop-blur-md cursor-pointer hover:scale-110 active:scale-95 transition-all pointer-events-auto duration-200 shadow-lg">
                    {isVideoPlaying ? (
                      <Pause className="h-6 w-6 fill-white" />
                    ) : (
                      <Play className="h-6 w-6 fill-white ml-1" />
                    )}
                  </button>
                </div>

                {/* Glassmorphic Control Bar */}
                <div
                  className={`absolute bottom-6 left-6 right-6 p-4 rounded-2xl flex flex-col gap-2.5 transition-all duration-300 shadow-2xl border border-white/10 backdrop-blur-md bg-black/60 text-white z-20 ${
                    showVideoControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
                  }`}
                >
                  {/* Progress Timeline Slider */}
                  <div className="flex items-center gap-3 w-full">
                    <span className="text-[10px] font-mono text-white/70 min-w-[35px] text-right">
                      {formatTime(videoCurrentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 100}
                      step={0.1}
                      value={videoCurrentTime}
                      onChange={handleVideoSeek}
                      className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                    />
                    <span className="text-[10px] font-mono text-white/70 min-w-[35px]">
                      {formatTime(videoDuration)}
                    </span>
                  </div>

                  {/* Buttons & Sliders */}
                  <div className="flex items-center justify-between">
                    {/* Left: Play/Pause, Skip Back, Skip Forward, Volume */}
                    <div className="flex items-center gap-3.5">
                      <button
                        onClick={togglePlayVideo}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/90 hover:text-white"
                      >
                        {isVideoPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
                      </button>

                      <button
                        onClick={() => skipVideo(-10)}
                        title="Skip back 10s"
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        <SkipBack className="h-4 w-4" />
                      </button>

                      <button
                        onClick={() => skipVideo(10)}
                        title="Skip forward 10s"
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        <SkipForward className="h-4 w-4" />
                      </button>

                      <div className="h-4 w-px bg-white/10" />

                      {/* Volume controls */}
                      <div className="flex items-center gap-1.5 group/volume">
                        <button
                          onClick={toggleVideoMute}
                          className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                        >
                          {isVideoMuted || videoVolume === 0 ? (
                            <VolumeX className="h-4.5 w-4.5" />
                          ) : (
                            <Volume2 className="h-4.5 w-4.5" />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isVideoMuted ? 0 : videoVolume}
                          onChange={handleVideoVolumeChange}
                          className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-blue-500 focus:outline-none transition-all duration-200"
                        />
                      </div>
                    </div>

                    {/* Right: Speed, Fullscreen */}
                    <div className="flex items-center gap-3 relative">
                      {/* Playback Speed selector */}
                      <div className="relative">
                        <button
                          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                          className="text-[11px] font-mono font-bold px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/5 rounded-lg cursor-pointer transition-colors"
                        >
                          {videoSpeed === 1 ? "1.0x" : `${videoSpeed}x`}
                        </button>

                        {showSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 py-1.5 w-20 rounded-xl border border-white/10 bg-slate-900/90 backdrop-blur-lg shadow-xl text-white/95 flex flex-col z-35 animate-in fade-in slide-in-from-bottom-2 duration-150">
                            {[0.5, 1, 1.25, 1.5, 2].map((sp) => (
                              <button
                                key={sp}
                                onClick={() => handleVideoSpeedChange(sp)}
                                className={`px-3 py-1 text-left text-[11px] font-mono hover:bg-white/10 transition-colors w-full cursor-pointer ${
                                  videoSpeed === sp ? "text-blue-400 font-bold" : ""
                                }`}
                              >
                                {sp === 1 ? "1.0x" : `${sp}x`}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={handleVideoFullscreen}
                        className="p-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white/85 hover:text-white"
                      >
                        {isVideoFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AUDIO */}
            {isAudio && contentUrl && (
              <div className="w-full h-full flex items-center justify-center p-6 bg-slate-950/5 animate-in fade-in duration-200">
                {/* Audio Element */}
                <audio
                  ref={audioRef}
                  src={contentUrl}
                  autoPlay
                  onPlay={() => setIsAudioPlaying(true)}
                  onPause={() => setIsAudioPlaying(false)}
                  onTimeUpdate={handleAudioTimeUpdate}
                  onLoadedMetadata={handleAudioLoadedMetadata}
                />

                {/* Inline Styles for visualizer and rotation animation */}
                <style>{`
                  @keyframes audio-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  @keyframes bounce-bar-1 { 0% { height: 15%; } 100% { height: 75%; } }
                  @keyframes bounce-bar-2 { 0% { height: 30%; } 100% { height: 95%; } }
                  @keyframes bounce-bar-3 { 0% { height: 20%; } 100% { height: 60%; } }
                  @keyframes bounce-bar-4 { 0% { height: 40%; } 100% { height: 85%; } }
                  @keyframes bounce-bar-5 { 0% { height: 10%; } 100% { height: 100%; } }
                `}</style>

                {/* Glassmorphic Music Card */}
                <div
                  className={`flex flex-col items-center gap-6 p-8 rounded-3xl max-w-sm w-full border backdrop-blur-lg shadow-2xl transition-all duration-350 ${
                    isDark
                      ? "bg-slate-900/60 border-slate-800/40 shadow-[0_0_50px_rgba(20,184,166,0.15)]"
                      : "bg-white/60 border-slate-200/50 shadow-[0_0_40px_rgba(20,184,166,0.1)]"
                  }`}
                >
                  {/* Vinyl/CD Disc Layout */}
                  <div className="relative group select-none">
                    {/* Outer glowing border */}
                    <div
                      className={`h-40 w-40 rounded-full flex items-center justify-center bg-slate-950/95 dark:bg-black/90 relative shadow-2xl transition-transform duration-300 ${
                        isAudioPlaying ? "scale-105" : "scale-100"
                      }`}
                      style={{
                        backgroundImage: "radial-gradient(circle, #27272a 1px, transparent 1px), radial-gradient(circle, #09090b 70%, transparent 70%)",
                        backgroundSize: "6px 6px, 100% 100%",
                        animation: "audio-spin 12s linear infinite",
                        animationPlayState: isAudioPlaying ? "running" : "paused",
                        border: "5px solid rgba(255,255,255,0.03)",
                      }}
                    >
                      {/* Vinyl grooves lines (repeated concentric circles) */}
                      <div className="absolute inset-4 rounded-full border border-white/5" />
                      <div className="absolute inset-8 rounded-full border border-white/5" />
                      <div className="absolute inset-12 rounded-full border border-white/5" />

                      {/* Disc Center Label */}
                      <div
                        className="h-16 w-16 rounded-full flex items-center justify-center text-teal-400 relative"
                        style={{
                          background: "linear-gradient(135deg, #134e4a 0%, #115e59 100%)",
                          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.2)",
                        }}
                      >
                        <Music className="h-6 w-6 animate-pulse" style={{ animationPlayState: isAudioPlaying ? "running" : "paused" }} />
                        {/* Spindle hole */}
                        <div className="absolute h-3 w-3 rounded-full bg-slate-950 dark:bg-black border border-white/10" />
                      </div>
                    </div>
                  </div>

                  {/* Equalizer Waveform Bouncing Bars */}
                  <div className="flex items-end justify-center gap-1.5 h-10 px-4 w-full">
                    {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((_, i) => {
                      const animName = `bounce-bar-${(i % 5) + 1}`;
                      return (
                        <div
                          key={i}
                          className="w-1 bg-teal-500 dark:bg-teal-400 rounded-t-full transition-all duration-300"
                          style={{
                            height: isAudioPlaying ? "100%" : "20%",
                            animation: isAudioPlaying ? `${animName} 0.8s ease-in-out infinite alternate` : "none",
                            animationDelay: `${i * 0.1}s`,
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Track Info */}
                  <div className="text-center min-w-0 w-full">
                    <p
                      className="text-[15px] font-bold truncate leading-snug"
                      style={{ color: colors.text }}
                    >
                      {file.name}
                    </p>
                    <p className="text-[11px] font-semibold mt-1 flex items-center justify-center gap-1.5" style={{ color: colors.muted }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-ping" style={{ animationPlayState: isAudioPlaying ? "running" : "paused" }} />
                      Audio Track
                    </p>
                  </div>

                  {/* Seek Bar & Duration */}
                  <div className="flex flex-col gap-1.5 w-full">
                    <input
                      type="range"
                      min={0}
                      max={audioDuration || 100}
                      step={0.1}
                      value={audioCurrentTime}
                      onChange={handleAudioSeek}
                      className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500 dark:accent-teal-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: colors.muted }}>
                      <span>{formatTime(audioCurrentTime)}</span>
                      <span>{formatTime(audioDuration)}</span>
                    </div>
                  </div>

                  {/* Primary Playback controls */}
                  <div className="flex items-center justify-center gap-5 w-full">
                    <button
                      onClick={() => skipAudio(-10)}
                      title="Skip back 10s"
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition-colors cursor-pointer"
                      style={{ color: colors.muted }}
                    >
                      <SkipBack className="h-5 w-5" />
                    </button>

                    <button
                      onClick={togglePlayAudio}
                      className="h-14 w-14 flex items-center justify-center rounded-full bg-teal-500 hover:bg-teal-400 hover:scale-105 active:scale-95 text-white cursor-pointer shadow-lg transition-all duration-200"
                    >
                      {isAudioPlaying ? (
                        <Pause className="h-5.5 w-5.5 fill-white" />
                      ) : (
                        <Play className="h-5.5 w-5.5 fill-white ml-1" />
                      )}
                    </button>

                    <button
                      onClick={() => skipAudio(10)}
                      title="Skip forward 10s"
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition-colors cursor-pointer"
                      style={{ color: colors.muted }}
                    >
                      <SkipForward className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Secondary controls (Volume + Speed) */}
                  <div className="flex items-center justify-between w-full mt-2 border-t pt-4" style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
                    {/* Volume */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleAudioMute}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        style={{ color: colors.muted }}
                      >
                        {isAudioMuted || audioVolume === 0 ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isAudioMuted ? 0 : audioVolume}
                        onChange={handleAudioVolumeChange}
                        className="w-16 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500 dark:accent-teal-400 focus:outline-none"
                      />
                    </div>

                    {/* Speed dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowAudioSpeedMenu(!showAudioSpeedMenu)}
                        className="text-[10px] font-mono font-bold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/30 rounded-lg cursor-pointer transition-colors"
                        style={{ color: colors.text }}
                      >
                        {audioSpeed === 1 ? "1.0x" : `${audioSpeed}x`}
                      </button>

                      {showAudioSpeedMenu && (
                        <div
                          className={`absolute bottom-full right-0 mb-2 py-1 w-20 rounded-xl border shadow-xl flex flex-col z-35 animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                            isDark
                              ? "bg-slate-900 border-slate-800 text-white"
                              : "bg-white border-slate-200 text-slate-800"
                          }`}
                        >
                          {[0.5, 1, 1.25, 1.5, 2].map((sp) => (
                            <button
                              key={sp}
                              onClick={() => handleAudioSpeedChange(sp)}
                              className={`px-3 py-1 text-left text-[11px] font-mono hover:bg-slate-100 dark:hover:bg-white/10 transition-colors w-full cursor-pointer ${
                                audioSpeed === sp
                                  ? "text-teal-500 font-bold"
                                  : isDark
                                  ? "text-slate-400"
                                  : "text-slate-600"
                              }`}
                            >
                              {sp === 1 ? "1.0x" : `${sp}x`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
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
