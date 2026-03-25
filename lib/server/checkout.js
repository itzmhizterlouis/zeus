import crypto from "crypto";
import { db } from "./db";
import { getDeliveryProviderConfig, getPaymentProviderConfig } from "./env";
import { listDeliveryEvents, refreshDeliveryTracking } from "./deliveries";
import { getLatestDisputeForTransaction } from "./disputes";
import { getTransactionBySlug, listTransactionStatusHistory } from "./transactions";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function validateRequired(value, label) {
  if (!sanitizeString(value)) {
    throw new Error(`${label} is required.`);
  }
}

function normalizeEmail(email) {
  return sanitizeString(email).toLowerCase();
}

function normalizePhone(phone) {
  return sanitizeString(phone).replace(/[^\d]/g, "");
}

function createBuyerId() {
  return `buyer_${crypto.randomUUID()}`;
}

function toBuyerRecord(row) {
  if (!row) {
    return null;
  }

  return {
    createdAt: row.created_at,
    deliveryAddress: row.delivery_address,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    phone: row.phone,
    updatedAt: row.updated_at,
    verificationStatus: row.verification_status,
  };
}

function deriveJourney({ buyer, delivery, payment, transaction }) {
  if (payment?.status === "confirmed") {
    return {
      canPay: false,
      canRefreshTracking: Boolean(delivery),
      currentStep: 3,
      label: "Track",
    };
  }

  if (buyer) {
    return {
      canPay: true,
      canRefreshTracking: false,
      currentStep: 2,
      label: "Pay",
    };
  }

  return {
    canPay: transaction.status === "awaiting_payment",
    canRefreshTracking: false,
    currentStep: 1,
    label: "Verify",
  };
}

export async function getBuyerByTransactionId(transactionId) {
  const row = await db
    .prepare("SELECT * FROM buyers WHERE transaction_id = ?")
    .get(transactionId);
  return toBuyerRecord(row);
}

export async function upsertBuyerForTransaction(transaction, payload) {
  const fullName = sanitizeString(payload.fullName);
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.phone);
  const deliveryAddress = sanitizeString(
    payload.deliveryAddress || transaction.deliveryAddress
  );
  const timestamp = nowIso();
  const existing = await getBuyerByTransactionId(transaction.id);

  validateRequired(fullName, "Full name");
  validateRequired(email, "Email");
  validateRequired(phone, "Phone number");
  validateRequired(deliveryAddress, "Delivery address");

  if (phone.length < 10) {
    throw new Error("Phone number looks too short.");
  }

  if (existing) {
    await db.prepare(
      `UPDATE buyers
       SET full_name = ?, email = ?, phone = ?, delivery_address = ?, updated_at = ?
       WHERE transaction_id = ?`
    ).run(fullName, email, phone, deliveryAddress, timestamp, transaction.id);
  } else {
    await db.prepare(
      `INSERT INTO buyers (
        id, transaction_id, full_name, email, phone, delivery_address,
        verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      createBuyerId(),
      transaction.id,
      fullName,
      email,
      phone,
      deliveryAddress,
      timestamp,
      timestamp
    );
  }

  return getBuyerByTransactionId(transaction.id);
}

export async function getCheckoutStateBySlug(slug, options = {}) {
  let transaction = await getTransactionBySlug(slug);

  if (!transaction) {
    return null;
  }

  if (options.refreshDelivery && transaction.delivery?.providerReference) {
    await refreshDeliveryTracking(transaction);
    transaction = await getTransactionBySlug(slug);
  }

  const buyer = await getBuyerByTransactionId(transaction.id);
  const payment = transaction.payment || null;
  const dispute = await getLatestDisputeForTransaction(transaction.id);
  const delivery = transaction.delivery
    ? {
        ...transaction.delivery,
        events: await listDeliveryEvents(transaction.delivery.id),
      }
    : null;
  const journey = deriveJourney({ buyer, delivery, payment, transaction });

  return {
    buyer,
    delivery,
    deliveryProvider: getDeliveryProviderConfig().provider,
    dispute,
    journey,
    payment,
    paymentProvider: getPaymentProviderConfig().provider,
    statusHistory: await listTransactionStatusHistory(transaction.id),
    transaction,
  };
}
