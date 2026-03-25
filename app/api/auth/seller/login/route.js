import { NextResponse } from "next/server";
import {
  attachSellerSession,
  loginSeller,
} from "../../../../../lib/server/seller-auth";

export async function POST(request) {
  try {
    const payload = await request.json();
    const result = await loginSeller(payload);

    if (result.nextStep === "otp") {
      return NextResponse.json({
        devOtp: result.devOtp,
        message: "We re-issued your OTP codes so you can finish verification.",
        nextStep: "otp",
        seller: result.seller,
        sellerId: result.seller.id,
      });
    }

    const response = NextResponse.json({
      message:
        result.nextStep === "dashboard"
          ? "Welcome back. Opening your seller dashboard."
          : "Welcome back. Finish your seller verification to unlock the dashboard.",
      nextStep: result.nextStep,
      seller: result.seller,
    });

    return attachSellerSession(response, result.token);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to log in right now." },
      { status: 400 }
    );
  }
}
