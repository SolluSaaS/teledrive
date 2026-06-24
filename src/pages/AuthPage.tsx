import { KeyRound } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function AuthPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();

  const handleMockLogin = () => {
    // Save credentials & dummy session for scaffolding testing
    setSession("dummy_session_string", "+1234567890");
    navigate("/drive/my-drive");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md p-6 bg-white dark:bg-slate-900 rounded-lg shadow-md border border-slate-200 dark:border-slate-800 text-center">
        <KeyRound className="h-12 w-12 text-brand-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold tracking-tight mb-2">Welcome to TeleDrive</h2>
        <p className="text-muted-foreground mb-6">
          Access your personal Telegram-backed cloud storage
        </p>
        <Button className="w-full bg-brand-500 hover:bg-brand-600" onClick={handleMockLogin}>
          Sign in (Bypass Auth for testing)
        </Button>
      </div>
    </div>
  );
}
