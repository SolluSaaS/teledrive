import { useState, useEffect } from "react";
import { useFileStore } from "@/stores/fileStore";
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export function UploadProgressPanel() {
  const { uploadQueue, clearQueue, removeFromQueue } = useFileStore();
  const [isMinimized, setIsMinimized] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Auto-show when queue has items
  useEffect(() => {
    if (uploadQueue.length > 0) {
      setIsVisible(true);
    }
  }, [uploadQueue.length]);

  if (!isVisible || uploadQueue.length === 0) return null;

  const totalCount = uploadQueue.length;
  const doneCount = uploadQueue.filter((item) => item.status === "done").length;
  const errorCount = uploadQueue.filter((item) => item.status === "error").length;
  const uploadingCount = uploadQueue.filter((item) => item.status === "uploading").length;
  
  const isAllFinished = doneCount + errorCount === totalCount;

  const handleClose = () => {
    if (!isAllFinished) {
      if (!window.confirm("Active uploads are still running. Closing this panel will not cancel them, but you won't see their progress. Close anyway?")) {
        return;
      }
    }
    setIsVisible(false);
    clearQueue();
  };

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-32px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 transform",
        isMinimized ? "h-12" : "h-96"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 dark:bg-slate-950 text-white select-none cursor-pointer" onClick={() => setIsMinimized(!isMinimized)}>
        <div className="flex items-center gap-2">
          {isAllFinished ? (
            errorCount > 0 ? (
              <XCircle className="h-4.5 w-4.5 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
            )
          ) : (
            <Loader2 className="h-4.5 w-4.5 text-blue-400 animate-spin shrink-0" />
          )}
          <span className="text-xs font-bold font-sans">
            {isAllFinished
              ? errorCount > 0
                ? `Upload complete with ${errorCount} error${errorCount > 1 ? "s" : ""}`
                : "All uploads complete"
              : `Uploading ${uploadingCount} item${uploadingCount > 1 ? "s" : ""} (${doneCount}/${totalCount})`}
          </span>
        </div>
        
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
          >
            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Upload Item List */}
      {!isMinimized && (
        <div className="flex flex-col h-[calc(100%-48px)] overflow-y-auto p-4 space-y-3.5 bg-slate-50/50 dark:bg-slate-900/40">
          {uploadQueue.map((item) => (
            <div key={item.id} className="relative flex flex-col gap-1.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900/80 shadow-sm group">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Upload className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate pr-2">
                    {item.name}
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {item.status === "done" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  )}
                  {item.status === "error" && (
                    <span title={item.error}>
                      <XCircle className="h-4 w-4 text-red-500" />
                    </span>
                  )}
                  {item.status === "uploading" && (
                    <span className="text-[10px] font-bold text-blue-500 font-mono">
                      {item.progress}%
                    </span>
                  )}
                  {item.status === "pending" && (
                    <span className="text-[10px] text-slate-400 font-bold">
                      Queued
                    </span>
                  )}
                  
                  {/* Remove button for completed/errored items */}
                  {item.status !== "uploading" && (
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="text-[10px] text-slate-400 font-mono">
                {(item.size / (1024 * 1024)).toFixed(2)} MB
              </div>

              {/* Progress bar */}
              {item.status === "uploading" && (
                <Progress value={item.progress} className="h-1.5 bg-slate-100 dark:bg-slate-800 text-blue-500 [&>div]:bg-blue-500 rounded-full" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
