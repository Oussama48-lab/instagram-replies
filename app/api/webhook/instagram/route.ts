import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type BotStatus = "BOT_ACTIVE" | "WAITING_FOR_DOCTOR" | "DOCTOR_REPLIED";

type MessageIntent =
  | "NEW_PHOTO"
  | "ASKING_QUESTION"
  | "YES_TO_BOOKING"
  | "NO_TO_BOOKING"
  | "GENERAL";

interface CustomerProfile {
  name:              string | null;
  first_name:        string | null;
  last_name:         string | null;
  phone:             string | null;
  has_photo:         boolean;
  last_dental_image: string | null;
  status:            BotStatus;
}

interface AIExtracted {
  reply:     string;
  extracted: {
    full_name:    string | null;
    phone:        string | null;
    booking_day:  string | null; // e.g. "Sun", "Mon"
    booking_time: string | null; // e.g. "11a", "3p"
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — single source of truth for slots, labels, model name
// ─────────────────────────────────────────────────────────────────────────────

// FIX: gemini-1.5-flash-latest returns 404 with some API keys.
// gemini-2.0-flash is the correct current model.
const GEMINI_MODEL = "gemini-flash-latest";

const DAY_LABEL: Record<string, string> = {
  Mon: "Lundi", Tue: "Mardi", Wed: "Mercredi",
  Thu: "Jeudi", Fri: "Vendredi", Sat: "Samedi", Sun: "Dimanche",
};

const TIME_LABEL: Record<string, string> = {
  "9a": "09h00", "11a": "11h00", "1p": "13h00",
  "3p": "15h00", "4p": "16h00", "5p": "17h00",
};

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─────────────────────────────────────────────────────────────────────────────
// INTENT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectIntent(text: string, imageUrl: string | null): MessageIntent {
  if (imageUrl) return "NEW_PHOTO";
  const t = text.toLowerCase().trim();
  if (!t) return "GENERAL";
  const QUESTION_PATTERNS = [
    /goli[a]?\s*b3da/, /\bchno\s*khass/, /\bwach\s*khass/, /\bkifash/,
    /\b3lash\b/, /\bchhal\b|\bch7al\b/, /\bprix\b|\bcombien\b/,
    /\bhow\s+much\b/, /\bwhat\s+(do|should|can)\b/, /\?/,
    /\bma3rftch\b|\bfahmtch\b/, /\bchno\s+hiya\b/, /\b(explain|tell me|goli)\b/,
  ];
  if (QUESTION_PATTERNS.some((p) => p.test(t))) return "ASKING_QUESTION";
  if (/\b(iyeh|ah\b|oui|yes|wakha|mashi\s*mochkil|bghit|agree|ok\b|okay)\b/.test(t)) return "YES_TO_BOOKING";
  if (/\b(la\b|non\b|no\b|ma\s*bghitch|machi\s*daba|later)\b/.test(t)) return "NO_TO_BOOKING";
  return "GENERAL";
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────

function extractPhoneFromText(text: string): string | null {
  const match = text.match(/(?:\+212|0)([ \-]?\d){9}/);
  return match ? match[0].replace(/[\s\-]/g, "") : null;
}

function extractDayFromText(text: string): string | null {
  const CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayIdx = new Date().getDay();
  const t = text.toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();

  if (/ba3d\s*ghda|ba3dghda/.test(t)) return CODES[(todayIdx + 2) % 7];
  if (/\bghda\b|\bghdda\b|\bdemain\b/.test(t)) return CODES[(todayIdx + 1) % 7];
  if (/\bhad\s+nhar\b|\blyoum\b/.test(t)) return CODES[todayIdx];

  const PATTERNS: Array<[RegExp, string]> = [
    [/(?:nhar\s*)?(?:l\s*)?(?:t[h]?nin|itnin|lundi|monday|\bmon\b)/, "Mon"],
    [/(?:nhar\s*)?(?:l\s*)?(?:t{1,2}\s*[ah]?lata|mardi|tuesday|\btue\b)/, "Tue"],
    [/(?:nhar\s*)?(?:l\s*)?(?:arb[a3ae]+|mercredi|wednesday|\bwed\b)/, "Wed"],
    [/(?:nhar\s*)?(?:l\s*)?(?:kh?[ae]mis|jeudi|thursday|\bthu\b)/, "Thu"],
    [/(?:nhar\s*)?(?:l\s*)?(?:j{1,2}\s*m[ae][ah]?|jum[au]3?[ah]?|vendredi|friday|\bfri\b)/, "Fri"],
    [/(?:nhar\s*)?(?:l\s*)?(?:s{1,2}\s*(?:[ae]?bt|abt|ebt)|samedi|saturday|\bsat\b)/, "Sat"],
    [/(?:nhar\s*)?(?:(?:l\s*)?(?:h[ae]d|7[ae]d|hd)|\bahad\b|dimanche|sunday|\bsun\b)/, "Sun"],
  ];
  for (const [regex, code] of PATTERNS) {
    if (regex.test(t)) return code;
  }
  return null;
}

function extractTimeFromText(text: string): string | null {
  const t = text.toLowerCase();
  const slangMatch = t.match(/\bl(\d{1,2})\b/);
  if (slangMatch) {
    const h = parseInt(slangMatch[1]);
    const map: Record<number, string> = { 1: "1p", 3: "3p", 4: "4p", 5: "5p", 9: "9a", 11: "11a" };
    if (map[h]) return map[h];
  }
  const m3aMatch = t.match(/m3a\s*(\d{1,2})/);
  if (m3aMatch) {
    const h = parseInt(m3aMatch[1]);
    const map: Record<number, string> = { 9: "9a", 11: "11a", 1: "1p", 13: "1p", 3: "3p", 15: "3p", 4: "4p", 16: "4p", 5: "5p", 17: "5p" };
    if (map[h]) return map[h];
  }
  const clockMatch = t.match(/\b(\d{1,2})(?:h|:00)\b/);
  if (clockMatch) {
    const h = parseInt(clockMatch[1]);
    const map: Record<number, string> = { 9: "9a", 11: "11a", 1: "1p", 13: "1p", 3: "3p", 15: "3p", 4: "4p", 16: "4p", 5: "5p", 17: "5p" };
    if (map[h]) return map[h];
  }
  for (const slot of ["9a", "11a", "1p", "3p", "4p", "5p"]) {
    if (t.includes(slot)) return slot;
  }
  return null;
}

const NOT_A_NAME = new Set([
  "salam", "mrhba", "wakha", "bghit", "iyeh", "la", "oui", "non", "ok", "okay",
  "merci", "chokran", "mzyan", "smah", "lia", "daba", "chwia", "inchallah",
  "rendez", "vous", "cabinet", "docteur", "tbib", "photo", "tswira", "hatif",
  "telephone", "smiytek", "smiti", "smiyti", "ismi", "esmi", "ana", "kifach",
  "wach", "chno", "chhal", "3afak", "afak", "bzaf", "bzzaf", "khoya", "lalla",
  "sidi", "sahbi", "sahba", "labas", "bikhir", "hamdullah", "bislama",
]);

function extractNameFromText(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 50) return null;
  const EXPLICIT = /^(?:smit[yi]|smiyti|ismi|esmi|je\s*m'?appelle|my\s*name\s*is)[\s:]+(.{3,40})$/i;
  const em = t.match(EXPLICIT);
  if (em?.[1]) return em[1].trim();
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (!/^[A-Za-zÀ-ÿ'\- ]{3,45}$/.test(t)) return null;
  if (/\d/.test(t)) return null;
  if (/[?!@#$%&*()+={}\[\]|<>]/.test(t)) return null;
  const lowerWords = words.map((w) => w.toLowerCase().replace(/['\\-]/g, ""));
  if (lowerWords.some((w) => NOT_A_NAME.has(w))) return null;
  if (words.length === 2 && lowerWords.every((w) => NOT_A_NAME.has(w))) return null;
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI WITH RETRY — handles 503 spikes gracefully
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(systemInstruction: string, userMessage: string, maxRetries = 3): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(userMessage);
      return result.response.text().trim();
    } catch (err: any) {
      const isRetryable = err?.status === 503 || err?.message?.includes("503");
      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 1500;
        console.warn(`[GEMINI] 503 attempt ${attempt}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Gemini: max retries exhausted");
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getAvailableSlots(): Promise<string> {
  const { data, error } = await supabase
    .from("appointment_slots")
    .select("day, time")
    .eq("status", "open")
    .eq("is_booked", false)
    .order("day").order("time");

  if (error || !data || data.length === 0) return "Aucun créneau disponible pour le moment.";

  const byDay: Record<string, string[]> = {};
  for (const slot of data) {
    if (!byDay[slot.day]) byDay[slot.day] = [];
    byDay[slot.day].push(TIME_LABEL[slot.time] ?? slot.time);
  }
  return DAY_ORDER
    .filter((d) => byDay[d])
    .map((d) => `• ${DAY_LABEL[d]}: ${byDay[d].join(", ")}`)
    .join("\n");
}

// Try to book a slot — returns the confirmation message or null if slot unavailable
async function bookSlot(day: string, time: string, senderId: string, patientName: string | null): Promise<string | null> {
  const { data: slot, error } = await supabase
    .from("appointment_slots")
    .select("id")
    .eq("day", day)
    .eq("time", time)
    .eq("status", "open")
    .eq("is_booked", false)
    .maybeSingle();

  if (error || !slot) return null; // slot not available

  const { error: updateError } = await supabase
    .from("appointment_slots")
    .update({
      status:         "confirmed",
      is_booked:      true,
      user_id:        senderId,
      booked_by_name: patientName ?? "",
      last_updated:   new Date().toISOString(),
    })
    .eq("id", slot.id);

  if (updateError) {
    console.error("[BOOKING] Update failed:", updateError.message);
    return null;
  }

  console.log(`[BOOKING] ✅ Booked ${day} ${time} for ${patientName} (${senderId})`);
  return `✅ Mzyan! Confermina lik rendez-vous nhar ${DAY_LABEL[day] ?? day} m3a ${TIME_LABEL[time] ?? time}. Ntsawro f-cabinet 😊`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — Instagram Webhook Verification
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === process.env.INSTAGRAM_VERIFY_TOKEN
  ) {
    return new Response(p.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — Main Webhook Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let senderId = "";

  try {
    const body      = await req.json();
    const messaging = body?.entry?.[0]?.messaging?.[0];

    if (!messaging || messaging.read) return new Response("OK", { status: 200 });

    // ── ECHO HANDLER ─────────────────────────────────────────────────────────
    // FIX: Only update to DOCTOR_REPLIED when bot is currently WAITING_FOR_DOCTOR.
    // Old code had no guard — every bot DM echoed back and reset state in a loop.
    if (messaging.message?.is_echo) {
      const customerId: string = messaging.recipient?.id ?? "";
      if (customerId) {
        const { data: updated } = await supabase
          .from("customers")
          .update({ status: "DOCTOR_REPLIED" })
          .eq("instagram_id", customerId)
          .eq("status", "WAITING_FOR_DOCTOR")
          .select("id");
        if (updated?.length) console.log(`[ECHO] Doctor replied to ${customerId} → DOCTOR_REPLIED`);
      }
      return new Response("OK", { status: 200 });
    }

    senderId = messaging.sender?.id ?? "";
    if (!senderId) return new Response("OK", { status: 200 });

    const messageId: string | undefined = messaging.message?.mid;
    const messageText: string           = messaging.message?.text ?? "";
    const attachments: any[]            = messaging.message?.attachments ?? [];
    const imageAttachment               = attachments.find((a) => a.type === "image");
    const audioAttachment               = attachments.find((a) => a.type === "audio");
    const imageUrl: string | null       = imageAttachment?.payload?.url ?? null;

    // ── GUARD: Audio ──────────────────────────────────────────────────────────
    if (audioAttachment) {
      await sendInstagramMessage(senderId, "Smahlia, momkin tkteb hit ma imkanich nssm3 l-audio daba 🙏");
      return new Response("OK", { status: 200 });
    }

    // ── GUARD: Deduplication ──────────────────────────────────────────────────
    if (messageId) {
      try {
        const { error: dupError } = await supabase.from("processed_messages").insert({ message_id: messageId });
        if (dupError?.code === "23505") return new Response("OK", { status: 200 });
      } catch { return new Response("OK", { status: 200 }); }
    }

    // ── STEP 1: Load profile ──────────────────────────────────────────────────
    const { data: rawProfile } = await supabase
      .from("customers")
      .select("name, first_name, last_name, phone, has_photo, last_dental_image, status")
      .eq("instagram_id", senderId)
      .maybeSingle();

    const profile: CustomerProfile = {
      name:              rawProfile?.name              ?? null,
      first_name:        rawProfile?.first_name        ?? null,
      last_name:         rawProfile?.last_name         ?? null,
      phone:             rawProfile?.phone             ?? null,
      has_photo:         rawProfile?.has_photo         ?? false,
      last_dental_image: rawProfile?.last_dental_image ?? null,
      status:            (rawProfile?.status as BotStatus) ?? "BOT_ACTIVE",
    };

    console.log(`[WEBHOOK] sender=${senderId} status=${profile.status}`);

    // ── GUARD: Waiting for doctor ─────────────────────────────────────────────
    if (profile.status === "WAITING_FOR_DOCTOR") {
      console.log(`[PAUSE] ${senderId} waiting for doctor. Silent.`);
      return new Response("OK", { status: 200 });
    }

    // ── CONTEXT: Doctor just replied ──────────────────────────────────────────
    const doctorJustReplied = profile.status === "DOCTOR_REPLIED";
    if (doctorJustReplied) {
      await supabase.from("customers").update({ status: "BOT_ACTIVE" }).eq("instagram_id", senderId);
      console.log(`[CONTEXT] Doctor replied → post-triage mode`);
    }

    // ── STEP 2: Extract from raw message ─────────────────────────────────────
    const intent      = detectIntent(messageText, imageUrl);
    const msgPhone    = extractPhoneFromText(messageText);
    const msgName     = extractNameFromText(messageText);
    const msgDay      = extractDayFromText(messageText);
    const msgTime     = extractTimeFromText(messageText);
    const mergedPhone = msgPhone ?? profile.phone;
    const mergedName  = msgName ?? (
      profile.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : profile.name
    );

    // ── STEP 3: Save photo if arrived ────────────────────────────────────────
    let savedImageUrl: string | null = null;
    if (imageUrl) {
      savedImageUrl = await saveDentalPhoto(imageUrl, senderId);
      if (!savedImageUrl) savedImageUrl = imageUrl;
    }

    const finalImage = savedImageUrl ?? profile.last_dental_image;
    const hasPhoto   = profile.has_photo || !!savedImageUrl;
    const hasName    = !!mergedName;
    const hasPhone   = !!mergedPhone;

    // ── STEP 4: Determine mode ────────────────────────────────────────────────
    const wasComplete  = !!((profile.name || profile.first_name) && profile.phone && profile.has_photo);
    const isPostTriage = wasComplete || doctorJustReplied;

    console.log(`[MODE] wasComplete=${wasComplete} isPostTriage=${isPostTriage} doctorJustReplied=${doctorJustReplied}`);

    // ── STEP 5: Missing triage items ─────────────────────────────────────────
    const missing: string[] = [];
    if (!hasName)  missing.push("nom complet");
    if (!hasPhone) missing.push("numéro de téléphone");
    if (!hasPhoto) missing.push("photo claire des dents");

    const infoStatus = [
      `Nom: ${hasName  ? `✓ (${mergedName})`  : "✗ MANQUANT"}`,
      `Tél: ${hasPhone ? `✓ (${mergedPhone})` : "✗ MANQUANT"}`,
      `Photo: ${hasPhoto ? "✓ REÇUE"          : "✗ MANQUANTE"}`,
    ].join(" | ");

    // ── STEP 6: Call AI ───────────────────────────────────────────────────────
    let aiReply       = "";
    let aiName:  string | null = null;
    let aiPhone: string | null = null;
    let aiDay:   string | null = null;
    let aiTime:  string | null = null;

    if (isPostTriage) {
      // ── POST-TRIAGE: normal conversation + booking ──────────────────────────
      const availableSlots = await getAvailableSlots();

      const eventCtx = doctorJustReplied
        ? `Le médecin vient de répondre. Premier message du patient: "${messageText || "(pas de texte)"}"`
        : `Message du patient: "${messageText || "(pas de texte)"}"`;

      const postTriagePrompt = `Tu es Nour, l'assistante professionnelle d'un cabinet dentaire marocain.
Tu réponds en Darija marocaine naturelle + français, comme parlent les Marocains.

DOSSIER PATIENT:
• Nom: ${mergedName ?? "inconnu"} | Tél: ${mergedPhone ?? "inconnu"}
• Statut: Consultation terminée ✅ — ${doctorJustReplied ? "médecin vient de répondre" : "médecin a déjà répondu"}

CRÉNEAUX DISPONIBLES (données réelles):
${availableSlots}

JOUR/HEURE MENTIONNÉS DANS CE MESSAGE (détectés automatiquement):
• Jour: ${msgDay ? (DAY_LABEL[msgDay] ?? msgDay) : "non détecté"}
• Heure: ${msgTime ? (TIME_LABEL[msgTime] ?? msgTime) : "non détectée"}

RÔLE:
• Répondre naturellement aux questions du patient
• Si le patient veut réserver: proposer des créneaux UNIQUEMENT depuis la liste ci-dessus
• Si le patient mentionne un jour ET une heure disponibles: confirme et indique que tu vas réserver
• Si le créneau demandé n'est pas dans la liste: dis poliment qu'il n'est pas disponible et propose des alternatives

RÈGLES:
• NE PAS redemander photo, nom, téléphone — déjà collectés ✅
• NE PAS inventer des disponibilités — utiliser UNIQUEMENT la liste ci-dessus
• MAX 3 phrases. Professionnel et chaleureux.

FORMAT JSON uniquement:
{
  "reply": "message en Darija",
  "extracted": {
    "full_name": null,
    "phone": null,
    "booking_day": "code du jour (Mon/Tue/Wed/Thu/Fri/Sat/Sun) ou null",
    "booking_time": "code heure (9a/11a/1p/3p/4p/5p) ou null"
  }
}`;

      try {
        const rawText = await callGemini(postTriagePrompt, eventCtx);
        const s = rawText.indexOf("{");
        const e = rawText.lastIndexOf("}");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed: AIExtracted = JSON.parse(rawText.substring(s, e + 1));
        aiReply = parsed.reply?.trim() ?? "";
        aiDay   = parsed.extracted?.booking_day?.trim()  || null;
        aiTime  = parsed.extracted?.booking_time?.trim() || null;
      } catch (err) {
        console.error("[AI POST-TRIAGE ERROR]:", err);
        aiReply = "Smahlia chwia, kayn chi 3otla sa3a. Rja3 liya men ba3d dqiqa 🙏";
      }

    } else {
      // ── TRIAGE MODE ─────────────────────────────────────────────────────────
      let eventDescription: string;
      switch (intent) {
        case "NEW_PHOTO":
          eventDescription = missing.length === 0
            ? `[PHOTO REÇUE. Triage complet. Informe le patient que le médecin va l'examiner et le contacter.]`
            : `[PHOTO REÇUE${messageText ? ` caption: "${messageText}"` : ""}. Remercie chaleureusement. Demande UNE SEULE chose: "${missing[0]}". Ne demande pas encore: ${missing.slice(1).join(", ") || "rien d'autre"}.]`;
          break;
        case "ASKING_QUESTION":
          eventDescription = `[QUESTION]: "${messageText}"\nRéponds D'ABORD. ${missing.length > 0 ? `Ensuite demande UNE SEULE chose: "${missing[0]}".` : "Tout est complet."}`;
          break;
        default:
          eventDescription = missing.length > 0
            ? `Message: "${messageText || "(vide)"}"\nProchaine info: "${missing[0]}". Ne demande PAS: ${missing.slice(1).join(", ") || "rien"}.`
            : `Message: "${messageText || "(vide)"}". Triage complet — confirme que le médecin va contacter le patient.`;
      }

      const triagePrompt = `Tu es Nour, assistante d'un cabinet dentaire marocain. Darija naturelle + français.
STYLE: Chaleureux, MAX 2 phrases, emojis modérés 😊 🙏
OBJECTIF: Collecter 1) Photo dents 2) Nom complet 3) Téléphone
ÉTAT: ${infoStatus}
RÈGLES: Réponds d'abord aux questions. Un seul élément par message. Ne redemande jamais ce qui est coché (✓).
Tarifs: Détartrage 300DH | Plombage 400DH | Extraction 200DH | Blanchiment 500DH.
FORMAT JSON: {"reply":"...","extracted":{"full_name":"...","phone":"...","booking_day":null,"booking_time":null}}`;

      try {
        const rawText = await callGemini(triagePrompt, eventDescription);
        const s = rawText.indexOf("{");
        const e = rawText.lastIndexOf("}");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed: AIExtracted = JSON.parse(rawText.substring(s, e + 1));
        aiReply = parsed.reply?.trim() ?? "";
        aiName  = parsed.extracted?.full_name?.trim()  || null;
        aiPhone = parsed.extracted?.phone?.trim()      || null;
      } catch (err) {
        console.error("[AI TRIAGE ERROR]:", err);
        aiReply = "Smahlia chwia, kayn chi 3otla sa3a. Rja3 liya men ba3d dqiqa 🙏";
      }
    }

    // ── STEP 7: Merge extracted data ──────────────────────────────────────────
    let finalName:      string | null = profile.name       ?? null;
    let finalFirstName: string | null = profile.first_name ?? null;
    let finalLastName:  string | null = profile.last_name  ?? null;

    const nameToUse = mergedName || aiName;
    if (nameToUse && !(profile.name || profile.first_name)) {
      finalName = nameToUse;
      const parts    = finalName.split(/\s+/);
      finalFirstName = parts[0]                 ?? null;
      finalLastName  = parts.slice(1).join(" ") || null;
    }

    const finalPhone = mergedPhone ?? aiPhone ?? null;

    // Day/time: message text wins over AI extracted (regex is more reliable)
    const finalDay  = msgDay  ?? aiDay  ?? null;
    const finalTime = msgTime ?? aiTime ?? null;

    // ── STEP 8: Re-check triage completion ───────────────────────────────────
    const isNowComplete = !!((finalName || finalFirstName) && finalPhone && (hasPhoto || !!finalImage));

    // ── STEP 9: Decide reply + status ─────────────────────────────────────────
    let replyText:   string;
    let finalStatus: BotStatus = doctorJustReplied ? "BOT_ACTIVE" : profile.status;

    if (isNowComplete && !wasComplete && !isPostTriage) {
      // Triage just completed → hand off, go silent
      replyText   = "Mzyan bzaf! L-médecin ghadi ichouf dossier dyalk w ghadi icontactik daba chwya 😊 Chokran 3la thiqa!";
      finalStatus = "WAITING_FOR_DOCTOR";
      console.log(`[HANDOFF] ${senderId} → WAITING_FOR_DOCTOR`);

    } else if (isPostTriage && finalDay && finalTime) {
      // ── BOOKING ATTEMPT ────────────────────────────────────────────────────
      // Patient mentioned a day + time in post-triage mode → try to book it
      const bookingResult = await bookSlot(finalDay, finalTime, senderId, finalName);
      if (bookingResult) {
        replyText = bookingResult;
        console.log(`[BOOKING] Confirmed: ${finalDay} ${finalTime} for ${senderId}`);
      } else {
        // Slot not available — get fresh list and offer alternatives
        const freshSlots = await getAvailableSlots();
        replyText = `Smahlia, nhar ${DAY_LABEL[finalDay] ?? finalDay} m3a ${TIME_LABEL[finalTime] ?? finalTime} machi disponible. Créneaux disponibles:\n${freshSlots}`;
        console.log(`[BOOKING] Slot ${finalDay} ${finalTime} unavailable for ${senderId}`);
      }

    } else {
      replyText = aiReply || "Smahlia, ma fhamtch mezian 🙏 Mn fadlak 3awd rassil liya?";
    }

    // ── STEP 10: Atomic DB write ──────────────────────────────────────────────
    const upsertPayload: Record<string, unknown> = {
      instagram_id: senderId,
      has_photo:    hasPhoto || !!finalImage,
      status:       finalStatus,
      last_seen_at: new Date().toISOString(),
    };

    if (finalName      !== null) upsertPayload.name        = finalName;
    if (finalFirstName !== null) upsertPayload.first_name  = finalFirstName;
    if (finalLastName  !== null) upsertPayload.last_name   = finalLastName;
    if (finalPhone     !== null) upsertPayload.phone       = finalPhone;
    if (finalImage     !== null) upsertPayload.last_dental_image = finalImage;

    const { error: upsertError } = await supabase
      .from("customers")
      .upsert(upsertPayload, { onConflict: "instagram_id" });

    if (upsertError) console.error("[DB UPSERT ERROR]:", upsertError.message);

    // ── STEP 11: Sanity check ─────────────────────────────────────────────────
    if (!replyText || replyText.toLowerCase().includes("null")) {
      replyText = "Smahlia, ma fhamtch mezian 🙏 Kifach n9drw n3awnek?";
    }

    await sendInstagramMessage(senderId, replyText);
    return new Response("OK", { status: 200 });

  } catch (crashErr) {
    console.error("[CRASH]:", crashErr);
    if (senderId) await sendInstagramMessage(senderId, "Smahlia, kayn chi 3otla teknik daba 🙏 Rja3 liya men ba3d chwia.");
    return new Response("OK", { status: 200 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE DENTAL PHOTO
// ─────────────────────────────────────────────────────────────────────────────

async function saveDentalPhoto(instagramUrl: string, senderId: string): Promise<string | null> {
  try {
    const res = await fetch(instagramUrl);
    if (!res.ok) { console.error(`[PHOTO] CDN fetch failed: ${res.status}`); return null; }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext    = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = await res.arrayBuffer();
    const path   = `${senderId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("dental-images").upload(path, buffer, { contentType, upsert: false });
    if (error) { console.error("[PHOTO] Upload failed:", error.message); return null; }
    const { data: urlData } = supabase.storage.from("dental-images").getPublicUrl(path);
    console.log(`[PHOTO] Saved: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) { console.error("[PHOTO] Exception:", err); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEND INSTAGRAM DM
// ─────────────────────────────────────────────────────────────────────────────

async function sendInstagramMessage(recipientId: string, text: string): Promise<void> {
  if (!recipientId || !text) return;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      }
    );
    const json = await res.json();
    if (!res.ok) console.error("[DM ERROR]:", JSON.stringify(json));
    else console.log(`[DM SENT] to=${recipientId} | "${text.substring(0, 80)}"`);
  } catch (err) { console.error("[DM FETCH ERROR]:", err); }
}