import { FolderOpen, Plus, ChevronRight, Home } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function FolderPage() {
  const { "*": path } = useParams();

  // Build breadcrumbs path segments
  const segments = path ? path.split("/") : [];
  let accumPath = "";
  const breadcrumbs = segments.map((seg, idx) => {
    accumPath += (idx === 0 ? "" : "/") + seg;
    return {
      name: seg,
      link: `/drive/folder/${accumPath}`,
    };
  });

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Breadcrumb Header */}
      <div className="flex items-center justify-between border-b pb-4 shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground overflow-x-auto whitespace-nowrap py-1">
          <Link
            to="/drive/my-drive"
            className="flex items-center gap-1 hover:text-foreground transition-colors font-medium"
          >
            <Home className="h-4 w-4 shrink-0" />
            <span>My Drive</span>
          </Link>

          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.link} className="flex items-center gap-1.5 shrink-0">
              <ChevronRight className="h-4 w-4 shrink-0" />
              {idx === breadcrumbs.length - 1 ? (
                <span className="font-bold text-foreground">{crumb.name}</span>
              ) : (
                <Link to={crumb.link} className="hover:text-foreground transition-colors font-medium">
                  {crumb.name}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main empty folder content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-brand-100/50 dark:bg-brand-950/20 blur-xl rounded-full scale-150" />
          <FolderOpen className="relative h-20 w-20 text-brand-500/80 stroke-[1.5]" />
        </div>

        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
          This folder is empty
        </h3>

        <p className="text-sm text-muted-foreground mb-6">
          You can upload files or create new folders inside the virtual path: <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-bold">/{path}</code>
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button className="rounded-full bg-brand-500 hover:bg-brand-600 font-semibold px-6 shadow-md shadow-brand-500/10 gap-2">
            <Plus className="h-4 w-4" />
            Upload here
          </Button>
          <Button variant="outline" className="rounded-full font-semibold px-6 border-slate-200 dark:border-slate-800">
            New Folder
          </Button>
        </div>
      </div>
    </div>
  );
}
