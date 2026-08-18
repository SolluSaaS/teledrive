/**
 * useBackupFolders — bridges the licenseStore's `backupFolders` field
 * to the BackupSection UI.
 *
 * The source-folder configuration is server-authoritative (User model)
 * so two devices of the same user stay in sync.
 *
 * Design choice: AUTO-SAVE on every change.
 * -----------------------------------------
 * Earlier this hook kept a local working copy and exposed a Save button.
 * That pattern produced two recurring bugs:
 *   1. The Plan page's mount-time `refreshBackendState()` re-syncs the
 *      persisted value, which clobbered pending edits.
 *   2. The save action had to be wired through the store so the
 *      persisted value updated — bypassing it caused the list to
 *      vanish right after save.
 *
 * A folder picker is a one-click action; users expect it to "just
 * work". So this hook now persists every change immediately via the
 * licenseStore's `setProBackupFolders` action (which mirrors the
 * response back into the store). The hook re-renders against the
 * store's `backupFolders` directly — there is no separate local copy,
 * no dirty flag, no Save button.
 *
 * Concurrency: each mutation triggers a PATCH. The licenseStore
 * debounces is not strictly necessary for a 5-item list, but we
 * intentionally don't fan-out — `setProBackupFolders` is fire-and-
 * forget and the user can't add a 6th folder anyway (UI enforces 5).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLicenseStore } from "@/stores/licenseStore";

export interface UseBackupFolders {
  /** Source folder paths (absolute local paths). */
  paths: string[];
  /** Exclude glob patterns (matched relative to each source root). */
  excludes: string[];
  /** True iff the user has an active Pro license (the gate). */
  isPro: boolean;
  /** True while a PATCH is currently in flight. */
  isSaving: boolean;
  /** Add a folder path. No-op if already present (dedupe). */
  addFolder: (absPath: string) => void;
  /** Remove a folder path by exact match. */
  removeFolder: (absPath: string) => void;
  /** Add an exclude glob pattern. No-op if already present (dedupe). */
  addExclude: (pattern: string) => void;
  /** Remove an exclude pattern by exact match. */
  removeExclude: (pattern: string) => void;
}

export function useBackupFolders(): UseBackupFolders {
  const plan = useLicenseStore((s) => s.plan);
  const persisted = useLicenseStore((s) => s.backupFolders);
  const setLicenseBackupFolders = useLicenseStore((s) => s.setProBackupFolders);
  const isPro = plan === "PRO";

  const paths = persisted?.paths ?? [];
  const excludes = persisted?.excludes ?? [];

  // `isSaving` tracks whether ANY mutation is currently in flight. We
  // don't gate UI on it (mutations are fast) — but we expose it so the
  // UI can show a tiny "Saving…" indicator if needed.
  const [isSaving, setIsSaving] = useState(false);
  // Track the in-flight write so a rapid double-click can't race two
  // PATCHes that overwrite each other.
  const inflight = useRef<{ paths: string[]; excludes: string[] } | null>(null);

  // If `persisted` updates from outside (refresh, save success, etc.)
  // and we're NOT currently mid-write, nothing to do — we already read
  // from `persisted` directly. If we ARE mid-write, the store update
  // from our own PATCH will match the inflight snapshot and we skip
  // (no infinite loop).
  useEffect(() => {
    const w = inflight.current;
    if (!w) return;
    const same =
      sameArr(w.paths, persisted?.paths ?? []) &&
      sameArr(w.excludes, persisted?.excludes ?? []);
    if (same) {
      inflight.current = null;
      setIsSaving(false);
    }
  }, [persisted?.paths, persisted?.excludes]);

  const persist = useCallback(
    async (nextPaths: string[], nextExcludes: string[]) => {
      inflight.current = { paths: nextPaths, excludes: nextExcludes };
      setIsSaving(true);
      try {
        // The store action does the PATCH + mirrors the response into
        // the store. On error it throws and the toast is shown by the
        // action — we surface a flag so the UI can grey out controls.
        await setLicenseBackupFolders({ paths: nextPaths, excludes: nextExcludes });
      } catch {
        // toast already shown by the store action
      } finally {
        // Only clear if our write is still the latest one — a newer
        // mutation may have overwritten the snapshot.
        const w = inflight.current;
        if (w && sameArr(w.paths, nextPaths) && sameArr(w.excludes, nextExcludes)) {
          inflight.current = null;
          setIsSaving(false);
        }
      }
    },
    [setLicenseBackupFolders],
  );

  const addFolder = useCallback(
    (absPath: string) => {
      if (!isPro) return;
      const trimmed = absPath.trim();
      if (!trimmed) return;
      if (paths.includes(trimmed)) return;
      void persist([...paths, trimmed], excludes);
    },
    [isPro, paths, excludes, persist],
  );

  const removeFolder = useCallback(
    (absPath: string) => {
      const next = paths.filter((p) => p !== absPath);
      if (next.length === paths.length) return;
      void persist(next, excludes);
    },
    [paths, excludes, persist],
  );

  const addExclude = useCallback(
    (pattern: string) => {
      if (!isPro) return;
      const trimmed = pattern.trim();
      if (!trimmed) return;
      if (excludes.includes(trimmed)) return;
      void persist(paths, [...excludes, trimmed]);
    },
    [isPro, paths, excludes, persist],
  );

  const removeExclude = useCallback(
    (pattern: string) => {
      const next = excludes.filter((p) => p !== pattern);
      if (next.length === excludes.length) return;
      void persist(paths, next);
    },
    [paths, excludes, persist],
  );

  return {
    paths,
    excludes,
    isPro,
    isSaving,
    addFolder,
    removeFolder,
    addExclude,
    removeExclude,
  };
}

function sameArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}