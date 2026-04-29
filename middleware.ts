import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that never require authentication
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/",
  "/auth/confirm",
  "/auth/instagram/callback",
  "/api/webhook/instagram",
  "/api/instagram/callback",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes and public paths always pass through
  if (pathname.startsWith("/api/") || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // All other routes pass through — session is managed client-side by Supabase
  // (supabase-js browser client stores in localStorage, not cookies,
  //  so cookie-based checks here would always fail and block authenticated users)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
