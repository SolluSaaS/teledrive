import { Clock } from "lucide-react";

export default function RecentPage() {
  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-4 shrink-0">
        <span className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          Recent
        </span>
      </div>

      {/* Main empty state content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-slate-100 dark:bg-slate-900/50 blur-xl rounded-full scale-150" />
          <Clock className="relative h-20 w-20 text-slate-400 dark:text-slate-600 stroke-[1.5]" />
        </div>
        
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          No recent files
        </h3>
        
        <p className="text-sm text-muted-foreground">
          Files you upload, open, or edit will show up here for quick access.
        </p>
      </div>
    </div>
  );
}
