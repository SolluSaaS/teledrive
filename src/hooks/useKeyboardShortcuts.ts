import { useEffect, useRef } from "react";
import { useFileStore } from "@/stores/fileStore";
import { useFileActions } from "@/hooks/useFileActions";


interface KeyboardShortcutsProps {
  onToggleHelp: () => void;
}

export function useKeyboardShortcuts({ onToggleHelp }: KeyboardShortcutsProps) {
  const { files, selectedIds, currentFolder, setSelectedIds, clearSelection } = useFileStore();
  const { moveToTrash } = useFileActions();
  const lastKeyRef = useRef<{ key: string; time: number }>({ key: "", time: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts if user is typing in an input, textarea or contenteditable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        if (e.key === "Escape") {
          target.blur();
        }
        return;
      }

      // Detect Ctrl/Cmd modifier
      const isCmd = e.ctrlKey || e.metaKey;

      // 1. Focus Search: "/" or "Ctrl+F" / "Cmd+F"
      if (e.key === "/" || (isCmd && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        const searchInput = document.querySelector('input[placeholder="Search in TeleDrive"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // 2. Escape: Clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }

      // 3. Select All: "Ctrl+A" / "Cmd+A"
      if (isCmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const path = window.location.pathname;
        let selectableFiles = [...files];

        if (path === "/drive/my-drive" || path.startsWith("/drive/folder/")) {
          selectableFiles = selectableFiles.filter((f) => f.folderPath === currentFolder && !f.trashed);
        } else if (path === "/drive/starred") {
          selectableFiles = selectableFiles.filter((f) => f.starred && !f.trashed);
        } else if (path === "/drive/recent") {
          selectableFiles = selectableFiles.filter((f) => !f.trashed);
        } else if (path === "/drive/trash") {
          selectableFiles = selectableFiles.filter((f) => f.trashed);
        }

        setSelectedIds(selectableFiles.map((f) => f.id));
        return;
      }

      // 4. Delete: Move selected to trash (or delete permanently if in trash)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length > 0) {
          e.preventDefault();
          const path = window.location.pathname;
          if (path === "/drive/trash") {
            const event = new CustomEvent("teledrive-delete-selected");
            window.dispatchEvent(event);
          } else {
            // Move to trash (reversible — no confirmation needed)
            const filesToTrash = files.filter((f) => selectedIds.includes(f.id));
            filesToTrash.forEach((file) => moveToTrash(file));
            clearSelection();
          }
        }
        return;
      }

      // 5. Rename: F2
      if (e.key === "F2") {
        if (selectedIds.length === 1) {
          e.preventDefault();
          const targetFile = files.find((f) => f.id === selectedIds[0]);
          if (targetFile) {
            const event = new CustomEvent("teledrive-rename-file-event", { detail: targetFile });
            window.dispatchEvent(event);
          }
        }
        return;
      }

      // 6. Download: "Ctrl+D" / "Cmd+D"
      if (isCmd && e.key.toLowerCase() === "d") {
        if (selectedIds.length === 1) {
          e.preventDefault();
          const targetFile = files.find((f) => f.id === selectedIds[0]);
          if (targetFile && targetFile.mime !== "inode/directory" && targetFile.mime !== "application/x-directory") {
            const event = new CustomEvent("teledrive-download-file", { detail: targetFile });
            window.dispatchEvent(event);
          }
        }
        return;
      }

      // 7. Toggle Help: "?" or "Shift+Slash"
      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      // 8. Sequence navigation: "gg" (top) and "gl" (bottom)
      const now = Date.now();
      const prevKey = lastKeyRef.current;
      lastKeyRef.current = { key: e.key.toLowerCase(), time: now };

      if (prevKey.key === "g" && now - prevKey.time < 500) {
        if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
          }
        } else if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [files, selectedIds, currentFolder, setSelectedIds, clearSelection, moveToTrash, onToggleHelp]);
}
