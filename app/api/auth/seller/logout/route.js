import { NextResponse } from "next/server";
import {
  clearSellerSession,
  clearSellerSessionCookie,
  getCurrentSellerSessionToken,
} from "../../../../../lib/server/seller-auth";

export async function POST() {
  const token = await getCurrentSellerSessionToken();

  if (token) {
    await clearSellerSession(token);
  }

  const response = NextResponse.json({ message: "Seller logged out." });
  return clearSellerSessionCookie(response);
}
