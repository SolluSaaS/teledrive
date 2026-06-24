import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TrashPage() {
  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-4 shrink-0">
        <span className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          Trash
        </span>
        <Button
          variant="outline"
          size="sm"
          className="text-xs font-semibold rounded-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/20"
        >
          Empty Trash
        </Button>
      </div>

      {/* Main empty state content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-red-100/50 dark:bg-red-950/20 blur-xl rounded-full scale-150" />
          <Trash2 className="relative h-20 w-20 text-red-500/80 stroke-[1.5]" />
        </div>
        
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          Trash is empty
        </h3>
        
        <p className="text-sm text-muted-foreground">
          Files and folders you delete will show up here. Items in the trash are permanently deleted after 30 days.
        </p>
      </div>
    </div>
  );
}
