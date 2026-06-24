import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { HardDrive, Clock, Star, Trash2, Settings, Menu, Database } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import SearchBar from "./SearchBar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

export default function DriveLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  const files = useFileStore((state) => state.files);

  // Calculate mock storage based on actual file sizes in store + 0.5 GB base
  const totalSizeBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const usedGB = (totalSizeBytes / (1024 * 1024 * 1024) + 0.12).toFixed(2);
  const limitGB = 15;
  const storagePercentage = Math.min(Math.round((parseFloat(usedGB) / limitGB) * 100), 100);

  // Extract phone initials (e.g. "+91 9876..." -> "+9")
  const getInitials = (phone: string | null) => {
    if (!phone) return "TD";
    const cleaned = phone.replace(/[^0-9+]/g, "");
    if (cleaned.startsWith("+")) {
      return cleaned.slice(0, 2);
    }
    return cleaned.slice(0, 2).toUpperCase() || "TD";
  };

  const navItems = [
    { label: "My Drive", icon: HardDrive, path: "/drive/my-drive" },
    { label: "Recent", icon: Clock, path: "/drive/recent" },
    { label: "Starred", icon: Star, path: "/drive/starred" },
    { label: "Trash", icon: Trash2, path: "/drive/trash" },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-background">
      {/* Navigation items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            location.pathname === item.path ||
            (item.path === "/drive/my-drive" && location.pathname.startsWith("/drive/folder/"));
          return (
            <Link
              key={item.label}
              to={item.path}
              onClick={() => isMobile && setSidebarOpen(false)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400 font-semibold"
                  : "text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* Storage panel */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          <span>Storage</span>
        </div>
        <Progress value={storagePercentage} className="h-1.5 bg-slate-100 dark:bg-slate-900" />
        <div className="text-xs text-muted-foreground">
          {usedGB} GB of {limitGB} GB used
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs font-semibold rounded-full border-brand-200 hover:bg-brand-50 text-brand-600 dark:border-brand-900 dark:text-brand-400 dark:hover:bg-brand-950/20"
        >
          Buy storage
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Topbar */}
      <header className="flex items-center justify-between border-b px-4 h-14 md:h-16 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[var(--sidebar-width)] p-0 pt-10">
                <div className="px-6 py-2">
                  <span className="text-xl font-bold text-brand-500 tracking-tight">TeleDrive</span>
                </div>
                <SidebarContent />
              </SheetContent>
            </Sheet>
          )}

          {/* Logo / Title */}
          <Link to="/drive/my-drive" className="flex items-center gap-2">
            <svg
              className="h-7 w-7 text-brand-500 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span className="hidden sm:inline-block text-lg font-bold tracking-tight text-slate-800 dark:text-slate-200">
              TeleDrive
            </span>
          </Link>
        </div>

        {/* Search bar wrapper */}
        <div className="flex-1 max-w-2xl mx-4 md:mx-8">
          <SearchBar />
        </div>

        {/* Right side items */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/settings")}
            className="h-10 w-10 rounded-full hover:bg-muted hidden md:flex"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Button>

          <Avatar className="h-9 w-9 border cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate("/settings")}>
            <AvatarFallback className="bg-brand-500 text-white font-bold text-xs select-none">
              {getInitials(phoneNumber)}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Main shell */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Desktop) */}
        {!isMobile && (
          <aside className="w-[var(--sidebar-width)] border-r shrink-0 bg-background/50">
            <SidebarContent />
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50/30 dark:bg-slate-950/20 pb-[calc(var(--mobile-nav-height)+16px)] md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Bottom Nav (Mobile) */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-height)] border-t bg-background flex items-center justify-around z-40 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path === "/drive/my-drive" && location.pathname.startsWith("/drive/folder/"));
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
                  isActive ? "text-brand-500 font-semibold" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5 mb-0.5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
          
          {/* Settings tab for mobile bottom nav */}
          <Link
            to="/settings"
            className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
              location.pathname === "/settings" ? "text-brand-500 font-semibold" : "text-muted-foreground"
            }`}
          >
            <Settings className="h-5 w-5 mb-0.5" />
            <span className="text-[10px]">Settings</span>
          </Link>
        </nav>
      )}
    </div>
  );
}
