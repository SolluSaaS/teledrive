import { Sun, Moon, Laptop } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { Button } from "@/components/ui/button";

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
        <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Theme mode</label>
        
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant={isSelected ? "default" : "outline"}
                className={`h-24 rounded-xl flex flex-col gap-2 justify-center font-semibold text-xs border ${
                  isSelected
                    ? "bg-brand-500 hover:bg-brand-600 text-white border-brand-500 shadow-md shadow-brand-500/10"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
                onClick={() => setTheme(opt.value)}
              >
                <Icon className={`h-5 w-5 ${isSelected ? "text-white" : "text-muted-foreground"}`} />
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border text-xs text-muted-foreground leading-relaxed">
        💡 <strong>System Mode:</strong> Adjusts the theme color of TeleDrive according to your operating system appearance preference automatically.
      </div>
    </div>
  );
}
