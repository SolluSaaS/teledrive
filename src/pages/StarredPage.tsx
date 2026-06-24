import { Star } from "lucide-react";

export default function StarredPage() {
  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-4 shrink-0">
        <span className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          Starred
        </span>
      </div>

      {/* Main empty state content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-yellow-100/50 dark:bg-yellow-950/20 blur-xl rounded-full scale-150" />
          <Star className="relative h-20 w-20 fill-yellow-400/10 text-yellow-500 stroke-[1.5]" />
        </div>
        
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          No starred files
        </h3>
        
        <p className="text-sm text-muted-foreground">
          Right-click or tap the options on a file and select "Add to Starred" to pin key items here.
        </p>
      </div>
    </div>
  );
}
