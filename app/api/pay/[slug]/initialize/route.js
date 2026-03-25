import { NextResponse } from "next/server";
import {
  getCheckoutStateBySlug,
  upsertBuyerForTransaction,
} from "../../../../../lib/server/checkout";
import { createPaymentAttempt } from "../../../../../lib/server/payments";

export async function POST(request, { params }) {
  try {
    const { slug } = await params;
    const checkoutState = await getCheckoutStateBySlug(slug);

    if (!checkoutState) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (checkoutState.payment?.status === "confirmed") {
      return NextResponse.json(
        {
          checkoutState,
          error: "This transaction has already been paid for.",
        },
        { status: 400 }
      );
    }

    const payload = await request.json();
    const buyer = await upsertBuyerForTransaction(checkoutState.transaction, payload);
    const paymentSession = await createPaymentAttempt(
      checkoutState.transaction,
      buyer,
      request.nextUrl.origin
    );
    const freshCheckoutState = await getCheckoutStateBySlug(slug);

    return NextResponse.json({
      checkout: paymentSession.checkout,
      checkoutState: freshCheckoutState,
      message:
        paymentSession.checkout.provider === "interswitch"
          ? "Quickteller checkout is ready."
          : "Mock payment session created.",
      payment: paymentSession.payment,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to start the payment flow right now." },
      { status: 400 }
    );
  }
}
