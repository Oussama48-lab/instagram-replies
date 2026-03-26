export default function CommandCenterPage() {
  const steps = [
    {
      title: "Incoming DM",
      subtitle: "Triggers + intent capture",
      badge: "Instagram",
      accent: "from-[#7C3AED] to-[#D946EF]",
    },
    {
      title: "AI Analysis",
      subtitle: "Extracts goal, urgency, and slot fit",
      badge: "Model",
      accent: "from-[#60A5FA] to-[#A78BFA]",
    },
    {
      title: "Auto-Reply / Book",
      subtitle: "Draft reply + reserve appointment",
      badge: "Scheduler",
      accent: "from-[#10B981] to-[#34D399]",
    },
  ] as const;

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  const times = ["9a", "11a", "1p", "3p", "5p"] as const;
  const slots: Record<string, Record<string, "open" | "confirmed" | "blocked">> =
    {
      Mon: { "9a": "confirmed", "11a": "open", "1p": "open", "3p": "blocked", "5p": "open" },
      Tue: { "9a": "open", "11a": "confirmed", "1p": "open", "3p": "open", "5p": "blocked" },
      Wed: { "9a": "open", "11a": "open", "1p": "confirmed", "3p": "open", "5p": "open" },
      Thu: { "9a": "blocked", "11a": "open", "1p": "open", "3p": "confirmed", "5p": "open" },
      Fri: { "9a": "open", "11a": "open", "1p": "blocked", "3p": "open", "5p": "confirmed" },
      Sat: { "9a": "open", "11a": "blocked", "1p": "open", "3p": "open", "5p": "open" },
      Sun: { "9a": "blocked", "11a": "blocked", "1p": "open", "3p": "open", "5p": "open" },
    };

  const liveFeed = [
    {
      name: "Maya K.",
      handle: "@mayakdesign",
      time: "Just now",
      message: "Do you have anything this Thursday afternoon?",
      draft:
        "Yes — I can do Thu at 3:00 PM or 5:00 PM. Which works best for you, and what’s the best email to send the confirmation?",
      status: "needs-approval" as const,
    },
    {
      name: "Jared S.",
      handle: "@jared.studio",
      time: "2m",
      message: "Price for a 30-min consult?",
      draft:
        "A 30-minute consult is $49. If you'd like, I can book you into the next open slot and send a confirmation.",
      status: "edited" as const,
    },
    {
      name: "Nina",
      handle: "@ninawellness",
      time: "8m",
      message: "Can I reschedule my appointment from Friday?",
      draft:
        "Absolutely — tell me your preferred day/time window and I’ll propose a few open slots for you.",
      status: "auto-sent" as const,
    },
  ];

  const chip = (label: string, tone: "purple" | "emerald" | "zinc") => {
    const cls =
      tone === "purple"
        ? "border-purple-500/30 bg-purple-500/10 text-purple-200"
        : tone === "emerald"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-white/5 text-zinc-200";
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}>
        {label}
      </span>
    );
  };

  const slotTag = (v: "open" | "confirmed" | "blocked") => {
    if (v === "confirmed") return chip("Confirmed", "emerald");
    if (v === "open") return chip("Open", "zinc");
    return chip("Blocked", "zinc");
  };

  return (
    <div className="min-h-[100dvh] bg-[#07070B] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="absolute -bottom-40 right-[-80px] h-[520px] w-[520px] rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_50%_-10%,rgba(124,58,237,0.25),rgba(7,7,11,0)_60%)]" />
      </div>

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl" />
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-300">Command Center</div>
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  InstaSchedule Pro
                </h1>
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            {chip("IG: Connected", "purple")}
            {chip("Auto-Reply: On", "zinc")}
            {chip("Bookings: Live", "emerald")}
          </div>

          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 backdrop-blur-xl transition hover:bg-white/10">
              New Rule
            </button>
            <button className="rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-2 text-sm font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition hover:brightness-110">
              Publish
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="lg:col-span-8">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Automation Hub</h2>
                  <p className="text-sm text-zinc-300">
                    Visual logic for DM → analysis → booking
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {chip("Logic Builder", "zinc")}
                  {chip("Electric Purple", "purple")}
                </div>
              </div>

              <div className="relative mt-5">
                <svg
                  className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
                  viewBox="0 0 1000 220"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="flow" x1="0" x2="1">
                      <stop offset="0%" stopColor="rgba(124,58,237,0.85)" />
                      <stop offset="100%" stopColor="rgba(16,185,129,0.85)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M240 110 C 340 110, 360 110, 470 110"
                    fill="none"
                    stroke="url(#flow)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
                  <path
                    d="M530 110 C 640 110, 660 110, 760 110"
                    fill="none"
                    stroke="url(#flow)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
                  <circle cx="240" cy="110" r="3.5" fill="rgba(124,58,237,0.95)" />
                  <circle cx="470" cy="110" r="3.5" fill="rgba(167,139,250,0.95)" />
                  <circle cx="530" cy="110" r="3.5" fill="rgba(96,165,250,0.95)" />
                  <circle cx="760" cy="110" r="3.5" fill="rgba(16,185,129,0.95)" />
                </svg>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {steps.map((s) => (
                    <div
                      key={s.title}
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
                    >
                      <div
                        className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${s.accent}`}
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{s.title}</div>
                          <div className="mt-1 text-xs text-zinc-300">{s.subtitle}</div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200">
                          {s.badge}
                        </span>
                      </div>

                      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between text-xs text-zinc-300">
                          <span>Confidence</span>
                          <span className="text-zinc-200">0.92</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
                          <div className="h-1.5 w-[92%] rounded-full bg-gradient-to-r from-purple-500 to-emerald-400" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Availability Matrix</h2>
                  <p className="text-sm text-zinc-300">
                    Weekly view: open slots vs confirmed appointments
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {chip("Confirmed", "emerald")}
                  {chip("Open", "zinc")}
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <div className="min-w-[720px] rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="grid grid-cols-8 gap-2">
                    <div className="col-span-1" />
                    {days.map((d) => (
                      <div key={d} className="col-span-1 text-xs font-medium text-zinc-200">
                        {d}
                      </div>
                    ))}

                    {times.map((t) => (
                      <div key={t} className="contents">
                        <div className="col-span-1 flex items-center text-xs text-zinc-300">
                          {t}
                        </div>
                        {days.map((d) => {
                          const v = slots[d]?.[t] ?? "open";
                          const bg =
                            v === "confirmed"
                              ? "bg-emerald-500/12 border-emerald-500/25"
                              : v === "blocked"
                                ? "bg-white/4 border-white/10"
                                : "bg-white/6 border-white/10";
                          const ring =
                            v === "confirmed"
                              ? "shadow-[0_0_0_1px_rgba(16,185,129,0.18)]"
                              : "shadow-[0_0_0_1px_rgba(255,255,255,0.04)]";
                          return (
                            <button
                              key={`${d}-${t}`}
                              className={`col-span-1 rounded-xl border ${bg} ${ring} px-2 py-2 text-left transition hover:bg-white/10`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-zinc-200">
                                  {v === "confirmed" ? "Booked" : v === "blocked" ? "—" : "Open"}
                                </div>
                                <div className="shrink-0">{slotTag(v)}</div>
                              </div>
                              <div className="mt-1 text-[11px] text-zinc-400">
                                {v === "confirmed" ? "30m • Consult" : "30m"}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="lg:col-span-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Live Feed</h2>
                  <p className="text-sm text-zinc-300">
                    Real-time messages + AI drafted response
                  </p>
                </div>
                {chip("Realtime", "zinc")}
              </div>

              <div className="mt-5 space-y-3">
                {liveFeed.map((m) => (
                  <div
                    key={`${m.handle}-${m.time}`}
                    className="rounded-2xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.name}</div>
                        <div className="truncate text-xs text-zinc-400">
                          {m.handle} • {m.time}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {m.status === "needs-approval"
                          ? chip("Needs approval", "purple")
                          : m.status === "edited"
                            ? chip("Edited", "zinc")
                            : chip("Auto-sent", "emerald")}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                        <div className="text-[11px] font-medium text-zinc-300">
                          Customer message
                        </div>
                        <div className="mt-1 text-sm text-zinc-100">{m.message}</div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium text-zinc-300">
                            AI drafted response
                          </div>
                          <span className="text-[11px] text-zinc-400">Tone: Calm • Clear</span>
                        </div>
                        <div className="mt-1 text-sm text-zinc-100">{m.draft}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <button className="flex-1 rounded-xl bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/22">
                            Approve
                          </button>
                          <button className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">
                    Knowledge Base Settings
                  </h2>
                  <p className="text-sm text-zinc-300">
                    Business facts and tone-of-voice for the AI
                  </p>
                </div>
                {chip("Minimal", "zinc")}
              </div>

              <div className="mt-5 space-y-3">
                <label className="block">
                  <div className="text-xs font-medium text-zinc-300">Business Facts</div>
                  <textarea
                    className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] outline-none focus:border-purple-400/35 focus:ring-2 focus:ring-purple-500/15"
                    rows={5}
                    placeholder={
                      "Hours, pricing, location, cancellation policy, key services...\n\nExample:\n- 30-min consult: $49\n- Booking window: Mon–Fri\n- Cancellation: 24 hours"
                    }
                    defaultValue={
                      "• 30-min consult: $49\n• Office hours: Mon–Fri, 9am–5pm\n• Cancellation: 24 hours notice\n• Services: Consults, onboarding, follow-ups"
                    }
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-medium text-zinc-300">Tone of Voice</div>
                  <textarea
                    className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] outline-none focus:border-purple-400/35 focus:ring-2 focus:ring-purple-500/15"
                    rows={4}
                    placeholder={"Short, professional, friendly. Ask one question at a time."}
                    defaultValue={
                      "Professional, warm, and concise. Ask one question at a time. Confirm details before booking. Never overpromise. Use clear next steps."
                    }
                  />
                </label>

                <button className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-2 text-sm font-medium text-white transition hover:brightness-110">
                  Save settings
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

