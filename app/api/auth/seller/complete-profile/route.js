import { NextResponse } from "next/server";
import {
  completeSellerOnboarding,
  getCurrentSeller,
} from "../../../../../lib/server/seller-auth";

export async function POST(request) {
  try {
    const currentSeller = await getCurrentSeller();

    if (!currentSeller) {
      return NextResponse.json(
        { error: "Your session expired. Please log in again." },
        { status: 401 }
      );
    }

    const payload = await request.json();
    const seller = await completeSellerOnboarding(currentSeller.id, payload);

    return NextResponse.json({
      message: "Seller account verified. Your dashboard is ready.",
      nextStep: "dashboard",
      seller,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to complete onboarding right now." },
      { status: 400 }
    );
  }
}
