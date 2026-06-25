import React, { useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/fileStore";
import { fuzzySearch } from "@/lib/search/searchEngine";
import { FileIcon } from "../files/FileIcon";
import { TeleFile } from "@/lib/types";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();
  
  const files = useFileStore((state) => state.files);
  
  // Get top 5 fuzzy match quick results for non-trashed files
  const quickResults = query.trim()
    ? fuzzySearch(files.filter((f) => !f.trashed), query).slice(0, 5)
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/drive/search?q=${encodeURIComponent(query.trim())}`);
      setIsFocused(false);
    }
  };

  const handleClear = () => {
    setQuery("");
  };

  const handleQuickResultClick = (file: TeleFile) => {
    setQuery("");
    setIsFocused(false);
    
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) {
      // Navigate to the virtual folder
      navigate(`/drive/folder${file.folderPath === "/" ? "" : file.folderPath}/${file.name}`);
    } else {
      // Trigger global preview event
      const event = new CustomEvent("teledrive-preview-file", { detail: file });
      window.dispatchEvent(event);
    }
  };

  return (
    <div className="relative w-full">
      <form
        onSubmit={handleSubmit}
        className={`relative flex items-center w-full h-10 transition-all duration-200 rounded-full px-4 border ${
          isFocused
            ? "bg-white dark:bg-slate-950 border-brand-500 shadow-md ring-2 ring-brand-500/15"
            : "bg-slate-100 border-slate-200/60 dark:bg-slate-900/70 dark:border-slate-800/80 hover:bg-slate-200/60 dark:hover:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700/80 shadow-xs"
        }`}
      >
        <Search className="h-4.5 w-4.5 text-slate-550 dark:text-slate-400 mr-2.5 shrink-0" />
        
        <input
          type="text"
          placeholder="Search in TeleDrive"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)} // short delay to allow clicks to register
          className="w-full h-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 px-0 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-450 dark:placeholder:text-slate-400/70"
        />

        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="h-7 w-7 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 shrink-0 ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </form>

      {/* Inline Quick Search Results Suggestion Dropdown */}
      {isFocused && query.trim() !== "" && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-2xl overflow-hidden z-50 animate-fade-in py-1">
          {quickResults.length > 0 ? (
            <div>
              <div className="px-3.5 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Quick Matches
              </div>
              {quickResults.map((file) => {
                const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
                return (
                  <div
                    key={file.id}
                    onMouseDown={() => handleQuickResultClick(file)} // use onMouseDown to fire before input blur closes dropdown
                    className="flex items-center gap-3 px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                  >
                    <FileIcon name={file.name} mime={file.mime} size="sm" className="p-0.5 rounded bg-transparent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {file.name}
                      </div>
                      <div className="text-[9px] text-slate-400 truncate">
                        {isDir ? "Folder" : `File • ${file.folderPath === "/" ? "My Drive" : file.folderPath}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-center text-slate-400 dark:text-slate-500 font-medium">
              No quick matches found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
