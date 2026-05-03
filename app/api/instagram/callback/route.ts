import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    console.log("[IG CONNECT] code received:", code ? `${code.substring(0, 20)}…` : "MISSING");

    if (!code) {
      return NextResponse.json({ error: "Missing code parameter" }, { status: 400 });
    }

    // ── Auth: resolve user from Bearer token ──────────────────────────────────
    const authHeader  = req.headers.get("Authorization");
    const accessToken = authHeader?.replace("Bearer ", "") ?? "";
    console.log("[IG CONNECT] auth token present:", !!accessToken);

    // Unauthenticated client — only used to validate the JWT
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(accessToken);
    console.log("[IG CONNECT] resolved user:", user?.id ?? "NONE", "| error:", userError?.message ?? "none");

    if (userError || !user) {
      return NextResponse.json({ error: `Not authenticated: ${userError?.message ?? "no user"}` }, { status: 401 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/auth/instagram/callback`;
    console.log("[IG CONNECT] redirect_uri:", redirectUri);

    // ── Step 1: Exchange code for short-lived token ───────────────────────────
    const tokenRes = await fetch("https://graph.facebook.com/v25.0/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri:  redirectUri,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    console.log("[IG CONNECT] step1 short-lived token response:", JSON.stringify(tokenData).substring(0, 200));

    if (tokenData.error) {
      return NextResponse.json({ error: `Short-lived token error: ${tokenData.error.message ?? JSON.stringify(tokenData.error)}` });
    }

    const shortLivedToken: string = tokenData.access_token;

    // ── Step 2: Exchange for long-lived token ─────────────────────────────────
    const longTokenUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    longTokenUrl.searchParams.set("grant_type",        "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id",         process.env.META_APP_ID!);
    longTokenUrl.searchParams.set("client_secret",     process.env.META_APP_SECRET!);
    longTokenUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const longTokenRes  = await fetch(longTokenUrl.toString());
    const longTokenData = await longTokenRes.json();
    console.log("[IG CONNECT] step2 long-lived token response:", JSON.stringify(longTokenData).substring(0, 200));

    if (longTokenData.error) {
      return NextResponse.json({ error: `Long-lived token error: ${longTokenData.error.message ?? JSON.stringify(longTokenData.error)}` });
    }

    const longLivedToken: string = longTokenData.access_token;

    // ── Step 3: Find Instagram Business Account (3-attempt dynamic strategy) ──
    let instagramAccountId: string | null = null;
    let instagramUsername:  string | null = null;
    let pageAccessToken:    string | null = null;
    let facebookPageId:     string | null = null;

    // Attempt 1 — /me/accounts (standard pages list)
    const accountsRes  = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${longLivedToken}`
    );
    const accountsData = await accountsRes.json();
    console.log("[IG CONNECT] attempt1 /me/accounts:", JSON.stringify(accountsData));

    const pages: any[] = accountsData.data ?? [];
    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        instagramAccountId = page.instagram_business_account.id;
        instagramUsername  = page.instagram_business_account.username ?? null;
        pageAccessToken    = page.access_token ?? longLivedToken;
        facebookPageId     = page.id;
        console.log(`[IG CONNECT] attempt1 found: page=${facebookPageId} ig=${instagramAccountId}`);
        break;
      }
    }

    // Attempt 2 — /me/accounts again (same call, already have result; skip duplicate)
    // Attempt 3 — /me with nested accounts (Business Portfolio fallback)
    if (!instagramAccountId) {
      const meAccountsRes  = await fetch(
        `https://graph.facebook.com/v25.0/me?fields=id,name,accounts{id,name,access_token,instagram_business_account{id,username}}&access_token=${longLivedToken}`
      );
      const meAccountsData = await meAccountsRes.json();
      console.log("[IG CONNECT] attempt3 /me nested accounts:", JSON.stringify(meAccountsData));

      const nestedPages: any[] = meAccountsData.accounts?.data ?? [];
      for (const page of nestedPages) {
        if (page.instagram_business_account?.id) {
          instagramAccountId = page.instagram_business_account.id;
          instagramUsername  = page.instagram_business_account.username ?? null;
          pageAccessToken    = page.access_token ?? longLivedToken;
          facebookPageId     = page.id;
          console.log(`[IG CONNECT] attempt3 found: page=${facebookPageId} ig=${instagramAccountId}`);
          break;
        }
      }
    }

    // Attempt 4 — query each page ID directly for instagram_business_account
    if (!instagramAccountId) {
      // Get all page IDs the user granted access to during OAuth
      const allPagesRes  = await fetch(
        `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token&access_token=${longLivedToken}`
      );
      const allPagesData = await allPagesRes.json();
      console.log("[IG CONNECT] attempt4 all pages:", JSON.stringify(allPagesData));

      const allPages: any[] = allPagesData.data ?? [];

      for (const page of allPages) {
        const pageDetailRes = await fetch(
          `https://graph.facebook.com/v25.0/${page.id}?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${page.access_token ?? longLivedToken}`
        );
        const pageDetail = await pageDetailRes.json();
        console.log(`[IG CONNECT] attempt4 page ${page.id} detail:`, JSON.stringify(pageDetail));

        if (pageDetail.instagram_business_account?.id) {
          instagramAccountId = pageDetail.instagram_business_account.id;
          instagramUsername  = pageDetail.instagram_business_account.username ?? null;
          pageAccessToken    = pageDetail.access_token ?? page.access_token ?? longLivedToken;
          facebookPageId     = page.id;
          console.log(`[IG CONNECT] attempt4 found: page=${facebookPageId} ig=${instagramAccountId}`);
          break;
        }
      }
    }

    // Attempt 5 — Instagram Business Login API (different endpoint)
    if (!instagramAccountId) {
      const igUserRes  = await fetch(
        `https://graph.facebook.com/v25.0/me?fields=id,username,name&access_token=${longLivedToken}`
      );
      const igUserData = await igUserRes.json();
      console.log("[IG CONNECT] attempt5 /me instagram login:", JSON.stringify(igUserData));

      if (igUserData.id && !igUserData.error) {
        instagramAccountId = igUserData.id;
        instagramUsername  = igUserData.username ?? null;
        pageAccessToken    = longLivedToken;
        facebookPageId     = igUserData.id;
        console.log(`[IG CONNECT] attempt5 found: ig=${instagramAccountId} username=${instagramUsername}`);
      }
    }

    if (!instagramAccountId) {
      return NextResponse.json({
        error: "Could not find Instagram Business Account. Make sure your Facebook Page is connected to an Instagram Business Account.",
      });
    }

    // ── Step 6: Persist to buisness_owner ────────────────────────────────────
    console.log("[IG CONNECT] step6 updating buisness_owner where auth_user_id =", user.id);

    // Authenticated client — passes the user JWT so RLS auth.uid() resolves correctly
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    );

    const tokenExpiresAt        = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const tokenLastRefreshedAt  = new Date().toISOString();

    const { data: updatedRows, error: dbError } = await supabase
      .from("buisness_owner")
      .update({
        instagram_access_token:  longLivedToken,
        instagram_id:            instagramAccountId,
        instagram_username:      instagramUsername,
        page_access_token:       pageAccessToken,
        facebook_page_id:        facebookPageId,
        token_expires_at:        tokenExpiresAt,
        token_last_refreshed_at: tokenLastRefreshedAt,
      })
      .eq("auth_user_id", user.id)
      .select("id, auth_user_id, instagram_username");

    console.log("[IG CONNECT] step6 db result — updated rows:", JSON.stringify(updatedRows), "| error:", dbError?.message ?? "none");

    if (dbError) {
      return NextResponse.json({ error: `Database error: ${dbError.message}` });
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({
        error: `No buisness_owner row found for auth_user_id=${user.id}. The row may not exist yet.`,
      });
    }

    console.log(`[IG CONNECT] ✅ Connected @${instagramUsername} for user ${user.id}`);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("[IG CONNECT] Crash:", err);
    return NextResponse.json({ error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
