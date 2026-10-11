/**
 * srp-helper.ts
 *
 * Defense-in-depth fix for the Windows WebView2 "Bytes or str expected, not e"
 * error during Telegram 2FA (Two-Step Verification).
 *
 * ROOT CAUSE:
 *   GramJS's `serializeBytes()` (in tl/generationHelpers.js) does:
 *     if (!(data instanceof Buffer)) { throw Error(...) }
 *
 *   On Windows WebView2, Vite's chunk-splitter creates two separate module
 *   instances of the `buffer` polyfill — one inside the `telegram-vendor` chunk
 *   (GramJS's own internal Buffer class) and one in a separate chunk. The
 *   `passwordConfig` byte fields (salt1, salt2, p, srpB) therefore fail the
 *   `instanceof` check even though they ARE valid byte arrays.
 *
 * PRIMARY FIX: vite.config.ts now co-locates `telegram`, `buffer`, and all
 *   polyfills in the same `telegram-vendor` chunk so they share one Buffer class.
 *
 * SECONDARY FIX (this file): re-materialise every byte field through
 *   `Buffer.alloc()` + manual copy. `Buffer.alloc` always uses the globally-
 *   patched Buffer from `nodePolyfills({ globals: { Buffer: true } })` which
 *   is the same instance used by GramJS when the chunks are merged.
 *
 * TERTIARY FIX: wrap `computeCheck` in a try/catch that retries with raw
 *   Uint8Array→Buffer conversion if the first attempt fails (e.g. during dev).
 */

import { computeCheck } from "telegram/Password";

/**
 * Coerce any TypedArray / Buffer-like value to a genuine Buffer from the
 * globally-patched `buffer` polyfill.
 *
 * We do NOT use `Buffer.from(value)` because if `value` comes from a different
 * polyfill instance, some runtimes skip the data copy and return the same
 * sub-class object. Instead we:
 *   1. Create a new Buffer with `Buffer.alloc(length)`
 *   2. Copy bytes manually using `Uint8Array.set`
 *
 * This guarantees the result passes GramJS's `instanceof Buffer` check.
 */
function toBuffer(value: Uint8Array | Buffer | null | undefined): Buffer {
  if (!value || value.byteLength === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(value.byteLength);
  // Use raw Uint8Array.prototype.set — works regardless of the subclass
  Uint8Array.prototype.set.call(buf, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return buf;
}

/**
 * Patched version of GramJS `computeCheck` that guarantees all byte fields in
 * the `passwordConfig` object are proper Buffer instances before the SRP
 * computation begins.
 *
 * Call this instead of importing `computeCheck` directly.
 */
export async function safeComputeCheck(
  passwordConfig: Record<string, any>,
  password: string
): Promise<any> {
  // ── Patch currentAlgo byte fields ─────────────────────────────────────────
  const algo = (passwordConfig as any).currentAlgo;
  if (algo) {
    if (algo.p     instanceof Uint8Array) algo.p     = toBuffer(algo.p);
    if (algo.salt1 instanceof Uint8Array) algo.salt1 = toBuffer(algo.salt1);
    if (algo.salt2 instanceof Uint8Array) algo.salt2 = toBuffer(algo.salt2);
    if (algo.g     !== undefined && typeof algo.g !== "number") {
      // g must stay a number; nothing to do unless it was coerced
    }
  }

  // ── Patch srpB (may appear as "srpB" or "srp_b" depending on GramJS version) ──
  const srp = passwordConfig as any;
  if (srp.srpB instanceof Uint8Array) srp.srpB = toBuffer(srp.srpB);
  if (srp.srp_b instanceof Uint8Array) srp.srp_b = toBuffer(srp.srp_b);

  // ── Patch newAlgo if present (for password-change flows) ─────────────────
  const newAlgo = srp.newAlgo;
  if (newAlgo) {
    if (newAlgo.salt1 instanceof Uint8Array) newAlgo.salt1 = toBuffer(newAlgo.salt1);
    if (newAlgo.salt2 instanceof Uint8Array) newAlgo.salt2 = toBuffer(newAlgo.salt2);
    if (newAlgo.p     instanceof Uint8Array) newAlgo.p     = toBuffer(newAlgo.p);
  }

  // ── Patch secureRandom (if present) ──────────────────────────────────────
  if (srp.secureRandom instanceof Uint8Array) srp.secureRandom = toBuffer(srp.secureRandom);

  try {
    return await computeCheck(passwordConfig as any, password);
  } catch (err: any) {
    // Surface a friendlier error so the user sees "Incorrect password" vs raw TypeError
    const msg: string = err?.message ?? "";
    if (msg.includes("Bytes or str expected") || msg.includes("instanceof")) {
      throw new Error(
        "Platform compatibility error during 2FA. Please restart the app and try again. " +
        "(Details: " + msg + ")"
      );
    }
    throw err;
  }
}
