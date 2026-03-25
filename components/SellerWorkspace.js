"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatNaira } from "../lib/demo-data";
import {
  buildLocationDisplay,
  buildNigeriaLocationLabel,
  getNigeriaLocationById,
  getNigeriaLocationByLabel,
  nigeriaLocations,
} from "../lib/nigeria-locations";

const dashboardTabs = [
  { id: "create", label: "Create transaction" },
  { id: "deliveries", label: "Deliveries" },
  { id: "disputes", label: "Disputes" },
];

function getAbsoluteLink(value) {
  const link = String(value || "").trim();

  if (!link) {
    return "";
  }

  if (/^https?:\/\//i.test(link)) {
    return link;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  if (!baseUrl) {
    return link;
  }

  try {
    return new URL(link, baseUrl).toString();
  } catch {
    return link;
  }
}

function formatDateLabel(value) {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

function getTrackingSteps(delivery) {
  const disputeOpen = delivery.status === "dispute_open";
  const refundApproved = delivery.status === "refund_approved";
  const returnRequired = delivery.status === "return_required";
  const releaseApproved = delivery.status === "seller_release_approved";

  return [
    {
      done: true,
      label: "Link generated",
      note: `Created ${formatDateLabel(delivery.createdAt)}`,
    },
    {
      done: [
        "payment_pending_confirmation",
        "payment_confirmed",
        "delivery_booked",
        "in_transit",
        "delivered",
      ].includes(delivery.status),
      label: "Buyer payment",
      note:
        delivery.status === "awaiting_payment"
          ? "Waiting for the customer to open the link and pay."
          : delivery.paymentStatus === "confirmed"
            ? "Buyer payment has been confirmed."
            : "Buyer payment flow has started.",
    },
    {
      done: ["delivery_booked", "in_transit", "delivered"].includes(delivery.status),
      label: "Delivery movement",
      note:
        ["awaiting_payment", "payment_pending_confirmation", "payment_confirmed"].includes(
          delivery.status
        )
          ? "Delivery starts after payment confirmation."
          : disputeOpen
            ? "A buyer dispute has paused the normal delivery flow."
            : refundApproved
              ? "Admin approved a refund to the buyer."
              : returnRequired
                ? "Admin asked for a return before refund."
                : releaseApproved
                  ? "Admin approved release of funds to the seller."
          : delivery.deliveryReference
            ? `Tracking reference: ${delivery.deliveryReference}`
            : "Delivery has been booked.",
    },
    {
      done: delivery.status === "delivered" || releaseApproved || refundApproved,
      label: disputeOpen ? "Dispute open" : "Delivered",
      note:
        disputeOpen
          ? "Funds stay locked until admin review is completed."
          : refundApproved
            ? "The dispute ended in a buyer refund."
            : releaseApproved
              ? "The dispute ended in a seller payout."
          : delivery.status === "delivered"
          ? "The item has been marked as delivered."
          : "Awaiting delivery completion.",
    },
  ];
}

function normalizeTransaction(transaction, generatedLink = "") {
  return {
    createdAt: transaction.createdAt,
    deliveryAddress: transaction.deliveryAddress,
    deliveryReference:
      transaction.delivery?.providerReference ||
      transaction.delivery?.quoteReference ||
      "",
    generatedLink: getAbsoluteLink(generatedLink || `/pay/${transaction.slug}`),
    id: transaction.id,
    paymentStatus: transaction.payment?.status || "",
    pickupLocation: transaction.pickupLocation,
    price: transaction.price,
    productName: transaction.productName,
    shortCode: transaction.shortCode,
    status: transaction.status,
  };
}

function normalizeDispute(dispute) {
  return {
    buyerName: dispute.buyer?.fullName || "Buyer",
    createdAt: dispute.createdAt,
    description: dispute.description || "",
    evidenceAttachments: dispute.evidenceAttachments || [],
    evidenceNote: dispute.evidenceNote || "",
    id: dispute.id,
    reason: dispute.reason,
    resolution: dispute.resolution || "",
    shortCode: dispute.transaction?.shortCode || "",
    status: dispute.status,
    transactionAmount: dispute.transaction?.amount || 0,
    transactionProductName: dispute.transaction?.productName || "Unknown item",
    updatedAt: dispute.updatedAt,
  };
}

function humanize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const nigeriaLocationLabels = nigeriaLocations
  .map((location) => buildNigeriaLocationLabel(location))
  .sort((left, right) => left.localeCompare(right));

function formatRoutePreview(locationId, query, addressNote, emptyLabel) {
  const selectedLocation =
    getNigeriaLocationById(locationId) || getNigeriaLocationByLabel(query);

  if (selectedLocation) {
    return buildLocationDisplay(selectedLocation, addressNote);
  }

  if (query) {
    return `${query} (select a location from the list)`;
  }

  return emptyLabel;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

export default function SellerWorkspace({ initialDisputes = [], initialTransactions, seller }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("create");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [pickupQuery, setPickupQuery] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [pickupAddressNote, setPickupAddressNote] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [deliveryAddressNote, setDeliveryAddressNote] = useState("");
  const [deliveries, setDeliveries] = useState(
    initialTransactions.map((transaction) => normalizeTransaction(transaction))
  );
  const [disputes] = useState(initialDisputes.map(normalizeDispute));
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(
    initialTransactions[0]?.id || ""
  );
  const [selectedDisputeId, setSelectedDisputeId] = useState(initialDisputes[0]?.id || "");
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [copiedDeliveryId, setCopiedDeliveryId] = useState("");

  const priceValue = Number(price) || 0;
  const productPrice = priceValue > 0 ? formatNaira(priceValue) : "Not set";
  const pickupPreview = formatRoutePreview(
    pickupLocationId,
    pickupQuery,
    pickupAddressNote,
    "Pickup not set"
  );
  const destinationPreview = formatRoutePreview(
    deliveryLocationId,
    destinationQuery,
    deliveryAddressNote,
    "Destination not set"
  );
  const selectedDelivery =
    deliveries.find((delivery) => delivery.id === selectedDeliveryId) || deliveries[0] || null;
  const selectedDispute =
    disputes.find((dispute) => dispute.id === selectedDisputeId) || disputes[0] || null;
  const selectedTrackingSteps = selectedDelivery ? getTrackingSteps(selectedDelivery) : [];

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await fetch("/api/auth/seller/logout", {
        method: "POST",
      });
    } finally {
      router.push("/seller");
      router.refresh();
    }
  }

  async function handleCopyLink(delivery) {
    if (!delivery?.generatedLink || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(delivery.generatedLink);
      setCopiedDeliveryId(delivery.id);
      window.setTimeout(() => {
        setCopiedDeliveryId((current) => (current === delivery.id ? "" : current));
      }, 1800);
    } catch {
      setFormError("Unable to copy the customer link right now.");
    }
  }

  function resetForm() {
    setProductName("");
    setPrice("");
    setCondition("");
    setPickupQuery("");
    setPickupLocationId("");
    setPickupAddressNote("");
    setDestinationQuery("");
    setDeliveryLocationId("");
    setDeliveryAddressNote("");
  }

  function updateLocationInput(value, setQuery, setLocationId) {
    const nextValue = value;
    const matchedLocation = getNigeriaLocationByLabel(nextValue);

    setQuery(nextValue);
    setLocationId(matchedLocation?.id || "");
  }

  async function handleCreateTransaction(event) {
    event.preventDefault();
    setFormError("");
    setFormMessage("");
    setGenerating(true);

    try {
      if (!pickupLocationId) {
        throw new Error("Choose a pickup location from the list.");
      }

      if (!deliveryLocationId) {
        throw new Error("Choose a delivery destination from the list.");
      }

      const data = await postJson("/api/transactions", {
        condition,
        deliveryAddress: destinationQuery,
        deliveryAddressNote,
        deliveryLocationId,
        pickupAddressNote,
        pickupLocation: pickupQuery,
        pickupLocationId,
        price: priceValue,
        productName,
      });

      const nextDelivery = normalizeTransaction(data.transaction, data.generatedLink);

      setDeliveries((current) => [nextDelivery, ...current]);
      setSelectedDeliveryId(nextDelivery.id);
      setActiveTab("deliveries");
      setFormMessage(data.message);
      resetForm();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="dashboard-shell">
      <aside className="panel dashboard-sidebar">
        <div className="dashboard-sidebar-top">
          <span className="eyebrow accent-green">Verified seller</span>
          <h2>{seller.displayName}</h2>
          <p>
            {seller.email}
            <br />
            {seller.phone}
          </p>
        </div>

        <div className="dashboard-tab-list">
          {dashboardTabs.map((tab) => (
            <button
              className={`dashboard-tab ${activeTab === tab.id ? "dashboard-tab-active" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="list-stack">
          <div className="list-item">
            <strong>Identity</strong>
            <p>{seller.verificationType ? `${seller.verificationType} verified` : "Verification pending"}</p>
          </div>
          <div className="list-item">
            <strong>Payout account</strong>
            <p>{seller.bankName ? `${seller.bankName} ${seller.accountNumberMasked}` : "Bank details not added"}</p>
          </div>
        </div>

        <button
          className="button button-light sidebar-logout"
          disabled={loggingOut}
          onClick={handleLogout}
          type="button"
        >
          {loggingOut ? "Signing out..." : "Log out"}
        </button>
      </aside>

      <div className="dashboard-content">
        {activeTab === "create" && (
          <div className="workspace-stack">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-green">Transaction builder</span>
                  <h2>Create a secure sale</h2>
                </div>
              </div>

              {formError ? (
                <div className="message-banner message-banner-error">{formError}</div>
              ) : null}

              {formMessage ? (
                <div className="message-banner message-banner-info">{formMessage}</div>
              ) : null}

              <form className="content-stack" onSubmit={handleCreateTransaction}>
                <div className="field-grid seller-transaction-grid">
                  <label className="field">
                    <span>Product name</span>
                    <input
                      className="input"
                      onChange={(event) => setProductName(event.target.value)}
                      value={productName}
                    />
                  </label>

                  <label className="field">
                    <span>Condition</span>
                    <select
                      className="input"
                      onChange={(event) => setCondition(event.target.value)}
                      value={condition}
                    >
                      <option value="">Select condition</option>
                      <option>Brand new</option>
                      <option>Like new</option>
                      <option>Used, excellent</option>
                      <option>Used, good</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Price (NGN)</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ""))}
                      value={price}
                    />
                  </label>

                  <label className="field">
                    <span>Pickup location</span>
                    <input
                      className="input"
                      list="nigeria-location-options"
                      onChange={(event) =>
                        updateLocationInput(
                          event.target.value,
                          setPickupQuery,
                          setPickupLocationId
                        )
                      }
                      placeholder="Search Lagos, Abuja, Port Harcourt..."
                      value={pickupQuery}
                    />
                    <small className="field-note">
                      Search a city or area, then choose a Nigeria location from the list.
                    </small>
                  </label>

                  <label className="field">
                    <span>Pickup address note</span>
                    <input
                      className="input"
                      onChange={(event) => setPickupAddressNote(event.target.value)}
                      placeholder="Optional landmark, street, or shop note"
                      value={pickupAddressNote}
                    />
                  </label>

                  <label className="field">
                    <span>Buyer delivery destination</span>
                    <input
                      className="input"
                      list="nigeria-location-options"
                      onChange={(event) =>
                        updateLocationInput(
                          event.target.value,
                          setDestinationQuery,
                          setDeliveryLocationId
                        )
                      }
                      placeholder="Search the buyer's city or area"
                      value={destinationQuery}
                    />
                    <small className="field-note">
                      Keep this to a selected city or area. Add finer detail in the note below.
                    </small>
                  </label>

                  <label className="field">
                    <span>Delivery address note</span>
                    <input
                      className="input"
                      onChange={(event) => setDeliveryAddressNote(event.target.value)}
                      placeholder="Optional apartment, estate, junction, or landmark"
                      value={deliveryAddressNote}
                    />
                  </label>
                </div>

                <div className="button-row">
                  <button className="button button-dark" disabled={generating} type="submit">
                    {generating ? "Generating..." : "Generate link"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel panel-dark">
              <div className="panel-header compact-header">
                <div>
                  <span className="eyebrow accent-blue">Current draft</span>
                  <h2>{productName ? "Ready to generate" : "No draft yet"}</h2>
                </div>
              </div>

              <div className="list-stack">
                <div className="list-item">
                  <strong>Product</strong>
                  <p>{productName || "Add a product name to begin."}</p>
                </div>
                <div className="list-item">
                  <strong>Condition and price</strong>
                  <p>{condition ? `${condition} | ${productPrice}` : productPrice}</p>
                </div>
                <div className="list-item">
                  <strong>Delivery route</strong>
                  <p>
                    {pickupPreview}
                    <br />
                    {destinationPreview}
                  </p>
                </div>
              </div>
            </article>
          </div>
        )}

        {activeTab === "deliveries" && (
          <div className="dashboard-deliveries">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-pink">Deliveries</span>
                  <h2>View and track generated links</h2>
                </div>
              </div>

              {deliveries.length === 0 ? (
                <p className="helper-text">
                  No links yet. Generate a transaction link first and it will appear here for tracking.
                </p>
              ) : (
                <div className="delivery-list">
                  {deliveries.map((delivery) => (
                    <button
                      className={`delivery-card ${
                        selectedDelivery?.id === delivery.id ? "delivery-card-active" : ""
                      }`}
                      key={delivery.id}
                      onClick={() => setSelectedDeliveryId(delivery.id)}
                      type="button"
                    >
                      <div>
                        <strong>{delivery.productName}</strong>
                        <p>
                          {delivery.pickupLocation}
                          <br />
                          {delivery.deliveryAddress}
                        </p>
                      </div>
                      <div className="delivery-card-meta">
                        <span>{formatNaira(delivery.price)}</span>
                        <span>{delivery.shortCode}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </article>

            <article className="panel panel-dark sticky-panel">
              <div className="panel-header compact-header">
                <div>
                  <span className="eyebrow accent-blue">Tracking</span>
                  <h2>{selectedDelivery ? selectedDelivery.shortCode : "Select a delivery"}</h2>
                </div>
              </div>

              {selectedDelivery ? (
                <div className="content-stack">
                  <div className="list-stack">
                    <div className="list-item">
                      <strong>Customer link</strong>
                      <div className="link-copy-row">
                        <p>
                          <Link
                            className="text-link text-link-light"
                            href={selectedDelivery.generatedLink}
                          >
                            {selectedDelivery.generatedLink}
                          </Link>
                        </p>
                        <button
                          className="button button-light copy-link-button"
                          onClick={() => handleCopyLink(selectedDelivery)}
                          type="button"
                        >
                          {copiedDeliveryId === selectedDelivery.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div className="list-item">
                      <strong>Product</strong>
                      <p>{selectedDelivery.productName}</p>
                    </div>
                    <div className="list-item">
                      <strong>Route</strong>
                      <p>
                        {selectedDelivery.pickupLocation}
                        <br />
                        {selectedDelivery.deliveryAddress}
                      </p>
                    </div>
                  </div>

                  <div className="tracking-line">
                    {selectedTrackingSteps.map((step) => (
                      <div
                        className={`tracking-item ${
                          step.done ? "tracking-item-complete" : ""
                        }`}
                        key={step.label}
                      >
                        <strong>{step.label}</strong>
                        <span>{step.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="helper-text helper-text-light">
                  Choose a delivery from the list to see its tracking progress.
                </p>
              )}
            </article>
          </div>
        )}

        {activeTab === "disputes" && (
          <div className="dashboard-deliveries">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-pink">Seller disputes</span>
                  <h2>Cases raised against your transactions</h2>
                </div>
              </div>

              {disputes.length === 0 ? (
                <p className="helper-text">
                  No disputes yet. Any buyer issue raised from escrow will appear here.
                </p>
              ) : (
                <div className="delivery-list">
                  {disputes.map((dispute) => (
                    <button
                      className={`delivery-card ${
                        selectedDispute?.id === dispute.id ? "delivery-card-active" : ""
                      }`}
                      key={dispute.id}
                      onClick={() => setSelectedDisputeId(dispute.id)}
                      type="button"
                    >
                      <div>
                        <strong>{dispute.shortCode || dispute.transactionProductName}</strong>
                        <p>
                          {dispute.transactionProductName}
                          <br />
                          {humanize(dispute.reason)}
                        </p>
                      </div>
                      <div className="delivery-card-meta">
                        <span>{formatNaira(dispute.transactionAmount)}</span>
                        <span>{humanize(dispute.status)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </article>

            <article className="panel panel-dark sticky-panel">
              <div className="panel-header compact-header">
                <div>
                  <span className="eyebrow accent-blue">Case detail</span>
                  <h2>{selectedDispute ? selectedDispute.shortCode : "Select a dispute"}</h2>
                </div>
              </div>

              {selectedDispute ? (
                <div className="content-stack">
                  <div className="list-stack">
                    <div className="list-item">
                      <strong>Buyer</strong>
                      <p>{selectedDispute.buyerName}</p>
                    </div>
                    <div className="list-item">
                      <strong>Issue</strong>
                      <p>{selectedDispute.description}</p>
                    </div>
                    <div className="list-item">
                      <strong>Evidence note</strong>
                      <p>{selectedDispute.evidenceNote || "No evidence note added."}</p>
                    </div>
                    <div className="list-item">
                      <strong>Status</strong>
                      <p>
                        {humanize(selectedDispute.status)}
                        {selectedDispute.resolution
                          ? ` | ${humanize(selectedDispute.resolution)}`
                          : ""}
                      </p>
                    </div>
                    <div className="list-item">
                      <strong>Opened</strong>
                      <p>{formatDateLabel(selectedDispute.createdAt)}</p>
                    </div>
                    <div className="list-item">
                      <strong>Attachments</strong>
                      {selectedDispute.evidenceAttachments.length ? (
                        <div className="attachment-list">
                          {selectedDispute.evidenceAttachments.map((attachment) => (
                            <Link
                              className="text-link text-link-light"
                              href={attachment.url}
                              key={attachment.url}
                              target="_blank"
                            >
                              {attachment.name || "Evidence file"}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p>No attachments added.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="helper-text helper-text-light">
                  Choose a dispute to see its details.
                </p>
              )}
            </article>
          </div>
        )}
      </div>

      <datalist id="nigeria-location-options">
        {nigeriaLocationLabels.map((locationLabel) => (
          <option key={locationLabel} value={locationLabel} />
        ))}
      </datalist>
    </section>
  );
}
