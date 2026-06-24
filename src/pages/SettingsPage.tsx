import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Smartphone, KeyRound, Eye, HardDrive, Info } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import ApiConfigSection from "@/components/settings/ApiConfigSection";
import TelegramAccountSection from "@/components/settings/TelegramAccountSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import StorageSection from "@/components/settings/StorageSection";
import AboutSection from "@/components/settings/AboutSection";

type SectionType = "account" | "api" | "appearance" | "storage" | "about";

export default function SettingsPage() {
  const navigate = useNavigate();
  const apiId = useAuthStore((state) => state.apiId);
  const isMobile = useIsMobile();

  // Default active section is API configuration if not set, otherwise Telegram Account
  const [activeSection, setActiveSection] = useState<SectionType>(
    apiId ? "account" : "api"
  );

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
      id: "api" as const,
      label: "API Configuration",
      icon: KeyRound,
      component: ApiConfigSection,
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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Topbar Settings Header */}
      <header className="flex items-center gap-4 border-b px-4 h-14 md:h-16 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-muted"
          onClick={() => {
            if (isMobile && mobileShowContent) {
              setMobileShowContent(false);
            } else {
              navigate("/drive/my-drive");
            }
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-bold tracking-tight">Settings</h2>
      </header>

      {/* Main settings body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Split View: Nav List */}
        {(!isMobile || !mobileShowContent) && (
          <aside className="w-full md:w-[260px] md:border-r bg-slate-50/50 dark:bg-slate-900/10 shrink-0 overflow-y-auto">
            <div className="p-3 space-y-1">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isSelected = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => (isMobile ? handleMobileSelect(sec.id) : setActiveSection(sec.id))}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-colors text-left ${
                      isSelected && !isMobile
                        ? "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-brand-600 dark:text-brand-400 shadow-sm"
                        : "text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-900/50 hover:text-foreground border border-transparent"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Settings Panel Content Area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-background">
            <ActiveComponent />
          </div>
        )}
      </div>
    </div>
  );
}
