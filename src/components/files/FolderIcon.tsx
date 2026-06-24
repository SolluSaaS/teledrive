import React from "react";
import { cn } from "@/lib/utils";

interface FolderIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function FolderIcon({ className, size = "md", ...props }: FolderIconProps) {
  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  };

  return (
    <svg
      className={cn(
        "text-brand-500 dark:text-brand-400 fill-brand-50/30 dark:fill-brand-950/20 shrink-0 transition-transform duration-200 group-hover:scale-105",
        sizeClasses[size],
        className
      )}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}
