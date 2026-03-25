import crypto from "crypto";
import {
  buildLocationDisplay,
  getNigeriaLocationById,
  getNigeriaLocationByLabel,
} from "../nigeria-locations";
import { db } from "./db";
import { quoteDeliveryForTransaction, upsertQuotedDeliveryForTransaction } from "./deliveries";

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

function slugify(value) {
  return sanitizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function createShortCode() {
  return `TRX-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
}

function createTransactionId() {
  return `txn_${crypto.randomUUID()}`;
}

function createStatusHistoryId() {
  return `txn_history_${crypto.randomUUID()}`;
}

function serializeMetadata(metadata) {
  return metadata ? JSON.stringify(metadata) : "";
}

function parseMetadata(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeLocationData(location) {
  return location ? JSON.stringify(location) : "";
}

function parseLocationData(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getFallbackLocationFromDisplay(value) {
  const normalizedValue = sanitizeString(value);
  const locationLabel = normalizedValue.split("—")[0].split(" - ")[0].trim();
  return getNigeriaLocationByLabel(locationLabel);
}

function readStoredLocation(jsonValue, displayValue) {
  return (
    parseLocationData(jsonValue) ||
    getFallbackLocationFromDisplay(displayValue) ||
    null
  );
}

function resolveNigeriaLocation({ id, label }, fieldLabel) {
  const selectedById = getNigeriaLocationById(id);

  if (selectedById) {
    return selectedById;
  }

  const selectedByLabel = getNigeriaLocationByLabel(label);

  if (selectedByLabel) {
    return selectedByLabel;
  }

  throw new Error(`${fieldLabel} must be selected from the Nigeria list.`);
}

function toDeliverySummary(row) {
  if (!row) {
    return null;
  }

  return {
    bookedAt: row.booked_at || "",
    dropoffAddress: row.dropoff_address,
    id: row.id,
    lastSyncedAt: row.last_synced_at || "",
    pickupAddress: row.pickup_address,
    provider: row.provider,
    providerMode: row.provider_mode,
    providerReference: row.provider_reference || "",
    quoteReference: row.quote_reference || "",
    quotedFee: row.quoted_fee,
    receiverName: row.receiver_name || "",
    receiverPhone: row.receiver_phone || "",
    status: row.status,
    trackingUrl: row.tracking_url || "",
    updatedAt: row.updated_at,
  };
}

function toPaymentSummary(row) {
  if (!row) {
    return null;
  }

  return {
    amount: row.amount,
    confirmedAt: row.confirmed_at || "",
    createdAt: row.created_at,
    currency: row.currency,
    merchantReference: row.merchant_reference,
    paymentReference: row.payment_reference || "",
    provider: row.provider,
    providerMode: row.provider_mode,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function toBuyerSummary(row) {
  if (!row) {
    return null;
  }

  return {
    deliveryAddress: row.delivery_address,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    phone: row.phone,
    updatedAt: row.updated_at,
    verificationStatus: row.verification_status,
  };
}

async function getRelatedStateForTransaction(transactionId) {
  return {
    buyer: toBuyerSummary(
      await db.prepare("SELECT * FROM buyers WHERE transaction_id = ?").get(transactionId)
    ),
    delivery: toDeliverySummary(
      await db.prepare("SELECT * FROM deliveries WHERE transaction_id = ?").get(transactionId)
    ),
    payment: toPaymentSummary(
      await db
        .prepare(
          `SELECT * FROM payments
           WHERE transaction_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(transactionId)
    ),
  };
}

async function toTransactionRecord(row) {
  if (!row) {
    return null;
  }

  const related = await getRelatedStateForTransaction(row.id);
  const pickupLocationData = readStoredLocation(
    row.pickup_location_data,
    row.pickup_location
  );
  const deliveryLocationData = readStoredLocation(
    row.delivery_location_data,
    row.delivery_address
  );

  return {
    buyer: related.buyer,
    condition: row.item_condition,
    createdAt: row.created_at,
    delivery: related.delivery,
    deliveryAddress: row.delivery_address,
    deliveryAddressNote: row.delivery_address_note || "",
    deliveryFee: row.delivery_fee,
    deliveryLocationData,
    description: row.description,
    escrowFee: row.escrow_fee,
    id: row.id,
    payment: related.payment,
    pickupLocation: row.pickup_location,
    pickupAddressNote: row.pickup_address_note || "",
    pickupLocationData,
    price: row.price,
    productName: row.product_name,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    shortCode: row.short_code,
    slug: row.slug,
    status: row.status,
    totalBuyerPays: row.total_buyer_pays,
    updatedAt: row.updated_at,
  };
}

export async function appendTransactionHistory(transactionId, status, note = "", metadata = null) {
  await db.prepare(
    `INSERT INTO transaction_status_history (id, transaction_id, status, note, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    createStatusHistoryId(),
    transactionId,
    status,
    sanitizeString(note),
    serializeMetadata(metadata),
    nowIso()
  );
}

export async function listTransactionStatusHistory(transactionId) {
  const transaction = await db
    .prepare("SELECT id, status, created_at FROM transactions WHERE id = ?")
    .get(transactionId);
  const rows = await db
    .prepare(
      `SELECT * FROM transaction_status_history
       WHERE transaction_id = ?
       ORDER BY created_at ASC`
    )
    .all(transactionId);

  if (!transaction) {
    return [];
  }

  const history = rows.map((row) => ({
    createdAt: row.created_at,
    metadata: parseMetadata(row.metadata),
    note: row.note,
    status: row.status,
  }));

  if (!history.length || history[0].createdAt !== transaction.created_at) {
    history.unshift({
      createdAt: transaction.created_at,
      metadata: null,
      note: "Transaction created.",
      status: "awaiting_payment",
    });
  }

  return history;
}

export async function updateTransactionStatus(transactionId, status, note = "", metadata = null) {
  await db.prepare(
    `UPDATE transactions
     SET status = ?, updated_at = ?
     WHERE id = ?`
  ).run(status, nowIso(), transactionId);

  await appendTransactionHistory(transactionId, status, note, metadata);

  return getTransactionById(transactionId);
}

export async function createTransactionForSeller(seller, payload) {
  const productName = sanitizeString(payload.productName);
  const condition = sanitizeString(payload.condition);
  const pickupAddressNote = sanitizeString(payload.pickupAddressNote);
  const deliveryAddressNote = sanitizeString(payload.deliveryAddressNote);
  const price = Number(payload.price) || 0;
  const description = sanitizeString(payload.description);
  const pickupLocationData = resolveNigeriaLocation(
    {
      id: payload.pickupLocationId,
      label: payload.pickupLocation,
    },
    "Pickup location"
  );
  const deliveryLocationData = resolveNigeriaLocation(
    {
      id: payload.deliveryLocationId,
      label: payload.deliveryAddress,
    },
    "Delivery destination"
  );
  const pickupLocation = buildLocationDisplay(pickupLocationData, pickupAddressNote);
  const deliveryAddress = buildLocationDisplay(
    deliveryLocationData,
    deliveryAddressNote
  );

  validateRequired(productName, "Product name");
  validateRequired(condition, "Condition");
  validateRequired(pickupLocation, "Pickup location");
  validateRequired(deliveryAddress, "Delivery destination");

  if (price <= 0) {
    throw new Error("Price must be greater than zero.");
  }

  const deliveryQuote = await quoteDeliveryForTransaction({
    deliveryAddress,
    deliveryAddressNote,
    deliveryLocation: deliveryLocationData,
    pickupAddressNote,
    pickupLocation,
    pickupLocationData,
    price,
    productName,
    seller,
  });

  const escrowFee = Math.min(Math.round(price * 0.02), 25000);
  const deliveryFee = deliveryQuote.quotedFee;
  const totalBuyerPays = price + escrowFee + deliveryFee;
  const createdAt = nowIso();
  const baseSlug = slugify(productName) || "transaction";
  let slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

  while (await db.prepare("SELECT 1 FROM transactions WHERE slug = ?").get(slug)) {
    slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
  }

  let shortCode = createShortCode();
  while (
    await db.prepare("SELECT 1 FROM transactions WHERE short_code = ?").get(shortCode)
  ) {
    shortCode = createShortCode();
  }

  const row = {
    created_at: createdAt,
    delivery_address: deliveryAddress,
    delivery_address_note: deliveryAddressNote,
    delivery_location_data: serializeLocationData(deliveryLocationData),
    delivery_fee: deliveryFee,
    description,
    escrow_fee: escrowFee,
    id: createTransactionId(),
    item_condition: condition,
    pickup_location: pickupLocation,
    pickup_address_note: pickupAddressNote,
    pickup_location_data: serializeLocationData(pickupLocationData),
    price,
    product_name: productName,
    seller_id: seller.id,
    seller_name: seller.displayName,
    short_code: shortCode,
    slug,
    status: "awaiting_payment",
    total_buyer_pays: totalBuyerPays,
    updated_at: createdAt,
  };

  await db.prepare(
    `INSERT INTO transactions (
      id, slug, short_code, seller_id, seller_name, product_name, description,
      item_condition, pickup_location, pickup_location_data, pickup_address_note,
      delivery_address, delivery_location_data, delivery_address_note, price,
      escrow_fee, delivery_fee, total_buyer_pays, status, created_at, updated_at
    ) VALUES (
      @id, @slug, @short_code, @seller_id, @seller_name, @product_name, @description,
      @item_condition, @pickup_location, @pickup_location_data, @pickup_address_note,
      @delivery_address, @delivery_location_data, @delivery_address_note, @price,
      @escrow_fee, @delivery_fee, @total_buyer_pays, @status, @created_at, @updated_at
    )`
  ).run(row);

  await upsertQuotedDeliveryForTransaction(row, deliveryQuote);

  await appendTransactionHistory(row.id, "awaiting_payment", "Customer link generated.", {
    deliveryProvider: deliveryQuote.provider,
    deliveryReference: deliveryQuote.quoteReference,
  });

  return toTransactionRecord(row);
}

export async function listTransactionsForSeller(sellerId) {
  const rows = await db
    .prepare(
      `SELECT * FROM transactions
       WHERE seller_id = ?
       ORDER BY created_at DESC`
    )
    .all(sellerId);

  return Promise.all(rows.map(toTransactionRecord));
}

export async function getTransactionById(id) {
  const row = await db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  return toTransactionRecord(row);
}

export async function getTransactionBySlug(slug) {
  const row = await db.prepare("SELECT * FROM transactions WHERE slug = ?").get(slug);
  return toTransactionRecord(row);
}
