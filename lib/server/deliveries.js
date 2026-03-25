import crypto from "crypto";
import { db } from "./db";
import { getAppBaseUrl, getDeliveryProviderConfig, isSendboxConfigured } from "./env";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeString(value) {
  return String(value || "").trim();
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

function createDeliveryId() {
  return `delivery_${crypto.randomUUID()}`;
}

function createDeliveryEventId() {
  return `delivery_event_${crypto.randomUUID()}`;
}

function createMockReference(prefix) {
  return `${prefix}_${crypto.randomUUID().split("-")[0]}`;
}

function normalizeDeliveryStatus(status) {
  const value = sanitizeString(status).toLowerCase();

  if (!value) {
    return "quote_ready";
  }

  if (value.includes("deliver")) {
    return "delivered";
  }

  if (value.includes("transit") || value.includes("pickup") || value.includes("dispatch")) {
    return "in_transit";
  }

  if (value.includes("book") || value.includes("assign") || value.includes("accept")) {
    return "booked";
  }

  if (value.includes("cancel") || value.includes("fail")) {
    return "cancelled";
  }

  if (value.includes("quote") || value.includes("rate")) {
    return "quote_ready";
  }

  return value.replace(/\s+/g, "_");
}

function candidateObjects(source) {
  return [source, source?.data, source?.result, source?.response]
    .filter(Boolean)
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]));
}

function readFirstString(source, keys, fallback = "") {
  for (const candidate of candidateObjects(source)) {
    for (const key of keys) {
      const value = sanitizeString(candidate?.[key]);

      if (value) {
        return value;
      }
    }
  }

  return fallback;
}

function readFirstNumber(source, keys, fallback = 0) {
  for (const candidate of candidateObjects(source)) {
    for (const key of keys) {
      const parsed = Number(candidate?.[key]);

      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
      }
    }
  }

  return fallback;
}

function readFirstArray(source, keys) {
  for (const candidate of candidateObjects(source)) {
    for (const key of keys) {
      if (Array.isArray(candidate?.[key])) {
        return candidate[key];
      }
    }
  }

  return [];
}

function getMockQuoteFee(destinationLocation, destinationAddress, price) {
  const stateText = sanitizeString(destinationLocation?.state).toLowerCase();
  const destinationText = sanitizeString(destinationAddress).toLowerCase();
  const isLagosRoute = stateText === "lagos" || destinationText.includes("lagos");
  const baseFee = isLagosRoute ? 8500 : 18000;
  const insuranceBuffer = price >= 500000 ? 2500 : 0;
  return baseFee + insuranceBuffer;
}

function toDeliveryRecord(row) {
  if (!row) {
    return null;
  }

  return {
    bookedAt: row.booked_at || "",
    createdAt: row.created_at,
    deliveredAt: row.delivered_at || "",
    dropoffAddress: row.dropoff_address,
    id: row.id,
    lastSyncedAt: row.last_synced_at || "",
    pickupAddress: row.pickup_address,
    provider: row.provider,
    providerMode: row.provider_mode,
    providerPayload: parsePayload(row.provider_payload),
    providerReference: row.provider_reference || "",
    quoteReference: row.quote_reference || "",
    quotedFee: row.quoted_fee,
    receiverName: row.receiver_name || "",
    receiverPhone: row.receiver_phone || "",
    status: row.status,
    trackingUrl: row.tracking_url || "",
    transactionId: row.transaction_id,
    updatedAt: row.updated_at,
  };
}

function toDeliveryEvent(row) {
  return {
    createdAt: row.created_at,
    eventAt: row.event_at,
    location: row.location || "",
    note: row.note || "",
    providerPayload: parsePayload(row.provider_payload),
    status: row.status,
  };
}

function providerName(provider) {
  return provider === "sendbox" ? "Sendbox" : "mock";
}

function normalizeCountryName(value) {
  const normalized = sanitizeString(value).toUpperCase();

  if (!normalized || normalized === "NG") {
    return "Nigeria";
  }

  return value;
}

function buildAddressLine(location, addressNote = "") {
  const parts = [
    sanitizeString(addressNote),
    sanitizeString(location?.city),
    sanitizeString(location?.state),
    normalizeCountryName(location?.country),
  ].filter(Boolean);

  return parts.join(", ");
}

function buildStructuredLocation({
  addressNote = "",
  contactName = "",
  location = null,
  phone = "",
}) {
  const countryCode = sanitizeString(location?.country).toUpperCase() || "NG";
  const postCode = sanitizeString(location?.postCode);
  const addressLine = buildAddressLine(location, addressNote);
  const city = sanitizeString(location?.city);
  const state = sanitizeString(location?.state);

  return {
    address: addressLine,
    city,
    country: normalizeCountryName(countryCode),
    country_code: countryCode,
    name: sanitizeString(contactName),
    phone: sanitizeString(phone),
    postal_code: postCode,
    postcode: postCode,
    state,
    street: sanitizeString(addressNote) || city || state,
  };
}

async function getSellerContact(sellerId, fallbackName = "Seller") {
  const row = await db
    .prepare(
      `SELECT full_name, business_name, phone
       FROM sellers
       WHERE id = ?`
    )
    .get(sellerId);

  return {
    displayName: sanitizeString(row?.business_name || row?.full_name || fallbackName),
    phone: sanitizeString(row?.phone),
  };
}

function buildSendboxHeaders(config) {
  const headerName = config.sendbox.authHeader || "Authorization";
  const prefix = sanitizeString(config.sendbox.authPrefix);
  const headerValue = prefix
    ? `${prefix} ${config.sendbox.apiKey}`
    : config.sendbox.apiKey;

  return {
    "Content-Type": "application/json",
    [headerName]: headerValue,
  };
}

async function sendboxRequest(path, { method = "POST", payload } = {}) {
  const config = getDeliveryProviderConfig();

  if (!isSendboxConfigured()) {
    throw new Error("Sendbox delivery is not fully configured yet.");
  }

  const response = await fetch(`${config.sendbox.baseUrl}${path}`, {
    body: method === "GET" ? undefined : JSON.stringify(payload || {}),
    headers: buildSendboxHeaders(config),
    method,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      readFirstString(
        data,
        ["message", "error", "detail"],
        "Sendbox request failed."
      )
    );
  }

  return data || {};
}

function buildSendboxPayload({
  buyer = null,
  deliveryAddress,
  deliveryAddressNote = "",
  deliveryLocation = null,
  pickupAddressNote = "",
  pickupLocation,
  pickupLocationData = null,
  price = 0,
  productName,
  seller = null,
  shortCode = "",
}) {
  const sellerAddress = buildStructuredLocation({
    addressNote: pickupAddressNote,
    contactName: seller?.displayName || "Seller",
    location: pickupLocationData,
    phone: seller?.phone || "",
  });
  const destinationNote =
    sanitizeString(buyer?.deliveryAddress) &&
    sanitizeString(buyer?.deliveryAddress) !== sanitizeString(deliveryAddress)
      ? sanitizeString(buyer.deliveryAddress)
      : sanitizeString(deliveryAddressNote);
  const buyerAddress = buildStructuredLocation({
    addressNote: destinationNote,
    contactName: buyer?.fullName || "Buyer",
    location: deliveryLocation,
    phone: buyer?.phone || "",
  });

  return {
    delivery_address: buyerAddress.address || deliveryAddress,
    destination: buyerAddress,
    dropoff_address: buyerAddress.address || deliveryAddress,
    item_name: productName,
    item_value: price,
    metadata: {
      delivery_label: sanitizeString(deliveryAddress),
      pickup_label: sanitizeString(pickupLocation),
      short_code: shortCode,
    },
    order_reference: shortCode,
    origin: sellerAddress,
    package: {
      currency: "NGN",
      description: productName,
      name: productName,
      quantity: 1,
      value: price,
      weight: 1,
    },
    pickup_address: sellerAddress.address || pickupLocation,
    recipient_name: buyerAddress.name,
    recipient_phone: buyerAddress.phone,
    sender_name: sellerAddress.name,
    sender_phone: sellerAddress.phone,
  };
}

function buildSendboxQuoteRecord(config, response) {
  return {
    provider: "sendbox",
    providerMode: config.environment,
    providerPayload: response,
    quoteReference: readFirstString(response, ["quote_reference", "reference", "id", "code"]),
    quotedFee: readFirstNumber(
      response,
      ["quoted_fee", "fee", "amount", "price", "delivery_fee"]
    ),
    status: "quote_ready",
    trackingUrl: readFirstString(
      response,
      ["tracking_url", "trackingUrl", "tracking_link"]
    ),
  };
}

function buildSendboxBookingRecord(config, response) {
  return {
    provider: "sendbox",
    providerMode: config.environment,
    providerPayload: response,
    providerReference: readFirstString(response, [
      "delivery_reference",
      "shipment_reference",
      "order_reference",
      "reference",
      "id",
      "code",
    ]),
    status: normalizeDeliveryStatus(
      readFirstString(
        response,
        ["status", "delivery_status", "shipment_status"],
        "booked"
      )
    ),
    trackingUrl: readFirstString(
      response,
      ["tracking_url", "trackingUrl", "tracking_link"]
    ),
  };
}

function buildSendboxTrackingRecord(response, fallbackTrackingUrl = "", fallbackStatus = "booked") {
  return {
    events: readFirstArray(response, ["events", "history", "timeline", "tracking_events"]),
    status: normalizeDeliveryStatus(
      readFirstString(
        response,
        ["status", "delivery_status", "shipment_status"],
        fallbackStatus
      )
    ),
    trackingUrl: readFirstString(
      response,
      ["tracking_url", "trackingUrl", "tracking_link"],
      fallbackTrackingUrl
    ),
  };
}

export async function quoteDeliveryForTransaction({
  deliveryAddress,
  deliveryAddressNote,
  deliveryLocation,
  pickupAddressNote,
  pickupLocation,
  pickupLocationData,
  price,
  productName,
  seller,
}) {
  const config = getDeliveryProviderConfig();

  if (config.provider !== "sendbox" || !isSendboxConfigured()) {
    return {
      provider: "mock",
      providerMode: config.environment,
      providerPayload: {
        estimatedFrom: "mock_delivery_quote",
        deliveryAddressNote,
        deliveryLocation,
        pickupLocation,
        pickupLocationData,
        price,
        productName,
      },
      quoteReference: createMockReference("mock_quote"),
      quotedFee: getMockQuoteFee(deliveryLocation, deliveryAddress, price),
      status: "quote_ready",
      trackingUrl: "",
    };
  }

  const response = await sendboxRequest(config.sendbox.quotePath, {
    payload: buildSendboxPayload({
      deliveryAddress,
      deliveryAddressNote,
      deliveryLocation,
      pickupAddressNote,
      pickupLocation,
      pickupLocationData,
      price,
      productName,
      seller,
    }),
  });

  return buildSendboxQuoteRecord(config, response);
}

export async function upsertQuotedDeliveryForTransaction(transaction, quote) {
  const existing = await db
    .prepare("SELECT * FROM deliveries WHERE transaction_id = ?")
    .get(transaction.id);
  const timestamp = nowIso();

  if (existing) {
    await db.prepare(
      `UPDATE deliveries
       SET provider = ?, provider_mode = ?, quote_reference = ?, quoted_fee = ?,
           status = ?, pickup_address = ?, dropoff_address = ?, provider_payload = ?,
           tracking_url = ?, updated_at = ?
       WHERE transaction_id = ?`
    ).run(
      quote.provider,
      quote.providerMode,
      quote.quoteReference || "",
      quote.quotedFee,
      quote.status || "quote_ready",
      transaction.pickup_location,
      transaction.delivery_address,
      serializePayload(quote.providerPayload),
      quote.trackingUrl || "",
      timestamp,
      transaction.id
    );
  } else {
    await db.prepare(
      `INSERT INTO deliveries (
        id, transaction_id, provider, provider_mode, quote_reference,
        provider_reference, tracking_url, quoted_fee, status, pickup_address,
        dropoff_address, receiver_name, receiver_phone, provider_payload,
        last_synced_at, created_at, updated_at, booked_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, '', '', ?, NULL, ?, ?, NULL, NULL)`
    ).run(
      createDeliveryId(),
      transaction.id,
      quote.provider,
      quote.providerMode,
      quote.quoteReference || "",
      quote.trackingUrl || "",
      quote.quotedFee,
      quote.status || "quote_ready",
      transaction.pickup_location,
      transaction.delivery_address,
      serializePayload(quote.providerPayload),
      timestamp,
      timestamp
    );
  }

  return getDeliveryByTransactionId(transaction.id);
}

export async function getDeliveryByTransactionId(transactionId) {
  const row = await db
    .prepare("SELECT * FROM deliveries WHERE transaction_id = ?")
    .get(transactionId);
  return toDeliveryRecord(row);
}

export async function listDeliveryEvents(deliveryId) {
  const rows = await db
    .prepare(
      `SELECT * FROM delivery_events
       WHERE delivery_id = ?
       ORDER BY event_at ASC, created_at ASC`
    )
    .all(deliveryId);

  return rows.map(toDeliveryEvent);
}

export async function appendDeliveryEvent(
  deliveryId,
  { eventAt = nowIso(), location = "", note = "", providerPayload = null, status }
) {
  await db.prepare(
    `INSERT INTO delivery_events (
      id, delivery_id, status, note, location, event_at, provider_payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createDeliveryEventId(),
    deliveryId,
    status,
    sanitizeString(note),
    sanitizeString(location),
    eventAt,
    serializePayload(providerPayload),
    nowIso()
  );
}

export async function createDeliveryBooking(transaction, buyer) {
  const config = getDeliveryProviderConfig();
  const existing = await getDeliveryByTransactionId(transaction.id);
  const timestamp = nowIso();
  const seller = await getSellerContact(transaction.sellerId, transaction.sellerName);

  if (!buyer) {
    throw new Error("Buyer details are required before delivery can be booked.");
  }

  if (
    existing?.providerReference &&
    existing.status !== "quote_ready" &&
    existing.status !== "cancelled"
  ) {
    return existing;
  }

  if (!existing) {
    await db.prepare(
      `INSERT INTO deliveries (
        id, transaction_id, provider, provider_mode, quote_reference,
        provider_reference, tracking_url, quoted_fee, status, pickup_address,
        dropoff_address, receiver_name, receiver_phone, provider_payload,
        last_synced_at, created_at, updated_at, booked_at, delivered_at
      ) VALUES (?, ?, ?, ?, '', '', '', ?, 'quote_ready', ?, ?, '', '', '', NULL, ?, ?, NULL, NULL)`
    ).run(
      createDeliveryId(),
      transaction.id,
      config.provider === "sendbox" && isSendboxConfigured() ? "sendbox" : "mock",
      config.environment,
      transaction.deliveryFee,
      transaction.pickupLocation,
      buyer.deliveryAddress || transaction.deliveryAddress,
      timestamp,
      timestamp
    );
  }

  if (config.provider !== "sendbox" || !isSendboxConfigured()) {
    const providerReference = createMockReference("mock_delivery");
    const trackingUrl = `${getAppBaseUrl()}/pay/${transaction.slug}`;

    await db.prepare(
      `UPDATE deliveries
       SET provider = ?, provider_mode = ?, provider_reference = ?, tracking_url = ?,
           receiver_name = ?, receiver_phone = ?, status = ?, provider_payload = ?,
           last_synced_at = ?, booked_at = ?, updated_at = ?
       WHERE transaction_id = ?`
    ).run(
      "mock",
      config.environment,
      providerReference,
      trackingUrl,
      buyer.fullName,
      buyer.phone,
      "booked",
      serializePayload({
        bookedBy: "mock_delivery_provider",
        transactionShortCode: transaction.shortCode,
      }),
      timestamp,
      timestamp,
      timestamp,
      transaction.id
    );

    const bookedDelivery = await getDeliveryByTransactionId(transaction.id);

    await appendDeliveryEvent(bookedDelivery.id, {
      note: "Delivery booking created in test mode.",
      status: "booked",
    });

    return bookedDelivery;
  }

  const response = await sendboxRequest(config.sendbox.createOrderPath, {
    payload: buildSendboxPayload({
      buyer,
      deliveryAddress: transaction.deliveryAddress,
      deliveryAddressNote: transaction.deliveryAddressNote,
      deliveryLocation: transaction.deliveryLocationData,
      pickupAddressNote: transaction.pickupAddressNote,
      pickupLocation: transaction.pickupLocation,
      pickupLocationData: transaction.pickupLocationData,
      price: transaction.price,
      productName: transaction.productName,
      seller,
      shortCode: transaction.shortCode,
    }),
  });
  const booking = buildSendboxBookingRecord(config, response);

  await db.prepare(
    `UPDATE deliveries
     SET provider = ?, provider_mode = ?, provider_reference = ?, tracking_url = ?,
         receiver_name = ?, receiver_phone = ?, status = ?, provider_payload = ?,
         last_synced_at = ?, booked_at = ?, updated_at = ?
     WHERE transaction_id = ?`
  ).run(
    booking.provider,
    config.environment,
    booking.providerReference,
    booking.trackingUrl,
    buyer.fullName,
    buyer.phone,
    booking.status,
    serializePayload(booking.providerPayload),
    timestamp,
    timestamp,
    timestamp,
    transaction.id
  );

  const bookedDelivery = await getDeliveryByTransactionId(transaction.id);

  await appendDeliveryEvent(bookedDelivery.id, {
    note: `${providerName(booking.provider)} delivery booking accepted.`,
    providerPayload: booking.providerPayload,
    status: booking.status,
  });

  return bookedDelivery;
}

export async function refreshDeliveryTracking(transaction) {
  const config = getDeliveryProviderConfig();
  const delivery = await getDeliveryByTransactionId(transaction.id);

  if (!delivery || !delivery.providerReference) {
    return delivery;
  }

  if (delivery.provider === "mock") {
    const nextStatus =
      delivery.status === "booked"
        ? "in_transit"
        : delivery.status === "in_transit"
          ? "delivered"
          : delivery.status;
    const timestamp = nowIso();

    if (nextStatus !== delivery.status) {
      await db.prepare(
        `UPDATE deliveries
         SET status = ?, last_synced_at = ?, updated_at = ?,
             delivered_at = CASE
               WHEN ? = 'delivered' AND delivered_at IS NULL THEN ?
               ELSE delivered_at
             END
         WHERE transaction_id = ?`
      ).run(
        nextStatus,
        timestamp,
        timestamp,
        nextStatus,
        nextStatus === "delivered" ? timestamp : null,
        transaction.id
      );

      await appendDeliveryEvent(delivery.id, {
        note:
          nextStatus === "in_transit"
            ? "Test delivery advanced to in transit."
            : "Test delivery marked as delivered.",
        status: nextStatus,
      });
    }

    return getDeliveryByTransactionId(transaction.id);
  }

  if (
    config.provider !== "sendbox" ||
    !isSendboxConfigured() ||
    !config.sendbox.trackPath
  ) {
    return delivery;
  }

  const response = await sendboxRequest(config.sendbox.trackPath, {
    method: "POST",
    payload: {
      code: delivery.providerReference,
    },
  });
  const tracking = buildSendboxTrackingRecord(
    response,
    delivery.trackingUrl,
    delivery.status
  );
  const timestamp = nowIso();

  await db.prepare(
    `UPDATE deliveries
     SET status = ?, tracking_url = ?, provider_payload = ?, last_synced_at = ?,
         updated_at = ?, delivered_at = CASE
           WHEN ? = 'delivered' AND delivered_at IS NULL THEN ?
           ELSE delivered_at
         END
     WHERE transaction_id = ?`
  ).run(
    tracking.status,
    tracking.trackingUrl,
    serializePayload(response),
    timestamp,
    timestamp,
    tracking.status,
    tracking.status === "delivered" ? timestamp : null,
    transaction.id
  );

  const savedDelivery = await getDeliveryByTransactionId(transaction.id);

  if (!tracking.events.length) {
    await appendDeliveryEvent(savedDelivery.id, {
      note: `Tracking refreshed from ${providerName(delivery.provider)}.`,
      providerPayload: response,
      status: tracking.status,
    });
  } else {
    for (const event of tracking.events) {
      await appendDeliveryEvent(savedDelivery.id, {
        eventAt: readFirstString(
          event,
          ["event_time", "created_at", "timestamp"],
          timestamp
        ),
        location: readFirstString(event, ["location", "address"]),
        note: readFirstString(event, ["note", "description", "message"]),
        providerPayload: event,
        status: normalizeDeliveryStatus(
          readFirstString(
            event,
            ["status", "delivery_status", "shipment_status"],
            tracking.status
          )
        ),
      });
    }
  }

  return getDeliveryByTransactionId(transaction.id);
}
