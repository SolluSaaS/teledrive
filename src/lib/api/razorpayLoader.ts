/**
 * Lazily injects the Razorpay Checkout script.
 *
 * The script is idempotent: concurrent calls share the same promise, so we
 * never end up with two `<script>` tags or a race where one caller sees
 * the global before it's ready. After the first successful load the
 * module-level cache resolves instantly.
 *
 * CSP: `https://checkout.razorpay.com` must be in `script-src`. The
 * current `tauri.conf.json` already allows it (added in the foundation
 * plan's CSP update).
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let loadPromise: Promise<void> | null = null;

const SCRIPT_ID = 'razorpay-checkout-script';
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Already in the DOM but global not yet set — wait for load.
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Razorpay script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null; // allow retry on next call
      reject(new Error('Razorpay script failed to load'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Typed constructor exposed by the loaded script. Returns `undefined` if
 * the script hasn't been loaded yet — always call `loadRazorpayScript()`
 * and `await` it before reading this.
 */
export function getRazorpay(): NonNullable<Window['Razorpay']> | undefined {
  return window.Razorpay;
}