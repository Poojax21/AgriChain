const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "agrichain.sqlite");
const db = new sqlite3.Database(dbPath);

// Enable WAL mode for concurrent read/write, busy timeout to avoid SQLITE_BUSY,
// and foreign key enforcement.
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA busy_timeout = 5000;");
db.run("PRAGMA foreign_keys = ON;");

// Initialize database schema
db.serialize(() => {
  // 1. Users table (account profiles; wallet address IS the login credential)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      wallet_address TEXT PRIMARY KEY,
      role TEXT DEFAULT 'USER',
      display_name TEXT,
      location TEXT,
      contact TEXT,
      verified INTEGER DEFAULT 0,
      reputation_score INTEGER DEFAULT 100,
      successful_trades INTEGER DEFAULT 0,
      disputes_won INTEGER DEFAULT 0,
      disputes_lost INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  // 2. Listings table
  db.run(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id INTEGER PRIMARY KEY,
      token_id INTEGER,
      farmer_address TEXT,
      crop_type TEXT,
      price_per_unit TEXT,
      available_quantity INTEGER,
      unit TEXT DEFAULT 'kg',
      quality_grade INTEGER,
      grade_name TEXT,
      confidence_score INTEGER,
      image_cid TEXT,
      image_url TEXT,
      metadata_cid TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER
    )
  `);

  // 3. Orders table
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id INTEGER PRIMARY KEY,
      listing_id INTEGER,
      token_id INTEGER,
      buyer_address TEXT,
      farmer_address TEXT,
      quantity INTEGER,
      total_amount TEXT,
      platform_fee TEXT,
      status TEXT DEFAULT 'PLACED',
      placed_at INTEGER,
      shipped_at INTEGER,
      received_at INTEGER,
      delivered_at INTEGER,
      dispute_reason_hash TEXT
    )
  `);

  // 4. Transit Checkpoints table
  db.run(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      location TEXT,
      timestamp INTEGER,
      temperature INTEGER,
      status_note TEXT,
      latitude REAL,
      longitude REAL,
      weather_temp REAL,
      leaf_hash TEXT,
      merkle_root TEXT,
      ipfs_cid TEXT,
      submitted_by TEXT
    )
  `);

  // 5. Disputes table
  db.run(`
    CREATE TABLE IF NOT EXISTS disputes (
      dispute_id INTEGER PRIMARY KEY,
      order_id INTEGER,
      buyer_address TEXT,
      farmer_address TEXT,
      oracle_node TEXT,
      evidence_hash TEXT,
      evidence_url TEXT,
      claim_text TEXT,
      verdict TEXT DEFAULT 'PENDING',
      is_resolved INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  // Keep existing local databases usable when the demo-image field is added.
  db.run("ALTER TABLE listings ADD COLUMN image_url TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Could not add listings.image_url:", err.message);
    }
  });

  // Unboxing-evidence columns for buyer photo disputes (see POST /api/disputes/evidence).
  for (const col of ["evidence_url TEXT", "claim_text TEXT"]) {
    db.run(`ALTER TABLE disputes ADD COLUMN ${col}`, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error(`Could not add disputes.${col}:`, err.message);
      }
    });
  }

  // 6. Sustainability practices per batch (self-reported by farmer; demo credits)
  db.run(`
    CREATE TABLE IF NOT EXISTS sustainability (
      token_id INTEGER PRIMARY KEY,
      farmer_address TEXT,
      practices TEXT,
      credits REAL DEFAULT 0,
      created_at INTEGER
    )
  `);

  // 7. Authentication Nonces table for SIWE (EIP-4361 challenge-response)
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_nonces (
      nonce TEXT PRIMARY KEY,
      address TEXT,
      created_at INTEGER,
      expires_at INTEGER,
      used INTEGER DEFAULT 0
    )
  `);

  // 8. Notifications table (in-app alerts for order updates, disputes, shipments)
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_address TEXT NOT NULL,
      event_key TEXT UNIQUE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // 9. AI Quality Passports & Review History
  db.run(`
    CREATE TABLE IF NOT EXISTS quality_passports (
      token_id INTEGER PRIMARY KEY,
      crop_type TEXT,
      quality_grade INTEGER,
      grade_name TEXT,
      confidence_score INTEGER,
      confidence_type TEXT,
      grading_method TEXT,
      model_version TEXT,
      explanation TEXT,
      metrics TEXT,
      class_scores TEXT,
      report_hash TEXT,
      image_hash TEXT,
      oracle_address TEXT,
      inspected_at INTEGER,
      review_status TEXT DEFAULT 'ORIGINAL',
      review_decision TEXT,
      review_notes TEXT,
      reviewed_by TEXT,
      reviewed_at INTEGER
    )
  `);

  // Covering indexes for high-frequency queries and foreign key performance
  db.run("CREATE INDEX IF NOT EXISTS idx_auth_nonces_exp ON auth_nonces(expires_at, used)");
  db.run("CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_address)");
  db.run("CREATE INDEX IF NOT EXISTS idx_orders_farmer ON orders(farmer_address)");
  db.run("CREATE INDEX IF NOT EXISTS idx_checkpoints_order ON checkpoints(order_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_listings_farmer ON listings(farmer_address)");
  db.run("CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_address, is_read)");

  // Order lifecycle transaction hash
  db.run("ALTER TABLE orders ADD COLUMN tx_hash TEXT", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Could not add orders.tx_hash:", err.message);
    }
  });

  // Listing passport metadata
  for (const col of ["report_hash TEXT", "model_version TEXT", "grading_method TEXT"]) {
    db.run(`ALTER TABLE listings ADD COLUMN ${col}`, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error(`Could not add listings.${col}:`, err.message);
      }
    });
  }

  // Buyer receipt timestamp backing the retimed auto-release clock.
  db.run("ALTER TABLE orders ADD COLUMN received_at INTEGER", (err) => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error("Could not add orders.received_at:", err.message);
    }
  });

  // Transit telemetry columns (GPS + API weather per checkpoint).
  for (const col of ["latitude REAL", "longitude REAL", "weather_temp REAL"]) {
    db.run(`ALTER TABLE checkpoints ADD COLUMN ${col}`, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error(`Could not add checkpoints.${col}:`, err.message);
      }
    });
  }

  // Account profile + verification columns (wallet address is the login).
  for (const col of ["display_name TEXT", "location TEXT", "contact TEXT", "verified INTEGER DEFAULT 0"]) {
    db.run(`ALTER TABLE users ADD COLUMN ${col}`, (err) => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error(`Could not add users.${col}:`, err.message);
      }
    });
  }
});

// Helper database promise wrappers
const dbAsync = {
  all: (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    }),
  get: (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    }),
  run: (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }),
};

module.exports = {
  db,
  dbAsync,
};
