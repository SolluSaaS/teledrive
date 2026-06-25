/**
 * Utility functions for analyzing file names, extensions, and MIME types.
 */

export type FileCategory = "Documents" | "Images" | "Videos" | "Audio" | "Archives" | "Other";

export type FileIconType =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "code"
  | "archive"
  | "file";

/**
 * Extracts the lowercase file extension (without the dot) from a filename.
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length <= 1) return "";
  return parts.pop()!.toLowerCase().trim();
}

/**
 * Categorizes a file based on its MIME type and/or file extension.
 * This ensures files with generic MIME types (like application/octet-stream)
 * are correctly sorted into Documents, Images, etc. using their extension fallback.
 */
export function getFileCategory(fileName: string, mime: string): FileCategory {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);

  // 1. Folders are special
  if (m === "inode/directory" || m === "application/x-directory") {
    return "Other"; // Folders aren't media files
  }

  // 2. Images
  if (
    m.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "tif", "heic", "heif", "ico", "psd", "ai"].includes(ext)
  ) {
    return "Images";
  }

  // 3. Videos
  if (
    m.startsWith("video/") ||
    ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "3gp", "mpeg", "mpg"].includes(ext)
  ) {
    return "Videos";
  }

  // 4. Audio
  if (
    m.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus", "amr", "mpga"].includes(ext)
  ) {
    return "Audio";
  }

  // 5. Archives
  if (
    m.includes("zip") ||
    m.includes("tar") ||
    m.includes("rar") ||
    m.includes("gzip") ||
    m.includes("archive") ||
    m.includes("compressed") ||
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zipx", "iso", "dmg"].includes(ext)
  ) {
    return "Archives";
  }

  // 6. Documents / Code
  if (
    m.startsWith("text/") ||
    m.includes("document") ||
    m.includes("msword") ||
    m.includes("pdf") ||
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m.includes("presentation") ||
    m.includes("powerpoint") ||
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("xml") ||
    [
      // Document extensions
      "txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", 
      "rtf", "odt", "ods", "odp", "epub", "pages", "numbers", "key",
      // Code extensions
      "js", "ts", "jsx", "tsx", "html", "css", "json", "xml", "yaml", "yml",
      "py", "go", "c", "cpp", "h", "cs", "java", "rb", "rs", "sh", "bat", "ps1", "sql", "ini", "conf"
    ].includes(ext)
  ) {
    return "Documents";
  }

  return "Other";
}

/**
 * Maps a file to a specific visual type for selecting the appropriate icon and color scheme.
 */
export function getFileIconType(fileName: string, mime: string): FileIconType {
  const m = (mime || "").toLowerCase().trim();
  const ext = getFileExtension(fileName);

  if (m === "inode/directory" || m === "application/x-directory") {
    return "folder";
  }

  // Images
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico"].includes(ext)) {
    return "image";
  }

  // Videos
  if (m.startsWith("video/") || ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v"].includes(ext)) {
    return "video";
  }

  // Audio
  if (m.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "amr"].includes(ext)) {
    return "audio";
  }

  // PDFs
  if (m === "application/pdf" || ext === "pdf") {
    return "pdf";
  }

  // Spreadsheets
  if (
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m === "text/csv" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)
  ) {
    return "spreadsheet";
  }

  // Presentations
  if (
    m.includes("presentation") ||
    m.includes("powerpoint") ||
    m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ["ppt", "pptx", "odp", "key"].includes(ext)
  ) {
    return "presentation";
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
    m === "application/x-typescript" ||
    [
      "js", "ts", "jsx", "tsx", "html", "css", "json", "xml", "yaml", "yml",
      "py", "go", "c", "cpp", "h", "cs", "java", "rb", "rs", "sh", "bat", "ps1", "sql", "ini", "conf"
    ].includes(ext)
  ) {
    return "code";
  }

  // Archives
  if (
    m.includes("zip") ||
    m.includes("tar") ||
    m.includes("rar") ||
    m.includes("gzip") ||
    m.includes("archive") ||
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zipx", "iso", "dmg"].includes(ext)
  ) {
    return "archive";
  }

  // Documents/Text (generic/fallback document types)
  if (
    m.startsWith("text/") ||
    m.includes("document") ||
    m.includes("msword") ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ["txt", "md", "doc", "docx", "rtf", "odt", "pages", "epub"].includes(ext)
  ) {
    return "document";
  }

  return "file";
}
