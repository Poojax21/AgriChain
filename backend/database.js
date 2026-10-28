const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "agrichain.sqlite");
const db = new sqlite3.Database(dbPath);

// Initialize database schema
db.serialize(() => {
  // 1. Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      wallet_address TEXT PRIMARY KEY,
      role TEXT DEFAULT 'USER',
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
      verdict TEXT DEFAULT 'PENDING',
      is_resolved INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);
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
