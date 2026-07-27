"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (!isSupabaseConfigured()) {
      setMessage("Supabase is not configured yet. Add your environment variables and restart the app.");
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
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader>
        <CardTitle>{mode === "sign-in" ? "Welcome back" : "Create an account"}</CardTitle>
        <p className="text-sm text-zinc-500">Use Supabase Auth to sign in or create an account.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button className="w-full" disabled={loading}>
            {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <Separator className="my-4" />

        <Button variant="outline" className="w-full" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
          {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </Button>

        {message ? <p className="mt-4 text-sm text-zinc-600">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
