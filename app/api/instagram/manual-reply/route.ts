import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { instagram_id, customer_id, text } = await req.json();

    if (!instagram_id || !text) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Get page_access_token from buisness_owner
    const { data: bizOwner } = await supabase
      .from("buisness_owner")
      .select("page_access_token")
      .not("page_access_token", "is", null)
      .maybeSingle();

    if (!bizOwner?.page_access_token) {
      console.error("[MANUAL REPLY] No page_access_token found");
      return NextResponse.json({ error: "Instagram not connected" }, { status: 500 });
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${bizOwner.page_access_token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: instagram_id },
          message: { text },
        }),
      }
    );

    const json = await res.json();

    if (!res.ok) {
      console.error("[MANUAL REPLY] Instagram API error:", JSON.stringify(json));
      return NextResponse.json({ error: json }, { status: 500 });
    }

    console.log("[MANUAL REPLY] Sent to:", instagram_id);

    // Update customer status to DOCTOR_REPLIED
    await supabase
      .from("customers")
      .update({ status: "DOCTOR_REPLIED" })
      .eq("id", customer_id);

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("[MANUAL REPLY] Exception:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
