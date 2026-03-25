import { Pool } from "pg";

const connectionString = String(process.env.DATABASE_URL || "").trim();

function toPgStatement(sql, params) {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const values = [];
    const text = sql.replace(/@([a-zA-Z0-9_]+)/g, (_, key) => {
      values.push(params[key]);
      return `$${values.length}`;
    });

    return { text, values };
  }

  const values = Array.isArray(params) ? params : [params].filter((value) => value !== undefined);
  let index = 0;
  const text = sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });

  return { text, values };
}

function createDbError() {
  return new Error("DATABASE_URL is required to use the PostgreSQL data layer.");
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    })
  : null;

let initializedPromise = null;

async function initializeDatabase() {
  if (!pool) {
    throw createDbError();
  }

  if (!initializedPromise) {
    initializedPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sellers (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          business_name TEXT DEFAULT '',
          business_logo_url TEXT DEFAULT '',
          country TEXT DEFAULT '',
          email TEXT NOT NULL UNIQUE,
          phone TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          email_verified BOOLEAN NOT NULL DEFAULT FALSE,
          phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
          onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
          terms_accepted_at TIMESTAMPTZ,
          verification_type TEXT,
          verification_status TEXT,
          verification_value_last4 TEXT,
          verification_verified_at TIMESTAMPTZ,
          bank_name TEXT,
          bank_account_number TEXT,
          bank_account_holder_name TEXT,
          bank_verified_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS otp_sessions (
          id TEXT PRIMARY KEY,
          seller_id TEXT NOT NULL REFERENCES sellers(id),
          email_code TEXT NOT NULL,
          phone_code TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS seller_sessions (
          token TEXT PRIMARY KEY,
          seller_id TEXT NOT NULL REFERENCES sellers(id),
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          short_code TEXT NOT NULL UNIQUE,
          seller_id TEXT NOT NULL REFERENCES sellers(id),
          seller_name TEXT NOT NULL,
          product_name TEXT NOT NULL,
          description TEXT DEFAULT '',
          item_condition TEXT NOT NULL,
          pickup_location TEXT NOT NULL,
          pickup_location_data TEXT NOT NULL DEFAULT '',
          pickup_address_note TEXT NOT NULL DEFAULT '',
          delivery_address TEXT NOT NULL,
          delivery_location_data TEXT NOT NULL DEFAULT '',
          delivery_address_note TEXT NOT NULL DEFAULT '',
          price INTEGER NOT NULL,
          escrow_fee INTEGER NOT NULL,
          delivery_fee INTEGER NOT NULL,
          total_buyer_pays INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS buyers (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          delivery_address TEXT NOT NULL,
          verification_status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES transactions(id),
          buyer_id TEXT REFERENCES buyers(id),
          provider TEXT NOT NULL,
          provider_mode TEXT NOT NULL,
          merchant_reference TEXT NOT NULL UNIQUE,
          payment_reference TEXT DEFAULT '',
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          checkout_payload TEXT DEFAULT '',
          provider_response TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          confirmed_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS deliveries (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
          provider TEXT NOT NULL,
          provider_mode TEXT NOT NULL,
          quote_reference TEXT DEFAULT '',
          provider_reference TEXT DEFAULT '',
          tracking_url TEXT DEFAULT '',
          quoted_fee INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          pickup_address TEXT NOT NULL,
          dropoff_address TEXT NOT NULL,
          receiver_name TEXT DEFAULT '',
          receiver_phone TEXT DEFAULT '',
          provider_payload TEXT DEFAULT '',
          last_synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          booked_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS delivery_events (
          id TEXT PRIMARY KEY,
          delivery_id TEXT NOT NULL REFERENCES deliveries(id),
          status TEXT NOT NULL,
          note TEXT DEFAULT '',
          location TEXT DEFAULT '',
          event_at TIMESTAMPTZ NOT NULL,
          provider_payload TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transaction_status_history (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES transactions(id),
          status TEXT NOT NULL,
          note TEXT DEFAULT '',
          metadata TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS disputes (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES transactions(id),
          buyer_id TEXT NOT NULL REFERENCES buyers(id),
          reason TEXT NOT NULL,
          description TEXT DEFAULT '',
          evidence_note TEXT DEFAULT '',
          evidence_attachments TEXT DEFAULT '',
          status TEXT NOT NULL,
          resolution TEXT DEFAULT '',
          admin_note TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          resolved_at TIMESTAMPTZ
        );
      `);
    })();
  }

  await initializedPromise;
}

class PreparedStatement {
  constructor(sql) {
    this.sql = sql;
  }

  async get(...args) {
    await initializeDatabase();
    const { text, values } = toPgStatement(this.sql, args.length <= 1 ? args[0] : args);
    const result = await pool.query(text, values);
    return result.rows[0];
  }

  async all(...args) {
    await initializeDatabase();
    const { text, values } = toPgStatement(this.sql, args.length <= 1 ? args[0] : args);
    const result = await pool.query(text, values);
    return result.rows;
  }

  async run(...args) {
    await initializeDatabase();
    const { text, values } = toPgStatement(this.sql, args.length <= 1 ? args[0] : args);
    const result = await pool.query(text, values);
    return { changes: result.rowCount };
  }
}

export const db = {
  prepare(sql) {
    return new PreparedStatement(sql);
  },
};

export async function closeDatabase() {
  if (pool) {
    await pool.end();
  }
}
