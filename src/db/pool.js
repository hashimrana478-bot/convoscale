import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb } from 'pg-mem';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

let activePool = null;
let activeMemDb = null;
let isEmbedded = false;

// Initialize or get the database pool
export async function getDbPool() {
  if (activePool) return activePool;

  if (config.useEmbeddedEngines === 'true') {
    return initEmbeddedDb();
  }

  try {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      min: config.dbPoolMin,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
      connectionTimeoutMillis: config.dbPoolConnectionTimeoutMs,
    });

    // Test real connection
    const client = await pool.connect();
    client.release();
    activePool = pool;
    isEmbedded = false;
    return activePool;
  } catch (err) {
    if (config.useEmbeddedEngines === 'auto') {
      console.warn(`[DB] Remote/local PostgreSQL not reachable (${err.message}). Initializing embedded in-memory PostgreSQL engine...`);
      return initEmbeddedDb();
    }
    throw err;
  }
}

function initEmbeddedDb() {
  const memDb = newDb();
  activeMemDb = memDb;
  
  // Register common PostgreSQL functions
  memDb.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 16.0 (pg-mem embedded)',
  });
  
  const adapter = memDb.adapters.createPg();
  const pool = new adapter.Pool({
    max: config.dbPoolMax,
  });

  activePool = pool;
  isEmbedded = true;
  return activePool;
}

export function isEmbeddedDb() {
  return isEmbedded;
}

// Parameterized query runner
export async function query(text, params = []) {
  const pool = await getDbPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    return { ...res, durationMs: duration };
  } catch (error) {
    throw error;
  }
}

// Transaction helper with automatic rollback on error
export async function withTransaction(callback, isolationLevel = 'READ COMMITTED') {
  const pool = await getDbPool();
  const client = await pool.connect();

  if (isEmbedded && activeMemDb) {
    const backup = activeMemDb.backup();
    try {
      const result = await callback(client);
      return result;
    } catch (error) {
      backup.restore();
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB] Rollback failed:', rollbackErr);
    }
    throw error;
  } finally {
    client.release();
  }
}

// Initialize database schema
export async function initDatabase() {
  const pool = await getDbPool();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Strip single-line comments and split by semicolon
  const cleanSql = schemaSql.replace(/--.*$/gm, '');
  const statements = cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  // Suppress pg-mem internal AST parse warnings during in-memory schema init
  const originalWarn = console.warn;
  if (isEmbedded) {
    console.warn = (...args) => {
      const str = args.join(' ');
      if (str.includes('pg-mem is work-in-progress') || str.includes('Not supported')) return;
      originalWarn(...args);
    };
  }

  try {
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('not supported')) {
          originalWarn(`[DB Init Warning] Statement: ${stmt.slice(0, 45)}... - ${err.message}`);
        }
      }
    }
  } finally {
    if (isEmbedded) {
      console.warn = originalWarn;
    }
  }

  console.log(`[DB] Database schema initialized successfully (${isEmbedded ? 'Embedded In-Memory' : 'PostgreSQL Server'}).`);
}

// Pool health check
export async function dbHealthCheck() {
  try {
    const start = Date.now();
    const res = await query('SELECT 1 AS alive');
    const latency = Date.now() - start;
    return {
      status: res.rows && res.rows[0]?.alive === 1 ? 'healthy' : 'degraded',
      latencyMs: latency,
      isEmbedded,
      poolSize: activePool?.totalCount || config.dbPoolMax,
      idleClients: activePool?.idleCount || 0,
      waitingClients: activePool?.waitingCount || 0,
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message,
      isEmbedded,
    };
  }
}
