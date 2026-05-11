import { NextResponse } from "next/server";
import { STAFF_SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ success: true, message: "Logged out." });

  // Clear the session cookie by setting Max-Age to 0
  res.cookies.set(STAFF_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
