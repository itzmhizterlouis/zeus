import { NextResponse } from "next/server";
import { getCheckoutStateBySlug } from "../../../../lib/server/checkout";

export async function GET(_request, { params }) {
  const { slug } = await params;
  const checkoutState = await getCheckoutStateBySlug(slug);

  if (!checkoutState) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  return NextResponse.json(checkoutState);
}
