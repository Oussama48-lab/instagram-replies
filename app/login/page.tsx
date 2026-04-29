"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      // Full reload so middleware can read the fresh session cookie
      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err?.message ?? "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A1628] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
      {/* Background Subtle Gradient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00BFA6]/10 blur-[120px]" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <Link href="/" className="flex items-center justify-center gap-3 group">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00BFA6]/10 text-[#00BFA6] transition-transform group-hover:scale-105">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-3xl font-extrabold tracking-tight text-white">MediBook</span>
        </Link>
        <h2 className="mt-8 text-center text-2xl font-bold leading-9 tracking-tight text-white">
          Sign in to your dashboard
        </h2>
        <p className="mt-2 text-center text-sm text-blue-100/70">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-[#00BFA6] hover:text-[#00D9BD] transition-colors">
            Sign up now
          </Link>
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px] relative z-10">
        <div className="bg-[#0D1E36] px-6 py-12 shadow-2xl shadow-[#00BFA6]/5 sm:rounded-2xl sm:px-12 border border-white/5">
          {error && (
            <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium leading-6 text-blue-100">
                Email address
              </label>
              <div className="mt-2 text-blue-100">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="doctor@clinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-blue-100/30 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium leading-6 text-blue-100">
                Password
              </label>
              <div className="mt-2">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/10 bg-[#0A1628] text-[#00BFA6] focus:ring-[#00BFA6] focus:ring-offset-0 focus:ring-offset-[#0D1E36]"
                />
                <label htmlFor="remember-me" className="ml-3 block text-sm leading-6 text-blue-100">
                  Remember me
                </label>
              </div>

              <div className="text-sm leading-6">
                <a href="#" className="font-medium text-[#00BFA6] hover:text-[#00D9BD] transition-colors">
                  Forgot password?
                </a>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-lg bg-[#00BFA6] px-3 py-2.5 text-sm font-semibold text-[#0A1628] shadow-sm hover:bg-[#00D9BD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00BFA6] transition-all shadow-lg shadow-[#00BFA6]/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
          
          <div className="mt-8 text-center sm:mx-auto sm:w-full sm:max-w-md">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm font-medium leading-6">
                <span className="bg-[#0D1E36] px-6 text-blue-100/50">Demo mode</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-blue-100/50">
              For testing, just click "Sign in" directly to go to the dashboard.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
