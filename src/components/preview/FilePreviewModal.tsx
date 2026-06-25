import { useState, useEffect } from "react";
import { X, Download, Loader2, FileIcon as FallbackIcon } from "lucide-react";
import { TeleFile } from "@/lib/types";
import { downloadFileToBuffer, downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { updateFileLocal } from "@/lib/storage/metadataStore";
import { useFileStore } from "@/stores/fileStore";
import { Button } from "@/components/ui/button";
import { marked } from "marked";

interface FilePreviewModalProps {
  file: TeleFile | null;
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [markdownHtml, setMarkdownHtml] = useState<string | null>(null);

  // Update lastOpenedAt in local store only (no Telegram write).
  // Writing to Telegram on every preview open caused duplication because
  // saveIndex deletes+recreates pinned messages, and loadIndex then
  // concatenated multiple copies.
  useEffect(() => {
    if (file) {
      const store = useFileStore.getState();
      const updatedFiles = updateFileLocal(store.files, file.id, {
        lastOpenedAt: Date.now(),
      });
      store.setFiles(updatedFiles);
    }
  }, [file]);

  // Load file media when file changes
  useEffect(() => {
    if (!file) {
      // Clean up previous resource URLs to prevent memory leaks
      if (contentUrl) {
        URL.revokeObjectURL(contentUrl);
        setContentUrl(null);
      }
      setTextContent(null);
      setMarkdownHtml(null);
      setError(null);
      return;
    }

    let isCurrent = true;
    
    async function loadPreview() {
      if (!file) return;
      setLoading(true);
      setProgress(0);
      setError(null);
      
      try {
        const buffer = await downloadFileToBuffer(file.channelId, file.messageId, (pct) => {
          if (isCurrent) setProgress(pct);
        });

        if (!isCurrent) return;

        const mimeLower = file.mime.toLowerCase();

        // Handle text and markdown previews
        if (mimeLower.startsWith("text/") || mimeLower.includes("javascript") || mimeLower.includes("typescript") || mimeLower.includes("json")) {
          const text = new TextDecoder().decode(buffer);
          setTextContent(text);
          
          if (mimeLower === "text/markdown" || file.name.endsWith(".md")) {
            const html = await marked.parse(text);
            setMarkdownHtml(html);
          }
        } else {
          // Handle binary files (images, audio, video, pdfs) via Blob URLs
          const blob = new Blob([buffer], { type: file.mime });
          const url = URL.createObjectURL(blob);
          setContentUrl(url);
        }
      } catch (err: any) {
        console.error("Failed to load file preview:", err);
        if (isCurrent) {
          setError(err.message || "Failed to download file preview from Telegram.");
        }
      } finally {
        if (isCurrent) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      isCurrent = false;
    };
  }, [file]);

  // Clean up Object URL on unmount
  useEffect(() => {
    return () => {
      if (contentUrl) {
        URL.revokeObjectURL(contentUrl);
      }
    };
  }, [contentUrl]);

  if (!file) return null;

  const handleDownload = () => {
    downloadFileFromTelegram(file.channelId, file.messageId, file.name);
  };

  const isImage = file.mime.startsWith("image/");
  const isVideo = file.mime.startsWith("video/");
  const isAudio = file.mime.startsWith("audio/");
  const isPdf = file.mime === "application/pdf";
  const isMarkdown = markdownHtml !== null;
  const isText = textContent !== null && !isMarkdown;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 backdrop-blur-md text-slate-100 animate-fade-in select-none">
      {/* Topbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/40 bg-slate-900/40 backdrop-blur-sm shrink-0">
        <div className="min-w-0 pr-4">
          <span className="text-sm font-extrabold truncate block max-w-md tracking-tight">
            {file.name}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="h-9 w-9 hover:bg-slate-800/60 text-slate-300 hover:text-white rounded-xl cursor-pointer"
            title="Download file"
          >
            <Download className="h-4.5 w-4.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9 hover:bg-slate-800/60 text-slate-300 hover:text-white rounded-xl cursor-pointer"
            title="Close preview"
          >
            <X className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>

      {/* Main Preview Container */}
      <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 bg-slate-900/60 border border-slate-800/50 px-6 py-5 rounded-2xl backdrop-blur-md">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500 stroke-[2]" />
            <span className="text-[10px] text-slate-400 font-extrabold font-mono uppercase tracking-wider">
              Downloading media... {progress}%
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center max-w-sm text-center gap-4 animate-fade-in">
            <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-4 text-red-400 text-xs font-semibold">
              {error}
            </div>
            <Button
              onClick={handleDownload}
              className="bg-brand-500 hover:bg-brand-600 text-white rounded-full text-xs font-bold px-6 py-2 shadow-md shadow-brand-500/10 cursor-pointer"
            >
              Download Instead
            </Button>
          </div>
        )}

        {!loading && !error && (
          <div className="w-full h-full flex items-center justify-center animate-fade-in">
            {isImage && contentUrl && (
              <img
                src={contentUrl}
                alt={file.name}
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl select-text pointer-events-auto border border-slate-850"
              />
            )}
            
            {isVideo && contentUrl && (
              <video
                src={contentUrl}
                controls
                autoPlay
                className="max-w-full max-h-full rounded-xl shadow-2xl border border-slate-850"
              />
            )}
            
            {isAudio && contentUrl && (
              <div className="bg-slate-900/80 border border-slate-800/65 p-8 rounded-3xl w-full max-w-md shadow-2xl flex flex-col items-center gap-6 relative overflow-hidden backdrop-blur-md">
                <div className="absolute inset-0 bg-teal-500/5 blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="absolute inset-0 bg-teal-500/20 blur-md rounded-full animate-pulse" />
                  <div className="relative h-16 w-16 rounded-full bg-teal-950/40 border border-teal-500/30 flex items-center justify-center text-teal-400">
                    <FallbackIcon className="h-7 w-7" />
                  </div>
                </div>
                <div className="text-center w-full min-w-0">
                  <span className="text-xs font-bold text-slate-200 truncate block max-w-xs mx-auto">
                    {file.name}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 mt-1 block">Audio Track</span>
                </div>
                <audio src={contentUrl} controls autoPlay className="w-full mt-2 relative z-10" />
              </div>
            )}

            {isPdf && contentUrl && (
              <iframe
                src={contentUrl}
                title={file.name}
                className="w-full h-full max-w-4xl bg-white border border-slate-800 rounded-xl shadow-2xl"
              />
            )}

            {isMarkdown && (
              <div className="w-full h-full max-w-3xl bg-slate-900/90 border border-slate-850 rounded-2xl p-6 md:p-8 overflow-y-auto text-left shadow-2xl pointer-events-auto select-text relative">
                <div
                  className="prose prose-invert prose-sm max-w-none text-slate-350 leading-relaxed font-sans"
                  dangerouslySetInnerHTML={{ __html: markdownHtml }}
                />
              </div>
            )}

            {isText && (
              <div className="w-full h-full max-w-3xl bg-slate-900/90 border border-slate-850 rounded-2xl p-6 md:p-8 overflow-y-auto text-left shadow-2xl pointer-events-auto select-text font-mono">
                <pre className="text-xs text-slate-350 whitespace-pre-wrap leading-relaxed">
                  {textContent}
                </pre>
              </div>
            )}

            {!isImage && !isVideo && !isAudio && !isPdf && !isMarkdown && !isText && (
              <div className="flex flex-col items-center justify-center gap-4 text-center max-w-xs bg-slate-900/50 border border-slate-850 p-8 rounded-2xl backdrop-blur-md">
                <FallbackIcon className="h-14 w-14 text-slate-500 stroke-[1.5]" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-300">Preview not available</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    We can't preview files of type <code className="px-1 py-0.5 rounded bg-slate-950 text-[10px] font-mono">{file.mime}</code>.
                  </p>
                </div>
                <Button
                  onClick={handleDownload}
                  className="bg-brand-500 hover:bg-brand-600 text-white rounded-full text-xs font-bold px-6 py-2 shadow-md shadow-brand-500/10 cursor-pointer"
                >
                  Download to View
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
