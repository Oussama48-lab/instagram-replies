import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { business_owner_id, access_token } = await req.json();

    if (!business_owner_id || !access_token) {
      return NextResponse.json({ success: false, error: "Missing business_owner_id or access_token" }, { status: 400 });
    }

    // Step 1: Refresh the long-lived token via Meta
    const refreshUrl = new URL("https://graph.facebook.com/v18.0/oauth/access_token");
    refreshUrl.searchParams.set("grant_type", "fb_exchange_token");
    refreshUrl.searchParams.set("client_id", process.env.META_APP_ID!);
    refreshUrl.searchParams.set("client_secret", process.env.META_APP_SECRET!);
    refreshUrl.searchParams.set("fb_exchange_token", access_token);

    const refreshRes  = await fetch(refreshUrl.toString());
    const refreshData = await refreshRes.json();

    if (refreshData.error || !refreshData.access_token) {
      const msg = refreshData.error?.message ?? JSON.stringify(refreshData);
      console.error("[TOKEN REFRESH] Failed:", msg);
      return NextResponse.json({ success: false, error: msg });
    }

    const newToken = refreshData.access_token as string;
    const expiry   = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const now      = new Date().toISOString();

    // Step 2: Fetch fresh page access token from /me/accounts
    const accountsRes  = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${newToken}`);
    const accountsData = await accountsRes.json();
    const pageToken: string | null = accountsData?.data?.[0]?.access_token ?? null;

    // Step 3: Update buisness_owner row
    const updatePayload: Record<string, string> = {
      instagram_access_token:  newToken,
      token_expires_at:        expiry,
      token_last_refreshed_at: now,
    };
    if (pageToken) updatePayload.page_access_token = pageToken;

    const { error: updateError } = await supabase
      .from("buisness_owner")
      .update(updatePayload)
      .eq("id", business_owner_id);

    if (updateError) {
      console.error("[TOKEN REFRESH] DB update failed:", updateError.message);
      return NextResponse.json({ success: false, error: updateError.message });
    }

    console.log(`[TOKEN REFRESH] ✅ Refreshed for business_owner_id=${business_owner_id}, expires ${expiry}`);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("[TOKEN REFRESH] Crash:", err);
    return NextResponse.json({ success: false, error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
