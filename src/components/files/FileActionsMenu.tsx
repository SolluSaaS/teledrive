import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  MoreVertical,
  Eye,
  Download,
  Edit2,
  FolderInput,
  Star,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { TeleFile } from "@/lib/types";

interface FileActionsMenuProps {
  file: TeleFile;
  onPreview: (file: TeleFile) => void;
  onDownload: (file: TeleFile) => void;
  onRename: (file: TeleFile) => void;
  onStarToggle: (file: TeleFile) => void;
  onTrash: (file: TeleFile) => void;
  onMoveTo?: (file: TeleFile) => void;
}

export function FileActionsMenu({
  file,
  onPreview,
  onDownload,
  onRename,
  onStarToggle,
  onTrash,
  onMoveTo,
}: FileActionsMenuProps) {
  const isDirectory = file.mime === "inode/directory" || file.mime === "application/x-directory";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={(e) => e.stopPropagation()} // Prevent trigger select/click row
        >
          <MoreVertical className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-xl p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        {!isDirectory && !file.trashed && (
          <DropdownMenuItem
            onClick={() => onPreview(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Eye className="h-4 w-4" />
            <span>Preview</span>
          </DropdownMenuItem>
        )}
        {!isDirectory && !file.trashed && (
          <DropdownMenuItem
            onClick={() => onDownload(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            <span>Download</span>
          </DropdownMenuItem>
        )}
        
        {!file.trashed && (
          <DropdownMenuItem
            onClick={() => onRename(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Edit2 className="h-4 w-4" />
            <span>Rename</span>
          </DropdownMenuItem>
        )}

        {onMoveTo && !file.trashed && (
          <DropdownMenuItem
            onClick={() => onMoveTo(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <FolderInput className="h-4 w-4" />
            <span>Move to</span>
          </DropdownMenuItem>
        )}

        {!file.trashed && (
          <DropdownMenuItem
            onClick={() => onStarToggle(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Star className={`h-4 w-4 ${file.starred ? "fill-amber-400 text-amber-400" : "text-slate-400"}`} />
            <span>{file.starred ? "Remove star" : "Add star"}</span>
          </DropdownMenuItem>
        )}

        {file.trashed ? (
          <DropdownMenuItem
            onClick={() => onTrash(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Restore</span>
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuSeparator className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <DropdownMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/20 focus:bg-red-50 dark:focus:bg-red-950/20 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              <span>Move to Trash</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
