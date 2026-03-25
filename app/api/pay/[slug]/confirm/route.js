import { NextResponse } from "next/server";
import { getCheckoutStateBySlug } from "../../../../../lib/server/checkout";
import { confirmPaymentForTransaction } from "../../../../../lib/server/payments";

export async function POST(request, { params }) {
  try {
    const { slug } = await params;
    const checkoutState = await getCheckoutStateBySlug(slug);

    if (!checkoutState) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const payload = await request.json();
    const merchantReference = String(payload.merchantReference || "").trim();

    if (!merchantReference) {
      return NextResponse.json(
        { error: "Merchant reference is required." },
        { status: 400 }
      );
    }

    await confirmPaymentForTransaction(
      checkoutState.transaction.id,
      merchantReference,
      request.nextUrl.origin
    );
    const freshCheckoutState = await getCheckoutStateBySlug(slug);

    return NextResponse.json({
      checkoutState: freshCheckoutState,
      message: "Payment confirmed and delivery booking created.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to confirm the payment yet." },
      { status: 400 }
    );
  }
}
