"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { apiJson } from "@/lib/api";
import { loginMethodSchema, userSchema } from "@/lib/schemas";
import { postRedirectTarget } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { z } from "zod";

type Step = "username" | "password" | "otp" | "register";

export default function LoginPage() {
  const { setUserLocal, isAuthenticated, loading, user } = useAuth();
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [reg, setReg] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    branch_id: "",
  });
  const [branches, setBranches] = useState<{ id: number; name: string; code: string }[]>([]);

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      window.location.replace(postRedirectTarget(user));
    }
  }, [loading, isAuthenticated, user]);

  useEffect(() => {
    apiJson
      .get<{ branches: { id: number; name: string; code: string }[] }>("/api/branches")
      .then((d) => setBranches(d.branches || []))
      .catch(() => undefined);
  }, []);

  async function checkLoginMethod() {
    setError("");
    if (!username.trim()) {
      setError("Please enter your User ID");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson.post("/api/get-login-method", { username: username.trim() }, loginMethodSchema);
      if (!data.success) {
        setError(data.error || "Unable to continue");
        return;
      }
      if (data.username) setUsername(data.username);
      if (data.allow_password && !data.allow_otp) {
        setHint(`Signing in as ${data.username}. Enter your password.`);
        setStep("password");
      } else if (data.allow_otp) {
        await sendOtp(data.username || username.trim());
      } else {
        setError("No login method available. Contact your superadmin.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp(user = username) {
    setError("");
    setBusy(true);
    try {
      const data = await apiJson.post<{
        success: boolean;
        message?: string;
        username?: string;
        error?: string;
      }>("/api/send-otp", { username: user });
      if (!data.success) {
        setError(data.error || "Failed to send OTP");
        return;
      }
      if (data.username) setUsername(data.username);
      setHint(data.message || "OTP sent");
      setStep("otp");
      setOtp("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setError("");
    if (!otp.trim()) {
      setError("Please enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson.post(
        "/api/verify-otp",
        { username, otp: otp.trim() },
        z.object({
          success: z.boolean(),
          user: userSchema.optional(),
          error: z.string().optional(),
        })
      );
      if (!data.success || !data.user) {
        setError(data.error || "Invalid OTP");
        return;
      }
      setUserLocal(data.user);
      toast.success("Signed in");
      window.location.replace(postRedirectTarget(data.user));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function doPasswordLogin() {
    setError("");
    if (!password) {
      setError("Please enter your password");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson.post(
        "/api/login",
        { username, password },
        z.object({
          success: z.boolean(),
          user: userSchema.optional(),
          error: z.string().optional(),
        })
      );
      if (!data.success || !data.user) {
        setError(data.error || "Invalid credentials");
        return;
      }
      setUserLocal(data.user);
      toast.success("Signed in");
      window.location.replace(postRedirectTarget(data.user));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setError("");
    setBusy(true);
    try {
      const data = await apiJson.post<{ success: boolean; message?: string; error?: string }>(
        "/api/register",
        {
          name: reg.name.trim() || reg.username.trim(),
          username: reg.username,
          email: reg.email,
          password: reg.password,
          branch_id: Number(reg.branch_id),
        }
      );
      if (!data.success) {
        setError(data.error || "Registration failed");
        return;
      }
      toast.success(data.message || "Account created");
      setStep("username");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative flex flex-col justify-center px-8 py-12 md:px-16 lg:px-[10%]">
        <div className="absolute left-8 top-10 flex items-center gap-3 md:left-16 lg:left-[10%]">
          <Image src="/sbc_logo.png" alt="SBC" width={40} height={40} />
          <div>
            <p className="text-sm font-semibold text-[#0A67AE]">SBC Tanzania</p>
            <p className="text-xs text-muted-foreground">Label Scanner</p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mx-auto w-full max-w-md"
          >
            {step !== "username" && step !== "register" && (
              <button
                className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setError("");
                  setStep("username");
                }}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}

            <h1 className="font-display text-4xl text-[#1F2937]">
              {step === "register" ? "Request access" : "Sign in"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {step === "register"
                ? "Create an account for your branch. A superadmin must approve it."
                : "Scan labels, sync stock, and move inventory across branches."}
            </p>

            <div className="mt-8 space-y-4">
              {step === "username" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">User ID or email</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && checkLoginMethod()}
                      placeholder="username or email"
                      autoFocus
                    />
                  </div>
                  <Button className="w-full" disabled={busy} onClick={checkLoginMethod}>
                    {busy ? "Checking…" : "Continue"}
                  </Button>
                  <button
                    className="text-sm text-primary hover:underline"
                    onClick={() => {
                      setError("");
                      setStep("register");
                    }}
                  >
                    Need an account? Register
                  </button>
                </>
              )}

              {step === "password" && (
                <>
                  <p className="text-sm text-muted-foreground">{hint}</p>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doPasswordLogin()}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button className="w-full" disabled={busy} onClick={doPasswordLogin}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </>
              )}

              {step === "otp" && (
                <>
                  <p className="text-sm text-muted-foreground">{hint}</p>
                  <div className="space-y-2">
                    <Label htmlFor="otp">One-time code</Label>
                    <Input
                      id="otp"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                      placeholder="6-digit code"
                      autoFocus
                    />
                  </div>
                  <Button className="w-full" disabled={busy} onClick={verifyOtp}>
                    {busy ? "Verifying…" : "Verify & Sign in"}
                  </Button>
                  <button
                    className="text-sm text-primary hover:underline"
                    onClick={() => sendOtp()}
                    disabled={busy}
                  >
                    Resend OTP
                  </button>
                </>
              )}

              {step === "register" && (
                <>
                  <div className="space-y-2">
                    <Label>Full name</Label>
                    <Input
                      value={reg.name}
                      onChange={(e) => setReg({ ...reg, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input
                      value={reg.username}
                      onChange={(e) => setReg({ ...reg, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={reg.email}
                      onChange={(e) => setReg({ ...reg, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={reg.password}
                      onChange={(e) => setReg({ ...reg, password: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                      value={reg.branch_id}
                      onChange={(e) => setReg({ ...reg, branch_id: e.target.value })}
                    >
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button className="w-full" disabled={busy} onClick={register}>
                    {busy ? "Submitting…" : "Create account"}
                  </Button>
                  <button
                    className="text-sm text-primary hover:underline"
                    onClick={() => setStep("username")}
                  >
                    Back to sign in
                  </button>
                </>
              )}

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative hidden overflow-hidden bg-[#0A67AE] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(246,180,38,0.35),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.12),transparent_40%)]" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <div />
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/70">Warehouse ops</p>
            <h2 className="mt-3 font-display text-5xl leading-tight">
              Scan once.
              <br />
              Stock everywhere.
            </h2>
            <p className="mt-4 max-w-md text-white/80">
              Capture PepsiCo-style labels, sync IN/OUT movements, and transfer stock to
              production with FEFO-aware picks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-white/80">
            <span className="rounded-full bg-white/10 px-3 py-1">Live deliveries</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Expiry analytics</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Branch transfers</span>
          </div>
        </div>
      </div>
    </div>
  );
}
