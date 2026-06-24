import { useState, useEffect } from "react";
import { X, Download, Loader2, FileIcon as FallbackIcon } from "lucide-react";
import { TeleFile } from "@/lib/types";
import { downloadFileToBuffer, downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { updateFile } from "@/lib/storage/metadataStore";
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

  // Update lastOpenedAt on Telegram channel index when file is previewed
  useEffect(() => {
    if (file) {
      const markAsOpened = async () => {
        try {
          const updatedFiles = await updateFile(file.channelId, file.id, {
            lastOpenedAt: Date.now(),
          });
          useFileStore.getState().setFiles(updatedFiles);
        } catch (e) {
          console.warn("Failed to update lastOpenedAt metadata:", e);
        }
      };
      markAsOpened();
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
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-slate-100 animate-fade-in select-none">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/60 shrink-0">
        <div className="min-w-0 pr-4">
          <span className="text-sm font-bold truncate block max-w-md">
            {file.name}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="h-9 w-9 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl"
            title="Download file"
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl"
            title="Close preview"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Main Preview Container */}
      <div className="flex-1 flex items-center justify-center overflow-auto p-6 relative">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <span className="text-xs text-slate-400 font-bold font-mono">
              Downloading media... {progress}%
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center max-w-sm text-center gap-4">
            <div className="bg-red-950/20 border border-red-900/50 rounded-2xl p-4 text-red-400 text-xs">
              {error}
            </div>
            <Button
              onClick={handleDownload}
              className="bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs font-semibold px-5"
            >
              Download Instead
            </Button>
          </div>
        )}

        {!loading && !error && (
          <div className="w-full h-full flex items-center justify-center">
            {isImage && contentUrl && (
              <img
                src={contentUrl}
                alt={file.name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg select-text pointer-events-auto"
              />
            )}
            
            {isVideo && contentUrl && (
              <video
                src={contentUrl}
                controls
                autoPlay
                className="max-w-full max-h-full rounded-lg shadow-lg"
              />
            )}
            
            {isAudio && contentUrl && (
              <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl w-full max-w-md shadow-2xl flex flex-col items-center gap-6">
                <FallbackIcon className="h-16 w-16 text-teal-400 animate-pulse" />
                <span className="text-xs text-slate-300 font-bold truncate w-full text-center">
                  {file.name}
                </span>
                <audio src={contentUrl} controls autoPlay className="w-full mt-2" />
              </div>
            )}

            {isPdf && contentUrl && (
              <iframe
                src={contentUrl}
                title={file.name}
                className="w-full h-full max-w-4xl bg-white border border-slate-800 rounded-lg shadow-lg"
              />
            )}

            {isMarkdown && (
              <div className="w-full h-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl p-6 overflow-y-auto text-left shadow-lg pointer-events-auto select-text">
                <div
                  className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed font-sans"
                  dangerouslySetInnerHTML={{ __html: markdownHtml }}
                />
              </div>
            )}

            {isText && (
              <div className="w-full h-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl p-6 overflow-y-auto text-left shadow-lg pointer-events-auto select-text font-mono">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {textContent}
                </pre>
              </div>
            )}

            {!isImage && !isVideo && !isAudio && !isPdf && !isMarkdown && !isText && (
              <div className="flex flex-col items-center justify-center gap-4 text-center max-w-xs">
                <FallbackIcon className="h-16 w-16 text-slate-600" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-300">Preview not available</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    We can't preview files of type <code className="px-1 py-0.5 rounded bg-slate-900 text-[10px]">{file.mime}</code>.
                  </p>
                </div>
                <Button
                  onClick={handleDownload}
                  className="bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs font-semibold px-5"
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
