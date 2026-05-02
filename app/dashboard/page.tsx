"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
export default function CommandCenterPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [openSlots, setOpenSlots] = useState<any[]>([]); // stores all slots from Supabase
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null);
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [draftMessages, setDraftMessages] = useState<Record<number, string>>({});
  const [sendingMsgId, setSendingMsgId] = useState<number | null>(null);
  const [bizOwner, setBizOwner] = useState<{ id: number | null; instagram_username: string | null } | null>(null);
  const [bookingModal, setBookingModal] = useState<{ slot: any } | null>(null);
  const [bookingForm, setBookingForm] = useState({ patientName: "", phoneNumber: "" });
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  async function handleMessage(message: string) {
    console.log("User said:", message);

    // 1. Call Claude to extract day + time
    const res = await fetch("/api/analyse-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const { intent, day, time } = await res.json();

    if (intent !== "book" || !day || !time) {
      console.log("No booking intent detected");
      return;
    }

    // 2. Fetch open slots
    const { data: slots } = await supabase
      .from("appointment_slots")
      .select("*")
      .eq("status", "open");

    if (!slots || slots.length === 0) {
      console.log("No slots available");
      return;
    }

    // 3. Find the matching slot
    const slot = slots.find((s) => s.day === day && s.time === time);

    if (!slot) {
      console.log("Requested slot not available");
      return;
    }

    // 4. Book it
    const success = await bookSlot(slot.id);
    if (success) getOpenSlots();
  }
  async function getOpenSlots() {
    const { data, error } = await supabase
      .from("appointment_slots")
      .select("*")
      .order("day", { ascending: true });

    if (error) {
      console.error("Error fetching slots:", error);
    } else {
      console.log('[SLOTS LOADED]', data);
      setOpenSlots(data ?? []);
    }
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    getOpenSlots();
    getCustomers();
    supabase.from("customers").select("id", { count: "exact" }).eq("status", "ARCHIVED").then(({ count }) => setArchivedCount(count ?? 0));

    // Refresh every 30s to keep it "Live"
    const interval = setInterval(() => {
      getCustomers();
    }, 30000);

    // Real-time subscription — re-fetch customers so counts update instantly
    const channel = supabase
      .channel("customers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        getCustomers();
        getOpenSlots();
      })
      .subscribe();

    const slotsChannel = supabase
      .channel("slots-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_slots" }, () => {
        getOpenSlots();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      supabase.removeChannel(slotsChannel);
    };
  }, [authChecked]);

  async function handleManualReply(customer: any) {
    const text = draftMessages[customer.id]?.trim();
    if (!text || !customer.instagram_id) return;

    setSendingMsgId(customer.id);
    
    try {
      const res = await fetch("/api/instagram/manual-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagram_id: customer.instagram_id,
          customer_id: customer.id,
          text
        }),
      });

      if (!res.ok) throw new Error("Failed to send message");

      // Clear draft & refresh feed (moves them out of Priority)
      setDraftMessages(prev => ({ ...prev, [customer.id]: "" }));
      getCustomers();
    } catch (err) {
      console.error(err);
      alert("Failed to send message. Check console.");
    } finally {
      setSendingMsgId(null);
    }
  }

  async function markCompleted(customer: any) {
    const name = customer.name || customer.first_name || (customer.instagram_id ? `@${customer.instagram_id}` : "Unknown Patient");
    const confirmed = window.confirm(`Are you sure you want to mark ${name} as completed?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("customers")
      .update({ status: "ARCHIVED" })
      .eq("id", customer.id);

    if (error) {
      console.error("Error marking as completed:", error);
    } else {
      getCustomers();
    }
  }

  async function fetchBizOwner() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("buisness_owner")
      .select("id, instagram_username")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();
    setBizOwner(data);
  }

  async function disconnectInstagram() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from("buisness_owner")
      .update({ instagram_username: null, instagram_access_token: null, instagram_id: null })
      .eq("auth_user_id", session.user.id);
    setBizOwner((prev) => prev ? { ...prev, instagram_username: null } : null);
  }

  useEffect(() => {
    if (!authChecked) return;
    fetchBizOwner();
  }, [authChecked]);

  // Transform openSlots into the same shape as your old 'slots' object
  const slotsByDay: Record<string, Record<string, "open" | "confirmed" | "blocked">> = useMemo(() => {
    const result: Record<string, Record<string, "open" | "confirmed" | "blocked">> = {};

    openSlots.forEach((slot) => {
      if (!result[slot.day]) {
        result[slot.day] = {};
      }
      result[slot.day][slot.time] = slot.is_booked ? "confirmed" : slot.status === "blocked" ? "blocked" : "open";
    });

    return result;
  }, [openSlots]);

  async function bookSlot(slotId: number) {
    const { data, error } = await supabase
      .from("appointment_slots")
      .update({
        status: "confirmed",
        is_booked: true
      })
      .eq("id", slotId)
      .select();

    if (error) {
      console.error("Error booking slot:", error);
      return false;
    }

    console.log("Slot booked successfully:", data);
    return true;
  }
  async function getCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .in("status", ["WAITING_FOR_DOCTOR", "DOCTOR_REPLIED"])
      .order("last_seen_at", { ascending: false });

    if (error) {
      console.error("Error fetching customers:", error);
    } else {
      setCustomers(data || []);
    }
  }

  async function handleSlotClick(day: string, time: string) {
    console.log('[SLOT CLICK] looking for day:', day, 'time:', time);
    const slot = openSlots.find(s => s.day === day && s.time === time);
    console.log('[SLOT CLICK] found:', slot);
    console.log('[SLOT CLICK] openSlots count:', openSlots.length);
    if (!slot) {
      console.log('[SLOT CLICK] no slot found in openSlots array');
      return;
    }

    if (!slot.is_booked) {
      setBookingForm({ patientName: "", phoneNumber: "" });
      setBookingError(null);
      setBookingModal({ slot });
      return;
    }

    setIsModalLoading(true);
    setSelectedAppointment({ slot });

    const { data: customer, error } = await supabase
      .from("customers")
      .select("*")
      .eq("instagram_id", slot.user_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching customer details:", error);
    } else {
      setSelectedAppointment({ slot, customer });
    }
    setIsModalLoading(false);
  }

  async function handleManualBook() {
    if (!bookingModal) return;
    const name = bookingForm.patientName.trim();
    const phone = bookingForm.phoneNumber.trim();

    if (!name || !phone) {
      setBookingError("Both fields are required.");
      return;
    }

    setBookingLoading(true);
    setBookingError(null);

    try {
      const { error: slotError } = await supabase
        .from("appointment_slots")
        .update({
          is_booked: true,
          status: "confirmed",
          booked_by_name: name,
          user_id: null,
          last_updated: new Date().toISOString(),
          customer_id: "manual",
        })
        .eq("id", bookingModal.slot.id);

      if (slotError) throw slotError;

      const { error: customerError } = await supabase
        .from("customers")
        .insert({
          name,
          phone,
          source: "manual",
          business_owner_id: bizOwner?.id ?? null,
        });

      if (customerError) throw customerError;

      setBookingModal(null);
      getOpenSlots();
    } catch (err: any) {
      setBookingError(err.message || "An unexpected error occurred.");
    } finally {
      setBookingLoading(false);
    }
  }

  const bookedCount = openSlots.filter(s => s.is_booked === true && s.status === "confirmed").length;
  const highIntentCount = customers.filter(c =>
    c.status === "WAITING_FOR_DOCTOR" || c.status === "DOCTOR_REPLIED"
  ).length;
  const lostCount = archivedCount;

  const stats = [
    {
      title: "Confirmed Appointments",
      value: String(bookedCount),
      accent: "from-[#10B981] to-[#34D399]",
    },
    {
      title: "High-Intent Leads",
      value: String(highIntentCount),
      accent: "from-[#7C3AED] to-[#D946EF]",
    },
    {
      title: "Leads Lost",
      value: String(lostCount),
      accent: "from-[#EF4444] to-[#FCA5A5]",
    },
  ];

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  const times = ["9a", "11a", "1p", "3p", "5p"] as const;
  type Day = (typeof days)[number];
  type Time = (typeof times)[number];
  type SlotState = "open" | "confirmed" | "blocked";

  const liveFeed = [
    {
      name: "Maya K.",
      handle: "@mayakdesign",
      time: "Just now",
      message: "Do you have anything this Thursday afternoon?",
      draft:
        "Yes — I can do Thu at 3:00 PM or 5:00 PM. Which works best for you, and what’s the best email to send the confirmation?",
      status: "needs-approval",
      dentalImage: "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=600&q=80",
    },
    {
      name: "Jared S.",
      handle: "@jared.studio",
      time: "2m",
      message: "Price for a 30-min consult?",
      draft:
        "A 30-minute consult is $49. If you'd like, I can book you into the next open slot and send a confirmation.",
      status: "edited",
      dentalImage: "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=600&q=80",
    },
    {
      name: "Nina",
      handle: "@ninawellness",
      time: "8m",
      message: "Can I reschedule my appointment from Friday?",
      draft:
        "Absolutely — tell me your preferred day/time window and I’ll propose a few open slots for you.",
      status: "auto-sent",
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

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] bg-[#07070B] flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }

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
              <div className="h-9 w-9 rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl flex items-center justify-center text-xl">🦷</div>
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-300">Dashboard</div>
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  Cabinet Dentaire AI
                </h1>
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            {chip("IG: Connected", "purple")}
            {chip("Auto-Reply: On", "zinc")}
            {chip("Bookings: Live", "emerald")}
          </div>

          </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="lg:col-span-8">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Vue d'ensemble</h2>
                  <p className="text-sm text-zinc-300">
                    Statistiques en temps réel
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {chip("Logic Builder", "zinc")}
                  {chip("Electric Purple", "purple")}
                </div>
              </div>

              <div className="relative mt-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {stats.map((s) => (
                    <div
                      key={s.title}
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] flex flex-col items-center justify-center text-center"
                    >
                      <div
                        className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${s.accent}`}
                      />
                      <div className="text-sm font-semibold text-zinc-300 tracking-wide">{s.title}</div>
                      <div className="mt-3 text-5xl font-bold tracking-tight text-white">{s.value}</div>
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

              <div className="mt-6 overflow-x-auto pb-4">
                <div className="min-w-[760px] rounded-2xl border border-white/5 bg-[#0A0A0E] p-4 shadow-inner shadow-white/5">
                  <div className="grid grid-cols-8 gap-3">
                    <div className="col-span-1" />
                    {days.map((d) => (
                      <div key={d} className="col-span-1 mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                        {d}
                      </div>
                    ))}

                    {times.map((t) => (
                      <div key={t} className="contents">
                        <div className="col-span-1 flex items-center justify-end pr-3 text-xs font-medium text-zinc-500">
                          {t}
                        </div>
                        {days.map((d) => {
                          const v: SlotState = slotsByDay[d]?.[t] ?? "open";
                          const isConfirmed = v === "confirmed";
                          const isBlocked = v === "blocked";
                          const isOpen = v === "open";

                          const bg = isConfirmed
                            ? "bg-emerald-500/10 border-emerald-500/20"
                            : isBlocked
                              ? "bg-white/[0.02] border-white/5 opacity-40 cursor-not-allowed"
                              : "bg-white/[0.03] border-white/10 hover:border-purple-500/30 hover:bg-purple-500/10 hover:shadow-[0_0_15px_rgba(124,58,237,0.1)]";

                          return (
                            <button
                              key={`${d}-${t}`}
                              disabled={isBlocked}
                              onClick={() => handleSlotClick(d, t)}
                              className={`col-span-1 flex h-[68px] flex-col justify-center rounded-xl border ${bg} p-3 text-left transition-all duration-300 ${isOpen ? 'cursor-pointer hover:-translate-y-0.5' : isConfirmed ? 'cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/20' : ''}`}
                            >
                              <div className="flex w-full items-center justify-between gap-2">
                                <span className={`text-[13px] font-semibold ${isConfirmed ? 'text-emerald-400' : isBlocked ? 'text-zinc-600' : 'text-zinc-200'}`}>
                                  {isConfirmed ? "Booked" : isBlocked ? "Blocked" : "Open"}
                                </span>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isConfirmed ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : isBlocked ? 'bg-zinc-700' : 'bg-purple-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]'}`} />
                              </div>
                              <span className={`mt-1 text-[11px] font-medium ${isConfirmed ? 'text-emerald-500/70' : isBlocked ? 'text-zinc-700' : 'text-zinc-500'}`}>
                                {isConfirmed ? "30m • Consult" : "30 min"}
                              </span>
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
                  <h2 className="text-base font-semibold tracking-tight">🔥 Hot Leads</h2>
                  <p className="text-sm text-zinc-300">
                    Patients ready for doctor call
                  </p>
                </div>
                {chip("Realtime", "zinc")}
              </div>

              <div className="mt-5 max-h-[70vh] overflow-y-auto pr-2 space-y-3">
                {customers.length === 0 ? (
                  <div className="text-center py-10 text-zinc-500 text-sm border border-dashed border-white/10 rounded-2xl">
                    No hot leads right now — patients will appear here when they complete the bot flow and confirm interest.
                  </div>
                ) : (
                  customers.map((customer) => {
                    const formattedTime = customer.last_seen_at
                      ? new Date(customer.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : null;
                    const name = customer.name || customer.first_name || (customer.instagram_id ? `@${customer.instagram_id}` : "Unknown Patient");
                    const hasPhoto = customer.has_photo === true && Boolean(customer.last_dental_image);

                    return (
                      <div
                        key={customer.id}
                        className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl transition hover:bg-white/10"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                              </svg>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-zinc-100">{name}</div>
                              {formattedTime && <div className="mt-0.5 text-xs text-zinc-400">Seen: {formattedTime}</div>}
                              {customer.phone && <div className="mt-1 text-[11px] font-medium text-emerald-400/90 tracking-wide">📞 {customer.phone}</div>}
                            </div>
                          </div>
                          {customer.has_photo ? chip("Priority", "purple") : chip("New", "zinc")}
                        </div>
                        <div className="flex flex-col gap-3 border-t border-white/5 pt-3 mt-1">
                          <textarea
                            value={draftMessages[customer.id] || ""}
                            onChange={(e) => setDraftMessages(prev => ({ ...prev, [customer.id]: e.target.value }))}
                            placeholder="Type your medical advice here..."
                            className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder:text-zinc-500 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] outline-none focus:border-purple-400/35 focus:ring-1 focus:ring-purple-500/15 min-h-[60px]"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-1">
                              <button
                                onClick={() => handleManualReply(customer)}
                                disabled={sendingMsgId === customer.id || !draftMessages[customer.id]?.trim()}
                                className="flex items-center justify-center rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
                              >
                                {sendingMsgId === customer.id ? "Sending..." : "Send Message"}
                              </button>
                            </div>
                            <div className="flex justify-end gap-2 shrink-0">
                              <button
                                onClick={() => setSelectedImageUrl(customer.last_dental_image)}
                                disabled={!hasPhoto}
                                className="rounded-lg border border-purple-500/30 bg-transparent px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/10 disabled:opacity-30 disabled:border-white/10 disabled:text-zinc-500 disabled:hover:bg-transparent"
                              >
                                View Picture
                              </button>
                              <button
                                onClick={() => markCompleted(customer)}
                                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${customer.has_photo ? "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10" : "bg-purple-500 text-white hover:bg-purple-600 shadow-[0_0_10px_rgba(168,85,247,0.3)]"}`}
                              >
                                Called ✓
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Instagram Account</h2>
                  <p className="text-sm text-zinc-300">Connect your Instagram Business Account</p>
                </div>
                {chip("Meta", "purple")}
              </div>

              <div className="mt-5">
                {bizOwner?.instagram_username ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <span className="text-emerald-400 text-base">✅</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-emerald-300">Connected</div>
                        <div className="text-xs text-emerald-400/70 truncate">@{bizOwner.instagram_username}</div>
                      </div>
                    </div>
                    <button
                      onClick={disconnectInstagram}
                      className="w-full rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      const { data: { session } } = await supabase.auth.getSession();
                      const state = session?.access_token || '';
                      const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.NEXT_PUBLIC_META_APP_ID}&redirect_uri=${process.env.NEXT_PUBLIC_BASE_URL}/auth/instagram/callback&scope=instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement&response_type=code&state=${encodeURIComponent(state)}`;
                      window.location.href = url;
                    }}
                    className="block w-full rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-2.5 text-center text-sm font-medium text-white transition hover:brightness-110"
                  >
                    Connect Instagram Account
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
      {/* Manual Booking Modal */}
      {bookingModal && (console.log('[MODAL] rendering booking modal', bookingModal), (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => !bookingLoading && setBookingModal(null)}
          />
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0D0D15] shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />

            <div className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold tracking-tight text-white">Book Appointment</h3>
                <button
                  onClick={() => !bookingLoading && setBookingModal(null)}
                  className="rounded-full p-2 text-zinc-400 hover:bg-white/5 hover:text-white transition"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-2 flex gap-3">
                <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-zinc-400">
                  <span className="font-semibold text-zinc-200">{bookingModal.slot.day}</span>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-zinc-400">
                  <span className="font-semibold text-zinc-200">{bookingModal.slot.time}</span>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Patient Name</div>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={bookingForm.patientName}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, patientName: e.target.value }))}
                    placeholder="e.g. Sarah Johnson"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-purple-400/50 focus:ring-1 focus:ring-purple-500/20 transition"
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Phone Number</div>
                  <input
                    type="text"
                    required
                    value={bookingForm.phoneNumber}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, phoneNumber: e.target.value }))}
                    placeholder="e.g. +212 600 000 000"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-purple-400/50 focus:ring-1 focus:ring-purple-500/20 transition"
                  />
                </label>

                {bookingError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {bookingError}
                  </div>
                )}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => !bookingLoading && setBookingModal(null)}
                  disabled={bookingLoading}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-white/10 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualBook}
                  disabled={bookingLoading}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 hover:brightness-110 transition disabled:opacity-60 disabled:pointer-events-none"
                >
                  {bookingLoading ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Saving...
                    </>
                  ) : "Book"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md">
          <div 
            className="absolute inset-0 bg-black/60" 
            onClick={() => setSelectedAppointment(null)}
          />
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0D0D15] shadow-2xl transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
            
            <div className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold tracking-tight text-white">Appointment Details</h3>
                <button 
                  onClick={() => setSelectedAppointment(null)}
                  className="rounded-full p-2 text-zinc-400 hover:bg-white/5 hover:text-white transition"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-8 space-y-6">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Patient</div>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 flex items-center justify-center border border-purple-500/20">
                      <span className="text-lg font-bold text-purple-400">
                        {(selectedAppointment.customer?.name || selectedAppointment.slot?.booked_by_name || "?")[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-white truncate">
                        {isModalLoading ? "Loading..." : (selectedAppointment.customer?.name || selectedAppointment.slot?.booked_by_name || "Unknown Patient")}
                      </div>
                      <div className="text-xs text-zinc-400">Instagram: @{selectedAppointment.customer?.instagram_id || "direct"}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white/5 border border-white/5 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Day</div>
                    <div className="text-sm font-semibold text-zinc-200">{selectedAppointment.slot?.day}</div>
                  </div>
                  <div className="rounded-2xl bg-white/5 border border-white/5 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Time</div>
                    <div className="text-sm font-semibold text-zinc-200">{selectedAppointment.slot?.time}</div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/5 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Phone Number</div>
                  <div className="text-sm font-semibold text-zinc-200">
                    {isModalLoading ? "..." : (selectedAppointment.customer?.phone || "No phone provided")}
                  </div>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setSelectedAppointment(null)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-white/10 transition"
                >
                  Close
                </button>
                <a 
                  href={selectedAppointment.customer?.phone ? `https://wa.me/${selectedAppointment.customer.phone.replace(/\D/g, '').replace(/^0/, '212')}` : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 hover:brightness-110 transition ${!selectedAppointment.customer?.phone ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                >
                  <svg className="h-4 w-4 fill-white" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.29-4.143c1.553.921 3.541 1.482 5.545 1.483 5.398 0 9.791-4.393 9.794-9.792.001-2.618-1.019-5.074-2.872-6.928s-4.314-2.873-6.932-2.873c-5.39 0-9.786 4.399-9.782 9.796.001 2.107.568 4.156 1.65 5.928l-.992 3.626 3.71-.973zm11.332-6.633c-.092-.152-.338-.243-.707-.428-.369-.185-2.181-1.077-2.519-1.2-.338-.124-.585-.185-.831.185-.246.37-.954 1.2-.17 1.27.215.123 1.076.431 1.076.431s.123.031.185-.062c.062-.092.277-.338.338-.4.062-.062.124-.092.246-.031.124.062.77.369 1.047.524.277.154.462.231.523.338.062.108.062.616-.153.892zm-3.344 1.411c-.11-.031-.246-.077-.417-.184-1.047-.647-1.754-1.354-2.123-2.031-.154-.277-.246-.585-.246-.923 0-.154.03-.308.092-.462.123-.308.4-.554.738-.677l.061-.03c.092-.031.185-.046.246-.046.062 0 .123.015.185.031l.031.015c.184.062.338.154.43.277.154.215.185.492.092.738-.031.062-.077.123-.123.185l-.184.246c-.062.092-.092.185-.031.308.338.647.892 1.231 1.57 1.631.092.062.185.062.277 0l.246-.308c.062-.092.185-.123.308-.062.123.062.738.338.862.4.123.062.185.123.185.215 0 .031-.031.154-.092.308l-.062.123c-.246.646-.83 1.077-1.477 1.108z"/>
                  </svg>
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedImageUrl && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-md">
          <div 
            className="absolute inset-0 bg-black/60" 
            onClick={() => setSelectedImageUrl(null)}
          />
          <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#0D0D15] shadow-2xl transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
            
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold tracking-tight text-white">Dental Image</h3>
                <button 
                  onClick={() => setSelectedImageUrl(null)}
                  className="rounded-full p-2 text-zinc-400 hover:bg-white/5 hover:text-white transition"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="relative flex justify-center bg-black/50 rounded-2xl overflow-hidden border border-white/10">
                <img 
                  src={selectedImageUrl} 
                  alt="Patient Dental Scan" 
                  className="max-h-[70vh] w-auto object-contain"
                />
              </div>
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setSelectedImageUrl(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-white/10 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

