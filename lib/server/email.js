function sanitizeString(value) {
  return String(value || "").trim();
}

function sanitizeEmail(value) {
  return sanitizeString(value).toLowerCase();
}

function splitEmails(value) {
  return sanitizeString(value)
    .split(",")
    .map((entry) => sanitizeEmail(entry))
    .filter(Boolean);
}

function getEmailConfig() {
  return {
    adminAlertEmails: splitEmails(process.env.ADMIN_ALERT_EMAILS),
    brevo: {
      apiKey: sanitizeString(process.env.BREVO_API_KEY),
      baseUrl: sanitizeString(process.env.BREVO_API_BASE_URL) || "https://api.brevo.com/v3",
    },
    fromEmail: sanitizeEmail(process.env.EMAIL_FROM_ADDRESS),
    fromName: sanitizeString(process.env.EMAIL_FROM_NAME) || "Zescrow",
    mode: sanitizeString(process.env.EMAIL_MODE || "mock").toLowerCase(),
  };
}

function isBrevoConfigured(config) {
  return Boolean(config.brevo.apiKey && config.fromEmail);
}

export function getAdminAlertEmails() {
  return getEmailConfig().adminAlertEmails;
}

export async function sendEmail({ html = "", subject, text = "", to }) {
  const config = getEmailConfig();
  const recipients = Array.isArray(to)
    ? to.map(sanitizeEmail).filter(Boolean)
    : [sanitizeEmail(to)].filter(Boolean);

  if (!recipients.length || !sanitizeString(subject)) {
    return { delivered: false, reason: "missing_recipients_or_subject" };
  }

  if (config.mode !== "brevo" || !isBrevoConfigured(config)) {
    console.info("[zescrow-email]", {
      html,
      subject,
      text,
      to: recipients,
    });

    return { delivered: false, reason: "mock_mode" };
  }

  const response = await fetch(`${config.brevo.baseUrl}/smtp/email`, {
    body: JSON.stringify({
      htmlContent: html || undefined,
      sender: {
        email: config.fromEmail,
        name: config.fromName,
      },
      subject,
      textContent: text || undefined,
      to: recipients.map((email) => ({ email })),
    }),
    headers: {
      "Content-Type": "application/json",
      "api-key": config.brevo.apiKey,
      Accept: "application/json",
    },
    method: "POST",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      sanitizeString(data?.message) || "Brevo could not send the email."
    );
  }

  return {
    delivered: true,
    messageId: sanitizeString(data?.messageId),
  };
}
