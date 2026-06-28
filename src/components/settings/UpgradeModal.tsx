/**
 * Upgrade to Pro modal.
 *
 * Flow:
 *   1. User clicks "Upgrade to Pro" → modal opens
 *   2. Click "Pay with Razorpay" → POST /api/payment/create-order
 *   3. Load https://checkout.razorpay.com/v1/checkout.js
 *   4. Open Razorpay hosted Checkout with the order id
 *   5. On `handler` success, poll POST /api/auth/verify every 2s up to 30s
 *      waiting for the backend to flip plan to PRO (webhook → license → user)
 *   6. Show progress + result toasts; close modal
 *
 * If the webhook isn't reachable (e.g. backend not yet deployed), the
 * polling times out and we surface a clear message: "Payment captured by
 * Razorpay but our backend hasn't confirmed yet — try Refresh."
 */
import { useEffect, useRef, useState } from "react";
import { Crown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createOrder, loadRazorpayScript, getRazorpay, API_BASE_URL } from "@/lib/api";
import { useLicenseStore } from "@/stores/licenseStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => void;
  modal: { ondismiss: () => void };
  prefill?: { contact?: string };
  theme?: { color?: string };
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeModal({ open, onOpenChange }: UpgradeModalProps) {
  const refreshBackendState = useLicenseStore((s) => s.refreshBackendState);
  const [stage, setStage] = useState<"idle" | "creating" | "checkout" | "polling" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  // Reset state when the modal closes.
  useEffect(() => {
    if (!open) {
      setStage("idle");
      setErrorMsg(null);
      startedRef.current = false;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const startUpgrade = async () => {
    setStage("creating");
    setErrorMsg(null);

    let order;
    try {
      order = await createOrder("PRO");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create order";
      setStage("error");
      setErrorMsg(msg);
      toast.error("Could not start payment", { description: msg });
      return;
    }

    setStage("checkout");
    try {
      await loadRazorpayScript();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load Razorpay";
      setStage("error");
      setErrorMsg(msg);
      toast.error("Payment gateway failed to load", { description: msg });
      return;
    }

    const Razorpay = getRazorpay();
    if (!Razorpay) {
      setStage("error");
      setErrorMsg("Razorpay is not available");
      toast.error("Payment gateway is not available");
      return;
    }

    const phone = useLicenseStore.getState().jwt
      ? undefined // we don't have phone on the client easily; backend records it
      : undefined;

    const rz = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "TeleDrive",
      description: "TeleDrive Pro — lifetime license",
      order_id: order.orderId,
      handler: (resp) => {
        void pollForPro(resp);
      },
      modal: {
        ondismiss: () => {
          if (stage !== "polling" && stage !== "done") {
            setStage("idle");
            toast("Payment cancelled", { description: "You can try again any time." });
          }
        },
      },
      prefill: phone ? { contact: phone } : undefined,
      theme: { color: "#6366f1" },
    } satisfies RazorpayOptions);
    rz.open();
  };

  const pollForPro = async (_resp: RazorpaySuccessResponse) => {
    setStage("polling");
    toast.success("Payment captured", {
      description: "Waiting for license activation…",
    });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const tick = async (): Promise<void> => {
      if (Date.now() > deadline) {
        setStage("done"); // close modal but show message
        toast.warning("Activation pending", {
          description:
            "Payment was captured by Razorpay but our backend hasn't confirmed yet. " +
            "Your plan will update within a few minutes — try Refresh in Plan & Devices.",
          duration: 10_000,
        });
        return;
      }
      try {
        await refreshBackendState();
        const plan = useLicenseStore.getState().plan;
        if (plan === "PRO") {
          setStage("done");
          toast.success("Welcome to TeleDrive Pro!", {
            description: "Your device limit is now 2.",
          });
          return;
        }
      } catch {
        // network blip — keep polling
      }
      pollRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Upgrade to TeleDrive Pro
          </DialogTitle>
          <DialogDescription>
            One-time payment — lifetime license. Unlocks 2 devices, priority updates,
            and all upcoming Pro features.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-baseline justify-between rounded-lg border border-slate-200/70 dark:border-slate-800/70 bg-slate-50/60 dark:bg-slate-900/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">TeleDrive Pro (lifetime)</span>
            <span className="text-2xl font-bold">₹499</span>
          </div>

          <ul className="text-sm space-y-1.5 text-slate-700 dark:text-slate-300">
            <li>• 2 devices per account</li>
            <li>• Priority updates</li>
            <li>• Future Pro features (scheduled backup, advanced search, more)</li>
          </ul>

          {stage === "error" && errorMsg && (
            <div className="text-sm p-3 rounded-lg border border-red-300/50 bg-red-50/60 dark:bg-red-950/30 dark:border-red-800/40 text-red-800 dark:text-red-200">
              {errorMsg}
            </div>
          )}

          {stage === "polling" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Activating your license…
            </div>
          )}

          {stage === "done" && (
            <Badge variant="secondary" className="text-xs">
              You can close this window.
            </Badge>
          )}

          <p className="text-xs text-muted-foreground pt-2">
            Payments are processed by Razorpay. Test mode uses card{" "}
            <code className="rounded bg-slate-200/60 dark:bg-slate-800/60 px-1 py-0.5">
              4111 1111 1111 1111
            </code>{" "}
            with any future expiry and any CVV.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={stage === "creating" || stage === "checkout"}
          >
            <X className="h-4 w-4 mr-1.5" />
            {stage === "done" ? "Close" : "Cancel"}
          </Button>
          {(stage === "idle" || stage === "error") && (
            <Button onClick={() => void startUpgrade()}>
              <Crown className="h-4 w-4 mr-1.5" />
              {stage === "error" ? "Try again" : "Pay with Razorpay"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Lint-satisfy unused-API export warning (Base URL is referenced by other API
// modules and tests; re-exporting here for grep-ability).
export { API_BASE_URL };