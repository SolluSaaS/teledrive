import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Smartphone, Eye, HardDrive, Info, CreditCard } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import TelegramAccountSection from "@/components/settings/TelegramAccountSection";
import PlanSection from "@/components/settings/PlanSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import StorageSection from "@/components/settings/StorageSection";
import AboutSection from "@/components/settings/AboutSection";

type SectionType = "account" | "plan" | "appearance" | "storage" | "about";

export default function SettingsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Default active section is Telegram Account
  const [activeSection, setActiveSection] = useState<SectionType>("account");

  // For mobile navigation flow: nav list -> tap -> shows content screen with a back button to nav list
  const [mobileShowContent, setMobileShowContent] = useState(false);

  const sections = [
    {
      id: "account" as const,
      label: "Telegram Account",
      icon: Smartphone,
      component: TelegramAccountSection,
    },
    {
      id: "plan" as const,
      label: "Plan & Devices",
      icon: CreditCard,
      component: PlanSection,
    },
    {
      id: "appearance" as const,
      label: "Appearance",
      icon: Eye,
      component: AppearanceSection,
    },
    {
      id: "storage" as const,
      label: "Storage",
      icon: HardDrive,
      component: StorageSection,
    },
    {
      id: "about" as const,
      label: "About",
      icon: Info,
      component: AboutSection,
    },
  ];

  const ActiveComponent = sections.find((s) => s.id === activeSection)?.component || TelegramAccountSection;

  const handleMobileSelect = (secId: SectionType) => {
    setActiveSection(secId);
    setMobileShowContent(true);
  };

  // Logout state
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Step 1: Disconnect and destroy the GramJS client singleton first.
      // Without this, initClient() reuses the stale session → AUTH_RESTART.
      const { disconnectClient } = await import("@/lib/telegram/client");
      await disconnectClient();

      // Step 2: Clear the Rust session file — but KEEP the phone number.
      //
      // We call `clear_session_only` (not `clear_session`) so the session file
      // becomes { session: null, phone: "+91..." }.
      //
      // Why keep the phone?
      //   Channel IDs are stored in the vault under per-phone keys:
      //     "telegram_channel_id_+918653420095"
      //     "telegram_channel_id_+14155551234"
      //   On the next login, bootstrapTeleDrive(phone) looks up THAT account's
      //   channel and finds all previously uploaded files — even if a different
      //   account was used in between.
      //
      // Why NOT delete channel IDs?
      //   They are NOT credentials. Deleting them forces a dialog search on
      //   next login where GramJS returns BigInt IDs in a different format,
      //   causing metadataStore to fail to resolve the channel → empty drive.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_session_only").catch((e: any) =>
        console.warn("clear_session_only failed (non-fatal):", e)
      );

      // Step 3: Also wipe the vault's secondary session backup.
      //         Leave VAULT_KEY_PHONE and all channel ID entries intact.
      const { deleteSecret, VAULT_KEY_SESSION } = await import("@/lib/secure/vault");
      await deleteSecret(VAULT_KEY_SESSION).catch(() => {});

      // Step 4: Reset in-memory stores
      const { useAuthStore } = await import("@/stores/authStore");
      const { useFileStore } = await import("@/stores/fileStore");
      useAuthStore.getState().logout();
      // Reset bootstrapComplete too — see TelegramAccountSection.handleDisconnect
      // for the same fix; without it, the next login's bootstrap gate is
      // already true and uploads could race the orphan scan.
      useFileStore.setState({
        files: [],
        selectedIds: [],
        selectedIdsSet: new Set(),
        currentFolder: "/",
        bootstrapComplete: false,
      });

      // Step 5: Wipe backend license session (best-effort).
      const { useLicenseStore } = await import("@/stores/licenseStore");
      await useLicenseStore.getState().logoutFromBackend().catch((err) => {
        console.warn("Backend logout failed (non-fatal):", err);
      });
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setIsLoggingOut(false);
      navigate("/auth", { replace: true });
    }
  };


  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground relative">
      {/* Decorative ambient background blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-500/5 dark:bg-brand-500/8 blur-[130px] pointer-events-none z-0 animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/5 dark:bg-indigo-500/8 blur-[130px] pointer-events-none z-0 animate-pulse duration-[12000ms]" />
      {/* Topbar Settings Header */}
      <header className="flex items-center gap-4 border-b px-4 h-14 md:h-16 shrink-0 bg-background/80 backdrop-blur-md border-slate-200/60 dark:border-slate-800/60">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-muted cursor-pointer"
          onClick={() => {
            if (isMobile && mobileShowContent) {
              setMobileShowContent(false);
            } else {
              navigate("/drive/my-drive");
            }
          }}
        >
          <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
        </Button>
        <h2 className="text-base font-extrabold tracking-tight">Settings</h2>
      </header>

      {/* Main settings body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Split View: Nav List */}
        {(!isMobile || !mobileShowContent) && (
          <aside className="w-full md:w-[260px] md:border-r bg-slate-50/10 dark:bg-slate-950/10 backdrop-blur-md shrink-0 overflow-y-auto border-slate-200/60 dark:border-slate-800/80 flex flex-col z-10">
            <div className="flex-1 p-3 space-y-1.5">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isSelected = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => (isMobile ? handleMobileSelect(sec.id) : setActiveSection(sec.id))}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-left relative group cursor-pointer ${
                      isSelected && !isMobile
                        ? "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-brand-600 dark:text-brand-400 shadow-xs"
                        : "text-muted-foreground hover:bg-slate-100/60 dark:hover:bg-slate-900/30 hover:text-foreground border border-transparent hover:translate-x-0.5"
                    }`}
                  >
                    {isSelected && !isMobile && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 bg-brand-500 rounded-r-full shadow-[0_0_8px_rgba(26,115,232,0.6)]" />
                    )}
                    <Icon className={`h-4.5 w-4.5 shrink-0 transition-transform duration-200 ${isSelected && !isMobile ? "text-brand-500 scale-105" : "text-muted-foreground group-hover:text-foreground"}`} />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Logout button pinned to bottom of sidebar */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 shrink-0">
              <button
                onClick={() => setLogoutDialogOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-left group cursor-pointer text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 border border-transparent hover:border-red-200 dark:hover:border-red-900/40 hover:translate-x-0.5"
              >
                <svg
                  className="h-4.5 w-4.5 shrink-0 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>Log Out</span>
              </button>
            </div>
          </aside>
        )}

        {/* Settings Panel Content Area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-background/40 dark:bg-slate-950/30 backdrop-blur-md z-10">
            <div key={activeSection} className="max-w-2xl animate-slide-up-fade">
              <ActiveComponent />
            </div>
          </div>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      {logoutDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => !isLoggingOut && setLogoutDialogOpen(false)}
          />
          {/* Dialog card */}
          <div className="relative z-10 w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Icon */}
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 mx-auto mb-4">
              <svg
                className="h-6 w-6 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </div>

            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 text-center mb-1.5">
              Log Out
            </h3>
            <p className="text-sm text-muted-foreground text-center leading-relaxed mb-6">
              You will be signed out of your Telegram account. Your files will remain safe in your storage channel.
            </p>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-xl h-10 text-sm font-semibold border-slate-200 dark:border-slate-800"
                disabled={isLoggingOut}
                onClick={() => setLogoutDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 rounded-xl h-10 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white border-0 shadow-sm"
                disabled={isLoggingOut}
                onClick={handleLogout}
              >
                {isLoggingOut ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Logging out…
                  </span>
                ) : (
                  "Log Out"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
