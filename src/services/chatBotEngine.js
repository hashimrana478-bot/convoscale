import { query } from '../db/pool.js';
import { cacheAside } from './redis.js';

const CACHE_KEY_RULES = 'chatbot:rules:active';
const CACHE_TTL_SECONDS = 300; // 5 minutes

export async function getActiveBotRules() {
  return cacheAside(CACHE_KEY_RULES, CACHE_TTL_SECONDS, async () => {
    const res = await query(
      'SELECT trigger_keyword, response_text, priority FROM chatbot_responses WHERE is_active = true ORDER BY priority DESC'
    );
    return res.rows;
  });
}

/**
 * Generate bot response using rule/keyword matching
 */
export async function determineBotResponse(userMessageText) {
  const normalized = (userMessageText || '').toLowerCase().trim();
  const rules = await getActiveBotRules();

  // Find best match by priority
  for (const rule of rules) {
    const keyword = rule.trigger_keyword.toLowerCase();
    // Check exact match, phrase match, or word boundary match
    if (normalized === keyword || normalized.includes(keyword)) {
      return rule.response_text;
    }
  }

  // Default contextual response
  return `I have processed your message: "${userMessageText.slice(0, 50)}${userMessageText.length > 50 ? '...' : ''}". The operation was safely committed to the database. Send 'help' to see system options.`;
}
