"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthConfirmPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        router.replace("/signup");
        return;
      }

      const { user } = data.session;
      const name = localStorage.getItem("signup_name") ?? "";
      const clinic_name = localStorage.getItem("signup_clinic_name") ?? "";

      await supabase.from("buisness_owner").insert({
        auth_user_id: user.id,
        email: user.email,
        name,
        clinic_name,
        last_login: new Date().toISOString(),
      });

      localStorage.removeItem("signup_name");
      localStorage.removeItem("signup_clinic_name");

      router.replace("/dashboard");
    };

    run();
  }, [router]);

  return (
    <div className="min-h-[100dvh] bg-[#0A1628] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <svg
          className="h-10 w-10 animate-spin text-[#00BFA6]"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <p className="text-sm text-blue-100/60">Setting up your account…</p>
      </div>
    </div>
  );
}
