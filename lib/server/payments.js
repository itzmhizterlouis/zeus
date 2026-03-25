import crypto from "crypto";
import { db } from "./db";
import { getAdminAlertEmails, sendEmail } from "./email";
import { getPaymentProviderConfig, isQuicktellerConfigured } from "./env";
import { createDeliveryBooking } from "./deliveries";
import { getBuyerByTransactionId } from "./checkout";
import { getTransactionById, updateTransactionStatus } from "./transactions";

function nowIso() {
  return new Date().toISOString();
}

function createPaymentId() {
  return `payment_${crypto.randomUUID()}`;
}

function createMockReference(prefix) {
  return `${prefix}_${crypto.randomUUID().split("-")[0]}`;
}

function createMerchantReference(shortCode) {
  return `${shortCode}-${Date.now()}`;
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function toMinorUnits(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function serializePayload(value) {
  return value ? JSON.stringify(value) : "";
}

function parsePayload(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getSellerByTransactionId(transactionId) {
  const row = await db
    .prepare(
      `SELECT sellers.email, sellers.full_name, sellers.business_name
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
  };
}

function toPaymentRecord(row) {
  if (!row) {
    return null;
  }

  return {
    amount: row.amount,
    buyerId: row.buyer_id || "",
    checkoutPayload: parsePayload(row.checkout_payload),
    confirmedAt: row.confirmed_at || "",
    createdAt: row.created_at,
    currency: row.currency,
    id: row.id,
    merchantReference: row.merchant_reference,
    paymentReference: row.payment_reference || "",
    provider: row.provider,
    providerMode: row.provider_mode,
    providerResponse: parsePayload(row.provider_response),
    status: row.status,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

async function getPaymentByMerchantReference(transactionId, merchantReference) {
  const row = await db
    .prepare(
      `SELECT * FROM payments
       WHERE transaction_id = ? AND merchant_reference = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(transactionId, merchantReference);
  return toPaymentRecord(row);
}

export async function getLatestPaymentForTransaction(transactionId) {
  const row = await db
    .prepare(
      `SELECT * FROM payments
       WHERE transaction_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(transactionId);
  return toPaymentRecord(row);
}

async function getConfirmedPaymentForTransaction(transactionId) {
  const row = await db
    .prepare(
      `SELECT * FROM payments
       WHERE transaction_id = ? AND status = 'confirmed'
       ORDER BY confirmed_at DESC, updated_at DESC
       LIMIT 1`
    )
    .get(transactionId);
  return toPaymentRecord(row);
}

export async function createPaymentAttempt(transaction, buyer, origin = "") {
  const config = getPaymentProviderConfig(origin);
  const merchantReference = createMerchantReference(transaction.shortCode);
  const timestamp = nowIso();
  const paymentRow = {
    amount: transaction.totalBuyerPays,
    buyer_id: buyer?.id || null,
    checkout_payload: "",
    confirmed_at: null,
    created_at: timestamp,
    currency: config.currency,
    id: createPaymentId(),
    merchant_reference: merchantReference,
    payment_reference: "",
    provider:
      config.provider === "interswitch" && isQuicktellerConfigured(origin)
        ? "interswitch"
        : "mock",
    provider_mode: config.environment,
    provider_response: "",
    status: "initialized",
    transaction_id: transaction.id,
    updated_at: timestamp,
  };

  const redirectUrl = `${config.appBaseUrl}/pay/${transaction.slug}?merchantReference=${encodeURIComponent(
    merchantReference
  )}`;
  const gatewayAmount = toMinorUnits(transaction.totalBuyerPays);
  const checkoutRequest =
    paymentRow.provider === "interswitch"
      ? {
          amount: gatewayAmount,
          currency: config.currency,
          cust_email: buyer.email,
          cust_name: buyer.fullName,
          merchant_code: config.quickteller.merchantCode,
          mode: config.environment === "live" ? "LIVE" : "TEST",
          pay_item_id: config.quickteller.payItemId,
          pay_item_name: config.quickteller.payItemName,
          site_redirect_url: redirectUrl,
          txn_ref: merchantReference,
        }
      : {
          amount: transaction.totalBuyerPays,
          currency: config.currency,
          mode: "TEST",
          provider: "mock",
          txn_ref: merchantReference,
        };

  paymentRow.checkout_payload = serializePayload(checkoutRequest);

  await db.prepare(
    `INSERT INTO payments (
      id, transaction_id, buyer_id, provider, provider_mode, merchant_reference,
      payment_reference, amount, currency, status, checkout_payload,
      provider_response, created_at, updated_at, confirmed_at
    ) VALUES (
      @id, @transaction_id, @buyer_id, @provider, @provider_mode, @merchant_reference,
      @payment_reference, @amount, @currency, @status, @checkout_payload,
      @provider_response, @created_at, @updated_at, @confirmed_at
    )`
  ).run(paymentRow);

  await updateTransactionStatus(
    transaction.id,
    "payment_pending_confirmation",
    "Buyer started the payment flow.",
    { merchantReference }
  );

  const payment = await getPaymentByMerchantReference(transaction.id, merchantReference);

  return {
    checkout: payment.provider === "interswitch"
      ? {
          provider: "interswitch",
          request: checkoutRequest,
          scriptUrl: config.quickteller.scriptUrl,
        }
      : {
          provider: "mock",
          request: checkoutRequest,
          scriptUrl: "",
        },
    payment,
  };
}

async function confirmInterswitchPayment(transaction, payment, origin = "") {
  const config = getPaymentProviderConfig(origin);
  const query = new URLSearchParams({
    amount: String(toMinorUnits(payment.amount)),
    merchantcode: config.quickteller.merchantCode,
    transactionreference: payment.merchantReference,
  });
  const response = await fetch(
    `${config.quickteller.confirmationBaseUrl}/collections/api/v1/gettransaction.json?${query.toString()}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      method: "GET",
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const paymentReference = sanitizeString(
    data?.PaymentReference || data?.paymentReference
  );
  const confirmedAmount = Number(data?.Amount || data?.amount || 0);
  const responseCode = sanitizeString(data?.ResponseCode || data?.responseCode);
  const responseDescription = sanitizeString(
    data?.ResponseDescription || data?.responseDescription
  );
  const expectedAmount = toMinorUnits(payment.amount);

  await db.prepare(
    `UPDATE payments
     SET provider_response = ?, updated_at = ?,
         payment_reference = CASE
           WHEN ? != '' THEN ?
           ELSE payment_reference
         END,
         status = CASE
           WHEN ? = '00' THEN 'confirmed'
           ELSE 'failed'
         END,
         confirmed_at = CASE
           WHEN ? = '00' THEN ?
           ELSE confirmed_at
         END
     WHERE id = ?`
  ).run(
    serializePayload(data),
    nowIso(),
    paymentReference,
    paymentReference,
    responseCode,
    responseCode,
    responseCode === "00" ? nowIso() : null,
    payment.id
  );

  if (responseCode !== "00") {
    await updateTransactionStatus(transaction.id, "awaiting_payment", responseDescription || "Payment not confirmed.");
    throw new Error(responseDescription || "Quickteller did not confirm the payment.");
  }

  if (confirmedAmount && confirmedAmount !== expectedAmount) {
    await updateTransactionStatus(
      transaction.id,
      "awaiting_payment",
      "Payment amount mismatch during confirmation."
    );
    throw new Error("Quickteller returned a different payment amount than expected.");
  }

  return getPaymentByMerchantReference(transaction.id, payment.merchantReference);
}

async function confirmMockPayment(transaction, payment) {
  const paymentReference = createMockReference("mock_qt");
  const responsePayload = {
    PaymentReference: paymentReference,
    ResponseCode: "00",
    ResponseDescription: "Mock payment confirmed in test mode.",
  };

  await db.prepare(
    `UPDATE payments
     SET provider_response = ?, updated_at = ?, payment_reference = ?,
         status = 'confirmed', confirmed_at = ?
     WHERE id = ?`
  ).run(
    serializePayload(responsePayload),
    nowIso(),
    paymentReference,
    nowIso(),
    payment.id
  );

  return getPaymentByMerchantReference(transaction.id, payment.merchantReference);
}

export async function confirmPaymentForTransaction(
  transactionId,
  merchantReference,
  origin = ""
) {
  const transaction = await getTransactionById(transactionId);

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  const existingConfirmedPayment = await getConfirmedPaymentForTransaction(transactionId);

  if (existingConfirmedPayment) {
    return existingConfirmedPayment;
  }

  const payment = await getPaymentByMerchantReference(transactionId, merchantReference);

  if (!payment) {
    throw new Error("Payment session not found.");
  }

  if (payment.status === "confirmed") {
    return payment;
  }

  const confirmedPayment =
    payment.provider === "interswitch"
      ? await confirmInterswitchPayment(transaction, payment, origin)
      : confirmMockPayment(transaction, payment);
  const buyer = await getBuyerByTransactionId(transactionId);

  await updateTransactionStatus(
    transactionId,
    "payment_confirmed",
    "Buyer payment confirmed and secured in escrow.",
    { merchantReference }
  );

  const delivery = await createDeliveryBooking(transaction, buyer);

  await updateTransactionStatus(
    transactionId,
    delivery?.status === "booked" ? "delivery_booked" : "payment_confirmed",
    delivery?.status === "booked"
      ? "Delivery booking has been created."
      : "Payment confirmed.",
    delivery?.providerReference
      ? { deliveryReference: delivery.providerReference }
      : null
  );

  const seller = await getSellerByTransactionId(transactionId);
  const adminEmails = getAdminAlertEmails();

  await Promise.allSettled(
    [
      buyer?.email
        ? sendEmail({
            html: `<p>Your payment for <strong>${transaction.productName}</strong> has been confirmed and secured in escrow.</p><p>Reference: ${confirmedPayment.paymentReference || confirmedPayment.merchantReference}</p>`,
            subject: `Payment confirmed for ${transaction.shortCode}`,
            text: `Your payment for ${transaction.productName} has been confirmed and secured in escrow.`,
            to: buyer.email,
          })
        : null,
      seller?.email
        ? sendEmail({
            html: `<p>The buyer payment for <strong>${transaction.productName}</strong> has been confirmed.</p><p>You can now follow the delivery from your dashboard.</p>`,
            subject: `Buyer payment confirmed for ${transaction.shortCode}`,
            text: `The buyer payment for ${transaction.productName} has been confirmed.`,
            to: seller.email,
          })
        : null,
      adminEmails.length
        ? sendEmail({
            html: `<p>A buyer payment was confirmed for transaction <strong>${transaction.shortCode}</strong>.</p>`,
            subject: `Admin alert: payment confirmed for ${transaction.shortCode}`,
            text: `A buyer payment was confirmed for ${transaction.shortCode}.`,
            to: adminEmails,
          })
        : null,
    ].filter(Boolean)
  );

  return confirmedPayment;
}
