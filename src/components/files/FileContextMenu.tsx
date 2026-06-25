import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Eye,
  Download,
  Edit2,
  FolderInput,
  Star,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { TeleFile } from "@/lib/types";

interface FileContextMenuProps {
  file: TeleFile;
  children: React.ReactNode;
  onPreview: (file: TeleFile) => void;
  onDownload: (file: TeleFile) => void;
  onRename: (file: TeleFile) => void;
  onStarToggle: (file: TeleFile) => void;
  onTrash: (file: TeleFile) => void;
  onMoveTo?: (file: TeleFile) => void;
  onDeletePermanently?: (file: TeleFile) => void;
}

export function FileContextMenu({
  file,
  children,
  onPreview,
  onDownload,
  onRename,
  onStarToggle,
  onTrash,
  onMoveTo,
  onDeletePermanently,
}: FileContextMenuProps) {
  const isDirectory = file.mime === "inode/directory" || file.mime === "application/x-directory";
  
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52 rounded-xl p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md">
        {!isDirectory && !file.trashed && (
          <ContextMenuItem
            onClick={() => onPreview(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Eye className="h-4 w-4" />
            <span>Preview</span>
          </ContextMenuItem>
        )}
        {!isDirectory && !file.trashed && (
          <ContextMenuItem
            onClick={() => onDownload(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            <span>Download</span>
          </ContextMenuItem>
        )}
        
        {!file.trashed && (
          <ContextMenuItem
            onClick={() => onRename(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Edit2 className="h-4 w-4" />
            <span>Rename</span>
          </ContextMenuItem>
        )}

        {onMoveTo && !file.trashed && (
          <ContextMenuItem
            onClick={() => onMoveTo(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <FolderInput className="h-4 w-4" />
            <span>Move to</span>
          </ContextMenuItem>
        )}

        {!file.trashed && (
          <ContextMenuItem
            onClick={() => onStarToggle(file)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <Star className={`h-4 w-4 ${file.starred ? "fill-amber-400 text-amber-400" : "text-slate-400"}`} />
            <span>{file.starred ? "Remove star" : "Add star"}</span>
          </ContextMenuItem>
        )}

        {file.trashed ? (
          <>
            <ContextMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Restore</span>
            </ContextMenuItem>
            {onDeletePermanently && (
              <>
                <ContextMenuSeparator className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <ContextMenuItem
                  onClick={() => onDeletePermanently(file)}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/20 focus:bg-red-50 dark:focus:bg-red-950/20 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete Permanently</span>
                </ContextMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            <ContextMenuSeparator className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <ContextMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/20 focus:bg-red-50 dark:focus:bg-red-950/20 text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              <span>Move to Trash</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
