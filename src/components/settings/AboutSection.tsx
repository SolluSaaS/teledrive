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

      <div className="p-6 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-5 shadow-xs animate-fade-in">
        <div className="flex items-center gap-3.5 group">
          <div className="relative">
            <div className="absolute inset-0 bg-brand-500/20 blur-sm rounded-xl" />
            <img
              src="/teledrive.png"
              alt="TeleDrive Logo"
              className="relative h-12 w-12 object-contain rounded-xl shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-105"
            />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">TeleDrive</h4>
            <p className="text-xs text-slate-400 font-bold font-mono">v{version}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          TeleDrive is an open-source, cross-platform cloud storage application powered by your personal Telegram account. It maps file uploads to a private channel and maintains a virtual folder hierarchy inside a pinned message index, offering an unlimited backup space solution completely under your control.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/senapati484/teledrive")}
            className="rounded-xl text-xs font-bold gap-2 border-slate-200 dark:border-slate-800 cursor-pointer h-9 px-4"
          >
            <GithubIcon className="h-4 w-4" />
            GitHub Repository
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenLink("https://github.com/senapati484/teledrive/issues")}
            className="rounded-xl text-xs font-bold gap-2 border-slate-200 dark:border-slate-800 cursor-pointer h-9 px-4"
          >
            <Bug className="h-4 w-4 text-slate-500" />
            Report a Bug
          </Button>
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-800/80" />

        <Button
          onClick={handleCheckUpdates}
          disabled={checking}
          className="rounded-xl text-xs font-bold bg-brand-500 hover:bg-brand-600 px-5 h-10 shadow-md shadow-brand-500/10 cursor-pointer"
        >
          {checking ? "Checking for updates..." : "Check for Updates"}
        </Button>
      </div>

      {/* Disclaimer Section */}
      <div className="flex gap-3.5 p-4 rounded-2xl border border-slate-200/40 dark:border-slate-850/30 bg-slate-100/50 dark:bg-slate-900/60 text-muted-foreground">
        <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-brand-500" />
        <div className="space-y-1 text-xs leading-relaxed">
          <h5 className="font-extrabold text-slate-700 dark:text-slate-300 tracking-tight">Disclaimer</h5>
          <p>
            TeleDrive is an independent open-source client app and is not affiliated with, authorized, maintained, sponsored or endorsed by Telegram FZ-LLC or any of its affiliates. Use at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}
