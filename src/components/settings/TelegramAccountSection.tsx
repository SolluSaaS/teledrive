import { useState, useEffect } from "react";
import { LinkIcon, Smartphone, Database } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { deleteSecret, getSecret, VAULT_KEY_SESSION, VAULT_KEY_CHANNEL_ID, channelIdKey } from "@/lib/secure/vault";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

export default function TelegramAccountSection() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const logout = useAuthStore((state) => state.logout);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    async function loadChannel() {
      if (!phoneNumber) return;
      const phoneKey = channelIdKey(phoneNumber);
      let savedChannel = await getSecret(phoneKey);
      if (!savedChannel) {
        savedChannel = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      if (savedChannel) {
        setChannelId(savedChannel);
      }
    }
    if (isAuthenticated && phoneNumber) {
      loadChannel();
    }
  }, [isAuthenticated, phoneNumber]);

  const handleDisconnect = async () => {
    try {
      // Step 1: Disconnect and destroy the GramJS client singleton first
      const { disconnectClient } = await import("@/lib/telegram/client");
      await disconnectClient();

      // Step 2: Clear Rust session file (preserve phone number)
      await invoke("clear_session_only").catch((e: any) =>
        console.warn("clear_session_only failed:", e)
      );

      // Step 3: Clear session secret in vault
      await deleteSecret(VAULT_KEY_SESSION).catch(() => {});

      // Step 4: Reset auth/file stores
      logout();
      const { useFileStore } = await import("@/stores/fileStore");
      // Reset bootstrapComplete too — otherwise the next login's uploads
      // would race the orphan scan (waitForBootstrap returns immediately
      // because the flag is still true) and could write a partial state.
      useFileStore.setState({
        files: [],
        selectedIds: [],
        selectedIdsSet: new Set(),
        currentFolder: "/",
        bootstrapComplete: false,
      });

      // Step 5: Wipe backend license session (best-effort). Best-effort because
      // the backend may already be unreachable on this machine.
      await useLicenseStore.getState().logoutFromBackend().catch((err) => {
        console.warn("Backend logout failed (non-fatal):", err);
      });

      toast.success("Disconnected Telegram account successfully.");
      navigate("/auth");
    } catch (err) {
      console.error("Failed to disconnect:", err);
      toast.error("Failed to disconnect account.");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Telegram Account</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your connected Telegram session and storage credentials.
        </p>
      </div>

      {!isAuthenticated ? (
        <div className="flex flex-col items-center justify-center p-8 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 text-center shadow-xs">
          <LinkIcon className="h-10 w-10 text-muted-foreground mb-3 stroke-[1.5]" />
          <h4 className="font-extrabold text-slate-850 dark:text-slate-200 tracking-tight text-sm">Not connected</h4>
          <p className="text-xs text-muted-foreground max-w-xs mt-1.5 mb-5 leading-relaxed">
            Connect your Telegram account to enable cloud storage features.
          </p>
          <Button
            className="rounded-xl bg-brand-500 hover:bg-brand-600 font-bold px-6 h-10 text-xs shadow-md shadow-brand-500/10 cursor-pointer"
            onClick={() => navigate("/auth")}
          >
            Connect Telegram Account
          </Button>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Status Box */}
          <div className="p-6 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 rounded-full bg-green-500/10 dark:bg-green-500/20 border border-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 shrink-0">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-850 dark:text-slate-200 text-sm tracking-tight">{phoneNumber}</span>
                  <Badge className="bg-green-500 hover:bg-green-650 dark:bg-green-500/20 dark:text-green-400 dark:border dark:border-green-500/30 text-white font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5 border-0">
                    Connected
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Telegram session active</p>
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-bold border-destructive text-destructive hover:bg-destructive/10 shrink-0 w-full sm:w-auto cursor-pointer"
              onClick={handleDisconnect}
            >
              Disconnect Account
            </Button>
          </div>

          {/* Storage Channel Info */}
          <div className="p-6 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-5 shadow-xs">
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0 mt-0.5">
                <Database className="h-5 w-5" />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-200 tracking-tight">Active Storage Channel</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your files are stored in the private Telegram channel:
                </p>
                <div className="text-xs font-mono bg-slate-50 dark:bg-slate-950/40 border dark:border-slate-850/80 px-4 py-2.5 rounded-xl block mt-2 select-text overflow-x-auto leading-relaxed text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-bold">NAME:</span>
                    <span className="font-bold text-slate-850 dark:text-slate-100">TeleDrive Storage</span>
                  </div>
                  {channelId && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-slate-400 font-bold">ID:</span>
                      <span className="font-bold text-slate-850 dark:text-slate-100">{channelId}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 cursor-pointer"
                onClick={() => setIsDialogOpen(true)}
              >
                Change Storage Channel
              </Button>
            </div>
          </div>

          {/* Info Card */}
          <div className="p-4 rounded-2xl bg-slate-100/50 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-850/30 text-xs text-muted-foreground leading-relaxed">
            💡 <strong>How files are stored:</strong> Your files are stored inside a private Telegram channel in your account. TeleDrive automatically creates this channel and reads the file list from a pinned message index.
          </div>
        </div>
      )}

      {/* Change storage channel dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-bold text-slate-850 dark:text-slate-200">Change Storage Channel</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This allows you to select a different private channel for TeleDrive storage.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-red-500/10 border border-red-500/20 dark:border-red-500/30 rounded-xl text-xs text-red-650 dark:text-red-400 leading-relaxed font-semibold">
            ⚠️ <strong>Warning:</strong> Changing your storage channel will disconnect the active file list index. TeleDrive will look for a pinned index message in the selected channel or create one.
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="ghost" className="rounded-xl text-xs" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs"
              onClick={async () => {
                setIsDialogOpen(false);
                try {
                  if (phoneNumber) {
                    await deleteSecret(channelIdKey(phoneNumber)).catch(() => {});
                  }
                  await deleteSecret(VAULT_KEY_CHANNEL_ID).catch(() => {});
                  setChannelId(null);
                  toast.success("Storage channel reset. Restart the app to re-map it.");
                } catch (err) {
                  console.error("Failed to reset storage channel:", err);
                  toast.error("Failed to reset storage channel.");
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
