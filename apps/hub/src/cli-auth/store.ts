import { Database } from "bun:sqlite";

export interface CliWalletRecord {
  userId: string;
  walletId: string;
  address: string;
  createdAt: number;
}

export interface CliLoginRecord {
  code: string;
  deviceHash: string;
  userId: string | null;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface CliSessionRecord {
  tokenHash: string;
  userId: string;
  walletId: string;
  address: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

interface CliWalletRow {
  user_id: string;
  wallet_id: string;
  address: string;
  created_at: number;
}

interface CliLoginRow {
  code: string;
  device_hash: string;
  user_id: string | null;
  created_at: number;
  expires_at: number;
  consumed: number;
}

interface CliSessionRow {
  token_hash: string;
  user_id: string;
  wallet_id: string;
  address: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export class CliAuthStore {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run(
      "CREATE TABLE IF NOT EXISTS cli_wallets (user_id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, address TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS cli_logins (code TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0)",
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS cli_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, wallet_id TEXT NOT NULL, address TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)",
    );
  }

  getWallet(userId: string): CliWalletRecord | null {
    const row = this.db
      .query<CliWalletRow, [string]>("SELECT * FROM cli_wallets WHERE user_id = ?")
      .get(userId);
    if (row === null) return null;
    return {
      userId: row.user_id,
      walletId: row.wallet_id,
      address: row.address,
      createdAt: row.created_at,
    };
  }

  putWallet(userId: string, walletId: string, address: string, at: number): void {
    this.db
      .query(
        "INSERT OR REPLACE INTO cli_wallets (user_id, wallet_id, address, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(userId, walletId, address, at);
  }

  putLogin(code: string, deviceHash: string, at: number, expiresAt: number): void {
    this.db
      .query(
        "INSERT INTO cli_logins (code, device_hash, user_id, created_at, expires_at, consumed) VALUES (?, ?, NULL, ?, ?, 0)",
      )
      .run(code, deviceHash, at, expiresAt);
  }

  getLoginByCode(code: string): CliLoginRecord | null {
    const row = this.db
      .query<CliLoginRow, [string]>("SELECT * FROM cli_logins WHERE code = ?")
      .get(code);
    return row === null ? null : loginFromRow(row);
  }

  getLoginByDevice(deviceHash: string): CliLoginRecord | null {
    const row = this.db
      .query<CliLoginRow, [string]>("SELECT * FROM cli_logins WHERE device_hash = ?")
      .get(deviceHash);
    return row === null ? null : loginFromRow(row);
  }

  approveLogin(code: string, userId: string): void {
    this.db
      .query("UPDATE cli_logins SET user_id = ? WHERE code = ? AND user_id IS NULL")
      .run(userId, code);
  }

  consumeLogin(code: string): void {
    this.db.query("UPDATE cli_logins SET consumed = 1 WHERE code = ?").run(code);
  }

  putSession(record: {
    tokenHash: string;
    userId: string;
    walletId: string;
    address: string;
    createdAt: number;
    expiresAt: number;
  }): void {
    this.db
      .query(
        "INSERT INTO cli_sessions (token_hash, user_id, wallet_id, address, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      )
      .run(
        record.tokenHash,
        record.userId,
        record.walletId,
        record.address,
        record.createdAt,
        record.expiresAt,
      );
  }

  getSession(tokenHash: string): CliSessionRecord | null {
    const row = this.db
      .query<CliSessionRow, [string]>("SELECT * FROM cli_sessions WHERE token_hash = ?")
      .get(tokenHash);
    if (row === null) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      walletId: row.wallet_id,
      address: row.address,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  revokeSession(tokenHash: string, at: number): void {
    this.db.query("UPDATE cli_sessions SET revoked_at = ? WHERE token_hash = ?").run(at, tokenHash);
  }
}

function loginFromRow(row: CliLoginRow): CliLoginRecord {
  return {
    code: row.code,
    deviceHash: row.device_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumed: row.consumed !== 0,
  };
}
