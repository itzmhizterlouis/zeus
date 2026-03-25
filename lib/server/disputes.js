import crypto from "crypto";
import { db } from "./db";
import { getAdminAlertEmails, sendEmail } from "./email";
import { getTransactionById, updateTransactionStatus } from "./transactions";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function createDisputeId() {
  return `dispute_${crypto.randomUUID()}`;
}

function serializeAttachments(attachments) {
  return attachments?.length ? JSON.stringify(attachments) : "";
}

function parseAttachments(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateRequired(value, label) {
  if (!sanitizeString(value)) {
    throw new Error(`${label} is required.`);
  }
}

function reasonLabel(reason) {
  const value = sanitizeString(reason);

  if (value === "not_delivered") {
    return "Buyer reported that the item was not delivered.";
  }

  if (value === "wrong_item") {
    return "Buyer reported that the wrong item was received.";
  }

  if (value === "condition_mismatch") {
    return "Buyer reported that the item condition does not match the listing.";
  }

  if (value === "tampered_or_used") {
    return "Buyer reported that the item appears used or tampered with.";
  }

  return "Buyer opened a dispute.";
}

async function toDisputeRecord(row) {
  if (!row) {
    return null;
  }

  const transaction = await db
    .prepare(
      `SELECT id, short_code, product_name, seller_name, total_buyer_pays, status
       FROM transactions
       WHERE id = ?`
    )
    .get(row.transaction_id);
  const buyer = await db
    .prepare("SELECT id, full_name, email, phone FROM buyers WHERE id = ?")
    .get(row.buyer_id);

  return {
    adminNote: row.admin_note || "",
    buyer: buyer
      ? {
          email: buyer.email,
          fullName: buyer.full_name,
          id: buyer.id,
          phone: buyer.phone,
        }
      : null,
    createdAt: row.created_at,
    description: row.description || "",
    evidenceAttachments: parseAttachments(row.evidence_attachments),
    evidenceNote: row.evidence_note || "",
    id: row.id,
    reason: row.reason,
    resolution: row.resolution || "",
    resolvedAt: row.resolved_at || "",
    status: row.status,
    transaction: transaction
      ? {
          amount: transaction.total_buyer_pays,
          id: transaction.id,
          productName: transaction.product_name,
          sellerName: transaction.seller_name,
          shortCode: transaction.short_code,
          status: transaction.status,
        }
      : null,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

async function getSellerByTransactionId(transactionId) {
  const row = await db
    .prepare(
      `SELECT sellers.id, sellers.full_name, sellers.business_name, sellers.email, sellers.phone
       FROM transactions
       JOIN sellers ON sellers.id = transactions.seller_id
       WHERE transactions.id = ?`
    )
    .get(transactionId);

  if (!row) {
    return null;
  }

  return {
    displayName: row.business_name || row.full_name,
    email: row.email,
    id: row.id,
    phone: row.phone,
  };
}

async function getBuyerByTransactionId(transactionId) {
  const row = await db
    .prepare("SELECT * FROM buyers WHERE transaction_id = ?")
    .get(transactionId);

  if (!row) {
    return null;
  }

  return {
    deliveryAddress: row.delivery_address,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    phone: row.phone,
  };
}

export async function getLatestDisputeForTransaction(transactionId) {
  const row = await db
    .prepare(
      `SELECT * FROM disputes
       WHERE transaction_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(transactionId);

  return toDisputeRecord(row);
}

async function getOpenDisputeForTransaction(transactionId) {
  const row = await db
    .prepare(
      `SELECT * FROM disputes
       WHERE transaction_id = ? AND status IN ('open', 'under_review')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(transactionId);

  return toDisputeRecord(row);
}

export async function listDisputes() {
  const rows = await db
    .prepare(
      `SELECT * FROM disputes
       ORDER BY
         CASE
           WHEN status IN ('open', 'under_review') THEN 0
           ELSE 1
         END,
         created_at DESC`
    )
    .all();

  return Promise.all(rows.map(toDisputeRecord));
}

export async function listDisputesForSeller(sellerId) {
  const rows = await db
    .prepare(
      `SELECT disputes.*
       FROM disputes
       JOIN transactions ON transactions.id = disputes.transaction_id
       WHERE transactions.seller_id = ?
       ORDER BY
         CASE
           WHEN disputes.status IN ('open', 'under_review') THEN 0
           ELSE 1
         END,
         disputes.created_at DESC`
    )
    .all(sellerId);

  return Promise.all(rows.map(toDisputeRecord));
}

export async function createDisputeForTransaction(transactionId, payload) {
  const transaction = await getTransactionById(transactionId);

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (transaction.payment?.status !== "confirmed") {
    throw new Error("A dispute can only be opened after payment is confirmed.");
  }

  const buyer = await getBuyerByTransactionId(transactionId);

  if (!buyer) {
    throw new Error("Buyer details are required before opening a dispute.");
  }

  const existingDispute = await getOpenDisputeForTransaction(transactionId);

  if (existingDispute) {
    throw new Error("There is already an open dispute on this transaction.");
  }

  const reason = sanitizeString(payload.reason);
  const description = sanitizeString(payload.description);
  const evidenceNote = sanitizeString(payload.evidenceNote);
  const evidenceAttachments = Array.isArray(payload.evidenceAttachments)
    ? payload.evidenceAttachments
        .map((attachment) => ({
          cid: sanitizeString(attachment?.cid),
          mimeType: sanitizeString(attachment?.mimeType),
          name: sanitizeString(attachment?.name),
          size: Number(attachment?.size || 0),
          url: sanitizeString(attachment?.url),
        }))
        .filter((attachment) => attachment.url)
    : [];

  validateRequired(reason, "Dispute reason");
  validateRequired(description, "What happened");

  const allowedReasons = new Set([
    "not_delivered",
    "wrong_item",
    "condition_mismatch",
    "tampered_or_used",
  ]);

  if (!allowedReasons.has(reason)) {
    throw new Error("Choose a valid dispute reason.");
  }

  const timestamp = nowIso();

  await db.prepare(
    `INSERT INTO disputes (
      id, transaction_id, buyer_id, reason, description, evidence_note, evidence_attachments,
      status, resolution, admin_note, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', '', '', ?, ?, NULL)`
  ).run(
    createDisputeId(),
    transactionId,
    buyer.id,
    reason,
    description,
    evidenceNote,
    serializeAttachments(evidenceAttachments),
    timestamp,
    timestamp
  );

  await updateTransactionStatus(
    transactionId,
    "dispute_open",
    reasonLabel(reason),
    {
      disputeReason: reason,
    }
  );

  const createdDispute = await getLatestDisputeForTransaction(transactionId);
  const seller = await getSellerByTransactionId(transactionId);
  const adminEmails = getAdminAlertEmails();

  await Promise.allSettled(
    [
      seller?.email
        ? sendEmail({
            html: `<p>A buyer opened a dispute for <strong>${transaction.productName}</strong>.</p><p>Reason: ${reasonLabel(reason)}</p><p>${description}</p>`,
            subject: `Dispute opened for ${transaction.shortCode}`,
            text: `A buyer opened a dispute for ${transaction.productName}. Reason: ${reasonLabel(reason)} ${description}`,
            to: seller.email,
          })
        : null,
      adminEmails.length
        ? sendEmail({
            html: `<p>A new dispute needs review.</p><p>Transaction: <strong>${transaction.shortCode}</strong></p><p>Reason: ${reasonLabel(reason)}</p>`,
            subject: `Admin alert: dispute opened for ${transaction.shortCode}`,
            text: `A new dispute needs review for ${transaction.shortCode}.`,
            to: adminEmails,
          })
        : null,
    ].filter(Boolean)
  );

  return createdDispute;
}

export async function resolveDispute(disputeId, payload) {
  const dispute = await db.prepare("SELECT * FROM disputes WHERE id = ?").get(disputeId);

  if (!dispute) {
    throw new Error("Dispute not found.");
  }

  if (!["open", "under_review"].includes(dispute.status)) {
    throw new Error("This dispute has already been resolved.");
  }

  const resolution = sanitizeString(payload.resolution);
  const adminNote = sanitizeString(payload.adminNote);

  validateRequired(resolution, "Resolution");

  const allowedResolutions = new Set(["refund_buyer", "release_seller", "return_first"]);

  if (!allowedResolutions.has(resolution)) {
    throw new Error("Choose a valid admin resolution.");
  }

  const timestamp = nowIso();

  await db.prepare(
    `UPDATE disputes
     SET status = 'resolved', resolution = ?, admin_note = ?, updated_at = ?, resolved_at = ?
     WHERE id = ?`
  ).run(resolution, adminNote, timestamp, timestamp, disputeId);

  if (resolution === "refund_buyer") {
    await updateTransactionStatus(
      dispute.transaction_id,
      "refund_approved",
      "Admin approved a refund to the buyer.",
      adminNote ? { adminNote } : null
    );
  }

  if (resolution === "release_seller") {
    await updateTransactionStatus(
      dispute.transaction_id,
      "seller_release_approved",
      "Admin approved release of funds to the seller.",
      adminNote ? { adminNote } : null
    );
  }

  if (resolution === "return_first") {
    await updateTransactionStatus(
      dispute.transaction_id,
      "return_required",
      "Admin requested a return before refund.",
      adminNote ? { adminNote } : null
    );
  }

  const resolvedDispute = await toDisputeRecord(
    await db.prepare("SELECT * FROM disputes WHERE id = ?").get(disputeId)
  );
  const buyer = await getBuyerByTransactionId(dispute.transaction_id);
  const seller = await getSellerByTransactionId(dispute.transaction_id);
  const subject = `Dispute resolved for ${resolvedDispute?.transaction?.shortCode || disputeId}`;

  await Promise.allSettled(
    [buyer?.email, seller?.email]
      .filter(Boolean)
      .map((email) =>
        sendEmail({
          html: `<p>Your dispute for <strong>${resolvedDispute?.transaction?.productName || "this item"}</strong> has been resolved.</p><p>Resolution: <strong>${resolution.replace(/_/g, " ")}</strong></p><p>${adminNote || ""}</p>`,
          subject,
          text: `Your dispute has been resolved as ${resolution.replace(/_/g, " ")}. ${adminNote}`,
          to: email,
        })
      )
  );

  return resolvedDispute;
}
