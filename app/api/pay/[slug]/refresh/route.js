import { NextResponse } from "next/server";
import { getCheckoutStateBySlug } from "../../../../../lib/server/checkout";
import { updateTransactionStatus } from "../../../../../lib/server/transactions";

export async function POST(_request, { params }) {
  try {
    const { slug } = await params;
    const checkoutState = await getCheckoutStateBySlug(slug, { refreshDelivery: true });

    if (!checkoutState) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const disputeOpen = ["open", "under_review"].includes(
      checkoutState.dispute?.status || ""
    );
    const resolutionLocked = [
      "dispute_open",
      "refund_approved",
      "seller_release_approved",
      "return_required",
    ].includes(checkoutState.transaction.status);

    if (
      !disputeOpen &&
      !resolutionLocked &&
      checkoutState.delivery?.status === "in_transit" &&
      checkoutState.transaction.status !== "in_transit"
    ) {
      await updateTransactionStatus(
        checkoutState.transaction.id,
        "in_transit",
        "Delivery tracking updated."
      );
    }

    if (
      !disputeOpen &&
      !resolutionLocked &&
      checkoutState.delivery?.status === "delivered" &&
      checkoutState.transaction.status !== "delivered"
    ) {
      await updateTransactionStatus(
        checkoutState.transaction.id,
        "delivered",
        "Delivery marked as completed."
      );
    }

    const freshCheckoutState = await getCheckoutStateBySlug(slug);

    return NextResponse.json({
      checkoutState: freshCheckoutState,
      message: "Tracking refreshed.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to refresh tracking right now." },
      { status: 400 }
    );
  }
}
