import { HardDrive, Plus, Grid, List, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";

export default function MyDrivePage() {
  const viewMode = useUIStore((state) => state.viewMode);
  const setViewMode = useUIStore((state) => state.setViewMode);

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
            My Drive
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="h-9 w-9 rounded-full"
            title={viewMode === "grid" ? "List view" : "Grid view"}
          >
            {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" title="Sort options">
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main empty state content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-brand-100/50 dark:bg-brand-950/20 blur-xl rounded-full scale-150" />
          <HardDrive className="relative h-20 w-20 text-brand-500/80 stroke-[1.5]" />
        </div>
        
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          Your drive is empty
        </h3>
        
        <p className="text-sm text-muted-foreground mb-6">
          Upload files or create folders to get started. All your files will be stored securely on Telegram.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button className="rounded-full bg-brand-500 hover:bg-brand-600 font-semibold px-6 shadow-md shadow-brand-500/10 gap-2">
            <Plus className="h-4 w-4" />
            Upload File
          </Button>
          <Button variant="outline" className="rounded-full font-semibold px-6 border-slate-200 dark:border-slate-800">
            New Folder
          </Button>
        </div>
      </div>
    </div>
  );
}
