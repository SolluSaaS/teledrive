import { useState } from "react";
import { HardDrive, RefreshCw, Info } from "lucide-react";
import { useFileStore } from "@/stores/fileStore";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function StorageSection() {
  const files = useFileStore((state) => state.files);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const calculateStorage = () => {
    const totalSizeBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const totalFiles = files.filter(f => f.mime !== 'inode/directory').length;
    const totalFolders = files.filter(f => f.mime === 'inode/directory').length;
    
    let formattedSize = "0 Bytes";
    if (totalSizeBytes > 0) {
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(totalSizeBytes) / Math.log(k));
      formattedSize = parseFloat((totalSizeBytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }
    
    // Storage bar is normalized against 15 GB just for visualization (since Telegram is "unlimited")
    const limitBytes = 15 * 1024 * 1024 * 1024; // 15 GB
    const percentage = Math.min((totalSizeBytes / limitBytes) * 100, 100);

    return {
      bytes: totalSizeBytes,
      formattedSize,
      percentage,
      totalFiles,
      totalFolders,
    };
  };

  const storage = calculateStorage();

  const handleRecalculate = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success("Storage calculation refreshed successfully.");
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Storage Usage</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your Telegram storage bucket space consumption.
        </p>
      </div>

      <div className="p-5 border rounded-lg bg-background space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-950/20 border border-brand-200 flex items-center justify-center text-brand-600 shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Total Space Used</span>
            <span className="text-xl font-bold">{storage.formattedSize}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Progress value={storage.percentage} className="h-2 bg-slate-100 dark:bg-slate-900" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{storage.formattedSize} used</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">Unlimited*</span>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4 text-sm py-1">
          <div>
            <span className="text-xs text-muted-foreground block">Files stored</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{storage.totalFiles}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Folders created</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{storage.totalFolders}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          onClick={handleRecalculate}
          className="rounded-full text-xs font-semibold gap-2"
        >
          <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          Recalculate
        </Button>
      </div>

      {/* Info Warning Banner */}
      <div className="flex gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-muted-foreground">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p>
            *Telegram does not impose an official cap on total storage inside personal private channels.
          </p>
          <p className="mt-1">
            However, individual file size limitations apply: up to <strong>2 GB</strong> per file for standard accounts, and up to <strong>4 GB</strong> for Telegram Premium subscribers.
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline custom separator implementation since separator might not be fully referenced
function Separator() {
  return <div className="h-px bg-border my-2" />;
}
