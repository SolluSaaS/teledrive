import React, { useState, useEffect } from "react";
import { Globe, Smartphone, Code2, PlusCircle, KeyRound, AlertTriangle } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useAuthStore } from "@/stores/authStore";
import { saveSecret, getSecret, VAULT_KEY_API_ID, VAULT_KEY_API_HASH } from "@/lib/secure/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export default function ApiConfigSection() {
  const apiId = useAuthStore((state) => state.apiId);
  const setCredentials = useAuthStore((state) => state.setCredentials);

  const [isEditing, setIsEditing] = useState(!apiId);
  const [formApiId, setFormApiId] = useState("");
  const [formApiHash, setFormApiHash] = useState("");
  const [errors, setErrors] = useState<{ apiId?: string; apiHash?: string }>({});

  useEffect(() => {
    // Load current credentials from vault if not in state
    async function loadCreds() {
      const savedId = await getSecret(VAULT_KEY_API_ID);
      const savedHash = await getSecret(VAULT_KEY_API_HASH);
      if (savedId && savedHash) {
        setCredentials(parseInt(savedId), savedHash);
        setFormApiId(savedId);
        setFormApiHash(savedHash);
        setIsEditing(false);
      }
    }
    loadCreds();
  }, [setCredentials]);

  const handleOpenPortal = async () => {
    try {
      await openUrl("https://my.telegram.org");
    } catch (err) {
      console.error("Failed to open URL in browser:", err);
      toast.error("Failed to open browser link.");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: { apiId?: string; apiHash?: string } = {};

    const idNum = parseInt(formApiId);
    if (isNaN(idNum) || idNum <= 0) {
      newErrors.apiId = "API ID must be a positive integer.";
    }

    const cleanHash = formApiHash.trim();
    if (!/^[a-fA-F0-9]{32}$/.test(cleanHash)) {
      newErrors.apiHash = "API Hash must be exactly 32 hex characters.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await saveSecret(VAULT_KEY_API_ID, formApiId.toString());
      await saveSecret(VAULT_KEY_API_HASH, cleanHash);
      setCredentials(idNum, cleanHash);
      setIsEditing(false);
      setErrors({});
      toast.success("Telegram API credentials saved successfully!");
    } catch (err) {
      console.error("Failed to save secrets:", err);
      toast.error("Failed to securely save credentials.");
    }
  };

  const maskValue = (val: string | number | null) => {
    if (!val) return "";
    const str = val.toString();
    if (str.length <= 4) return "****";
    return str.slice(0, 3) + "****";
  };

  const steps = [
    {
      title: "Open Telegram's developer portal",
      icon: Globe,
      description: "Go to my.telegram.org in your browser.",
      action: (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 rounded-full border-brand-200 text-brand-600 hover:bg-brand-50"
          onClick={handleOpenPortal}
        >
          Open my.telegram.org →
        </Button>
      ),
    },
    {
      title: "Log in with your phone number",
      icon: Smartphone,
      description:
        "Enter your Telegram phone number (with country code). Telegram will send a login confirmation code to your Telegram app.",
    },
    {
      title: "Go to API Development Tools",
      icon: Code2,
      description: "After logging in, click the 'API Development Tools' link in the developer portal menu.",
    },
    {
      title: "Create a new application",
      icon: PlusCircle,
      description: "Fill in the creation form: App Title = 'My TeleDrive', Short name = 'myteledrive', Platform = 'Desktop'. Then submit to get your credentials.",
    },
    {
      title: "Paste your credentials below",
      icon: KeyRound,
      description: "Copy the App api_id (a number) and App api_hash (a 32-character string) and enter them in the form below.",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Connect Telegram API</h3>
        <p className="text-sm text-muted-foreground mt-1">
          TeleDrive uses your personal Telegram API credentials to store files. Your data stays completely in your own Telegram account.
        </p>
      </div>

      {/* Stepper Guide */}
      <div className="relative pl-6 space-y-6 border-l border-slate-200 dark:border-slate-800 ml-4">
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          return (
            <div key={index} className="relative">
              {/* Stepper Circle */}
              <div className="absolute -left-10 top-0 flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 border text-xs font-semibold text-muted-foreground">
                {index + 1}
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <StepIcon className="h-4 w-4 text-brand-500" />
                  {step.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                {step.action}
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Credentials form / Display */}
      {isEditing ? (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="api-id">API ID</Label>
            <Input
              id="api-id"
              type="text"
              placeholder="e.g. 12345678"
              value={formApiId}
              onChange={(e) => setFormApiId(e.target.value)}
              className={errors.apiId ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {errors.apiId && <p className="text-xs text-destructive">{errors.apiId}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="api-hash">API Hash</Label>
            <Input
              id="api-hash"
              type="text"
              placeholder="e.g. 0123456789abcdef0123456789abcdef"
              value={formApiHash}
              onChange={(e) => setFormApiHash(e.target.value)}
              className={errors.apiHash ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {errors.apiHash && <p className="text-xs text-destructive">{errors.apiHash}</p>}
          </div>

          <div className="flex gap-3">
            <Button type="submit" className="rounded-full bg-brand-500 hover:bg-brand-600 font-semibold px-6">
              Save and Connect
            </Button>
            {apiId && (
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">API ID</span>
              <span className="font-semibold font-mono">{maskValue(apiId)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">API Hash</span>
              <span className="font-semibold font-mono">********************************</span>
            </div>
          </div>
          <Button
            variant="outline"
            className="rounded-full text-xs font-semibold px-4 border-brand-200 text-brand-600 hover:bg-brand-50"
            onClick={() => setIsEditing(true)}
          >
            Change Credentials
          </Button>
        </div>
      )}

      {/* Warning Alert Box */}
      <div className="flex gap-3 p-4 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-950 dark:bg-red-950/20 text-red-700 dark:text-red-400">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h5 className="text-xs font-bold uppercase tracking-wider">Keep credentials private</h5>
          <p className="text-xs leading-relaxed">
            Never share your api_id or api_hash with anyone. TeleDrive stores these credentials encrypted locally inside Tauri's Stronghold secure vault on your device.
          </p>
        </div>
      </div>
    </div>
  );
}
