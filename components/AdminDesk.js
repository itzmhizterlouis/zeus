"use client";

import { useMemo, useState } from "react";
import { formatNaira } from "../lib/demo-data";

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

function humanize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

export default function AdminDesk({ initialDisputes }) {
  const [disputes, setDisputes] = useState(initialDisputes);
  const [selectedId, setSelectedId] = useState(initialDisputes[0]?.id || "");
  const [adminNote, setAdminNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedDispute =
    disputes.find((dispute) => dispute.id === selectedId) || disputes[0] || null;
  const openDisputeCount = useMemo(
    () =>
      disputes.filter((dispute) => ["open", "under_review"].includes(dispute.status)).length,
    [disputes]
  );
  const resolvedDisputeCount = disputes.length - openDisputeCount;

  async function handleResolve(resolution) {
    if (!selectedDispute) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await postJson(
        `/api/admin/disputes/${selectedDispute.id}/resolve`,
        {
          adminNote,
          resolution,
        }
      );

      setDisputes(data.disputes);
      setSelectedId(data.dispute.id);
      setMessage(data.message);
      setAdminNote("");
    } catch (resolutionError) {
      setError(resolutionError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-stack">
      <div className="metrics-row admin-metrics">
        <article className="metric-card">
          <strong>{openDisputeCount}</strong>
          <span>open disputes</span>
        </article>
        <article className="metric-card">
          <strong>{resolvedDisputeCount}</strong>
          <span>resolved disputes</span>
        </article>
        <article className="metric-card">
          <strong>{disputes.length}</strong>
          <span>total recorded cases</span>
        </article>
      </div>

      <div className="workspace-grid">
        <article className="panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-pink">Dispute queue</span>
              <h2>Cases awaiting admin review</h2>
            </div>
          </div>

          {disputes.length === 0 ? (
            <p className="helper-text">
              No disputes yet. Buyer issues will appear here once they are raised from escrow.
            </p>
          ) : (
            <div className="queue-list">
              {disputes.map((item) => (
                <button
                  className={`queue-item ${
                    selectedDispute?.id === item.id ? "queue-item-active" : ""
                  }`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <div>
                    <strong>{item.transaction?.shortCode || item.id}</strong>
                    <p>{item.transaction?.productName || "Unknown item"}</p>
                  </div>
                  <div className="queue-side">
                    <span>{humanize(item.reason)}</span>
                    <strong>
                      {item.transaction ? formatNaira(item.transaction.amount) : "Amount unavailable"}
                    </strong>
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel panel-dark sticky-panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-blue">Selected case</span>
              <h2>{selectedDispute?.transaction?.shortCode || "No dispute selected"}</h2>
            </div>
            {selectedDispute ? (
              <span className="status-pill accent-pink">{humanize(selectedDispute.status)}</span>
            ) : null}
          </div>

          {error ? (
            <div className="message-banner message-banner-error">{error}</div>
          ) : null}

          {message ? (
            <div className="message-banner message-banner-info">{message}</div>
          ) : null}

          {selectedDispute ? (
            <div className="content-stack">
              <div className="list-stack">
                <div className="list-item">
                  <strong>Buyer issue</strong>
                  <p>{selectedDispute.description}</p>
                </div>
                <div className="list-item">
                  <strong>Evidence note</strong>
                  <p>{selectedDispute.evidenceNote || "No extra evidence note was added."}</p>
                </div>
                <div className="list-item">
                  <strong>Attachments</strong>
                  {selectedDispute.evidenceAttachments?.length ? (
                    <div className="attachment-list">
                      {selectedDispute.evidenceAttachments.map((attachment) => (
                        <a
                          className="text-link text-link-light"
                          href={attachment.url}
                          key={attachment.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {attachment.name || "Evidence file"}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p>No attachments were uploaded.</p>
                  )}
                </div>
                <div className="list-item">
                  <strong>Buyer details</strong>
                  <p>
                    {selectedDispute.buyer?.fullName}
                    <br />
                    {selectedDispute.buyer?.email}
                    <br />
                    {selectedDispute.buyer?.phone}
                  </p>
                </div>
                <div className="list-item">
                  <strong>Seller and transaction</strong>
                  <p>
                    {selectedDispute.transaction?.sellerName}
                    <br />
                    {selectedDispute.transaction?.productName}
                  </p>
                </div>
              </div>

              {selectedDispute.status !== "resolved" ? (
                <>
                  <label className="field">
                    <span>Admin note</span>
                    <textarea
                      className="input textarea-input"
                      onChange={(event) => setAdminNote(event.target.value)}
                      placeholder="Add context for your decision."
                      value={adminNote}
                    />
                  </label>

                  <div className="button-row">
                    <button
                      className="button button-light"
                      disabled={busy}
                      onClick={() => handleResolve("release_seller")}
                      type="button"
                    >
                      {busy ? "Saving..." : "Release seller"}
                    </button>
                    <button
                      className="button button-light"
                      disabled={busy}
                      onClick={() => handleResolve("refund_buyer")}
                      type="button"
                    >
                      {busy ? "Saving..." : "Refund buyer"}
                    </button>
                    <button
                      className="button button-dark"
                      disabled={busy}
                      onClick={() => handleResolve("return_first")}
                      type="button"
                    >
                      {busy ? "Saving..." : "Return first"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="highlight-box">
                  <span className="highlight-label">Resolution</span>
                  <strong>{humanize(selectedDispute.resolution)}</strong>
                  <span>{selectedDispute.adminNote || "No admin note recorded."}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="helper-text helper-text-light">
              Choose a dispute from the queue to review it.
            </p>
          )}
        </article>
      </div>

      <div className="workspace-grid lower-grid">
        <article className="panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-green">Timeline</span>
              <h2>Case timestamps</h2>
            </div>
          </div>

          {selectedDispute ? (
            <div className="timeline-list">
              <div className="timeline-item">
                <strong>{formatDateLabel(selectedDispute.createdAt)}</strong>
                <p>Buyer opened the dispute with reason: {humanize(selectedDispute.reason)}.</p>
              </div>
              <div className="timeline-item">
                <strong>{formatDateLabel(selectedDispute.updatedAt)}</strong>
                <p>Latest case update status: {humanize(selectedDispute.status)}.</p>
              </div>
              {selectedDispute.resolvedAt ? (
                <div className="timeline-item">
                  <strong>{formatDateLabel(selectedDispute.resolvedAt)}</strong>
                  <p>Admin resolved the dispute as {humanize(selectedDispute.resolution)}.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="helper-text">No case selected.</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-blue">Guardrails</span>
              <h2>Admin permissions model</h2>
            </div>
          </div>

          <div className="list-stack">
            <div className="list-item">
              <strong>Admins can review, release, and refund</strong>
              <p>They can resolve disputes and hold funds in escrow while the case is open.</p>
            </div>
            <div className="list-item">
              <strong>Admins cannot rewrite history</strong>
              <p>Transaction history stays system-generated and every decision is timestamped.</p>
            </div>
            <div className="list-item">
              <strong>Buyer disputes lock the normal flow</strong>
              <p>Once an issue is opened, the transaction should not quietly continue to payout.</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
