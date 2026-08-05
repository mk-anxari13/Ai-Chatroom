import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        // Windows 11-inspired wallpaper gradient — soft blue-lavender
        background: `
          radial-gradient(ellipse at 25% 40%, rgba(0, 140, 255, 0.35) 0%, transparent 55%),
          radial-gradient(ellipse at 75% 65%, rgba(140, 90, 255, 0.28) 0%, transparent 55%),
          radial-gradient(ellipse at 50% 10%, rgba(0, 180, 220, 0.20) 0%, transparent 60%),
          linear-gradient(160deg, #1a2e4a 0%, #0f1e35 40%, #1a1530 100%)
        `,
      }}
    >
      {/* Subtle background pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)`,
          backgroundSize: "40px 40px",
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-[380px]">
        <AuthForm />
      </div>
    </main>
  );
}
