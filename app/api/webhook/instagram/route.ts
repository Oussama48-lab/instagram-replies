import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type BotStatus =
  | "BOT_ACTIVE"
  | "WAITING_FOR_CONSENT"
  | "WAITING_FOR_DOCTOR"
  | "DOCTOR_REPLIED"
  | "ARCHIVED"
  | "WAITING_FOR_APPOINTMENT_INTENT";

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
  reply: string;
  extracted: {
    full_name:    string | null;
    phone:        string | null;
    booking_day:  string | null;
    booking_time: string | null;
  };
}

interface TriageSession {
  name:              string | null;
  phone:             string | null;
  photo_url:         string | null;
  biz_id:            number | null;
  photo_requested:   boolean;
  last_photo_ask_at: string | null;
}

const DAY_LABEL: Record<string, string> = {
  Mon: "Lundi", Tue: "Mardi", Wed: "Mercredi",
  Thu: "Jeudi", Fri: "Vendredi", Sat: "Samedi", Sun: "Dimanche",
};

const TIME_LABEL: Record<string, string> = {
  "9a":  "09h00",
  "10a": "10h00",
  "11a": "11h00",
  "12p": "12h00",
  "1p":  "13h00",
  "2p":  "14h00",
  "3p":  "15h00",
  "4p":  "16h00",
  "5p":  "17h00",
  "6p":  "18h00",
  "7p":  "19h00",
  "8p":  "20h00",
  "9p":  "21h00",
  "10p": "22h00",
};

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const recentlyProcessed = new Set<string>();
const recentlySentReplies = new Map<string, { text: string; at: number }>();

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE
// ─────────────────────────────────────────────────────────────────────────────

function extractImageUrl(attachments: any[]): string | null {
  if (!attachments || attachments.length === 0) return null;
  for (const att of attachments) {
    if (att.type === "image" && att.payload?.url) return att.payload.url;
    if (att.type === "image" && att.image_data?.url) return att.image_data.url;
    if (att.payload?.url) return att.payload.url;
    if (att.url) return att.url;
  }
  return null;
}

async function fetchImageUrlFromGraphAPI(
  messageId: string,
  pageAccessToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${messageId}?fields=message,attachments&access_token=${pageAccessToken}`
    );
    const data = await res.json();
    console.log("[GRAPH API]", res.status, JSON.stringify(data));
    if (!res.ok) return null;
    const atts = data?.attachments?.data ?? data?.attachments ?? [];
    for (const att of atts) {
      const url =
        att?.image_data?.url ??
        att?.payload?.url ??
        att?.file_url ??
        att?.url ??
        null;
      if (url) return url;
    }
    return data?.image_data?.url ?? data?.url ?? null;
  } catch (err) {
    console.error("[GRAPH API] Exception:", err);
    return null;
  }
}

async function saveDentalPhoto(
  instagramUrl: string,
  senderId: string,
  pageAccessToken: string
): Promise<string | null> {
  try {
    const H = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "image/*,*/*",
    };
    let res = await fetch(instagramUrl, { headers: H });
    if (!res.ok && pageAccessToken) {
      const u = instagramUrl.includes("?")
        ? `${instagramUrl}&access_token=${pageAccessToken}`
        : `${instagramUrl}?access_token=${pageAccessToken}`;
      res = await fetch(u, { headers: H });
    }
    if (!res.ok) {
      console.error(`[PHOTO] fetch failed: ${res.status}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    if (!buffer || buffer.byteLength < 1000) {
      console.error(`[PHOTO] invalid buffer: ${buffer?.byteLength} bytes`);
      return null;
    }
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/") && !ct.includes("octet-stream")) {
      console.error(`[PHOTO] bad content-type: ${ct}`);
      return null;
    }
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const path = `patients/${senderId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("dental-images")
      .upload(path, buffer, { contentType: ct, upsert: true });
    if (error) {
      console.error("[PHOTO] upload failed:", error.message);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from("dental-images")
      .getPublicUrl(path);
    console.log(`[PHOTO] Saved: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error("[PHOTO] Exception:", err);
    return null;
  }
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
  const t = text
    .toLowerCase()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const sm = t.match(/\bl(\d{1,2})\b/);
  if (sm) {
    const h = parseInt(sm[1]);
    const m: Record<number, string> = { 1: "1p", 3: "3p", 4: "4p", 5: "5p", 9: "9a", 11: "11a" };
    if (m[h]) return m[h];
  }
  const m3 = t.match(/m3a\s*(\d{1,2})/);
  if (m3) {
    const h = parseInt(m3[1]);
    const m: Record<number, string> = { 9: "9a", 11: "11a", 1: "1p", 13: "1p", 3: "3p", 15: "3p", 4: "4p", 16: "4p", 5: "5p", 17: "5p" };
    if (m[h]) return m[h];
  }
  const cm = t.match(/\b(\d{1,2})(?:h|:00)\b/);
  if (cm) {
    const h = parseInt(cm[1]);
    const m: Record<number, string> = { 9: "9a", 11: "11a", 1: "1p", 13: "1p", 3: "3p", 15: "3p", 4: "4p", 16: "4p", 5: "5p", 17: "5p" };
    if (m[h]) return m[h];
  }
  for (const slot of ["9a", "11a", "1p", "3p", "4p", "5p"]) {
    if (t.includes(slot)) return slot;
  }
  return null;
}

function extractNameFromText(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 50) return null;
  const AFF =
    /^(bien\s*sur|d'?accord|ok|okay|oui|yes|wakha|iyeh|ah|mashi|ewa|yah|ouais|parfait|super|merci|noted|ayeh|marhba|salam|inchallah|hamdullah|labas|bikhir)(\s.*)?$/i;
  if (AFF.test(t)) return null;
  const EXPLICIT =
    /^(?:s+miyti|smit[yi]|smiyti|ismi|esmi|je\s*m'?appelle|my\s*name\s*is|اسمي|سميتي)[\s:]+(.{3,40})$/i;
  const em = t.match(EXPLICIT);
  if (em?.[1]) return em[1].trim();
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (!/^[A-Za-zÀ-ÿ'\-؀-ۿ ]{3,45}$/.test(t)) return null;
  if (/\d/.test(t)) return null;
  if (/[?!@#$%&*()+={}\[\]|<>]/.test(t)) return null;
  const NOT_A_NAME = new Set([
    "salam","mrhba","wakha","bghit","iyeh","la","oui","non","ok","okay",
    "merci","chokran","mzyan","smah","lia","daba","chwia","inchallah",
    "rendez","vous","cabinet","docteur","tbib","photo","tswira","hatif",
    "telephone","smiytek","smiti","smiyti","ismi","esmi","ana","kifach",
    "wach","chno","chhal","3afak","afak","bzaf","bzzaf","khoya","lalla",
    "sidi","sahbi","sahba","labas","bikhir","hamdullah","bislama",
    "bien","sur","daccord","parfait","super","thanks","noted","recu",
    "compris","mashi","mochkil","walo","lah","ewa","ah","yah","yeh",
    "ouais","voila","exact","correcte","ayeh","marhba","ahlen",
  ]);
  const lw = words.map((w) => w.toLowerCase().replace(/['\\-]/g, ""));
  if (lw.some((w) => NOT_A_NAME.has(w))) return null;
  if (words.length === 2 && lw.every((w) => NOT_A_NAME.has(w))) return null;
  return t;
}

function isValidHumanName(name: string): boolean {
  if (!name || name.trim().length < 4) return false;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  if (!/^[A-Za-zÀ-ÿ\s'\-؀-ۿ]+$/.test(name)) return false;
  const BAD =
    /^(ayeh|iyeh|marhba|ahlen|salam|wakha|oui|yes|ok|okay|ewa|bien|sur|merci|chokran|inchallah|hamdullah|labas|bikhir|parfait|super|noted|daccord|ouais|exact|waw|na3am|ah\b)/i;
  if (BAD.test(name.trim())) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE
// ─────────────────────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string): Promise<string> {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system,
    messages: [{ role: "user", content: user }],
  });
  const c = r.content[0];
  if (c.type !== "text") throw new Error("Unexpected response type");
  return c.text.trim();
}

async function callClaudeHaiku(system: string, user: string): Promise<string> {
  const r = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system,
    messages: [{ role: "user", content: user }],
  });
  const c = r.content[0];
  if (c.type !== "text") throw new Error("Unexpected response type");
  return c.text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOTS
// ─────────────────────────────────────────────────────────────────────────────

async function getAvailableSlots(): Promise<string> {
  const { data, error } = await supabase
    .from("appointment_slots")
    .select("day, time")
    .eq("status", "open")
    .eq("is_booked", false)
    .order("day")
    .order("time");
  if (error || !data || data.length === 0) return "Aucun créneau disponible.";
  const byDay: Record<string, string[]> = {};
  for (const slot of data) {
    if (!byDay[slot.day]) byDay[slot.day] = [];
    byDay[slot.day].push(TIME_LABEL[slot.time] ?? slot.time);
  }
  return DAY_ORDER.filter((d) => byDay[d])
    .map((d) => `• ${DAY_LABEL[d]}: ${byDay[d].join(", ")}`)
    .join("\n");
}

async function bookSlot(
  day: string,
  time: string,
  senderId: string,
  patientName: string | null
): Promise<string | null> {
  const { data: slot, error } = await supabase
    .from("appointment_slots")
    .select("id")
    .eq("day", day)
    .eq("time", time)
    .eq("status", "open")
    .eq("is_booked", false)
    .maybeSingle();
  if (error || !slot) return null;
  const { error: ue } = await supabase
    .from("appointment_slots")
    .update({
      status: "confirmed",
      is_booked: true,
      user_id: senderId,
      booked_by_name: patientName ?? "",
      last_updated: new Date().toISOString(),
    })
    .eq("id", slot.id);
  if (ue) {
    console.error("[BOOKING] failed:", ue.message);
    return null;
  }
  console.log(`[BOOKING] ✅ ${day} ${time} for ${patientName}`);
  return `✅ Mzyan! Confermina lik rendez-vous nhar ${DAY_LABEL[day] ?? day} m3a ${TIME_LABEL[time] ?? time}. nchofok f-cabinet nchallah 😊`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function sendDM(
  recipientId: string,
  text: string,
  token: string
): Promise<void> {
  if (!recipientId || !text || !token) {
    console.error("[DM] Missing params");
    return;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      }
    );
    const json = await res.json();
    if (!res.ok) console.error("[DM ERROR]:", JSON.stringify(json));
    else console.log(`[DM SENT] "${text.substring(0, 80)}"`);
  } catch (err) {
    console.error("[DM FETCH ERROR]:", err);
  }
}

async function saveMsgHistory(
  senderId: string,
  msgText: string,
  replyText: string,
  bizId: number | null
) {
  await supabase.from("customer_messages").insert({
    customer_id: senderId,
    message_text: msgText,
    reply_text: replyText,
    reply_sent: true,
    timestamp: new Date(),
    business_owner_id: bizId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION (Supabase-backed — works on Vercel serverless)
// ─────────────────────────────────────────────────────────────────────────────

async function getSession(instagramId: string): Promise<TriageSession | null> {
  const { data } = await supabase
    .from("triage_sessions")
    .select("name, phone, photo_url, biz_id, photo_requested, last_photo_ask_at")
    .eq("instagram_id", instagramId)
    .maybeSingle();
  return data ?? null;
}

async function setSession(
  instagramId: string,
  data: {
    name?: string | null;
    phone?: string | null;
    photoUrl?: string | null;
    bizId?: number | null;
    photoRequested?: boolean;
    lastPhotoAskAt?: string | null;
  }
) {
  const payload: Record<string, unknown> = {
    instagram_id: instagramId,
    updated_at:   new Date().toISOString(),
  };
  if (data.name           !== undefined) payload.name              = data.name;
  if (data.phone          !== undefined) payload.phone             = data.phone;
  if (data.photoUrl       !== undefined) payload.photo_url         = data.photoUrl;
  if (data.bizId          !== undefined) payload.biz_id            = data.bizId;
  if (data.photoRequested !== undefined) payload.photo_requested   = data.photoRequested;
  if (data.lastPhotoAskAt !== undefined) payload.last_photo_ask_at = data.lastPhotoAskAt;

  console.log('[SESSION] Attempting upsert:', JSON.stringify(payload));

  const { error } = await supabase
    .from("triage_sessions")
    .upsert(payload, { onConflict: "instagram_id" });

  if (error) {
    console.error("[SESSION] setSession FAILED:", error.message, error.code, error.details);
  } else {
    console.log("[SESSION] upsert SUCCESS for:", instagramId);
  }
}

async function deleteSession(instagramId: string) {
  await supabase.from("triage_sessions").delete().eq("instagram_id", instagramId);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — Webhook verification
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
// POST — Main webhook handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let senderId = "";
  let messageSent = false;

  try {
    const body = await req.json();
    const messaging = body?.entry?.[0]?.messaging?.[0];
    if (!messaging || messaging.read) return new Response("OK", { status: 200 });

    // ── BUSINESS OWNER ──────────────────────────────────────────────────────
    const recipientId = messaging.recipient?.id ?? "";
    const { data: bizOwner } = await supabase
      .from("buisness_owner")
      .select("id, page_access_token, instagram_id")
      .eq("instagram_id", recipientId)
      .maybeSingle();
    const token = bizOwner?.page_access_token ?? "";
    const bizId = bizOwner?.id ?? null;

    // ── ECHO ────────────────────────────────────────────────────────────────
    if (messaging.message?.is_echo) {
      console.log(`[ECHO] Ignored — status changes only happen via dashboard`);
      return new Response("OK", { status: 200 });
    }

    senderId = messaging.sender?.id ?? "";
    if (!senderId) return new Response("OK", { status: 200 });

    const messageId: string | undefined = messaging.message?.mid;
    const messageText: string = messaging.message?.text ?? "";
    const attachments: any[] = messaging.message?.attachments ?? [];

    if (attachments.length > 0)
      console.log("[ATTACHMENTS]", JSON.stringify(attachments));

    const audioAttachment = attachments.find((a) => a.type === "audio");
    const hasEphemeral = attachments.some((a) => a.type === "ephemeral");
    let imageUrl: string | null = extractImageUrl(attachments);

    // Ephemeral → ask to resend from gallery
    if (hasEphemeral) {
      await sendDM(
        senderId,
        "afak ssiftlina tsswira dyal snank ila kan momkin , 3la limen dyal chacha dyalk atbanlik gallerie clicki eliha o sift tsswira men tema 😊",
        token
      );
      return new Response("OK", { status: 200 });
    }

    // Audio
    if (audioAttachment) {
      await sendDM(
        senderId,
        "Smahlia, momkin tkteb hit ma imkanich nssm3 l-audio daba 🙏",
        token
      );
      return new Response("OK", { status: 200 });
    }

    // Try Graph API for image
    if (!imageUrl && attachments.length > 0 && messageId && token) {
      const graphUrl = await fetchImageUrlFromGraphAPI(messageId, token);
      if (graphUrl) imageUrl = graphUrl;
    }

    if (imageUrl) console.log("[IMAGE URL FOUND]:", imageUrl.substring(0, 80));

    // ── DEDUPLICATION — by messageId AND by content+time ─────────────────────
    if (messageId) {
      if (recentlyProcessed.has(messageId)) {
        console.log('[DEDUP] In-memory skip:', messageId);
        return new Response("OK", { status: 200 });
      }
      recentlyProcessed.add(messageId);
      setTimeout(() => recentlyProcessed.delete(messageId), 30000);
      try {
        const { error: de } = await supabase
          .from("processed_messages")
          .insert({ message_id: messageId });
        if (de?.code === "23505") {
          console.log('[DEDUP] DB skip:', messageId);
          return new Response("OK", { status: 200 });
        }
      } catch {
        return new Response("OK", { status: 200 });
      }
    }

    // Secondary dedup: same sender + same text/image within 10 seconds
    const contentToCheck = messageText || (imageUrl ? "[image]" : "");
    if (contentToCheck) {
      const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
      const { data: recentDup } = await supabase
        .from("customer_messages")
        .select("id")
        .eq("customer_id", senderId)
        .eq("message_text", contentToCheck)
        .gte("timestamp", tenSecondsAgo)
        .maybeSingle();

      if (recentDup) {
        console.log('[DEDUP] Content+time duplicate — skipping:', contentToCheck);
        return new Response("OK", { status: 200 });
      }
    }

    // ── PRE-LOAD STATUS — needed to decide whether to buffer ─────────────────
    const { data: statusRow } = await supabase
      .from("customers")
      .select("status")
      .eq("instagram_id", senderId)
      .maybeSingle();
    const currentStatus = statusRow?.status as BotStatus | null;

    if (currentStatus === "WAITING_FOR_DOCTOR" || currentStatus === "ARCHIVED") {
      console.log(`[EARLY EXIT] Status ${currentStatus} — silent.`);
      return new Response("OK", { status: 200 });
    }

    // These statuses need immediate handling — never buffer them
    const bypassBuffer =
      currentStatus === "WAITING_FOR_CONSENT" ||
      currentStatus === "WAITING_FOR_APPOINTMENT_INTENT" ||
      currentStatus === "WAITING_FOR_DOCTOR" ||
      currentStatus === "ARCHIVED";

    // ── TYPING WINDOW ────────────────────────────────────────────────────────
    // Insert AFTER deduplication — only non-duplicate messages enter the buffer
    if (messageText || imageUrl) {
      await supabase.from("pending_messages").insert({
        instagram_id: senderId,
        message_text: messageText || (imageUrl ? "[image]" : ""),
        message_id: messageId ?? null,
        processed: false,
      });
    }

    // Only look at messages from the last 10 seconds
    const windowStart = new Date(Date.now() - 10000).toISOString();

    const { data: pendingMsgs } = await supabase
      .from("pending_messages")
      .select("id, message_text, created_at")
      .eq("instagram_id", senderId)
      .eq("processed", false)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true });

    const firstTime = pendingMsgs?.[0]?.created_at
      ? new Date(pendingMsgs[0].created_at)
      : new Date();
    const secondsWaited = (Date.now() - firstTime.getTime()) / 1000;

    // Only buffer if there are MULTIPLE messages being sent rapidly
    // Single messages are processed immediately
    // Multiple messages within 8s are batched together
    const messageCount = pendingMsgs?.length ?? 0;

    if (!bypassBuffer && messageCount > 1 && secondsWaited < 8) {
      console.log(
        `[WINDOW] Buffering ${Math.round(8 - secondsWaited)}s left. Count: ${messageCount}`
      );
      return new Response("OK", { status: 200 });
    }

    // Mark all as processed
    await supabase
      .from("pending_messages")
      .update({ processed: true })
      .eq("instagram_id", senderId)
      .eq("processed", false);

    // Clean up old messages older than 5 minutes
    await supabase
      .from("pending_messages")
      .delete()
      .eq("instagram_id", senderId)
      .lt("created_at", new Date(Date.now() - 300000).toISOString());

    if (!pendingMsgs || pendingMsgs.length === 0) {
      console.log("[WINDOW] No pending messages — skipping");
      return new Response("OK", { status: 200 });
    }

    const allPendingText = (pendingMsgs ?? [])
      .map((m: any) => m.message_text)
      .filter((m: any) => m && m !== "[image]")
      .join(" | ");
    const hasImageInPending = (pendingMsgs ?? []).some(
      (m: any) => m.message_text === "[image]"
    );
    const combinedText = allPendingText || messageText;

    console.log(
      `[WINDOW] Processing ${pendingMsgs?.length} msgs: "${allPendingText}"`
    );

    // ── LOAD PROFILE ─────────────────────────────────────────────────────────
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

    // ── WELCOME ──────────────────────────────────────────────────────────────
    if (!rawProfile) {
      const intentPrompt = `A patient just sent their first message to a dental clinic Instagram account.

Analyse their message and respond with JSON only:
{
  "intent": "PRICE_ONLY" or "WANTS_APPOINTMENT" or "GENERAL_INTEREST",
  "reply": "your natural Darija response"
}

PRICE_ONLY = they only ask about price/cost with no booking interest (ch7al, combien, prix, tarif, ch7al kaytswab)
WANTS_APPOINTMENT = they want to book, have a dental problem, say salam/mrhba showing they want help
GENERAL_INTEREST = anything else — treat as interested

If PRICE_ONLY: answer price in Darija, then add: "ila bghiti dir rdv tbib ghay3ytlik 😊"
If WANTS_APPOINTMENT or GENERAL_INTEREST: reply = "" — welcome message handles it

Prices: Détartrage 300DH | Plombage 400DH | Extraction 200DH | Blanchiment 500DH

Patient message: "${combinedText || messageText}"`;

      try {
        const intentRaw = await callClaudeHaiku(
          intentPrompt,
          combinedText || messageText || ""
        );
        const is = intentRaw.indexOf("{");
        const ie = intentRaw.lastIndexOf("}");
        const intentParsed = JSON.parse(intentRaw.substring(is, ie + 1));
        if (intentParsed.intent === "PRICE_ONLY") {
          console.log("[INTENT] Price-only — not saving to DB");
          await sendDM(senderId, intentParsed.reply, token);
          return new Response("OK", { status: 200 });
        }
      } catch (err) {
        console.error("[INTENT] Error:", err);
      }

      const welcomeMsg = `Salam 😊 Mrhba bik f cabinet dyalna!\n\nGhadi nsswlok 3 ass2ila bssita bach nakhdo les infos li khassina — ghadi takhod ghir dqiqa mn we9tk.\n\nMn ba3d, tbib ghay3ytlik b appel bach dir consultation gratuite`;
      const { error: insertErr } = await supabase.from("customers").insert({
        instagram_id:      senderId,
        status:            "WAITING_FOR_CONSENT",
        has_photo:         false,
        intent:            "interested",
        last_seen_at:      new Date().toISOString(),
        business_owner_id: bizId,
      });
      if (insertErr) {
        console.error("[WELCOME] Insert failed:", insertErr.message);
        const { data: ex } = await supabase
          .from("customers")
          .select("status")
          .eq("instagram_id", senderId)
          .maybeSingle();
        if (!ex) {
          console.error("[WELCOME] Cannot create row");
          return new Response("OK", { status: 200 });
        }
      } else {
        await sendDM(senderId, welcomeMsg, token);
        await saveMsgHistory(
          senderId,
          combinedText || "(first message)",
          welcomeMsg,
          bizId
        );
        console.log("[WELCOME] Sent to:", senderId);
        return new Response("OK", { status: 200 });
      }
    }

    // ── STATUS GUARDS ────────────────────────────────────────────────────────
    if (profile.status === "WAITING_FOR_DOCTOR" || currentStatus === "WAITING_FOR_DOCTOR") {
      console.log(`[PAUSE] WAITING_FOR_DOCTOR — completely silent.`);
      return new Response("OK", { status: 200 });
    }
    if (profile.status === "ARCHIVED") {
      console.log(`[ARCHIVED] Silent.`);
      return new Response("OK", { status: 200 });
    }

    // ── APPOINTMENT INTENT ───────────────────────────────────────────────────
    if (profile.status === "WAITING_FOR_APPOINTMENT_INTENT") {
      const intentPrompt = `The patient was asked if they want to book an appointment soon or just wanted info.
Question: "wach baghi ta5ed chi rendez fhad l ayam ola bghit t3ref ghi latmina?"

JSON only: { "intent": "YES" or "NO" or "UNCLEAR" }

YES = iyeh, wakha, bghit, oui, yes, ewa, daba, fhad layam, bghit ndir, mzyan, yallah, ah, waw
NO = la, non, mazal, machi daba, bghit t3ref ghi, latmina, later, mabaghitch, machi
UNCLEAR = anything else → treat as YES

Patient reply: "${combinedText || messageText}"`;

      try {
        const raw = await callClaudeHaiku(
          intentPrompt,
          combinedText || messageText || ""
        );
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        const parsed = JSON.parse(raw.substring(s, e + 1));

        if (parsed.intent === "NO") {
          const priceMsg = `واخا مشكيل 😊 هادي لأسعار ديالنا:

🦷 détartrage (تنظيف الأسنان): 300 درهم
🔧 plombage (حشو): 400 درهم
🦷 extraction (خلع): 200 درهم
✨ blanchiment (تبييض): 500 درهم
📞 consultation: مجانية بتيليفون مع الطبيب

إلا بغيتي تدير رونديفو في أي وقت، هنا كاينين 😊`;
          await sendDM(senderId, priceMsg, token);
          await supabase.from("customer_messages").delete().eq("customer_id", senderId);
          await supabase.from("pending_messages").delete().eq("instagram_id", senderId);
          await supabase.from("customers").delete().eq("instagram_id", senderId);
          await deleteSession(senderId);
          console.log("[SESSION] Deleted — sent price list");
          return new Response("OK", { status: 200 });
        } else {
          const apptSession = await getSession(senderId);
          if (apptSession) {
            await supabase.from("customers").upsert(
              {
                instagram_id:      senderId,
                name:              apptSession.name,
                first_name:        apptSession.name?.split(" ")[0] ?? null,
                last_name:         apptSession.name?.split(" ").slice(1).join(" ") || null,
                phone:             apptSession.phone,
                has_photo:         !!apptSession.photo_url,
                last_dental_image: apptSession.photo_url,
                status:            "WAITING_FOR_DOCTOR",
                last_seen_at:      new Date().toISOString(),
                business_owner_id: apptSession.biz_id,
              },
              { onConflict: "instagram_id" }
            );
            await deleteSession(senderId);
            console.log("[SESSION] Committed to DB");
          } else {
            await supabase
              .from("customers")
              .update({ status: "WAITING_FOR_DOCTOR" })
              .eq("instagram_id", senderId);
          }
          const bookMsg = "Tbib ghaychof dossier dyalk o ghaycontactik daba chwya 😊";
          await sendDM(senderId, bookMsg, token);
          await saveMsgHistory(
            senderId,
            combinedText || messageText || "",
            bookMsg,
            bizId
          );
          return new Response("OK", { status: 200 });
        }
      } catch (err) {
        console.error("[APPOINTMENT INTENT] Error:", err);
        const bookMsg = "Tbib ghaychof dossier dyalk o ghaycontactik daba chwya 😊";
        await sendDM(senderId, bookMsg, token);
        await supabase
          .from("customers")
          .update({ status: "WAITING_FOR_DOCTOR" })
          .eq("instagram_id", senderId);
        return new Response("OK", { status: 200 });
      }
    }

    // ── CONSENT ──────────────────────────────────────────────────────────────
    if (profile.status === "WAITING_FOR_CONSENT") {
      const consentPrompt = `Analyse a reply from a patient who received a dental clinic welcome message.

JSON only: { "intent": "YES" or "NO" or "UNCLEAR" }

YES = wakha, ewa, ayeh, oui, ok, mrhba, inchallah, mzyan, waw, sure, yes, d'accord, parfait
NO = la, non, no, mabghitch, machi, later, machi daba
UNCLEAR = anything else

Patient message: "${combinedText || messageText}"`;

      try {
        const raw = await callClaudeHaiku(consentPrompt, combinedText || messageText);
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        const parsed = JSON.parse(raw.substring(s, e + 1));

        if (parsed.intent === "NO") {
          const { data: biz } = await supabase
            .from("buisness_owner")
            .select("phone")
            .eq("id", bizId)
            .maybeSingle();
          const doctorPhone = biz?.phone ?? "+212XXXXXXXXX";
          const noMsg = `Machi mochkil 😊 Hahowa numero dyal docteur ila bghiti tcalled m3ah nichan: ${doctorPhone}`;
          await sendDM(senderId, noMsg, token);
          await supabase
            .from("customers")
            .update({ status: "ARCHIVED" })
            .eq("instagram_id", senderId);
          await saveMsgHistory(senderId, combinedText || messageText, noMsg, bizId);
          return new Response("OK", { status: 200 });
        } else {
          await supabase
            .from("customers")
            .update({ status: "BOT_ACTIVE" })
            .eq("instagram_id", senderId);

          const startPrompt = `You are Nour, a warm receptionist for a Moroccan dental clinic on Instagram.
You speak natural Moroccan Darija mixed with French — like a real person texting on WhatsApp.

The patient just agreed to answer a few questions.
Their message: "${combinedText || messageText}"

Warmly acknowledge them and naturally ask for their full name (first and last).
Be human, short, natural. Max 1-2 sentences. 1 emoji max.

JSON only: { "reply": "your warm Darija message asking for their name" }`;

          try {
            const sr = await callClaude(startPrompt, combinedText || messageText);
            const ss = sr.indexOf("{");
            const ee = sr.lastIndexOf("}");
            const sp = JSON.parse(sr.substring(ss, ee + 1));
            const askMsg = sp.reply?.trim() ?? "Bzaf mzyan 😊 Smiytek kamla afak?";
            await sendDM(senderId, askMsg, token);
            await saveMsgHistory(senderId, combinedText || messageText, askMsg, bizId);
          } catch {
            const fallback = "Bzaf mzyan 😊 Smiytek kamla afak?";
            await sendDM(senderId, fallback, token);
            await saveMsgHistory(senderId, combinedText || messageText, fallback, bizId);
          }
          return new Response("OK", { status: 200 });
        }
      } catch (err) {
        console.error("[CONSENT] Error:", err);
        await supabase
          .from("customers")
          .update({ status: "BOT_ACTIVE" })
          .eq("instagram_id", senderId);
        const fallback = "Bzaf mzyan 😊 Smiytek kamla afak?";
        await sendDM(senderId, fallback, token);
        return new Response("OK", { status: 200 });
      }
    }

    // ── DOCTOR REPLIED ────────────────────────────────────────────────────────
    const doctorJustReplied = profile.status === "DOCTOR_REPLIED";
    if (doctorJustReplied) {
      await supabase
        .from("customers")
        .update({ status: "BOT_ACTIVE" })
        .eq("instagram_id", senderId);
      console.log(`[CONTEXT] Doctor done → activating booking flow`);

      // Immediately greet patient and offer booking
      const availableSlots = await getAvailableSlots();
      const greetMsg = `مرحبا من جديد 😊 الطبيب شاف ملفك. واش بغيتي تدير رونديفو؟ هادي الأوقات المتاحة:\n${availableSlots}`;
      await sendDM(senderId, greetMsg, token);
      await saveMsgHistory(senderId, "(doctor done)", greetMsg, bizId);
      return new Response("OK", { status: 200 });
    }

    // ── EXTRACT ───────────────────────────────────────────────────────────────
    // If this is an image message, don't try to extract
    // name/phone from old buffered text — use session only
    const isImageOnlyMessage = !!imageUrl && !messageText;
    const msgPhone = isImageOnlyMessage ? null : extractPhoneFromText(combinedText);
    const msgName  = isImageOnlyMessage ? null : extractNameFromText(combinedText);
    const msgDay   = extractDayFromText(combinedText);
    const msgTime  = extractTimeFromText(combinedText);

    const session = await getSession(senderId);
    const mergedPhone = msgPhone ?? profile.phone ?? session?.phone ?? null;
    const mergedName =
      msgName ??
      (profile.first_name
        ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
        : profile.name) ??
      session?.name ??    // session fetched at start of flow
      null;
    // Note: freshSession (fetched after photo processing) is used as additional
    // fallback in the photo completion block below for when image arrives

    // ── PHOTO — mark in session IMMEDIATELY before any other logic ─────────
    let savedImageUrl: string | null = null;

    // CRITICAL: If image is detected, immediately clear photo_requested flag
    // This prevents any logic from asking for the photo again
    if (imageUrl || hasImageInPending) {
      await setSession(senderId, { photoRequested: false });
    }

    if (imageUrl) {
      const uploaded = await saveDentalPhoto(imageUrl, senderId, token);
      if (uploaded) {
        savedImageUrl = uploaded;
        // Save photo URL and confirm photo is no longer needed
        await setSession(senderId, {
          photoUrl:        savedImageUrl,
          photoRequested:  false,
          lastPhotoAskAt:  null,
        });
        console.log(`[PHOTO] Saved: ${savedImageUrl}`);
      }
    }

    // Re-fetch session after photo update to get latest state
    const freshSession = await getSession(senderId);

    const hasPhoto =
      profile.has_photo ||
      !!savedImageUrl ||
      !!freshSession?.photo_url;
    const hasName  = !!mergedName;
    const hasPhone = !!mergedPhone;

    // ── MODE ──────────────────────────────────────────────────────────────────
    const wasComplete =
      !!((profile.name || profile.first_name) && profile.phone && profile.has_photo);
    const isPostTriage = wasComplete || doctorJustReplied;

    console.log(`[MODE] wasComplete=${wasComplete} isPostTriage=${isPostTriage}`);

    // ── AI ────────────────────────────────────────────────────────────────────
    let aiReply  = "";
    let aiName:  string | null = null;
    let aiPhone: string | null = null;
    let aiDay:   string | null = null;
    let aiTime:  string | null = null;

    if (isPostTriage) {
      // ── POST-TRIAGE: booking conversation ──────────────────────────────────
      const availableSlots = await getAvailableSlots();
      const eventCtx = doctorJustReplied
        ? `Doctor just replied. Patient's first message: "${combinedText || "(no text)"}"`
        : `Patient sent: "${combinedText || "(no text)"}"`;

      const postTriagePrompt = `You are Nour, a smart receptionist at a Moroccan dental clinic on Instagram DM.

CRITICAL LANGUAGE RULE:
- Write ALL replies in Moroccan Darija using Arabic script (الحروف العربية)
- Example: واخا، مزيان، سلام، دابا، عافاك
- NEVER use Latin letters for Darija
- Short, warm, natural — like a real person on WhatsApp
- Max 2 sentences. Max 1 emoji.

PATIENT INFO:
- Name: ${mergedName ?? "unknown"}
- Phone: ${mergedPhone ?? "unknown"}
- Status: Triage complete ✅

AVAILABLE SLOTS (never list all at once — only suggest 2-3):
${availableSlots}

AUTO-DETECTED FROM MESSAGE:
- Day: ${msgDay ? (DAY_LABEL[msgDay] ?? msgDay) : "not detected"}
- Time: ${msgTime ? (TIME_LABEL[msgTime] ?? msgTime) : "not detected"}

YOUR ROLE:
- If patient asks about availability → ask what time works for them
- If patient proposes an available slot → confirm warmly
- If slot NOT available → apologize and suggest nearest alternative
- If day and time detected → confirm the booking directly

RESPONSE FORMAT — JSON only, nothing else:
{
  "reply": "your reply in Arabic script Darija",
  "extracted": {
    "full_name": null,
    "phone": null,
    "booking_day": "day code like Mon/Tue or null",
    "booking_time": "time code like 9a/1p or null"
  }
}`;

      try {
        const rawText = await callClaude(postTriagePrompt, eventCtx);
        const s = rawText.indexOf("{");
        const e = rawText.lastIndexOf("}");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed: AIExtracted = JSON.parse(rawText.substring(s, e + 1));
        aiReply = parsed.reply?.trim() ?? "";
        aiDay   = parsed.extracted?.booking_day?.trim()  || null;
        aiTime  = parsed.extracted?.booking_time?.trim() || null;
      } catch (err) {
        console.error("[AI POST-TRIAGE ERROR]:", err);
        aiReply = "Smahlia chwia, kayn chi 3otla. Rja3 liya men ba3d dqiqa 🙏";
      }
    } else {
      // ── TRIAGE ───────────────────────────────────────────────────────────

      // Photo just arrived + name + phone = complete — ask appointment intent
      const latestSess = await getSession(senderId);
      const effectiveName  = mergedName  || latestSess?.name  || freshSession?.name  || null;
      const effectivePhone = mergedPhone || latestSess?.phone || freshSession?.phone || null;
      const effectivePhoto = savedImageUrl        ?? freshSession?.photo_url ?? null;

      if (savedImageUrl && effectiveName && effectivePhone) {
        // All 3 collected — save to session and ask appointment intent
        await setSession(senderId, {
          name:            effectiveName,
          phone:           effectivePhone,
          photoUrl:        savedImageUrl,
          photoRequested:  false,
          lastPhotoAskAt:  null,
          bizId,
        });
        const intentMsg =
          "wach baghi ta5ed chi rendez fhad l ayam ola bghit t3ref ghi latmina? 😊";
        await supabase
          .from("customers")
          .update({ status: "WAITING_FOR_APPOINTMENT_INTENT" })
          .eq("instagram_id", senderId);
        await sendDM(senderId, intentMsg, token);
        await saveMsgHistory(senderId, "[image]", intentMsg, bizId);
        return new Response("OK", { status: 200 });
      }

      // Declined photo
      const declined =
        /mandi\s*ha|ma\s*3ndi|makanitsh|makantch|machi\s*3ndi|bla\s*photo|sans\s*photo/i.test(
          combinedText
        );
      if (declined && hasName && hasPhone) {
        const msg = `Machi mochkil 😊 Tbib ghay3ytlik f ${mergedPhone} daba chwya o swwlo libghiti`;
        await supabase
          .from("customers")
          .update({ status: "WAITING_FOR_DOCTOR" })
          .eq("instagram_id", senderId);
        await sendDM(senderId, msg, token);
        await saveMsgHistory(senderId, combinedText, msg, bizId);
        return new Response("OK", { status: 200 });
      }

      const alreadyComplete = !!mergedName && !!mergedPhone && hasPhoto;

      // Check if photo was already requested recently (15s cooldown)
      const photoAskedRecently =
        freshSession?.photo_requested === true &&
        freshSession?.last_photo_ask_at != null &&
        Date.now() - new Date(freshSession.last_photo_ask_at).getTime() < 15000;

      if (!alreadyComplete && !hasImageInPending && !photoAskedRecently) {
        // Load history
        const { data: msgHistory } = await supabase
          .from("customer_messages")
          .select("message_text, reply_text, timestamp")
          .eq("customer_id", senderId)
          .order("timestamp", { ascending: true })
          .limit(15);
        const historyLines = (msgHistory ?? [])
          .flatMap((m: any) => [
            m.message_text ? `Patient: ${m.message_text}` : "",
            m.reply_text   ? `Nour: ${m.reply_text}`   : "",
          ])
          .filter(Boolean)
          .join("\n");

        const triageSystemPrompt = `You are Nour, a warm and friendly receptionist at a Moroccan dental clinic on Instagram DM.

CRITICAL LANGUAGE RULE:
- You MUST write ALL replies in Moroccan Darija using Arabic script (الحروف العربية)
- Example: سلام، واخا، مزيان، شنو، كيفاش، عافاك، دابا
- NEVER use Latin letters (mzyan, wakha, salam) — always use Arabic script
- Write naturally like a real Moroccan person texting on WhatsApp
- Short, warm, human — NOT robotic or formal

CURRENT PATIENT DATA (trust this above everything else):
- Name: ${mergedName ? `✅ COLLECTED → ${mergedName} — NEVER ask for name again` : "❌ MISSING — ask for name"}
- Phone: ${mergedPhone ? `✅ COLLECTED → ${mergedPhone} — NEVER ask for phone again` : "❌ MISSING — ask for phone"}
- Photo: ${hasPhoto ? "✅ RECEIVED — NEVER ask for photo again" : "❌ MISSING — ask for dental photo"}
- Next step: ${!mergedName ? "ASK FOR NAME ONLY" : !mergedPhone ? "ASK FOR PHONE ONLY" : !hasPhoto ? "ASK FOR PHOTO ONLY" : "ALL COLLECTED"}

STRICT RULES:
- NEVER ask for something already marked ✅
- Collect ONE thing at a time — name first, then phone, then photo
- Answer any question the patient asks BEFORE continuing collection
- If patient asks about price, answer it naturally then continue
- Max 2 sentences per reply. Max 1 emoji.

CONVERSATION HISTORY:
${historyLines || "No history yet"}

PRICES (only mention if asked):
- Détartrage: 300 DH | Plombage: 400 DH | Extraction: 200 DH | Blanchiment: 500 DH
- Consultation: free phone call with doctor

WHEN ALL 3 ARE COLLECTED, reply in Arabic script:
"واخا [name]! دوسيي ديالك واجد ✅ الطبيب غيتصل بيك ف [phone] دابا شوية 😊"

RESPONSE FORMAT — JSON only, nothing else:
{
  "reply": "your reply in Arabic script Darija",
  "extracted": {
    "full_name": "full name or null",
    "phone": "phone number or null",
    "has_photo": false
  }
}`;

        const userContext = `Patient messages (buffered — treat as one turn):
"${combinedText || "(image received)"}"`;

        try {
          const rawText = await callClaude(triageSystemPrompt, userContext);
          const s = rawText.indexOf("{");
          const e = rawText.lastIndexOf("}");
          if (s === -1 || e === -1) throw new Error("No JSON");
          const parsed = JSON.parse(rawText.substring(s, e + 1));
          aiReply = parsed.reply?.trim() ?? "";

          // If Claude is asking for photo, set the flag to prevent repeating
          const isAskingForPhoto =
            aiReply.includes("tsswira") ||
            aiReply.includes("galerie")  ||
            aiReply.includes("snano")    ||
            aiReply.includes("snank");

          if (isAskingForPhoto && !hasPhoto) {
            await setSession(senderId, {
              photoRequested:  true,
              lastPhotoAskAt:  new Date().toISOString(),
            });
            console.log("[SESSION] Photo request flagged");
          }

          const rawAiName = parsed.extracted?.full_name?.trim() || null;
          aiName  = rawAiName && isValidHumanName(rawAiName) ? rawAiName : null;
          if (rawAiName && !aiName) console.log("[NAME REJECTED]", rawAiName);
          if (aiName) {
            await setSession(senderId, { name: aiName });
            console.log('[SESSION] Name saved from AI:', aiName);
          }
          aiPhone = parsed.extracted?.phone?.trim() || null;
        } catch (err) {
          console.error("[AI TRIAGE ERROR]:", err);
          if (!hasName)       aiReply = "Smiytek kamla afak? 😊";
          else if (!hasPhone) aiReply = `Mzyan ${mergedName} 👍 R9m dyal portable dyalk?`;
          else                aiReply = "3tina tsswira dyal snank — doz 3la icon galerie f Instagram 😊";
        }
      }
      // If photoAskedRecently is true and no image arrived → stay silent
    }

    // ── MERGE DATA ────────────────────────────────────────────────────────────
    let finalName:      string | null = profile.name       ?? null;
    let finalFirstName: string | null = profile.first_name ?? null;
    let finalLastName:  string | null = profile.last_name  ?? null;

    const nameToUse = mergedName || aiName;
    if (nameToUse && !(profile.name || profile.first_name)) {
      finalName = nameToUse;
      const parts = (finalName ?? "").split(/\s+/);
      finalFirstName = parts[0] ?? null;
      finalLastName  = parts.slice(1).join(" ") || null;
    }

    const finalPhone = mergedPhone ?? aiPhone ?? null;
    const finalDay   = msgDay ?? aiDay  ?? null;
    const finalTime  = msgTime ?? aiTime ?? null;

    // ── DECIDE REPLY ──────────────────────────────────────────────────────────
    const isNowComplete =
      !!((finalName || finalFirstName) && finalPhone && hasPhoto);
    let replyText: string;
    let finalStatus: BotStatus = doctorJustReplied
      ? "BOT_ACTIVE"
      : profile.status;

    if (isNowComplete && !wasComplete && !isPostTriage && hasPhoto) {
      replyText   = `الطبيب غيتصل بيك دابا شوية باش يعطيك les détails 😊`;
      finalStatus = "WAITING_FOR_DOCTOR";
      console.log(`[HANDOFF] → WAITING_FOR_DOCTOR`);
    } else if (isPostTriage && finalDay && finalTime) {
      const bookingResult = await bookSlot(finalDay, finalTime, senderId, finalName);
      if (bookingResult) {
        replyText = bookingResult;
        console.log(`[BOOKING] ✅ ${finalDay} ${finalTime}`);
      } else {
        const freshSlots = await getAvailableSlots();
        replyText = `Smahlia, dak l-weqt m-3amer 😔 Hado les créneaux disponibles:\n${freshSlots}`;
      }
    } else {
      replyText = aiReply;
    }

    // ── UPDATE SESSION ────────────────────────────────────────────────────────
    // Check if we just asked for photo — preserve the flag
    const justAskedForPhoto =
      replyText?.includes("tsswira") ||
      replyText?.includes("galerie") ||
      replyText?.includes("snano")   ||
      replyText?.includes("snank");

    // Re-fetch the LATEST session to get values saved earlier
    // in this same webhook call (e.g. phone saved by early extraction)
    const latestSess = await getSession(senderId);

    await setSession(senderId, {
      name:            msgName       || mergedName              || latestSess?.name       || freshSession?.name       || null,
      phone:           msgPhone      || mergedPhone             || latestSess?.phone      || freshSession?.phone      || null,
      photoUrl:        savedImageUrl || latestSess?.photo_url   || freshSession?.photo_url || null,
      photoRequested:  justAskedForPhoto ? true : (latestSess?.photo_requested ?? freshSession?.photo_requested ?? false),
      lastPhotoAskAt:  justAskedForPhoto ? new Date().toISOString() : (latestSess?.last_photo_ask_at ?? freshSession?.last_photo_ask_at ?? null),
      bizId,
    });
    console.log('[SESSION] Final state:', {
      name:     msgName    || mergedName   || latestSess?.name,
      phone:    msgPhone   || mergedPhone  || latestSess?.phone,
      hasPhoto: !!(savedImageUrl || latestSess?.photo_url),
    });

    // ── DB WRITE (status + metadata only during triage) ───────────────────────
    const { error: ue } = await supabase
      .from("customers")
      .upsert(
        {
          instagram_id:      senderId,
          status:            finalStatus,
          last_seen_at:      new Date().toISOString(),
          business_owner_id: bizId,
          ...(finalName      ? { name: finalName, first_name: finalFirstName, last_name: finalLastName } : {}),
          ...(finalPhone     ? { phone: finalPhone } : {}),
          ...(savedImageUrl  ? { has_photo: true, last_dental_image: savedImageUrl } : {}),
        },
        { onConflict: "instagram_id" }
      );
    if (ue) console.error("[DB UPSERT ERROR]:", ue.message);

    // ── SEND ──────────────────────────────────────────────────────────────────
    if (!replyText || replyText.toLowerCase().includes("null")) {
      return new Response("OK", { status: 200 });
    }

    // ── ANTI-DUPLICATE REPLY GUARD ──────────────────────────────
    // 1. In-memory check (fast — same instance, catches race conditions)
    const lastSent = recentlySentReplies.get(senderId);
    if (lastSent && (Date.now() - lastSent.at) < 15000) {
      const isSame = lastSent.text === replyText;
      const isSimilarPhoto = lastSent.text.includes("tsswira") && replyText?.includes("tsswira");
      if (isSame || isSimilarPhoto) {
        console.log("[ANTI-DUPE] In-memory guard blocked duplicate");
        return new Response("OK", { status: 200 });
      }
    }

    // 2. DB check (cross-instance guard — saveMsgHistory runs BEFORE sendDM so the record exists)
    const { data: recentReply } = await supabase
      .from("customer_messages")
      .select("reply_text, timestamp")
      .eq("customer_id", senderId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentReply) {
      const secondsSince = (Date.now() - new Date(recentReply.timestamp).getTime()) / 1000;
      const isSameReply = recentReply.reply_text === replyText;
      const isSimilarPhotoRequest =
        recentReply.reply_text?.includes("tsswira") && replyText?.includes("tsswira");

      if (secondsSince < 15 && (isSameReply || isSimilarPhotoRequest)) {
        console.log("[ANTI-DUPE] DB guard blocked duplicate");
        return new Response("OK", { status: 200 });
      }
    }
    // ────────────────────────────────────────────────────────────

    // Register in-memory before sending
    recentlySentReplies.set(senderId, { text: replyText, at: Date.now() });
    setTimeout(() => recentlySentReplies.delete(senderId), 15000);

    // Save to DB BEFORE sending — so any concurrent webhook sees the record immediately
    await saveMsgHistory(
      senderId,
      combinedText || (imageUrl ? "[image]" : ""),
      replyText,
      bizId
    );

    await sendDM(senderId, replyText, token);
    messageSent = true;

    return new Response("OK", { status: 200 });
  } catch (crashErr) {
    console.error("[CRASH]:", crashErr);
    if (!messageSent && senderId) {
      const { data: biz } = await supabase
        .from("buisness_owner")
        .select("page_access_token")
        .maybeSingle();
      await sendDM(
        senderId,
        "Smahlia, kayn chi 3otla teknik 🙏 Rja3 liya men ba3d chwia.",
        biz?.page_access_token ?? ""
      );
    }
    return new Response("OK", { status: 200 });
  }
}