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

    // Update Zustand store
    setSession(sessionString, phone.trim());

    toast.success("Successfully logged in to Telegram!");
    setStep("bootstrap");
  };

  useEffect(() => {
    if (step !== "bootstrap") return;

    let isMounted = true;
    async function runBootstrap() {
      setBootstrapError(null);
      try {
        await bootstrapTeleDrive((status) => {
          if (isMounted) setBootstrapStatus(status);
        }, phone.trim());
        if (isMounted) {
          toast.success("TeleDrive is ready!");
          navigate("/drive/my-drive");
        }
      } catch (err: any) {
        console.error("Bootstrap failed:", err);
        if (isMounted) {
          setBootstrapError(err.message || "Failed to bootstrap storage channel. Please retry.");
        }
      }
    }

    runBootstrap();

    return () => {
      isMounted = false;
    };
  }, [step, navigate]);

  if (checkingConfig) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950 relative overflow-hidden">
        {/* Decorative background blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-500/10 dark:bg-brand-500/15 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 blur-[120px] pointer-events-none" />
        <div className="relative flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-brand-500" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading Configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 p-4 relative overflow-hidden">
      {/* Decorative ambient background blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-500/8 dark:bg-brand-500/12 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/8 dark:bg-indigo-500/12 blur-[130px] pointer-events-none" />

      <Card className="w-full max-w-md p-7 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/50 shadow-2xl rounded-2xl relative z-10 animate-fade-in transition-all">
        <div className="text-center mb-8 flex flex-col items-center">
          <Link to="/drive/my-drive" className="inline-flex items-center gap-2.5 mb-2 group">
            <div className="relative">
              <div className="absolute inset-0 bg-brand-500/30 blur-md rounded-xl group-hover:bg-brand-500/40 transition-all duration-300" />
              <img
                src="/teledrive.png"
                alt="TeleDrive Logo"
                className="relative h-11 w-11 object-contain rounded-xl shadow-md shrink-0 transition-transform duration-300 group-hover:scale-105"
              />
            </div>
            <span className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
              TeleDrive
            </span>
          </Link>

          {/* Warning placeholder replaced with clean layout spacing */}

          {error && (
            <div className="w-full flex gap-2.5 p-3.5 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-950/40 dark:bg-red-950/20 text-red-650 dark:text-red-400 text-xs text-left mb-2 animate-fade-in">
              <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-semibold">{error}</span>
            </div>
          )}
        </div>

        {/* STEP 1: Phone number input */}
        {step === "phone" && (
          <form onSubmit={handleSendCode} className="space-y-5 animate-slide-up-fade">
            <div className="space-y-1.5">
              <h3 className="text-lg font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">Sign in with Telegram</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enter your Telegram phone number (with country code) to request a verification code.
              </p>
            </div>

            <div className="space-y-2 mt-4">
              <Label htmlFor="phone-number" className="text-xs font-bold text-slate-600 dark:text-slate-355 uppercase tracking-wider">Phone number</Label>
              <Input
                id="phone-number"
                type="tel"
                placeholder="e.g. +1 555-0199"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                className="rounded-xl h-11 border-slate-200 dark:border-slate-800 focus-visible:ring-brand-500 focus-visible:border-brand-500 bg-slate-50/50 dark:bg-slate-900/30 focus-visible:ring-2 transition-all duration-200"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !phone.trim()}
              className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 font-bold shadow-md shadow-brand-500/10 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending code...
                </>
              ) : (
                "Send Code"
              )}
            </Button>
          </form>
        )}

        {/* STEP 2: OTP verification code */}
        {step === "otp" && (
          <form onSubmit={handleVerifyOTP} className="space-y-6 animate-slide-up-fade">
            <div className="space-y-1.5">
              <h3 className="text-lg font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">Enter the code</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Telegram sent a 5-digit verification code to your active sessions or mobile. Enter it below.
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
                  className="w-12 h-14 text-center font-extrabold text-xl rounded-xl border-slate-200/80 dark:border-slate-800/80 focus-visible:ring-2 focus-visible:ring-brand-500/20 focus-visible:border-brand-500 bg-slate-50/50 dark:bg-slate-900/30 shadow-sm transition-all duration-200"
                />
              ))}
            </div>

            <div className="space-y-3.5">
              <Button
                type="submit"
                disabled={loading || otp.join("").length !== 5}
                className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 font-bold shadow-md active:scale-[0.98] transition-all cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Code"
                )}
              </Button>
              
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => setStep("phone")}
                className="w-full h-11 rounded-xl hover:bg-slate-100/50 dark:hover:bg-slate-900/40 flex gap-2 justify-center items-center text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Phone number
              </Button>
            </div>
          </form>
        )}

        {/* STEP 3: 2FA Cloud password */}
        {step === "password" && (
          <form onSubmit={handleVerifyPassword} className="space-y-5 animate-slide-up-fade">
            <div className="space-y-1.5">
              <h3 className="text-lg font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">Two-Factor Authentication</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your Telegram account requires a Cloud password. Enter it below to authorize this session.
              </p>
            </div>

            <div className="space-y-2 mt-4">
              <Label htmlFor="cloud-password" className="text-xs font-bold text-slate-600 dark:text-slate-355 uppercase tracking-wider">Cloud password</Label>
              <div className="relative">
                <Input
                  id="cloud-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your 2FA password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="rounded-xl h-11 pr-10 border-slate-200 dark:border-slate-800 focus-visible:ring-brand-500 focus-visible:border-brand-500 bg-slate-50/50 dark:bg-slate-900/30 focus-visible:ring-2 transition-all duration-200"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-9 w-9 hover:bg-transparent text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-3.5 pt-2">
              <Button
                type="submit"
                disabled={loading || !password}
                className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 font-bold shadow-md active:scale-[0.98] transition-all cursor-pointer"
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
                className="w-full h-11 rounded-xl hover:bg-slate-100/50 dark:hover:bg-slate-900/40 flex gap-2 justify-center items-center text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Code verification
              </Button>
            </div>
          </form>
        )}

        {/* STEP 4: Bootstrapping TeleDrive */}
        {step === "bootstrap" && (
          <div className="space-y-6 py-4 text-center animate-slide-up-fade">
            <div className="space-y-2">
              <h3 className="text-lg font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">
                Setting up TeleDrive
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Please wait while we initialize your secure cloud storage space.
              </p>
            </div>

            {bootstrapError ? (
              <div className="space-y-4">
                <div className="flex gap-2.5 p-3.5 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-950/40 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-xs text-left">
                  <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                  <span className="leading-relaxed font-semibold">{bootstrapError}</span>
                </div>
                <Button
                  onClick={() => {
                     setBootstrapError(null);
                     setBootstrapStatus("Reconnecting to Telegram...");
                     setStep("phone");
                     setTimeout(() => setStep("bootstrap"), 50);
                  }}
                  className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 font-bold shadow-md cursor-pointer"
                >
                  Retry Setup
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-5 py-6">
                <Loader2 className="h-11 w-11 animate-spin text-brand-500 stroke-[2]" />
                <span className="text-xs font-semibold text-slate-650 dark:text-slate-350 animate-pulse bg-slate-100 dark:bg-slate-800/80 px-4 py-1.5 rounded-full border dark:border-slate-800/50">
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
