"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!clinicName || !doctorName || !email || !password || !confirmPassword) {
      setError("All fields are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      localStorage.setItem("signup_name", doctorName);
      localStorage.setItem("signup_clinic_name", clinicName);

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + "/auth/confirm" },
      });
      if (signUpError) throw signUpError;

      setError("");
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A1628] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
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
          Create your account
        </h2>
        <p className="mt-2 text-center text-sm text-blue-100/70">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[#00BFA6] hover:text-[#00D9BD] transition-colors">
            Sign in here
          </Link>
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[480px] relative z-10">
        <div className="bg-[#0D1E36] px-6 py-12 shadow-2xl shadow-[#00BFA6]/5 sm:rounded-2xl sm:px-12 border border-white/5">
          {success && (
            <div className="rounded-lg bg-[#00BFA6]/10 border border-[#00BFA6]/30 px-4 py-6 text-center text-sm text-[#00BFA6]">
              Check your email and click the confirmation link
            </div>
          )}
          {!success && error && (
            <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {!success && <form className="space-y-6" onSubmit={handleSignup}>
            <div>
              <label htmlFor="clinicName" className="block text-sm font-medium leading-6 text-blue-100">
                Clinic Name
              </label>
              <div className="mt-2">
                <input
                  id="clinicName"
                  name="clinicName"
                  type="text"
                  required
                  placeholder="Your Clinic Name"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-blue-100/30 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <label htmlFor="doctorName" className="block text-sm font-medium leading-6 text-blue-100">
                Doctor Full Name
              </label>
              <div className="mt-2">
                <input
                  id="doctorName"
                  name="doctorName"
                  type="text"
                  autoComplete="name"
                  required
                  placeholder="Dr. John Doe"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-blue-100/30 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium leading-6 text-blue-100">
                Email address
              </label>
              <div className="mt-2">
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
                  autoComplete="new-password"
                  required
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-blue-100/30 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium leading-6 text-blue-100">
                Confirm Password
              </label>
              <div className="mt-2">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full rounded-lg border-0 bg-[#0A1628] py-2.5 px-3 text-white shadow-sm ring-1 ring-inset ring-white/10 placeholder:text-blue-100/30 focus:ring-2 focus:ring-inset focus:ring-[#00BFA6] sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-lg bg-[#00BFA6] px-3 py-2.5 text-sm font-semibold text-[#0A1628] shadow-sm hover:bg-[#00D9BD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00BFA6] transition-all shadow-lg shadow-[#00BFA6]/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Creating account…" : "Sign up"}
              </button>
            </div>
          </form>}
        </div>
      </div>
    </div>
  );
}
