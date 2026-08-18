/**
 * Route guard for Pro-only routes.
 *
 * Wraps a route element. If the user is on the FREE plan, redirects to
 * `/drive/my-drive` and surfaces a one-shot toast explaining why. If the
 * user is on the Pro plan, renders the children normally.
 *
 * Used in App.tsx to gate:
 *   - `/drive/backups`           → <BackupsPage />
 *   - `/drive/backups/folder/*`  → <BackupsFolderPage />
 *
 * The toast fires once per mount thanks to a ref guard, so re-mounting
 * (back-button, second navigation, etc.) shows it again — which is the
 * right UX for a deep-link / bookmark landing. The toast does NOT fire
 * if the user is already Pro.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useIsPro } from '@/hooks/useIsPro';

interface RequireProProps {
  children: ReactNode;
}

export default function RequirePro({ children }: RequireProProps): ReactNode {
  const isPro = useIsPro();
  const toastedRef = useRef(false);

  useEffect(() => {
    if (!isPro && !toastedRef.current) {
      toastedRef.current = true;
      toast.error('Backups is a Pro feature', {
        description: 'Upgrade in Settings → Plan & Devices to enable device backup.',
      });
    }
  }, [isPro]);

  if (!isPro) {
    return <Navigate to="/drive/my-drive" replace />;
  }
  return <>{children}</>;
}