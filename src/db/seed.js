import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, initDatabase, isEmbeddedDb } from './pool.js';

export async function seedDatabase() {
  await initDatabase();

  console.log('[Seed] Seeding default users and chatbot rules...');

  // 1. Seed demo user
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const demoUserId = '11111111-1111-1111-1111-111111111111';
  const demoUser2Id = '22222222-2222-2222-2222-222222222222';

  await query(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    [demoUserId, 'alice@convoscale.io', passwordHash, 'Alice Engineer']
  );

  await query(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    [demoUser2Id, 'bob@convoscale.io', passwordHash, 'Bob SRE']
  );

  // 2. Seed chatbot responses
  const rules = [
    {
      keyword: 'hello',
      response: 'Hello! I am ConvoScale Bot, running on a high-concurrency transactional database backend. How can I assist you today?',
      priority: 10,
    },
    {
      keyword: 'hi',
      response: 'Hi there! ConvoScale is ready to handle your messages with atomic consistency.',
      priority: 10,
    },
    {
      keyword: 'help',
      response: 'Available commands: hello, architecture, scale, status, ping, help. Send any text to test ACID transactions and message ordering!',
      priority: 9,
    },
    {
      keyword: 'architecture',
      response: 'ConvoScale Architecture: PostgreSQL connection pooling (max 30), Redis sliding-window rate limiting & response cache, ACID transactions with row-locking, and cursor-based pagination.',
      priority: 8,
    },
    {
      keyword: 'scale',
      response: 'Targeting 10,000+ requests per minute (~167 req/s) with sub-50ms P95 latency and zero data loss under concurrent writes.',
      priority: 8,
    },
    {
      keyword: 'status',
      response: 'All systems operational. Database connection pool is active, rate limiters configured, and message sequencing is consistent.',
      priority: 7,
    },
    {
      keyword: 'ping',
      response: 'Pong! Transaction committed and message sequence verified atomically.',
      priority: 5,
    },
  ];

  for (const rule of rules) {
    await query(
      `INSERT INTO chatbot_responses (id, trigger_keyword, response_text, priority, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (trigger_keyword) DO UPDATE SET response_text = $3, priority = $4`,
      [uuidv4(), rule.keyword, rule.response, rule.priority]
    );
  }

  // 3. Seed demo conversation
  const convoId = '33333333-3333-3333-3333-333333333333';
  await query(
    `INSERT INTO conversations (id, user_id, title, message_count)
     VALUES ($1, $2, $3, 2)
     ON CONFLICT (id) DO NOTHING`,
    [convoId, demoUserId, 'System Scalability Chat']
  );

  // Seed initial messages
  await query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, sequence_number)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (id) DO NOTHING`,
    [uuidv4(), convoId, 'user', 'Hello ConvoScale!']
  );

  await query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, sequence_number)
     VALUES ($1, $2, $3, $4, 2)
     ON CONFLICT (id) DO NOTHING`,
    [uuidv4(), convoId, 'bot', 'Welcome to ConvoScale! Ready for 10,000 RPM.']
  );

  console.log('[Seed] Database seeding completed successfully.');
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}
