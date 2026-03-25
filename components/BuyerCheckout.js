"use client";

import { useEffect, useState } from "react";
import { formatNaira } from "../lib/demo-data";

const steps = ["Review", "Verify", "Pay", "Track"];
const disputeReasons = [
  { value: "not_delivered", label: "I did not receive this item" },
  { value: "wrong_item", label: "I received the wrong item" },
  { value: "condition_mismatch", label: "Condition does not match the listing" },
  { value: "tampered_or_used", label: "Item appears used or tampered with" },
];

function formatDateLabel(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

function buildBuyerForm(checkoutState) {
  return {
    deliveryAddress:
      checkoutState?.buyer?.deliveryAddress ||
      checkoutState?.transaction?.deliveryAddress ||
      "",
    email: checkoutState?.buyer?.email || "",
    fullName: checkoutState?.buyer?.fullName || "",
    phone: checkoutState?.buyer?.phone || "",
  };
}

function humanizeStatus(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStartingStep(checkoutState) {
  if (checkoutState?.payment?.status === "confirmed") {
    return 3;
  }

  if (checkoutState?.buyer) {
    return 2;
  }

  return 0;
}

function getTrackingItems(checkoutState) {
  const items = [
    ...checkoutState.statusHistory.map((entry) => ({
      label: humanizeStatus(entry.status),
      note: entry.note || "Status updated.",
      sortValue: entry.createdAt,
      time: formatDateLabel(entry.createdAt),
    })),
    ...(checkoutState.delivery?.events || []).map((event) => ({
      label: humanizeStatus(event.status),
      note: event.note || "Tracking event received.",
      sortValue: event.eventAt || event.createdAt,
      time: formatDateLabel(event.eventAt || event.createdAt),
    })),
  ];

  return items.sort((left, right) => {
    return new Date(left.sortValue).getTime() - new Date(right.sortValue).getTime();
  });
}

function buildDisputeForm(checkoutState) {
  return {
    description: "",
    evidenceAttachments: [],
    evidenceNote: "",
    reason: checkoutState?.delivery?.status === "delivered"
      ? "condition_mismatch"
      : "not_delivered",
  };
}

async function postJson(url, payload = {}) {
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

async function getJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function uploadAttachment(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/pinata", {
    body: formData,
    method: "POST",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Attachment upload failed.");
  }

  return data.file;
}

function loadQuicktellerScript(scriptUrl) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Quickteller checkout only runs in the browser."));
      return;
    }

    if (window.webpayCheckout) {
      resolve();
      return;
    }

    const existingScript = document.querySelector(
      'script[data-provider="quickteller-inline"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Unable to load the Quickteller checkout script.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.provider = "quickteller-inline";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Unable to load the Quickteller checkout script."));
    document.body.appendChild(script);
  });
}

export default function BuyerCheckout({
  initialCheckoutState,
  initialMerchantReference = "",
}) {
  const [checkoutState, setCheckoutState] = useState(initialCheckoutState);
  const [buyerForm, setBuyerForm] = useState(buildBuyerForm(initialCheckoutState));
  const [step, setStep] = useState(getStartingStep(initialCheckoutState));
  const [agreed, setAgreed] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeForm, setDisputeForm] = useState(buildDisputeForm(initialCheckoutState));
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const transaction = checkoutState.transaction;
  const payment = checkoutState.payment;
  const delivery = checkoutState.delivery;
  const dispute = checkoutState.dispute;
  const trackingItems = getTrackingItems(checkoutState);
  const isBusy = Boolean(busyLabel);
  const paymentConfirmed = payment?.status === "confirmed";
  const disputeOpen = ["open", "under_review"].includes(dispute?.status || "");
  const paymentSummary = [
    { label: "Phone price", value: formatNaira(transaction.price) },
    { label: "Escrow fee", value: formatNaira(transaction.escrowFee) },
    { label: "Delivery fee", value: formatNaira(transaction.deliveryFee) },
  ];

  useEffect(() => {
    let active = true;

    async function confirmReturnedPayment() {
      if (!initialMerchantReference || paymentConfirmed) {
        return;
      }

      setBusyLabel("Confirming returned payment...");
      setErrorMessage("");
      setInfoMessage("Quickteller returned to your payment link. Confirming the result...");

      try {
        const data = await postJson(`/api/pay/${transaction.slug}/confirm`, {
          merchantReference: initialMerchantReference,
        });

        if (!active) {
          return;
        }

        setCheckoutState(data.checkoutState);
        setBuyerForm(buildBuyerForm(data.checkoutState));
        setStep(3);
        setInfoMessage(data.message);
      } catch (error) {
        if (!active) {
          return;
        }

        setErrorMessage(error.message);
      } finally {
        if (active) {
          setBusyLabel("");
        }
      }
    }

    confirmReturnedPayment();

    return () => {
      active = false;
    };
  }, [initialMerchantReference, paymentConfirmed, transaction.slug]);

  function updateBuyerField(field, value) {
    setBuyerForm((current) => ({ ...current, [field]: value }));
  }

  function updateDisputeField(field, value) {
    setDisputeForm((current) => ({ ...current, [field]: value }));
  }

  async function refreshCheckoutState(message = "") {
    const data = await getJson(`/api/transactions/${transaction.slug}`);
    setCheckoutState(data);
    setBuyerForm(buildBuyerForm(data));
    setDisputeForm(buildDisputeForm(data));
    setStep(getStartingStep(data));

    if (message) {
      setInfoMessage(message);
    }
  }

  async function confirmPayment(merchantReference) {
    setBusyLabel("Confirming payment...");
    setErrorMessage("");

    try {
      const data = await postJson(`/api/pay/${transaction.slug}/confirm`, {
        merchantReference,
      });

      setCheckoutState(data.checkoutState);
      setBuyerForm(buildBuyerForm(data.checkoutState));
      setDisputeForm(buildDisputeForm(data.checkoutState));
      setStep(3);
      setInfoMessage(data.message);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleStartPayment() {
    setBusyLabel("Preparing payment...");
    setErrorMessage("");
    setInfoMessage("");

    try {
      const data = await postJson(`/api/pay/${transaction.slug}/initialize`, buyerForm);

      setCheckoutState(data.checkoutState);
      setBuyerForm(buildBuyerForm(data.checkoutState));
      setDisputeForm(buildDisputeForm(data.checkoutState));
      setStep(2);

      if (data.checkout.provider === "mock") {
        setInfoMessage("Mock payment session created. Confirming immediately in test mode...");
        await confirmPayment(data.payment.merchantReference);
        return;
      }

      await loadQuicktellerScript(data.checkout.scriptUrl);

      if (typeof window.webpayCheckout !== "function") {
        throw new Error("Quickteller script loaded, but checkout did not initialize.");
      }

      setInfoMessage("Quickteller checkout is open. Complete the payment to continue.");
      window.webpayCheckout({
        ...data.checkout.request,
        cust_mobile_no: buyerForm.phone,
        onComplete: (response) => {
          const merchantReference =
            response?.txn_ref ||
            response?.txnref ||
            data.payment.merchantReference;

          confirmPayment(merchantReference);
        },
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleRefreshTracking() {
    setBusyLabel("Refreshing tracking...");
    setErrorMessage("");

    try {
      const data = await postJson(`/api/pay/${transaction.slug}/refresh`);
      setCheckoutState(data.checkoutState);
      setBuyerForm(buildBuyerForm(data.checkoutState));
      setDisputeForm(buildDisputeForm(data.checkoutState));
      setStep(3);
      setInfoMessage(data.message);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleReloadTransaction() {
    setBusyLabel("Reloading transaction...");
    setErrorMessage("");

    try {
      await refreshCheckoutState("Transaction reloaded.");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleOpenDispute() {
    setBusyLabel("Opening dispute...");
    setErrorMessage("");

    try {
      const data = await postJson(`/api/pay/${transaction.slug}/dispute`, disputeForm);
      setCheckoutState(data.checkoutState);
      setBuyerForm(buildBuyerForm(data.checkoutState));
      setDisputeForm(buildDisputeForm(data.checkoutState));
      setShowDisputeForm(false);
      setStep(3);
      setInfoMessage(data.message);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyLabel("");
    }
  }

  async function handleAttachmentSelection(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    setUploadingAttachment(true);
    setErrorMessage("");

    try {
      const uploadedFiles = [];

      for (const file of files) {
        const uploadedFile = await uploadAttachment(file);
        uploadedFiles.push(uploadedFile);
      }

      setDisputeForm((current) => ({
        ...current,
        evidenceAttachments: [...current.evidenceAttachments, ...uploadedFiles],
      }));
      setInfoMessage("Attachment uploaded and added to the dispute.");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      event.target.value = "";
      setUploadingAttachment(false);
    }
  }

  return (
    <section className="checkout-layout">
      <div className="step-row">
        {steps.map((label, index) => (
          <div
            className={`step-pill ${step >= index ? "step-pill-active" : ""}`}
            key={label}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

      <div className="checkout-grid">
        <article className="panel">
          {errorMessage ? (
            <div className="message-banner message-banner-error">{errorMessage}</div>
          ) : null}

          {infoMessage ? (
            <div className="message-banner message-banner-info">{infoMessage}</div>
          ) : null}

          {step === 0 && (
            <div className="content-stack">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-blue">Step 1</span>
                  <h2>Review this protected sale</h2>
                </div>
                <span className="status-pill accent-green">
                  {humanizeStatus(transaction.status)}
                </span>
              </div>

              <div className="product-showcase">
                <div className="product-visual">
                  <div className="device-outline" />
                  <span className="device-tag accent-pink">{transaction.condition}</span>
                </div>
                <div className="product-copy">
                  <h3>{transaction.productName}</h3>
                  <p>{transaction.description || "The seller has created a protected transaction for this device."}</p>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span>Seller</span>
                      <strong>{transaction.sellerName}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Pickup</span>
                      <strong>{transaction.pickupLocation}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Destination</span>
                      <strong>{buyerForm.deliveryAddress || transaction.deliveryAddress}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Escrow total</span>
                      <strong>{formatNaira(transaction.totalBuyerPays)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="list-stack">
                <div className="list-item">
                  <strong>Protected release</strong>
                  <p>Funds stay secured until the item is accepted or a dispute is resolved.</p>
                </div>
                <div className="list-item">
                  <strong>Live status</strong>
                  <p>This page updates from the same records used by the seller dashboard.</p>
                </div>
                <div className="list-item">
                  <strong>Tracked delivery</strong>
                  <p>Once payment is confirmed, delivery booking and tracking stay attached to this link.</p>
                </div>
              </div>

              <button className="button button-dark" onClick={() => setStep(1)} type="button">
                Continue to verification
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="content-stack">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-green">Step 2</span>
                  <h2>Verify identity and delivery details</h2>
                </div>
              </div>

              <div className="field-grid">
                <label className="field">
                  <span>Full name</span>
                  <input
                    className="input"
                    onChange={(event) => updateBuyerField("fullName", event.target.value)}
                    value={buyerForm.fullName}
                  />
                </label>

                <label className="field">
                  <span>Email</span>
                  <input
                    className="input"
                    onChange={(event) => updateBuyerField("email", event.target.value)}
                    type="email"
                    value={buyerForm.email}
                  />
                </label>

                <label className="field">
                  <span>Phone number</span>
                  <input
                    className="input"
                    onChange={(event) => updateBuyerField("phone", event.target.value)}
                    value={buyerForm.phone}
                  />
                </label>

                <label className="field field-full">
                  <span>Delivery address</span>
                  <input
                    className="input"
                    onChange={(event) =>
                      updateBuyerField("deliveryAddress", event.target.value)
                    }
                    value={buyerForm.deliveryAddress}
                  />
                </label>
              </div>

              <div className="highlight-box highlight-box-light">
                <span className="highlight-label">Buyer record</span>
                <strong>
                  Your contact and address details are stored against this transaction before payment starts.
                </strong>
              </div>

              <div className="button-row">
                <button className="button button-light" onClick={() => setStep(0)} type="button">
                  Back
                </button>
                <button className="button button-dark" onClick={() => setStep(2)} type="button">
                  Continue to payment
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="content-stack">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-pink">Step 3</span>
                  <h2>Secure your payment</h2>
                </div>
                <span className="status-pill accent-blue">
                  {checkoutState.paymentProvider === "interswitch"
                    ? "Quickteller"
                    : "Test mode"}
                </span>
              </div>

              <div className="summary-stack">
                {paymentSummary.map((item) => (
                  <div className="summary-line" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
                <div className="summary-line total-line">
                  <span>Total due</span>
                  <strong>{formatNaira(transaction.totalBuyerPays)}</strong>
                </div>
              </div>

              <label className="checkbox-row">
                <input
                  checked={agreed}
                  onChange={() => setAgreed((current) => !current)}
                  type="checkbox"
                />
                <span>
                  I understand that funds remain in escrow until I accept the
                  item or an admin resolves a dispute.
                </span>
              </label>

              {payment?.merchantReference ? (
                <div className="highlight-box highlight-box-light">
                  <span className="highlight-label">Latest payment session</span>
                  <strong>{payment.merchantReference}</strong>
                </div>
              ) : null}

              <div className="button-row">
                <button className="button button-light" onClick={() => setStep(1)} type="button">
                  Back
                </button>
                <button
                  className="button button-dark"
                  disabled={!agreed || isBusy || paymentConfirmed}
                  onClick={handleStartPayment}
                  type="button"
                >
                  {paymentConfirmed
                    ? "Payment confirmed"
                    : busyLabel || `Pay ${formatNaira(transaction.totalBuyerPays)}`}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="content-stack">
              <div className="panel-header">
                <div>
                  <span className="eyebrow accent-green">Step 4</span>
                  <h2>
                    {paymentConfirmed
                      ? "Payment secured. Follow the delivery."
                      : "Tracking unlocks after payment confirmation."}
                  </h2>
                </div>
                <span className="status-pill accent-green">
                  {paymentConfirmed ? humanizeStatus(transaction.status) : "Awaiting payment"}
                </span>
              </div>

              <div className="tracking-line">
                {trackingItems.map((item) => (
                  <div className="tracking-item tracking-item-complete" key={`${item.label}-${item.time}`}>
                    <strong>{item.label}</strong>
                    <span>{item.note}</span>
                    {item.time ? <span>{item.time}</span> : null}
                  </div>
                ))}
              </div>

              {delivery ? (
                <div className="summary-stack">
                  <div className="summary-line">
                    <span>Delivery status</span>
                    <strong>{humanizeStatus(delivery.status)}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Provider</span>
                    <strong>{humanizeStatus(delivery.provider)}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Tracking reference</span>
                    <strong>{delivery.providerReference || delivery.quoteReference || "Pending"}</strong>
                  </div>
                </div>
              ) : null}

              {dispute ? (
                <div className="highlight-box highlight-box-light">
                  <span className="highlight-label">Dispute status</span>
                  <strong>{humanizeStatus(dispute.reason)}</strong>
                  <span>
                    {disputeOpen
                      ? "Funds stay locked while this issue is reviewed."
                      : `Resolved as ${humanizeStatus(dispute.resolution)}.`}
                  </span>
                  <span>{dispute.description}</span>
                </div>
              ) : null}

              {paymentConfirmed && !dispute ? (
                <div className="content-stack">
                  <div className="panel-header compact-header">
                    <div>
                      <span className="eyebrow accent-pink">Buyer protection</span>
                      <h2>Report an issue from escrow</h2>
                    </div>
                  </div>

                  {showDisputeForm ? (
                    <div className="content-stack">
                      <div className="field-grid">
                        <label className="field field-full">
                          <span>What went wrong?</span>
                          <select
                            className="input"
                            onChange={(event) => updateDisputeField("reason", event.target.value)}
                            value={disputeForm.reason}
                          >
                            {disputeReasons.map((reason) => (
                              <option key={reason.value} value={reason.value}>
                                {reason.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="field field-full">
                          <span>Describe what happened</span>
                          <textarea
                            className="input textarea-input"
                            onChange={(event) =>
                              updateDisputeField("description", event.target.value)
                            }
                            placeholder="Explain what happened, including whether the item was not delivered or why the delivery update is incorrect."
                            value={disputeForm.description}
                          />
                        </label>

                        <label className="field field-full">
                          <span>Evidence note</span>
                          <textarea
                            className="input textarea-input"
                            onChange={(event) =>
                              updateDisputeField("evidenceNote", event.target.value)
                            }
                            placeholder="Optional: mention screenshots, calls, courier messages, or any supporting detail."
                            value={disputeForm.evidenceNote}
                          />
                        </label>

                        <label className="field field-full">
                          <span>Attachments</span>
                          <input
                            className="input"
                            multiple
                            onChange={handleAttachmentSelection}
                            type="file"
                          />
                          <small className="field-note">
                            Upload screenshots, photos, or any file that supports your dispute.
                          </small>
                        </label>

                        {disputeForm.evidenceAttachments.length ? (
                          <div className="attachment-list">
                            {disputeForm.evidenceAttachments.map((attachment) => (
                              <a
                                className="text-link"
                                href={attachment.url}
                                key={attachment.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {attachment.name || "Uploaded attachment"}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="button-row">
                        <button
                          className="button button-light"
                          onClick={() => setShowDisputeForm(false)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="button button-dark"
                          disabled={isBusy || uploadingAttachment}
                          onClick={handleOpenDispute}
                          type="button"
                        >
                          {uploadingAttachment ? "Uploading..." : busyLabel || "Submit dispute"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="button-row">
                      <button
                        className="button button-light"
                        onClick={() => {
                          setShowDisputeForm(true);
                          setDisputeForm((current) => ({
                            ...current,
                            reason: "not_delivered",
                          }));
                        }}
                        type="button"
                      >
                        Report not delivered
                      </button>
                      <button
                        className="button button-dark"
                        onClick={() => setShowDisputeForm(true)}
                        type="button"
                      >
                        Report another issue
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="button-row">
                <button className="button button-light" onClick={handleReloadTransaction} type="button">
                  Reload transaction
                </button>
                <button
                  className="button button-dark"
                  disabled={!paymentConfirmed || isBusy}
                  onClick={handleRefreshTracking}
                  type="button"
                >
                  {busyLabel || "Refresh tracking"}
                </button>
              </div>
            </div>
          )}
        </article>

        <aside className="panel panel-dark sticky-panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-blue">Transaction summary</span>
              <h2>{transaction.shortCode}</h2>
            </div>
          </div>

          <div className="summary-stack">
            <div className="summary-line">
              <span>Product</span>
              <strong>{transaction.productName}</strong>
            </div>
            <div className="summary-line">
              <span>Condition</span>
              <strong>{transaction.condition}</strong>
            </div>
            <div className="summary-line">
              <span>Seller</span>
              <strong>{transaction.sellerName}</strong>
            </div>
            <div className="summary-line">
              <span>Buyer pays</span>
              <strong>{formatNaira(transaction.totalBuyerPays)}</strong>
            </div>
            <div className="summary-line">
              <span>Buyer record</span>
              <strong>{checkoutState.buyer ? checkoutState.buyer.fullName : "Not started"}</strong>
            </div>
            <div className="summary-line">
              <span>Payment state</span>
              <strong>{payment ? humanizeStatus(payment.status) : "Not started"}</strong>
            </div>
            <div className="summary-line">
              <span>Dispute</span>
              <strong>
                {dispute
                  ? disputeOpen
                    ? humanizeStatus(dispute.status)
                    : humanizeStatus(dispute.resolution)
                  : "No issue reported"}
              </strong>
            </div>
          </div>

          <div className="highlight-box">
            <span className="highlight-label">Protection rule</span>
            <strong>Funds release only after buyer acceptance or dispute resolution.</strong>
          </div>

          <div className="list-stack">
            <div className="list-item">
              <strong>Delivery provider</strong>
              <p>
                {checkoutState.deliveryProvider === "sendbox"
                  ? "Sendbox sandbox delivery is configured for this transaction."
                  : "A local test delivery provider is active until Sendbox credentials are added."}
              </p>
            </div>
            <div className="list-item">
              <strong>Payment provider</strong>
              <p>
                {checkoutState.paymentProvider === "interswitch"
                  ? "Quickteller checkout is available for this payment link."
                  : "A local test payment provider is active until Quickteller credentials are added."}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
