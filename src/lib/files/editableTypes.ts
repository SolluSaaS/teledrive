import { TeleFile } from "@/lib/types";

/**
 * Returns true if the file is a text or code file that can be edited
 * in-app via the TeleDrive file editor.
 *
 * Binary files (images, audio, video, PDFs, archives) return false.
 */
export function isEditableFile(file: TeleFile): boolean {
  const mime = file.mime.toLowerCase();
  const name = file.name.toLowerCase();

  // Directories are never editable
  if (mime === "inode/directory" || mime === "application/x-directory") {
    return false;
  }

  // MIME-type based detection
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/sql" ||
    mime === "application/x-sh" ||
    mime === "application/x-bat" ||
    mime === "application/x-powershell" ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("yaml") ||
    mime.includes("toml") ||
    mime.includes("x-python") ||
    mime.includes("x-go") ||
    mime.includes("x-rust") ||
    mime.includes("x-c") ||
    mime.includes("x-java") ||
    mime.includes("x-ruby") ||
    mime.includes("x-php") ||
    mime.includes("x-csharp")
  ) {
    return true;
  }

  // Extension-based fallback for files that may report generic MIME
  const ext = name.split(".").pop() ?? "";
  const editableExtensions = new Set([
    "txt", "md", "markdown", "csv", "tsv",
    "json", "jsonc", "json5",
    "yaml", "yml",
    "toml", "ini", "conf", "config", "cfg",
    "env", "envrc",
    "xml", "svg", "html", "htm", "xhtml",
    "css", "scss", "less", "sass",
    "js", "mjs", "cjs",
    "ts", "tsx", "jsx",
    "py", "pyw",
    "go",
    "rs",
    "rb",
    "php",
    "java",
    "kt", "kts",
    "swift",
    "c", "h", "cpp", "hpp", "cc", "cxx",
    "cs",
    "sh", "bash", "zsh", "fish",
    "bat", "cmd", "ps1",
    "sql", "psql",
    "graphql", "gql",
    "dockerfile",
    "makefile",
    "gitignore", "gitattributes", "npmrc", "nvmrc",
    "editorconfig",
    "log",
    "rst", "adoc",
    "proto",
    "tf", "tfvars",
    "lua",
    "r",
    "dart",
    "ex", "exs",
    "clj", "cljs",
    "hs",
    "elm",
    "vue",
    "svelte",
    "astro",
  ]);

  return editableExtensions.has(ext);
}
