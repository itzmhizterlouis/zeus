import { NextResponse } from "next/server";
import {
  attachSellerSession,
  verifySellerOtp,
} from "../../../../../lib/server/seller-auth";

export async function POST(request) {
  try {
    const payload = await request.json();
    const result = await verifySellerOtp(payload);

    const response = NextResponse.json({
      message: "Verification complete. Finish KYC and bank setup.",
      nextStep: "profile",
      seller: result.seller,
    });

    return attachSellerSession(response, result.token);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to verify OTP right now." },
      { status: 400 }
    );
  }
}
