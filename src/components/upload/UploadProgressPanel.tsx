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

/**
 * Circular progress indicator for the minimized header state.
 */
function CircularProgress({ value }: { value: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <svg className="h-4.5 w-4.5 transform -rotate-90 shrink-0">
      <circle
        cx="9"
        cy="9"
        r={radius}
        className="stroke-slate-700 dark:stroke-slate-800"
        strokeWidth="2"
        fill="transparent"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        className="stroke-brand-500 transition-all duration-300"
        strokeWidth="2"
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </svg>
  );
}

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

  // Calculate overall upload progress
  const totalProgress = uploadQueue.reduce((acc, item) => acc + (item.status === "done" ? 100 : item.progress), 0);
  const overallProgressPercent = Math.round(totalProgress / totalCount);

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
        "fixed bottom-6 right-6 z-50 w-85 max-w-[calc(100vw-32px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 transform animate-in slide-in-from-bottom-8 duration-300 ease-out",
        isMinimized ? "h-13" : "h-96"
      )}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-slate-900 dark:bg-slate-950 text-white select-none cursor-pointer border-b dark:border-slate-800" 
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isAllFinished ? (
            errorCount > 0 ? (
              <XCircle className="h-4.5 w-4.5 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
            )
          ) : (
            isMinimized ? (
              <CircularProgress value={overallProgressPercent} />
            ) : (
              <Loader2 className="h-4.5 w-4.5 text-brand-400 animate-spin shrink-0" />
            )
          )}
          <span className="text-xs font-bold font-sans truncate pr-2">
            {isAllFinished
              ? errorCount > 0
                ? `Upload complete with ${errorCount} error${errorCount > 1 ? "s" : ""}`
                : "All uploads complete"
              : `Uploading ${uploadingCount} item${uploadingCount > 1 ? "s" : ""} (${overallProgressPercent}%)`}
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
        <div className="flex flex-col h-[calc(100%-52px)] overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
          {uploadQueue.map((item) => (
            <div key={item.id} className="relative flex flex-col gap-2 p-3.5 rounded-xl border border-slate-200/50 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm group">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Upload className="h-3.5 w-3.5 text-brand-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate pr-2">
                    {item.name}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {item.status === "done" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  )}
                  {item.status === "error" && (
                    <span title={item.error}>
                      <XCircle className="h-4 w-4 text-red-500" />
                    </span>
                  )}
                  {item.status === "uploading" && (
                    <span className="text-[10px] font-bold text-brand-500 font-mono">
                      {item.progress}%
                    </span>
                  )}
                  {item.status === "pending" && (
                    <span className="text-[10px] text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
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
              
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 font-mono">
                <span>{(item.size / (1024 * 1024)).toFixed(2)} MB</span>
                {item.status === "uploading" && (
                  <span className="animate-pulse text-brand-500 font-sans">Uploading...</span>
                )}
              </div>

              {/* Progress bar */}
              {item.status === "uploading" && (
                <Progress 
                  value={item.progress} 
                  className="h-1.5 bg-slate-100 dark:bg-slate-800 text-brand-500 [&>div]:bg-brand-500 rounded-full" 
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
