import { lazy, Suspense, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { Loader2 } from "lucide-react";
import { restoreSession } from "./lib/telegram/restoreSession";
import { bootstrapTeleDrive } from "./lib/telegram/bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { invoke } from "@tauri-apps/api/core";

// Lazy pages
const DriveLayout = lazy(() => import("./components/layout/DriveLayout"));
const MyDrivePage = lazy(() => import("./pages/MyDrivePage"));
const RecentPage = lazy(() => import("./pages/RecentPage"));
const StarredPage = lazy(() => import("./pages/StarredPage"));
const TrashPage = lazy(() => import("./pages/TrashPage"));
const FolderPage = lazy(() => import("./pages/FolderPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

// Full-screen spinner fallback
function LoadingFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
    </div>
  );
}

// Splash Screen Loader
function SplashLoader({ status }: { status: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 gap-4">
      <img
        src="/teledrive.png"
        alt="TeleDrive Logo"
        className="h-16 w-16 object-contain animate-pulse shrink-0 rounded-2xl shadow-md"
      />
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-medium">
        <Loader2 className="h-4.5 w-4.5 animate-spin text-brand-500" />
        <span className="text-sm">{status}</span>
      </div>
    </div>
  );
}

// Protected Route Guard
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/auth" replace />;
}

// Guest/Auth Route Guard
function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return !isAuthenticated ? <>{children}</> : <Navigate to="/drive/my-drive" replace />;
}

import { useTheme } from "./hooks/useTheme";

function App() {
  useTheme(); // Initialize theme logic
  const [isRestoring, setIsRestoring] = useState(true);
  const [status, setStatus] = useState("Connecting to Telegram...");

  useEffect(() => {
    async function initSession() {
      try {
        const restored = await restoreSession();
        if (restored) {
          await bootstrapTeleDrive(setStatus);
        }
      } catch (err: any) {
        console.error("Failed to restore session on app launch:", err);
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_ERR: ${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`
        }).catch(() => {});
      } finally {
        setIsRestoring(false);
      }
    }
    initSession();
  }, []);

  if (isRestoring) {
    return <SplashLoader status={status} />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Redirect root to /drive */}
          <Route path="/" element={<Navigate to="/drive/my-drive" replace />} />

          {/* Guest routes (Auth) */}
          <Route
            path="/auth"
            element={
              <GuestRoute>
                <AuthPage />
              </GuestRoute>
            }
          />

          {/* Protected routes */}
          <Route
            path="/drive"
            element={
              <ProtectedRoute>
                <DriveLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="my-drive" replace />} />
            <Route path="my-drive" element={<MyDrivePage />} />
            <Route path="recent" element={<RecentPage />} />
            <Route path="starred" element={<StarredPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="folder/*" element={<FolderPage />} />
          </Route>

          {/* Settings protected route */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
