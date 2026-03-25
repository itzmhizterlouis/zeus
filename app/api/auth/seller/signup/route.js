import { NextResponse } from "next/server";
import { beginSellerSignup } from "../../../../../lib/server/seller-auth";

export async function POST(request) {
  try {
    const payload = await request.json();
    const result = await beginSellerSignup(payload);

    return NextResponse.json({
      devOtp: result.devOtp,
      message: "Account created. Enter the OTP codes to continue.",
      nextStep: "otp",
      seller: result.seller,
      sellerId: result.seller.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to create seller account." },
      { status: 400 }
    );
  }
}
