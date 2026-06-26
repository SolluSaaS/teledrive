import React from "react";
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
  Pencil,
  FolderInput,
  Star,
  Trash2,
  RotateCcw,
  Archive,
  ArchiveRestore,
  CheckCircle,
  Check,
} from "lucide-react";
import { TeleFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isEditableFile } from "@/lib/files/editableTypes";

interface FileActionsMenuProps {
  file: TeleFile;
  onPreview: (file: TeleFile) => void;
  onDownload: (file: TeleFile) => void;
  onEdit?: (file: TeleFile) => void;
  onRename: (file: TeleFile) => void;
  onStarToggle: (file: TeleFile) => void;
  onTrash: (file: TeleFile) => void;
  onMoveTo?: (file: TeleFile) => void;
  /** Called when user clicks "Delete Permanently" in trash mode */
  onDeletePermanently?: (file: TeleFile) => void;
  onArchive?: (file: TeleFile) => void;
  onUnarchive?: (file: TeleFile) => void;
  onOfflineToggle?: (file: TeleFile) => void;
}

export const FileActionsMenu = React.memo(function FileActionsMenu({
  file,
  onPreview,
  onDownload,
  onEdit,
  onRename,
  onStarToggle,
  onTrash,
  onMoveTo,
  onDeletePermanently,
  onArchive,
  onUnarchive,
  onOfflineToggle,
}: FileActionsMenuProps) {
  const isDirectory = file.mime === "inode/directory" || file.mime === "application/x-directory";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800/80 data-[state=open]:bg-slate-100 dark:data-[state=open]:bg-slate-800/80 cursor-pointer transition-colors"
          onClick={(e) => e.stopPropagation()} // Prevent trigger select/click row
        >
          <MoreVertical className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-xl p-1.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xl shadow-slate-100/5 dark:shadow-black/30 ring-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Group 1: Retrieve Actions (Preview, Edit & Download) */}
        {!isDirectory && !file.trashed && !file.archived && (
          <>
            <DropdownMenuItem
              onClick={() => onPreview(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <Eye className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Preview</span>
            </DropdownMenuItem>
            {onEdit && isEditableFile(file) && (
              <DropdownMenuItem
                onClick={() => onEdit(file)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
              >
                <Pencil className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
                <span>Edit</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onDownload(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <Download className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Download</span>
            </DropdownMenuItem>
            {onOfflineToggle && (
              <DropdownMenuItem
                onClick={() => onOfflineToggle(file)}
                className="flex items-center justify-between px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    file.offline ? "text-green-500 fill-green-500/20" : "text-slate-450 dark:text-slate-500"
                  )} strokeWidth={1.75} />
                  <span>Available offline</span>
                </div>
                {file.offline && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="-mx-1.5 my-1.5 opacity-60 dark:opacity-40" />
          </>
        )}

        {/* Group 2: Metadata Modifications (Rename, Move, Star) */}
        {!file.trashed && !file.archived && (
          <>
            <DropdownMenuItem
              onClick={() => onRename(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <Edit2 className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Rename</span>
            </DropdownMenuItem>
            {onMoveTo && (
              <DropdownMenuItem
                onClick={() => onMoveTo(file)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
              >
                <FolderInput className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
                <span>Move to</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onStarToggle(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <Star
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  file.starred
                    ? "fill-amber-400 text-amber-400"
                    : "text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100"
                )}
                strokeWidth={1.75}
              />
              <span>{file.starred ? "Remove star" : "Add star"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1.5 opacity-60 dark:opacity-40" />
          </>
        )}

        {/* Group 3: Archive Operations */}
        {!file.trashed && !file.archived && onArchive && (
          <>
            <DropdownMenuItem
              onClick={() => onArchive(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <Archive className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Archive</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1.5 opacity-60 dark:opacity-40" />
          </>
        )}
        {file.archived && onUnarchive && (
          <>
            <DropdownMenuItem
              onClick={() => onUnarchive(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <ArchiveRestore className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Unarchive</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1.5 my-1.5 opacity-60 dark:opacity-40" />
          </>
        )}

        {/* Group 4: Trash Operations */}
        {file.trashed ? (
          <>
            <DropdownMenuItem
              onClick={() => onTrash(file)}
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg text-slate-700 dark:text-slate-200"
            >
              <RotateCcw className="h-4 w-4 text-slate-450 dark:text-slate-500 group-focus/dropdown-menu-item:text-slate-900 dark:group-focus/dropdown-menu-item:text-slate-100 transition-colors shrink-0" strokeWidth={1.75} />
              <span>Restore</span>
            </DropdownMenuItem>
            {onDeletePermanently && (
              <>
                <DropdownMenuSeparator className="-mx-1.5 my-1.5 opacity-60 dark:opacity-40" />
                <DropdownMenuItem
                  onClick={() => onDeletePermanently(file)}
                  variant="destructive"
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg"
                >
                  <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>Delete Permanently</span>
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : (
          !file.archived && (
            <DropdownMenuItem
              onClick={() => onTrash(file)}
              variant="destructive"
              className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-lg"
            >
              <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>Move to Trash</span>
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
