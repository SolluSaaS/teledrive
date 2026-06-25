import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Smartphone, Eye, HardDrive, Info } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import TelegramAccountSection from "@/components/settings/TelegramAccountSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import StorageSection from "@/components/settings/StorageSection";
import AboutSection from "@/components/settings/AboutSection";

type SectionType = "account" | "appearance" | "storage" | "about";

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
          <aside className="w-full md:w-[260px] md:border-r bg-slate-50/20 dark:bg-slate-900/5 shrink-0 overflow-y-auto border-slate-250 dark:border-slate-800/80">
            <div className="p-3 space-y-1.5">
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
          </aside>
        )}

        {/* Settings Panel Content Area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-background/50 backdrop-blur-md">
            <div className="max-w-2xl animate-fade-in">
              <ActiveComponent />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
