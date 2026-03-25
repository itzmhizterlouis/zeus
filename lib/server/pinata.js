function sanitizeString(value) {
  return String(value || "").trim();
}

export function getPinataConfig() {
  return {
    gatewayUrl:
      sanitizeString(process.env.PINATA_GATEWAY_URL) || "https://gateway.pinata.cloud/ipfs",
    jwt: sanitizeString(process.env.PINATA_JWT),
  };
}

export function isPinataConfigured() {
  return Boolean(getPinataConfig().jwt);
}

export async function uploadFileToPinata(file, metadata = {}) {
  if (!file) {
    throw new Error("A file is required.");
  }

  const config = getPinataConfig();

  if (!config.jwt) {
    throw new Error("Pinata is not configured yet.");
  }

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("network", "public");
  formData.append(
    "name",
    sanitizeString(metadata.name) || sanitizeString(file.name) || "zescrow-dispute-file"
  );

  if (Object.keys(metadata.keyvalues || {}).length) {
    formData.append("keyvalues", JSON.stringify(metadata.keyvalues));
  }

  const response = await fetch("https://uploads.pinata.cloud/v3/files", {
    body: formData,
    headers: {
      Authorization: `Bearer ${config.jwt}`,
    },
    method: "POST",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.reason || data?.message || "Pinata upload failed.");
  }

  const cid = sanitizeString(data?.data?.cid || data?.cid);
  const fileId = sanitizeString(data?.data?.id || data?.id);
  const name = sanitizeString(data?.data?.name || data?.name || file.name);
  const mimeType = sanitizeString(data?.data?.mime_type || data?.mime_type || file.type);
  const size = Number(data?.data?.size || data?.size || file.size || 0);

  return {
    cid,
    fileId,
    mimeType,
    name,
    size,
    url: `${config.gatewayUrl.replace(/\/+$/, "")}/${cid}`,
  };
}
