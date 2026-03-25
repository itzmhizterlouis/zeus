import { NextResponse } from "next/server";
import { listDisputes } from "../../../../lib/server/disputes";

export async function GET() {
  return NextResponse.json({
    disputes: await listDisputes(),
  });
}
