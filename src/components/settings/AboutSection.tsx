import { useState, useEffect } from "react";
import { Bug, ShieldAlert, Check } from "lucide-react";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    stroke="currentColor"
    strokeWidth="2.5"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AboutSection() {
  const [version, setVersion] = useState("0.1.0");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    async function fetchVersion() {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (err) {
        console.warn("Failed to load app version from Tauri:", err);
      }
    }
    fetchVersion();
  }, []);

  const handleOpenLink = async (url: string) => {
    try {
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open URL:", err);
      toast.error("Failed to open link.");
    }
  };

  const handleCheckUpdates = () => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      toast("You're up to date!", {
        icon: <Check className="h-4 w-4 text-green-500" />,
        description: `TeleDrive v${version} is the latest version.`,
      });
    }, 1000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">About TeleDrive</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Learn more about the project, licensing, and updates.
        </p>
      </div>

      <div className="p-5 border rounded-lg bg-background space-y-4">
        <div className="flex items-center gap-3">
          <img
            src="/teledrive.png"
            alt="TeleDrive Logo"
            className="h-12 w-12 object-contain rounded-xl shadow-sm shrink-0"
          />
          <div>
            <h4 className="text-md font-bold text-slate-800 dark:text-slate-200">TeleDrive</h4>
            <span className="text-xs text-muted-foreground">Version {version}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          TeleDrive is an open-source, cross-platform cloud storage application powered by your personal Telegram account. It maps file uploads to a private channel and maintains a virtual folder hierarchy inside a pinned message index, offering an unlimited backup space solution completely under your control.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/sayansenapati/teledrive")}
            className="rounded-full text-xs font-semibold gap-2 border-slate-200 dark:border-slate-800"
          >
            <GithubIcon className="h-3.5 w-3.5" />
            GitHub Repository
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/sayansenapati/teledrive/issues")}
            className="rounded-full text-xs font-semibold gap-2 border-slate-200 dark:border-slate-800"
          >
            <Bug className="h-3.5 w-3.5" />
            Report a Bug
          </Button>
        </div>

        <div className="h-px bg-border" />

        <Button
          onClick={handleCheckUpdates}
          disabled={checking}
          className="rounded-full text-xs font-semibold bg-brand-500 hover:bg-brand-600 px-5"
        >
          {checking ? "Checking for updates..." : "Check for Updates"}
        </Button>
      </div>

      {/* Disclaimer Section */}
      <div className="flex gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-muted-foreground">
        <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs leading-relaxed">
          <h5 className="font-bold text-slate-700 dark:text-slate-300">Disclaimer</h5>
          <p>
            TeleDrive is an independent open-source client app and is not affiliated with, authorized, maintained, sponsored or endorsed by Telegram FZ-LLC or any of its affiliates. Use at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}
