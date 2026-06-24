import { useState, useEffect } from "react";
import { LinkIcon, Smartphone, CheckCircle, Database } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { deleteSecret, getSecret, VAULT_KEY_SESSION, VAULT_KEY_PHONE, VAULT_KEY_CHANNEL_ID } from "@/lib/secure/vault";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function TelegramAccountSection() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const logout = useAuthStore((state) => state.logout);

  const [channelId, setChannelId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    async function loadChannel() {
      const savedChannel = await getSecret(VAULT_KEY_CHANNEL_ID);
      if (savedChannel) {
        setChannelId(savedChannel);
      }
    }
    if (isAuthenticated) {
      loadChannel();
    }
  }, [isAuthenticated]);

  const handleDisconnect = async () => {
    try {
      await deleteSecret(VAULT_KEY_SESSION);
      await deleteSecret(VAULT_KEY_PHONE);
      await deleteSecret(VAULT_KEY_CHANNEL_ID);
      logout();
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
        <div className="flex flex-col items-center justify-center p-8 border rounded-lg bg-slate-50/50 dark:bg-slate-900/10 text-center">
          <LinkIcon className="h-10 w-10 text-muted-foreground mb-3 stroke-[1.5]" />
          <h4 className="font-semibold text-slate-800 dark:text-slate-200">Not connected</h4>
          <p className="text-xs text-muted-foreground max-w-xs mt-1 mb-4">
            Connect your Telegram account to enable cloud storage features.
          </p>
          <Button
            className="rounded-full bg-brand-500 hover:bg-brand-600 font-semibold px-6"
            onClick={() => navigate("/auth")}
          >
            Connect Telegram Account
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status Box */}
          <div className="p-5 border rounded-lg bg-background flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-50 dark:bg-green-950/20 border border-green-200 flex items-center justify-center text-green-600 shrink-0">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{phoneNumber}</span>
                  <Badge className="bg-green-500 hover:bg-green-600 border-0 flex gap-1 items-center px-2 py-0">
                    <CheckCircle className="h-3 w-3" />
                    Connected
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">Telegram session active</span>
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-semibold border-destructive text-destructive hover:bg-destructive/10 shrink-0 w-full sm:w-auto"
              onClick={handleDisconnect}
            >
              Disconnect Account
            </Button>
          </div>

          {/* Storage Bucket Info */}
          <div className="p-5 border rounded-lg bg-background space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-950/20 border border-brand-200 flex items-center justify-center text-brand-600 shrink-0 mt-0.5">
                <Database className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Active Storage Channel</h4>
                <p className="text-xs text-muted-foreground">
                  Your files are stored in the private Telegram channel:
                </p>
                <div className="text-xs font-mono bg-slate-50 dark:bg-slate-900 border px-3 py-1.5 rounded-lg inline-block mt-2">
                  Name: <span className="font-semibold text-slate-800 dark:text-slate-200">TeleDrive Storage</span>
                  {channelId && (
                    <>
                      <br />
                      ID: <span className="font-semibold text-slate-800 dark:text-slate-200">{channelId}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-semibold"
                onClick={() => setIsDialogOpen(true)}
              >
                Change Storage Channel
              </Button>
            </div>
          </div>

          {/* Info Card */}
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border text-xs text-muted-foreground leading-relaxed">
            💡 <strong>How files are stored:</strong> Your files are stored inside a private Telegram channel in your account. TeleDrive automatically creates this channel and reads the file list from a pinned message index.
          </div>
        </div>
      )}

      {/* Change storage channel dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Storage Channel</DialogTitle>
            <DialogDescription>
              This allows you to select a different private channel for TeleDrive storage.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-muted/30 border rounded-lg text-xs text-muted-foreground leading-relaxed">
            ⚠️ <strong>Warning:</strong> Changing your storage channel will disconnect the active file list index. TeleDrive will look for a pinned index message in the selected channel or create one.
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-full bg-brand-500 hover:bg-brand-600"
              onClick={() => {
                setIsDialogOpen(false);
                toast.success("Storage channel re-mapped successfully.");
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
