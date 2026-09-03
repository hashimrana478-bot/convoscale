import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';

const requestLogBuffer = [];
const auditLogBuffer = [];
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;

let flushTimer = null;

export function enqueueAuditLog(item) {
  requestLogBuffer.push(item);
  if (requestLogBuffer.length >= BATCH_SIZE) {
    flushRequestLogs();
  }
}

export function recordAuditAction({ userId, action, resourceType, resourceId, details, ipAddress }) {
  auditLogBuffer.push({
    id: uuidv4(),
    userId,
    action,
    resourceType,
    resourceId,
    details: typeof details === 'object' ? JSON.stringify(details) : details,
    ipAddress,
  });

  if (auditLogBuffer.length >= BATCH_SIZE) {
    flushAuditLogs();
  }
}

async function flushRequestLogs() {
  if (requestLogBuffer.length === 0) return;
  const batch = requestLogBuffer.splice(0, BATCH_SIZE);

  try {
    for (const log of batch) {
      await query(
        `INSERT INTO request_logs (id, request_id, method, path, status_code, duration_ms, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uuidv4(),
          log.requestId,
          log.method,
          log.path,
          log.statusCode,
          log.durationMs,
          log.userId || null,
        ]
      );
    }
  } catch (err) {
    // Avoid crashing on non-critical background logging
    console.error('[Background Queue Error]: Failed to persist request logs:', err.message);
  }
}

async function flushAuditLogs() {
  if (auditLogBuffer.length === 0) return;
  const batch = auditLogBuffer.splice(0, BATCH_SIZE);

  try {
    for (const log of batch) {
      await query(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          log.id,
          log.userId || null,
          log.action,
          log.resourceType || null,
          log.resourceId || null,
          log.details || null,
          log.ipAddress || null,
        ]
      );
    }
  } catch (err) {
    console.error('[Background Queue Error]: Failed to persist audit logs:', err.message);
  }
}

// Start periodic flush worker
export function startBackgroundWorker() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushRequestLogs().catch(() => {});
    flushAuditLogs().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export async function stopBackgroundWorker() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushRequestLogs();
  await flushAuditLogs();
}
