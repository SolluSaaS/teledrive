/**
 * Single source of truth for "is this user on the Pro plan?".
 *
 * Reads `plan` from the license store and returns true iff it's 'PRO'.
 * Use this hook everywhere Pro-only UI or routing decisions are needed
 * so the comparison stays consistent (no inline `plan === 'PRO'` strings
 * scattered across the codebase).
 *
 * Reactive: the hook re-renders the consumer whenever the plan flips.
 * A Razorpay webhook success flips `plan: 'FREE' → 'PRO'` via
 * `refreshBackendState()` → `applyProjection()` (see licenseStore.ts),
 * and any subscriber to this hook re-renders automatically.
 */
import { useLicenseStore } from '@/stores/licenseStore';

export function useIsPro(): boolean {
  return useLicenseStore((s) => s.plan === 'PRO');
}