const DEFAULT_APP_URL = "http://localhost:3001";

function sanitizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized;
}

function getRailwayPublicUrl() {
  const publicDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();

  if (!publicDomain) {
    return "";
  }

  if (/^https?:\/\//i.test(publicDomain)) {
    return sanitizeBaseUrl(publicDomain);
  }

  return `https://${sanitizeBaseUrl(publicDomain)}`;
}

export function getAppBaseUrl(fallbackOrigin = "") {
  return (
    sanitizeBaseUrl(process.env.APP_URL) ||
    sanitizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    getRailwayPublicUrl() ||
    sanitizeBaseUrl(fallbackOrigin) ||
    DEFAULT_APP_URL
  );
}

export function getPaymentProviderConfig(origin = "") {
  const provider = String(process.env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();
  const environment = String(process.env.PAYMENT_ENV || "test").trim().toLowerCase();
  const isLive = environment === "live";

  return {
    appBaseUrl: getAppBaseUrl(origin),
    currency: String(process.env.INTERSWITCH_CURRENCY || "566").trim(),
    environment,
    provider,
    quickteller: {
      confirmationBaseUrl: isLive
        ? "https://webpay.interswitchng.com"
        : "https://qa.interswitchng.com",
      merchantCode: String(process.env.INTERSWITCH_MERCHANT_CODE || "").trim(),
      payItemId: String(process.env.INTERSWITCH_PAY_ITEM_ID || "").trim(),
      payItemName: String(
        process.env.INTERSWITCH_PAY_ITEM_NAME || "Zescrow Escrow Transaction"
      ).trim(),
      scriptUrl: isLive
        ? "https://newwebpay.interswitchng.com/inline-checkout.js"
        : "https://newwebpay.qa.interswitchng.com/inline-checkout.js",
    },
  };
}

export function isQuicktellerConfigured(origin = "") {
  const config = getPaymentProviderConfig(origin);
  return Boolean(
    config.quickteller.merchantCode && config.quickteller.payItemId
  );
}

export function getDeliveryProviderConfig() {
  return {
    environment: String(process.env.DELIVERY_ENV || "test").trim().toLowerCase(),
    provider: String(process.env.DELIVERY_PROVIDER || "mock").trim().toLowerCase(),
    sendbox: {
      apiKey: String(process.env.SENDBOX_API_KEY || "").trim(),
      authHeader: String(process.env.SENDBOX_AUTH_HEADER || "Authorization").trim(),
      authPrefix: String(process.env.SENDBOX_AUTH_PREFIX || "").trim(),
      baseUrl: sanitizeBaseUrl(process.env.SENDBOX_API_BASE_URL),
      createOrderPath: String(process.env.SENDBOX_CREATE_ORDER_PATH || "").trim(),
      quotePath: String(process.env.SENDBOX_QUOTE_PATH || "").trim(),
      trackPath: String(process.env.SENDBOX_TRACK_PATH || "").trim(),
    },
  };
}

export function isSendboxConfigured() {
  const config = getDeliveryProviderConfig();
  return Boolean(
    config.sendbox.baseUrl &&
      config.sendbox.apiKey &&
      config.sendbox.quotePath &&
      config.sendbox.createOrderPath
  );
}
