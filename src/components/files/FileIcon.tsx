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

interface FileIconProps {
  mime: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FileIcon({ mime, size = "md", className }: FileIconProps) {
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  };

  const currentSizeClass = sizeClasses[size];

  if (mime === "inode/directory" || mime === "application/x-directory") {
    return <FolderIcon size={size} className={className} />;
  }

  // Helper to choose the right icon and color style based on mime
  const getIconProps = () => {
    const m = mime.toLowerCase();
    
    if (m.startsWith("image/")) {
      return { Icon: FileImage, colorClass: "text-rose-500 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20" };
    }
    if (m.startsWith("video/")) {
      return { Icon: FileVideo, colorClass: "text-purple-500 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20" };
    }
    if (m.startsWith("audio/")) {
      return { Icon: FileAudio, colorClass: "text-teal-500 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/20" };
    }
    
    // PDF
    if (m === "application/pdf") {
      return { Icon: FileText, colorClass: "text-red-500 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20" };
    }
    
    // Spreadsheets
    if (
      m.includes("spreadsheet") ||
      m.includes("excel") ||
      m === "text/csv" ||
      m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return { Icon: FileText, colorClass: "text-emerald-500 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" };
    }
    
    // Documents / Text
    if (
      m.startsWith("text/") ||
      m.includes("document") ||
      m.includes("msword") ||
      m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return { Icon: FileText, colorClass: "text-brand-500 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-950/20" };
    }

    // Presentations / Slides
    if (
      m.includes("presentation") ||
      m.includes("powerpoint") ||
      m === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      return { Icon: FileText, colorClass: "text-amber-500 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20" };
    }
    
    // Code files
    if (
      m.includes("javascript") ||
      m.includes("typescript") ||
      m.includes("json") ||
      m.includes("html") ||
      m.includes("css") ||
      m.includes("xml") ||
      m === "application/x-javascript" ||
      m === "application/x-typescript"
    ) {
      return { Icon: FileCode, colorClass: "text-indigo-500 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20" };
    }
    
    // Archives / Zips
    if (
      m.includes("zip") ||
      m.includes("tar") ||
      m.includes("rar") ||
      m.includes("gzip") ||
      m.includes("archive")
    ) {
      return { Icon: FileArchive, colorClass: "text-orange-500 dark:text-orange-400 bg-orange-50/50 dark:bg-orange-950/20" };
    }
    
    // Fallback generic file
    return { Icon: File, colorClass: "text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/20" };
  };

  const { Icon, colorClass } = getIconProps();

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl transition-all duration-200",
        size === "lg" ? "p-4" : size === "md" ? "p-2" : "p-1",
        colorClass,
        className
      )}
    >
      <Icon className={currentSizeClass} strokeWidth={size === "sm" ? 2 : 1.75} />
    </div>
  );
}
