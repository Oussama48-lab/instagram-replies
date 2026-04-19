import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/doctor-reply
//
// Called by the dashboard when the doctor sends a reply.
// Accepts any of these body shapes:
//   { instagram_id: "965...", text: "..." }
//   { customer_id: "965...", text: "..." }   ← instagram_id as customer_id
//   { customer_id: 259,      text: "..." }   ← DB row id as customer_id
//   { instagram_id: "965...", message: "..." }
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[DOCTOR-REPLY] body:", JSON.stringify(body));

    const rawId = body.instagram_id ?? body.customer_id ?? body.id ?? "";
    const text: string = (body.text ?? body.message ?? "").trim();

    if (!rawId || !text) {
      return NextResponse.json(
        { error: "Provide instagram_id (or customer_id) and text (or message)" },
        { status: 400 }
      );
    }

    // ── Step 1: Resolve instagram_id ─────────────────────────────────────────
    // If UI sends DB row id (short number like 259), look up the instagram_id.
    let instagram_id: string = String(rawId);
    const isDbRowId = /^\d{1,10}$/.test(instagram_id) && instagram_id.length < 12;

    if (isDbRowId) {
      const { data, error } = await supabase
        .from("customers")
        .select("instagram_id")
        .eq("id", parseInt(instagram_id))
        .maybeSingle();

      if (error || !data?.instagram_id) {
        return NextResponse.json(
          { error: `No customer found with DB id ${instagram_id}` },
          { status: 404 }
        );
      }
      instagram_id = data.instagram_id;
      console.log(`[DOCTOR-REPLY] Resolved DB id ${rawId} → ${instagram_id}`);
    }

    // ── Step 2: Send the DM ───────────────────────────────────────────────────
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: instagram_id }, message: { text } }),
      }
    );

    const igJson = await igRes.json();
    if (!igRes.ok) {
      console.error("[DOCTOR-REPLY] Instagram error:", JSON.stringify(igJson));
      return NextResponse.json({ error: "Instagram API error", detail: igJson }, { status: 502 });
    }

    // ── Step 3: Set status to DOCTOR_REPLIED ─────────────────────────────────
    // The webhook detects DOCTOR_REPLIED on the next patient message and
    // switches to post-triage conversation mode (no more triage questions).
    const { data: updated, error: dbError } = await supabase
      .from("customers")
      .update({
        status:       "DOCTOR_REPLIED",
        last_seen_at: new Date().toISOString(),
      })
      .eq("instagram_id", instagram_id)
      .select("id");

    if (dbError) {
      console.error("[DOCTOR-REPLY] DB error:", dbError.message);
      return NextResponse.json({
        success: true,
        warning: "DM sent but DB update failed",
        instagram_message_id: igJson.message_id ?? null,
      });
    }

    console.log(`[DOCTOR-REPLY] ✅ Sent to ${instagram_id}, status → DOCTOR_REPLIED (rows: ${updated?.length ?? 0})`);

    return NextResponse.json({
      success:              true,
      instagram_id,
      instagram_message_id: igJson.message_id ?? null,
    });

  } catch (error) {
    console.error("[DOCTOR-REPLY] Crash:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}