import { NextResponse } from "next/server";
import { listDisputes, resolveDispute } from "../../../../../../lib/server/disputes";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const payload = await request.json();
    const dispute = await resolveDispute(id, payload);

    return NextResponse.json({
      dispute,
      disputes: await listDisputes(),
      message: "Dispute resolution recorded.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to resolve the dispute right now." },
      { status: 400 }
    );
  }
}
