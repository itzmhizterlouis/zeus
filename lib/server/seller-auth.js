import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";

export const SELLER_SESSION_COOKIE = "zeus_seller_session";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JWT_ALG = "HS256";

function now() {
  return new Date();
}

function nowIso() {
  return now().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function sanitizeString(value) {
  return String(value || "").trim();
}

function validateRequired(value, label) {
  if (!sanitizeString(value)) {
    throw new Error(`${label} is required.`);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  const [salt, savedHash] = String(storedPassword || "").split(":");

  if (!salt || !savedHash) {
    return false;
  }

  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return hash === savedHash;
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getJwtSecret() {
  const secret = String(process.env.AUTH_JWT_SECRET || "").trim();

  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is required for seller authentication.");
  }

  return secret;
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), "=") : normalized;
  return Buffer.from(padded, "base64").toString("utf8");
}

function signJwt(payload) {
  const header = encodeBase64Url(JSON.stringify({ alg: JWT_ALG, typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  const [header, body, signature] = String(token || "").split(".");

  if (!header || !body || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(body));

    if (!payload?.sub || !payload?.exp || payload.exp * 1000 <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(sellerId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_MS / 1000;

  return signJwt({
    exp: expiresAt,
    iat: issuedAt,
    sub: sellerId,
    type: "seller_session",
  });
}

function maskAccountNumber(accountNumber) {
  const value = sanitizeString(accountNumber);

  if (!value) {
    return "";
  }

  return `••••${value.slice(-4)}`;
}

function presentSeller(seller) {
  if (!seller) {
    return null;
  }

  return {
    id: seller.id,
    fullName: seller.full_name,
    businessName: seller.business_name,
    businessLogoUrl: seller.business_logo_url || "",
    country: seller.country,
    createdAt: seller.created_at,
    displayName: seller.business_name || seller.full_name,
    email: seller.email,
    emailVerified: Boolean(seller.email_verified),
    onboardingCompleted: Boolean(seller.onboarding_completed),
    phone: seller.phone,
    phoneVerified: Boolean(seller.phone_verified),
    verificationStatus: seller.verification_status || "pending",
    verificationType: seller.verification_type || "",
    bankName: seller.bank_name || "",
    accountHolderName: seller.bank_account_holder_name || "",
    accountNumberMasked: maskAccountNumber(seller.bank_account_number),
    termsAccepted: Boolean(seller.terms_accepted_at),
    updatedAt: seller.updated_at,
  };
}

async function persistSessionForSeller(sellerId) {
  return createSessionToken(sellerId);
}

export async function beginSellerSignup(payload) {
  const fullName = sanitizeString(payload.fullName);
  const businessName = sanitizeString(payload.businessName);
  const country = sanitizeString(payload.country);
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.phone);
  const password = String(payload.password || "");

  validateRequired(fullName, "Full name");
  validateRequired(country, "Country");
  validateRequired(email, "Email");
  validateRequired(phone, "Phone number");

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existingByEmail = await db
    .prepare("SELECT * FROM sellers WHERE email = ?")
    .get(email);
  const existingByPhone = await db
    .prepare("SELECT * FROM sellers WHERE phone = ?")
    .get(phone);
  const existingSeller = existingByEmail || existingByPhone;

  if (
    existingSeller &&
    (existingSeller.email_verified ||
      existingSeller.phone_verified ||
      existingSeller.onboarding_completed)
  ) {
    throw new Error("A seller account with this email or phone already exists. Please log in instead.");
  }

  const timestamp = nowIso();

  if (existingSeller) {
    await db.prepare(
      `UPDATE sellers
       SET business_name = ?, country = ?, email = ?, full_name = ?, password_hash = ?, phone = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      businessName,
      country,
      email,
      fullName,
      hashPassword(password),
      phone,
      timestamp,
      existingSeller.id
    );
  } else {
    await db.prepare(
      `INSERT INTO sellers (
        id, full_name, business_name, country, email, phone, password_hash,
        email_verified, phone_verified, onboarding_completed, terms_accepted_at,
        verification_type, verification_status, verification_value_last4,
        verification_verified_at, bank_name, bank_account_number,
        bank_account_holder_name, bank_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, FALSE, FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
    ).run(
      generateId("seller"),
      fullName,
      businessName,
      country,
      email,
      phone,
      hashPassword(password),
      timestamp,
      timestamp
    );
  }

  const seller = await db.prepare("SELECT * FROM sellers WHERE email = ?").get(email);

  const emailCode = generateOtpCode();
  const phoneCode = generateOtpCode();

  await db.prepare(
    `INSERT INTO otp_sessions (id, seller_id, email_code, phone_code, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    generateId("otp"),
    seller.id,
    emailCode,
    phoneCode,
    timestamp,
    new Date(Date.now() + OTP_TTL_MS).toISOString()
  );

  return {
    devOtp: {
      emailCode,
      expiresInMinutes: 10,
      phoneCode,
    },
    seller: presentSeller(seller),
  };
}

export async function verifySellerOtp(payload) {
  const sellerId = sanitizeString(payload.sellerId);
  const emailCode = sanitizeString(payload.emailCode);
  const phoneCode = sanitizeString(payload.phoneCode);

  validateRequired(sellerId, "Seller reference");
  validateRequired(emailCode, "Email OTP");
  validateRequired(phoneCode, "Phone OTP");

  const activeOtp = await db
    .prepare(
      `SELECT * FROM otp_sessions
       WHERE seller_id = ?
       AND consumed_at IS NULL
       AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(sellerId, nowIso());

  if (!activeOtp) {
    throw new Error("This OTP session has expired. Please start again.");
  }

  if (activeOtp.email_code !== emailCode || activeOtp.phone_code !== phoneCode) {
    throw new Error("The OTP codes did not match. Please try again.");
  }

  const seller = await db.prepare("SELECT * FROM sellers WHERE id = ?").get(sellerId);

  if (!seller) {
    throw new Error("Seller account not found.");
  }

  await db.prepare(
    `UPDATE otp_sessions SET consumed_at = ? WHERE id = ?`
  ).run(nowIso(), activeOtp.id);

  await db.prepare(
    `UPDATE sellers
     SET email_verified = TRUE, phone_verified = TRUE, updated_at = ?
     WHERE id = ?`
  ).run(nowIso(), sellerId);

  const updatedSeller = await db.prepare("SELECT * FROM sellers WHERE id = ?").get(sellerId);
  const token = await persistSessionForSeller(sellerId);

  return {
    seller: presentSeller(updatedSeller),
    token,
  };
}

export async function loginSeller(payload) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");

  validateRequired(email, "Email");
  validateRequired(password, "Password");

  const seller = await db.prepare("SELECT * FROM sellers WHERE email = ?").get(email);

  if (!seller || !verifyPassword(password, seller.password_hash)) {
    throw new Error("Invalid email or password.");
  }

  if (!seller.email_verified || !seller.phone_verified) {
    const emailCode = generateOtpCode();
    const phoneCode = generateOtpCode();

    await db.prepare(
      `INSERT INTO otp_sessions (id, seller_id, email_code, phone_code, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      generateId("otp"),
      seller.id,
      emailCode,
      phoneCode,
      nowIso(),
      new Date(Date.now() + OTP_TTL_MS).toISOString()
    );

    return {
      devOtp: {
        emailCode,
        expiresInMinutes: 10,
        phoneCode,
      },
      nextStep: "otp",
      seller: presentSeller(seller),
    };
  }

  const token = await persistSessionForSeller(seller.id);

  return {
    nextStep: seller.onboarding_completed ? "dashboard" : "profile",
    seller: presentSeller(seller),
    token,
  };
}

export async function completeSellerOnboarding(sellerId, payload) {
  const businessName = sanitizeString(payload.businessName);
  const businessLogoUrl = sanitizeString(payload.businessLogoUrl);
  const country = sanitizeString(payload.country);
  const identityType = sanitizeString(payload.identityType).toUpperCase();
  const identityValue = sanitizeString(payload.identityValue).replace(/[^\d]/g, "");
  const bankName = sanitizeString(payload.bankName);
  const accountNumber = sanitizeString(payload.accountNumber).replace(/[^\d]/g, "");
  const accountHolderName = sanitizeString(payload.accountHolderName);
  const acceptTerms = Boolean(payload.acceptTerms);

  validateRequired(country, "Country");
  validateRequired(identityType, "Identity type");
  validateRequired(identityValue, "BVN or NIN");
  validateRequired(bankName, "Bank name");
  validateRequired(accountNumber, "Account number");
  validateRequired(accountHolderName, "Account holder name");

  if (!["BVN", "NIN"].includes(identityType)) {
    throw new Error("Identity type must be BVN or NIN.");
  }

  if (identityValue.length < 10) {
    throw new Error("Your BVN or NIN looks too short.");
  }

  if (accountNumber.length !== 10) {
    throw new Error("Bank account number must be 10 digits.");
  }

  if (!acceptTerms) {
    throw new Error("You need to accept the seller escrow agreement to continue.");
  }

  const seller = await db.prepare("SELECT * FROM sellers WHERE id = ?").get(sellerId);

  if (!seller) {
    throw new Error("Seller account not found.");
  }

  if (!seller.email_verified || !seller.phone_verified) {
    throw new Error("Verify your email and phone first.");
  }

  await db.prepare(
    `UPDATE sellers
     SET business_name = ?, country = ?, onboarding_completed = TRUE,
         business_logo_url = ?,
         terms_accepted_at = ?, updated_at = ?, verification_type = ?,
         verification_status = 'verified', verification_value_last4 = ?,
         verification_verified_at = ?, bank_name = ?, bank_account_number = ?,
         bank_account_holder_name = ?, bank_verified_at = ?
     WHERE id = ?`
  ).run(
    businessName,
    country,
    businessLogoUrl,
    nowIso(),
    nowIso(),
    identityType,
    identityValue.slice(-4),
    nowIso(),
    bankName,
    accountNumber,
    accountHolderName,
    nowIso(),
    sellerId
  );

  return presentSeller(await db.prepare("SELECT * FROM sellers WHERE id = ?").get(sellerId));
}

export async function clearSellerSession(token) {
  return token ? true : false;
}

async function getSellerFromSessionToken(token) {
  if (!token) {
    return null;
  }

  const session = verifyJwt(token);

  if (!session) {
    return null;
  }

  const seller = await db.prepare("SELECT * FROM sellers WHERE id = ?").get(session.sub);

  return presentSeller(seller);
}

export async function getCurrentSeller() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SELLER_SESSION_COOKIE)?.value;
  return getSellerFromSessionToken(token);
}

export async function getCurrentSellerSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SELLER_SESSION_COOKIE)?.value || "";
}

export function attachSellerSession(response, token) {
  response.cookies.set(SELLER_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

export function clearSellerSessionCookie(response) {
  response.cookies.set(SELLER_SESSION_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
