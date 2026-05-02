"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code  = searchParams.get("code");
    const state = searchParams.get("state"); // Supabase access_token passed via OAuth state

    if (!code || !state) {
      setError("Session expired, please try again.");
      return;
    }

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 30000);

    (async () => {
      try {
        const res = await fetch("/api/instagram/callback", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state}`,
          },
          body: JSON.stringify({ code }),
        });

        clearTimeout(timeoutId);
        const data = await res.json();
        console.log("[IG CALLBACK] API response:", data);

        if (data.error) {
          setError(data.error);
        } else {
          window.location.href = "/dashboard";
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err?.name === "AbortError") {
          setError("Something went wrong, please try again.");
        } else {
          console.error("[IG CALLBACK] fetch error:", err);
          setError(err?.message ?? "Unexpected error, please try again.");
        }
      }
    })();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-[100dvh] bg-[#07070B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center p-6 max-w-sm">
          <div className="h-12 w-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10 transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#07070B] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-sm text-zinc-400">Connecting your Instagram account...</p>
      </div>
    </div>
  );
}

export default function InstagramCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] bg-[#07070B] flex items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
