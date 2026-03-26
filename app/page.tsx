import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#07070B] px-4 py-14 text-zinc-100">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl sm:p-8">
        <div className="text-sm text-zinc-300">InstaSchedule Pro</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Command Center dashboard
        </h1>
        <p className="mt-3 text-base leading-7 text-zinc-300">
          High-fidelity dark-mode UI for Instagram automation and appointment
          scheduling.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/command-center"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 text-sm font-medium text-white transition hover:brightness-110"
          >
            Open Command Center
          </Link>
          <a
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-zinc-200 backdrop-blur-xl transition hover:bg-white/10"
          >
            Next docs
          </a>
        </div>
      </div>
    </div>
  );
}
