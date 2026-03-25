import { NextResponse } from "next/server";
import { uploadFileToPinata } from "../../../../lib/server/pinata";

function isUploadableFile(file) {
  return Boolean(
    file &&
      typeof file === "object" &&
      typeof file.arrayBuffer === "function" &&
      typeof file.name === "string"
  );
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!isUploadableFile(file)) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }

    const uploadedFile = await uploadFileToPinata(file, {
      keyvalues: {
        scope: "dispute_evidence",
      },
      name: file.name,
    });

    return NextResponse.json({
      file: uploadedFile,
      message: "Attachment uploaded.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Unable to upload the attachment right now." },
      { status: 400 }
    );
  }
}
