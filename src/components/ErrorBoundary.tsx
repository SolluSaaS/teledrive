import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in TeleDrive:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center select-none">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-red-100/40 dark:bg-red-950/20 blur-xl rounded-full scale-150 animate-pulse" />
            <AlertTriangle className="relative h-16 w-16 text-red-500 stroke-[1.5]" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">Something went wrong</h2>
          <p className="text-xs text-muted-foreground max-w-sm mb-6 leading-relaxed">
            {this.state.error?.message || "An unexpected error occurred. Please refresh the page or try again."}
          </p>
          <Button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-brand-500 hover:bg-brand-600 font-semibold px-5 text-sm gap-1.5 shadow-sm text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
