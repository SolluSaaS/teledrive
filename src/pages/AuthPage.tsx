import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { useAuthStore } from "@/stores/authStore";
import { initClient, getClient } from "@/lib/telegram/client";
import { saveSecret, getSecret, VAULT_KEY_SESSION, VAULT_KEY_PHONE, VAULT_KEY_API_ID, VAULT_KEY_API_HASH } from "@/lib/secure/vault";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { DEFAULT_API_ID, DEFAULT_API_HASH } from "@/lib/telegram/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Buffer } from "buffer";

export default function AuthPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  
  // Auth credential check
  const [configApiId, setConfigApiId] = useState<number | null>(null);
  const [configApiHash, setConfigApiHash] = useState<string | null>(null);
  const [checkingConfig, setCheckingConfig] = useState(true);

  // States
  const [step, setStep] = useState<"phone" | "otp" | "password" | "bootstrap">("phone");
  const [phone, setPhone] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [otp, setOtp] = useState<string[]>(["", "", "", "", ""]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState("Connecting to Telegram...");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  // OTP box refs
  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    async function loadConfig() {
      try {
        const id = await getSecret(VAULT_KEY_API_ID);
        const hash = await getSecret(VAULT_KEY_API_HASH);
        // Use custom vault credentials if present, otherwise fall back to built-in defaults.
        // This allows any user to log in immediately without configuring their own API app.
        setConfigApiId(id ? parseInt(id) : DEFAULT_API_ID);
        setConfigApiHash(hash || DEFAULT_API_HASH);
      } catch (err) {
        console.error("Failed to load credentials config from vault:", err);
        // Even on vault error, fall back to defaults so login remains functional
        setConfigApiId(DEFAULT_API_ID);
        setConfigApiHash(DEFAULT_API_HASH);
      } finally {
        setCheckingConfig(false);
      }
    }
    loadConfig();
  }, []);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setError("Phone number is required");
      return;
    }
    if (!configApiId || !configApiHash) {
      setError("Please configure API ID and API Hash in Settings first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await initClient(configApiId, configApiHash);
      const client = getClient();
      
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone.trim(),
          apiId: configApiId,
          apiHash: configApiHash,
          settings: new Api.CodeSettings({}),
        })
      );

      setPhoneCodeHash((result as any).phoneCodeHash);
      setStep("otp");
      toast.success("Verification code sent to your Telegram account!");
    } catch (err: any) {
      console.error("Send code failed:", err);
      setError(err.message || "Failed to send code. Make sure country code is correct.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    const cleanVal = val.replace(/[^0-9]/g, "").slice(0, 1);
    const newOtp = [...otp];
    newOtp[index] = cleanVal;
    setOtp(newOtp);

    // Auto-focus next box if digit entered
    if (cleanVal && index < 4) {
      otpRefs[index + 1].current?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const data = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 5);
    if (data.length === 5) {
      const newOtp = data.split("");
      setOtp(newOtp);
      otpRefs[4].current?.focus();
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 5) {
      setError("Please enter the complete 5-digit code.");
      return;
    }
    if (!configApiId || !configApiHash) return;

    setLoading(true);
    setError(null);

    try {
      const client = getClient();
      
      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone.trim(),
            phoneCodeHash,
            phoneCode: code,
          })
        );
        
        // Logged in successfully
        await completeAuthentication(client);
      } catch (err: any) {
        if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
          setStep("password");
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("OTP verification failed:", err);
      setError(err.message || "Invalid verification code.");
      // Clear otp digits on error
      setOtp(["", "", "", "", ""]);
      otpRefs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const client = getClient();
      const passwordConfig = await client.invoke(new Api.account.GetPassword());

      // --- GramJS browser/webview polyfill fix ---
      // The Telegram server response is decoded by GramJS using the Node Buffer
      // polyfill. In Tauri's webview, multiple polyfill instances can be bundled,
      // creating "Buffer3" objects (a different subclass of Uint8Array) that break
      // two internal GramJS checks:
      //
      //  1. sha256/pbkdf2 in computeHash receives a "Buffer3" that crypto.subtle
      //     doesn't accept → "Bytes or str expected, not Buffer3"
      //  2. goodPrime.equals(algo.p) in checkPrimeAndGood receives a plain Uint8Array
      //     after the previous "fix" and the polyfill's .equals() throws because
      //     it only accepts Buffer instances → "bad /g in password"
      //
      // Fix: re-materialise every byte field with Buffer.from() using the SAME
      // polyfill instance that GramJS uses internally. Buffer.from(anyUint8Array)
      // always creates a proper Buffer from the active polyfill, satisfying both
      // sha256 (needs a BufferSource) and Buffer.equals() (needs a Buffer).
      const algo = passwordConfig.currentAlgo as any;
      if (algo) {
        if (algo.p)     algo.p     = Buffer.from(algo.p);
        if (algo.salt1) algo.salt1 = Buffer.from(algo.salt1);
        if (algo.salt2) algo.salt2 = Buffer.from(algo.salt2);
      }
      if ((passwordConfig as any).srpB) {
        (passwordConfig as any).srpB = Buffer.from((passwordConfig as any).srpB);
      }
      // -------------------------------------------

      const srpResult = await computeCheck(passwordConfig, password);

      await client.invoke(
        new Api.auth.CheckPassword({
          password: srpResult,
        })
      );

      await completeAuthentication(client);
    } catch (err: any) {
      console.error("2FA Verification failed:", err);
      setError(err.message || "Incorrect cloud password.");
    } finally {
      setLoading(false);
    }
  };

  const completeAuthentication = async (client: any) => {
    const sessionString = client.session.save() as string;

    // ── Primary: save session to the Rust file-backed store ──────────────────
    // This is reliable, fast, and survives dev-server restarts.
    try {
      await invoke("save_session", { session: sessionString, phone: phone.trim() });
    } catch (saveErr) {
      console.error("save_session (Rust) failed:", saveErr);
    }

    // ── Secondary: also persist to Stronghold vault (best-effort) ────────────
    try {
      await saveSecret(VAULT_KEY_SESSION, sessionString);
      await saveSecret(VAULT_KEY_PHONE, phone.trim());
    } catch (vaultErr) {
      console.warn("Stronghold saveSecret failed (non-fatal):", vaultErr);
    }

    // ── Bootstrap (load Telegram index → set files in store) ───────────────
    // Run inline BEFORE `setSession` so the AuthPage stays mounted through
    // the whole flow. If we set `isAuthenticated=true` first, the GuestRoute
    // immediately navigates to /drive/my-drive and UNMOUNTS AuthPage —
    // which silently drops the bootstrap useEffect's setFiles() call and
    // leaves the user on a blank drive page after re-login.
    //
    // By awaiting bootstrapTeleDrive here, files land in the file store
    // BEFORE we flip auth, so the user lands on /drive/my-drive with all
    // 37 files already visible.
    setStep("bootstrap");
    try {
      await bootstrapTeleDrive((status) => {
        setBootstrapStatus(status);
      }, phone.trim());
      toast.success("TeleDrive is ready!");
      // Now it's safe to flip auth — the bootstrap is fully done and the
      // file store is hydrated. GuestRoute will navigate to /drive/my-drive
      // and FileBrowser will see all 37 files.
      setSession(sessionString, phone.trim());
      navigate("/drive/my-drive");
    } catch (err: any) {
      console.error("Bootstrap failed:", err);
      setBootstrapError(err.message || "Failed to bootstrap storage channel. Please retry.");
      // Don't navigate; stay on the bootstrap screen so the user sees the error.
    }
  };

  // Bootstrap is awaited inline in `completeAuthentication` BEFORE we call
  // `setSession`. That ordering is what keeps the GuestRoute from
  // unmounting AuthPage mid-bootstrap (which used to silently drop the
  // setFiles() call and leave the user with an empty drive page after
  // re-login). The `step === "bootstrap"` state is kept only to render
  // the bootstrap status screen.

  if (checkingConfig) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground select-none">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-[#0B57D0] dark:text-[#A8C7FA]" />
          <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">Loading Configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground p-4 relative select-none">
      <Card className="w-full max-w-md p-8 md:p-10 bg-surface dark:bg-[#1E1F20] border border-slate-200/80 dark:border-slate-800/80 shadow-md rounded-3xl relative z-10 animate-fade-in transition-all">
        <div className="text-center mb-6 flex flex-col items-center">
          <Link to="/drive/my-drive" className="inline-flex items-center gap-2.5 mb-3 group">
            <img
              src="/teledrive.png"
              alt="TeleDrive Logo"
              className="h-10 w-10 object-contain"
            />
            <span className="text-2xl font-semibold tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
              TeleDrive
            </span>
          </Link>

          {error && (
            <div className="w-full flex gap-2.5 p-3 rounded-2xl border border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20 text-rose-650 dark:text-rose-400 text-xs text-left mb-2 animate-fade-in">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
              <span className="leading-relaxed font-medium">{error}</span>
            </div>
          )}
        </div>

        {/* STEP 1: Phone number input */}
        {step === "phone" && (
          <form onSubmit={handleSendCode} className="space-y-5 animate-slide-up-fade">
            <div className="text-center space-y-1 mb-6">
              <h3 className="text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">Sign in</h3>
              <p className="text-sm text-[#444746] dark:text-[#C4C7C5]">
                Use your Telegram account to continue to TeleDrive
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone-number" className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                Phone number
              </Label>
              <Input
                id="phone-number"
                type="tel"
                placeholder="+1 555-0199"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                className="rounded-xl h-12 border-slate-300 dark:border-slate-600 focus-visible:ring-[#0B57D0] focus-visible:border-[#0B57D0] bg-white dark:bg-[#282A2C] transition-all text-sm"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !phone.trim()}
              className="w-full h-11 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium text-sm transition-all cursor-pointer shadow-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending code...
                </>
              ) : (
                "Next"
              )}
            </Button>
          </form>
        )}

        {/* STEP 2: OTP verification code */}
        {step === "otp" && (
          <form onSubmit={handleVerifyOTP} className="space-y-6 animate-slide-up-fade">
            <div className="text-center space-y-1">
              <h3 className="text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">Verification code</h3>
              <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
                Telegram sent a code to your other devices or SMS for <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">{phone}</strong>
              </p>
            </div>

            <div className="flex justify-between gap-2.5 my-6">
              {otp.map((digit, idx) => (
                <Input
                  key={idx}
                  ref={otpRefs[idx]}
                  type="text"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  onPaste={handleOtpPaste}
                  disabled={loading}
                  className="w-12 h-14 text-center font-bold text-xl rounded-2xl border-slate-300 dark:border-slate-600 focus-visible:ring-2 focus-visible:ring-[#0B57D0]/20 focus-visible:border-[#0B57D0] bg-white dark:bg-[#282A2C] transition-all shadow-xs"
                />
              ))}
            </div>

            <div className="space-y-3">
              <Button
                type="submit"
                disabled={loading || otp.join("").length !== 5}
                className="w-full h-11 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium text-sm transition-all cursor-pointer shadow-xs"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => setStep("phone")}
                className="w-full h-10 rounded-full hover:bg-[#EDF2FC] dark:hover:bg-[#282A2C] flex gap-2 justify-center items-center text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Try a different phone number
              </Button>
            </div>
          </form>
        )}

        {/* STEP 3: 2FA Cloud password */}
        {step === "password" && (
          <form onSubmit={handleVerifyPassword} className="space-y-5 animate-slide-up-fade">
            <div className="text-center space-y-1">
              <h3 className="text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">Two-Step Verification</h3>
              <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
                Your Telegram account is protected by an additional cloud password.
              </p>
            </div>

            <div className="space-y-2 mt-4">
              <Label htmlFor="cloud-password" className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="cloud-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your 2FA password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="rounded-xl h-12 pr-10 border-slate-300 dark:border-slate-600 focus-visible:ring-[#0B57D0] focus-visible:border-[#0B57D0] bg-white dark:bg-[#282A2C] transition-all text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1.5 h-9 w-9 hover:bg-transparent text-[#747775] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] cursor-pointer"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                type="submit"
                disabled={loading || !password}
                className="w-full h-11 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium text-sm transition-all cursor-pointer shadow-xs"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => setStep("otp")}
                className="w-full h-10 rounded-full hover:bg-[#EDF2FC] dark:hover:bg-[#282A2C] flex gap-2 justify-center items-center text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to code verification
              </Button>
            </div>
          </form>
        )}

        {/* STEP 4: Bootstrapping TeleDrive */}
        {step === "bootstrap" && (
          <div className="space-y-6 py-4 text-center animate-slide-up-fade">
            <div className="space-y-1">
              <h3 className="text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
                Setting up your Drive
              </h3>
              <p className="text-xs text-[#444746] dark:text-[#C4C7C5] leading-relaxed">
                Initializing your personal Telegram cloud storage workspace.
              </p>
            </div>

            {bootstrapError ? (
              <div className="space-y-4">
                <div className="flex gap-2.5 p-3.5 rounded-2xl border border-rose-200 bg-rose-50/50 dark:border-rose-950/40 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-xs text-left">
                  <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5 text-rose-500" />
                  <span className="leading-relaxed font-medium">{bootstrapError}</span>
                </div>
                <Button
                  onClick={() => {
                     setBootstrapError(null);
                     setBootstrapStatus("Reconnecting to Telegram...");
                     setStep("phone");
                     setTimeout(() => setStep("bootstrap"), 50);
                  }}
                  className="w-full h-11 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] text-white dark:bg-[#A8C7FA] dark:hover:bg-[#D3E3FD] dark:text-[#062E6F] font-medium text-sm shadow-xs cursor-pointer"
                >
                  Retry Setup
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-5 py-6">
                <Loader2 className="h-10 w-10 animate-spin text-[#0B57D0] dark:text-[#A8C7FA] stroke-[2]" />
                <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5] bg-[#F0F4F9] dark:bg-[#282A2C] px-4 py-1.5 rounded-full border border-slate-200/60 dark:border-slate-700/60">
                  {bootstrapStatus}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
