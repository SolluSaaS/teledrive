import React from "react";
import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  File,
} from "lucide-react";
import { FolderIcon } from "./FolderIcon";
import { cn } from "@/lib/utils";
import { getFileIconType } from "@/lib/files/fileUtils";

interface FileIconProps {
  name?: string;
  mime: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const FileIcon = React.memo(function FileIcon({ name = "", mime, size = "md", className }: FileIconProps) {
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  };

  const currentSizeClass = sizeClasses[size];

  if (mime === "inode/directory" || mime === "application/x-directory") {
    return <FolderIcon size={size} className={className} />;
  }

  // Helper to choose the right icon and color style based on file type
  const getIconProps = () => {
    const iconType = getFileIconType(name, mime);

    switch (iconType) {
      case "folder":
        return { Icon: FolderIcon, colorClass: "" };

      case "image":
        return { Icon: FileImage, colorClass: "text-rose-500 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20" };

      case "video":
        return { Icon: FileVideo, colorClass: "text-purple-500 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20" };

      case "audio":
        return { Icon: FileAudio, colorClass: "text-teal-500 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/20" };

      case "pdf":
        return { Icon: FileText, colorClass: "text-red-500 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20" };

      case "spreadsheet":
        return { Icon: FileText, colorClass: "text-emerald-500 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" };

      case "presentation":
        return { Icon: FileText, colorClass: "text-amber-500 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20" };

      case "code":
        return { Icon: FileCode, colorClass: "text-indigo-500 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20" };

      case "archive":
        return { Icon: FileArchive, colorClass: "text-orange-500 dark:text-orange-400 bg-orange-50/50 dark:bg-orange-950/20" };

      case "document":
        return { Icon: FileText, colorClass: "text-brand-500 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-950/20" };

      case "file":
      default:
        return { Icon: File, colorClass: "text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/20" };
    }
  };

  const { Icon, colorClass } = getIconProps();

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl transition-all duration-300 ease-out group-hover:scale-110",
        size === "lg" ? "p-4" : size === "md" ? "p-2" : "p-1",
        colorClass,
        className
      )}
    >
      <Icon className={currentSizeClass} strokeWidth={size === "sm" ? 2 : 1.75} />
    </div>
  );
});
