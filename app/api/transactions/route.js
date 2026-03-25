import { NextResponse } from "next/server";
import { getCurrentSeller } from "../../../lib/server/seller-auth";
import { createTransactionForSeller } from "../../../lib/server/transactions";

export async function POST(request) {
  try {
    const seller = await getCurrentSeller();

    if (!seller) {
      return NextResponse.json(
        { error: "Your session expired. Please log in again." },
        { status: 401 }
      );
    }

    const payload = await request.json();
    const transaction = await createTransactionForSeller(seller, payload);
    const origin = request.nextUrl.origin;

    return NextResponse.json({
      generatedLink: `${origin}/pay/${transaction.slug}`,
      message: "Customer link generated.",
      transaction,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to generate a link right now." },
      { status: 400 }
    );
  }
}
