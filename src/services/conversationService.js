import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/pool.js';
import { determineBotResponse } from './chatBotEngine.js';
import { recordAuditAction } from './backgroundQueue.js';

// Concurrency mutex queue per conversation to serialize writes to the same conversation
const activeLocks = new Map();

async function acquireConversationLock(conversationId) {
  while (activeLocks.has(conversationId)) {
    await activeLocks.get(conversationId);
  }
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  activeLocks.set(conversationId, promise);
  return () => {
    activeLocks.delete(conversationId);
    release();
  };
}

/**
 * Create a new conversation for an authenticated user
 */
export async function createConversation(userId, title = 'New Conversation') {
  const conversationId = uuidv4();
  const now = new Date();

  await query(
    `INSERT INTO conversations (id, user_id, title, message_count, version, created_at, updated_at, last_message_at)
     VALUES ($1, $2, $3, 0, 1, $4, $4, $4)`,
    [conversationId, userId, title, now]
  );

  recordAuditAction({
    userId,
    action: 'CONVERSATION_CREATED',
    resourceType: 'conversations',
    resourceId: conversationId,
    details: { title },
  });

  return {
    id: conversationId,
    userId,
    title,
    messageCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };
}

/**
 * Get all conversations for a user with cursor pagination
 */
export async function getUserConversations(userId, { limit = 20, cursor, cursorId } = {}) {
  let sql = `
    SELECT id, user_id, title, message_count, version, last_message_at, created_at, updated_at
    FROM conversations
    WHERE user_id = $1
  `;
  const params = [userId];

  if (cursor && cursorId) {
    sql += ` AND ((last_message_at < $2) OR (last_message_at = $2 AND id < $3))`;
    params.push(cursor, cursorId);
  }

  sql += ` ORDER BY last_message_at DESC, id DESC LIMIT $${params.length + 1}`;
  params.push(limit + 1);

  const result = await query(sql, params);
  const hasNextPage = result.rows.length > limit;
  const items = hasNextPage ? result.rows.slice(0, limit) : result.rows;

  const nextCursor =
    hasNextPage && items.length > 0
      ? {
          lastMessageAt: items[items.length - 1].last_message_at,
          id: items[items.length - 1].id,
        }
      : null;

  return {
    items,
    pagination: {
      limit,
      hasNextPage,
      nextCursor,
    },
  };
}

/**
 * Get messages inside a conversation using efficient keyset / cursor pagination
 */
export async function getConversationMessages(conversationId, { limit = 20, cursor, cursorId } = {}) {
  let sql = `
    SELECT id, conversation_id, sender_type, content, idempotency_key, sequence_number, created_at
    FROM messages
    WHERE conversation_id = $1
  `;
  const params = [conversationId];

  if (cursor && cursorId) {
    sql += ` AND ((created_at < $2) OR (created_at = $2 AND id < $3))`;
    params.push(cursor, cursorId);
  }

  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1}`;
  params.push(limit + 1);

  const result = await query(sql, params);
  const hasNextPage = result.rows.length > limit;
  const items = hasNextPage ? result.rows.slice(0, limit) : result.rows;

  const nextCursor =
    hasNextPage && items.length > 0
      ? {
          createdAt: items[items.length - 1].created_at,
          id: items[items.length - 1].id,
        }
      : null;

  return {
    items: items.reverse(), // return in chronological order for chat UI
    pagination: {
      limit,
      hasNextPage,
      nextCursor,
    },
  };
}

/**
 * Send a message with strict ACID transaction guarantees, concurrency control,
 * atomic bot generation and response insertion, and sequence monotonicity.
 */
export async function sendMessage(conversationId, userId, content, idempotencyKey = null, simulateBotFailure = false) {
  const releaseLock = await acquireConversationLock(conversationId);

  try {
    return await withTransaction(async (client) => {
      // 1. Lock conversation row (FOR UPDATE)
      const convoRes = await client.query(
        `SELECT id, user_id, message_count, version 
         FROM conversations 
         WHERE id = $1 
         FOR UPDATE`,
        [conversationId]
      );

      if (convoRes.rows.length === 0) {
        const err = new Error(`Conversation with ID ${conversationId} not found.`);
        err.status = 404;
        throw err;
      }

      const conversation = convoRes.rows[0];
      if (conversation.user_id !== userId) {
        const err = new Error('Access denied. You do not own this conversation.');
        err.status = 403;
        throw err;
      }

      const currentCount = parseInt(conversation.message_count, 10);
      const userMsgId = uuidv4();
      const userSeq = currentCount + 1;
      const now = new Date();

      // 2. Insert User Message
      const userMsgRes = await client.query(
        `INSERT INTO messages (id, conversation_id, sender_type, content, idempotency_key, sequence_number, created_at)
         VALUES ($1, $2, 'user', $3, $4, $5, $6)
         RETURNING id, conversation_id, sender_type, content, sequence_number, created_at`,
        [userMsgId, conversationId, content, idempotencyKey, userSeq, now]
      );
      const userMessage = userMsgRes.rows[0];

      // 3. Evaluate Chatbot Response
      const botReplyText = await determineBotResponse(content);

      // Simulation hook for automated testing of ACID transaction rollback
      if (simulateBotFailure) {
        throw new Error('SIMULATED_BOT_FAILURE: Bot service failed during transaction.');
      }

      // 4. Insert Bot Response Message
      const botMsgId = uuidv4();
      const botSeq = currentCount + 2;
      const botTimestamp = new Date(now.getTime() + 10);

      const botMsgRes = await client.query(
        `INSERT INTO messages (id, conversation_id, sender_type, content, sequence_number, created_at)
         VALUES ($1, $2, 'bot', $3, $4, $5)
         RETURNING id, conversation_id, sender_type, content, sequence_number, created_at`,
        [botMsgId, conversationId, botReplyText, botSeq, botTimestamp]
      );
      const botMessage = botMsgRes.rows[0];

      // 5. Atomically update conversation metadata and version
      const updatedConvoRes = await client.query(
        `UPDATE conversations
         SET message_count = message_count + 2,
             last_message_at = $1,
             version = version + 1,
             updated_at = $1
         WHERE id = $2
         RETURNING id, user_id, title, message_count, version, last_message_at, updated_at`,
        [botTimestamp, conversationId]
      );

      recordAuditAction({
        userId,
        action: 'MESSAGE_SENT',
        resourceType: 'conversations',
        resourceId: conversationId,
        details: { userMsgId, botMsgId, sequence: [userSeq, botSeq] },
      });

      return {
        conversation: updatedConvoRes.rows[0],
        userMessage,
        botMessage,
      };
    });
  } finally {
    releaseLock();
  }
}

/**
 * Update conversation title
 */
export async function updateConversation(conversationId, userId, title) {
  const res = await query(
    `UPDATE conversations 
     SET title = $1, updated_at = CURRENT_TIMESTAMP, version = version + 1
     WHERE id = $2 AND user_id = $3
     RETURNING id, user_id, title, message_count, version, last_message_at, updated_at`,
    [title, conversationId, userId]
  );

  if (res.rows.length === 0) {
    const err = new Error('Conversation not found or unauthorized.');
    err.status = 404;
    throw err;
  }

  return res.rows[0];
}

/**
 * Delete conversation and cascade messages
 */
export async function deleteConversation(conversationId, userId) {
  const res = await query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
    [conversationId, userId]
  );

  if (res.rows.length === 0) {
    const err = new Error('Conversation not found or unauthorized.');
    err.status = 404;
    throw err;
  }

  recordAuditAction({
    userId,
    action: 'CONVERSATION_DELETED',
    resourceType: 'conversations',
    resourceId: conversationId,
  });

  return { id: conversationId, deleted: true };
}
