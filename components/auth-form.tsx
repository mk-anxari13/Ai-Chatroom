"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    if (!isSupabaseConfigured()) {
      setMessage("Supabase is not configured yet. Add your environment variables and restart the app.");
      setIsError(true);
      setLoading(false);
      return;
    }

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    const { error } = result;

    if (error) {
      setMessage(error.message);
      setIsError(true);
      setLoading(false);
      return;
    }

    if (mode === "sign-in") {
      setMessage("Signed in successfully.");
    } else {
      setMessage("Check your email to confirm your account.");
    }

    router.push("/");
    setLoading(false);
  }

  return (
    /* Windows 11 ContentDialog / sign-in card */
    <div
      className="w-full max-w-[380px] rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(40px) saturate(1.6)",
        WebkitBackdropFilter: "blur(40px) saturate(1.6)",
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header band */}
      <div className="px-8 pt-8 pb-6">
        {/* Windows logo mark */}
        <div className="mb-5 flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <rect x="0" y="0" width="10" height="10" rx="1" fill="#F25022"/>
            <rect x="12" y="0" width="10" height="10" rx="1" fill="#7FBA00"/>
            <rect x="0" y="12" width="10" height="10" rx="1" fill="#00A4EF"/>
            <rect x="12" y="12" width="10" height="10" rx="1" fill="#FFB900"/>
          </svg>
          <span className="text-sm font-semibold text-[#1A1A1A] tracking-tight">Chatroom</span>
        </div>

        <h1 className="text-[22px] font-semibold text-[#1A1A1A] leading-tight mb-1">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </h1>
        <p className="text-sm text-[#5C5C5C]">
          {mode === "sign-in"
            ? "Use your email and password to continue."
            : "Enter your details to get started."}
        </p>
      </div>

      {/* Form body */}
      <div className="px-8 pb-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="auth-email" className="text-xs font-medium text-[#5C5C5C] select-none">
              Email address
            </label>
            <Input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="h-9"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="auth-password" className="text-xs font-medium text-[#5C5C5C] select-none">
              Password
            </label>
            <Input
              id="auth-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              className="h-9"
            />
          </div>

          {/* Status message */}
          {message && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-snug ${
                isError
                  ? "bg-[#FDE7E9] text-[#C42B1C] border border-[#F8C4C8]"
                  : "bg-[#EFF8EF] text-[#107C10] border border-[#C3E6C3]"
              }`}
            >
              <span className="shrink-0 mt-px">{isError ? "⚠" : "✓"}</span>
              <span>{message}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-9 mt-1 text-sm font-medium"
          >
            {loading
              ? mode === "sign-in" ? "Signing in..." : "Creating account..."
              : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {/* Mode toggle */}
        <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setMessage(null);
            }}
            className="w-full text-center text-sm text-[#0078D4] hover:text-[#106EBE] hover:underline transition-colors cursor-pointer select-none"
          >
            {mode === "sign-in"
              ? "Don't have an account? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
