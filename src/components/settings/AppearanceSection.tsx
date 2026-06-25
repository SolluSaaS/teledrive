import { Sun, Moon, Laptop } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AppearanceSection() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  const themeOptions = [
    { label: "Light", value: "light" as const, icon: Sun },
    { label: "Dark", value: "dark" as const, icon: Moon },
    { label: "System", value: "system" as const, icon: Laptop },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Appearance</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the layout appearance and color theme of TeleDrive.
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Theme mode</label>
        
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant={isSelected ? "default" : "outline"}
                className={cn(
                  "h-24 rounded-2xl flex flex-col gap-2 justify-center font-extrabold text-xs border transition-all duration-300 cursor-pointer hover:-translate-y-0.5 hover:shadow-xs border-slate-200 dark:border-slate-800",
                  isSelected
                    ? "bg-brand-500 text-white border-brand-500 shadow-md shadow-brand-500/10 dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                    : "bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/60 text-slate-700 dark:text-slate-300"
                )}
                onClick={() => setTheme(opt.value)}
              >
                <Icon className={cn("h-5 w-5 transition-transform", isSelected ? "text-white dark:text-brand-400 scale-110" : "text-muted-foreground")} />
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-slate-100/50 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-850/30 text-xs text-muted-foreground leading-relaxed">
        💡 <strong>System Mode:</strong> Adjusts the theme color of TeleDrive according to your operating system appearance preference automatically.
      </div>
    </div>
  );
}
