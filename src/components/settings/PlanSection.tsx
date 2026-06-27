/**
 * Plan & Devices settings section.
 *
 * Shows:
 *   - Current plan (FREE / PRO) with a badge
 *   - Active license info (purchased date, expires)
 *   - "X of Y devices" usage indicator
 *   - Per-device list with Revoke button
 *   - Refresh button (re-hits /api/auth/verify)
 *   - "Upgrade to Pro" CTA when plan === FREE (opens UpgradeModal)
 *
 * Reads/writes the license store. On mount, calls refreshBackendState so
 * the displayed numbers are fresh even if a stale projection was loaded
 * from a different machine or a long time ago.
 */
import { useEffect, useState } from "react";
import {
  CreditCard,
  Crown,
  RefreshCw,
  Smartphone,
  Trash2,
  WifiOff,
  Plug,
} from "lucide-react";
import { useLicenseStore } from "@/stores/licenseStore";
import { detectOS, getDeviceName } from "@/lib/secure/deviceInfo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import BackupSection from "@/components/settings/BackupSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UpgradeModal } from "./UpgradeModal";
import { toast } from "sonner";

const OS_LABEL: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function PlanSection() {
  const plan = useLicenseStore((s) => s.plan);
  const license = useLicenseStore((s) => s.license);
  const activeDevices = useLicenseStore((s) => s.activeDevices);
  const deviceLimit = useLicenseStore((s) => s.deviceLimit);
  const backendReachable = useLicenseStore((s) => s.backendReachable);
  const jwt = useLicenseStore((s) => s.jwt);
  const refresh = useLicenseStore((s) => s.refreshBackendState);
  const revokeDeviceById = useLicenseStore((s) => s.revokeDeviceById);

  const [refreshing, setRefreshing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Re-hydrate on mount so the panel reflects current backend state.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleReconnect = async () => {
    setRefreshing(true);
    try {
      const { useAuthStore } = await import("@/stores/authStore");
      const phoneNumber = useAuthStore.getState().phoneNumber;
      if (!phoneNumber) {
        toast.error("No Telegram session", {
          description: "Sign in to Telegram from Settings → Telegram Account first.",
        });
        return;
      }
      await useLicenseStore.getState().reconnectToBackend({
        phoneNumber,
        deviceName: getDeviceName(),
        os: detectOS(),
      });
    } catch {
      // toast already shown by store
    } finally {
      setRefreshing(false);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    setRevoking(true);
    try {
      await revokeDeviceById(deviceId);
      setConfirmRevoke(null);
    } catch {
      // toast already shown by store
    } finally {
      setRevoking(false);
    }
  };

  // Identify the current device by matching name + os — there's only ever
  // one in the list that matches our locally-detected (deviceName, os).
  const currentDeviceName = getDeviceName();
  const currentOs = detectOS();
  const isCurrent = (d: { deviceName: string; os: string }) =>
    d.deviceName === currentDeviceName && d.os === currentOs;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            Plan & Devices
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your subscription, license, and devices currently signed in to TeleDrive.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!backendReachable && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {jwt
                ? "Can't reach the license server — showing cached info."
                : "Not signed in to the license server. Reconnect to refresh plan info."}
            </span>
          </div>
          {!jwt && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReconnect}
              disabled={refreshing}
              className="shrink-0"
            >
              <Plug className="h-4 w-4 mr-1.5" />
              Reconnect
            </Button>
          )}
        </div>
      )}

      {/* Plan + License card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {plan === "PRO" ? (
              <Crown className="h-6 w-6 text-amber-500" />
            ) : (
              <CreditCard className="h-6 w-6 text-slate-500" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-base">TeleDrive {plan === "PRO" ? "Pro" : "Free"}</h4>
                <Badge variant={plan === "PRO" ? "default" : "secondary"}>
                  {plan}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {plan === "PRO"
                  ? license?.status === "active"
                    ? `Active license — ${license.deviceLimit} device${license.deviceLimit === 1 ? "" : "s"}`
                    : "Pro plan (license pending)"
                  : "Free tier — 1 device"}
              </p>
            </div>
          </div>
          {plan === "FREE" && (
            <Button onClick={() => setUpgradeOpen(true)} className="shrink-0">
              <Crown className="h-4 w-4 mr-1.5" />
              Upgrade to Pro
            </Button>
          )}
        </div>

        {license && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-200/70 dark:border-slate-800/70 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Purchased</dt>
              <dd className="font-medium mt-0.5">{formatDate(license.purchasedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Status</dt>
              <dd className="font-medium mt-0.5 capitalize">{license.status}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Expires</dt>
              <dd className="font-medium mt-0.5">{formatDate(license.expiresAt)}</dd>
            </div>
          </dl>
        )}
      </Card>

      {/* Devices card */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h4 className="font-bold text-base">Active Devices</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeDevices.length} of {deviceLimit} device
              {deviceLimit === 1 ? "" : "s"}
            </p>
          </div>
          <Smartphone className="h-5 w-5 text-slate-400" />
        </div>

        {activeDevices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">
            No active devices yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
            {activeDevices.map((d) => {
              const mine = isCurrent(d);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{d.deviceName}</span>
                      {mine && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {OS_LABEL[d.os] ?? d.os} · last seen {formatDate(d.lastSeenAt)}
                    </p>
                  </div>
                  {!mine && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRevoke(d.id)}
                      disabled={revoking}
                      className="shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Revoke</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!backendReachable && (
          <p className="text-xs text-muted-foreground mt-4">
            Device list reflects the last successful sync. Reconnect to refresh.
          </p>
        )}
      </Card>

      {/* Pro-only feature: live multi-device sync + scheduled backup. */}
      <BackupSection />

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      {/* Revoke confirmation */}
      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this device?</DialogTitle>
            <DialogDescription>
              The device will be signed out of TeleDrive on next login. This can't be undone —
              you'll need to log in again from that device to use it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Surface an info note if the user can't activate from here */}
      {!backendReachable && activeDevices.length >= deviceLimit && (
        <p className="text-xs text-muted-foreground">
          Device limit reached. Reconnect to revoke another device from here.
        </p>
      )}
    </div>
  );
}