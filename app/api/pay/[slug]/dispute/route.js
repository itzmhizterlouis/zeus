import { NextResponse } from "next/server";
import { getCheckoutStateBySlug } from "../../../../../lib/server/checkout";
import { createDisputeForTransaction } from "../../../../../lib/server/disputes";

export async function POST(request, { params }) {
  try {
    const { slug } = await params;
    const checkoutState = await getCheckoutStateBySlug(slug);

    if (!checkoutState) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    const payload = await request.json();
    await createDisputeForTransaction(checkoutState.transaction.id, payload);
    const freshCheckoutState = await getCheckoutStateBySlug(slug);

    return NextResponse.json({
      checkoutState: freshCheckoutState,
      message: "Your dispute has been opened. Funds remain locked while it is reviewed.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to open the dispute right now." },
      { status: 400 }
    );
  }
}
