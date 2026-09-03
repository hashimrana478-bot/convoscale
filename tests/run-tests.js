import assert from 'assert';
import { initDatabase } from '../src/db/pool.js';
import { seedDatabase } from '../src/db/seed.js';
import { registerUser, loginUser } from '../src/services/authService.js';
import {
  createConversation,
  getUserConversations,
  getConversationMessages,
  sendMessage,
} from '../src/services/conversationService.js';
import { query } from '../src/db/pool.js';

let passed = 0;
let failed = 0;

async function test(description, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('  Running ConvoScale Automated Test Suite');
  console.log('======================================================\n');

  await initDatabase();
  await seedDatabase();

  console.log('\n--- 1. Authentication & Session Tests ---');

  let testUser1, testUser2;
  await test('User Registration creates user with hashed password', async () => {
    const res = await registerUser({
      email: `test_${Date.now()}@convoscale.io`,
      password: 'StrongPassword123!',
      name: 'Test Tester',
    });
    assert(res.user.id, 'User ID must be returned');
    assert(res.token, 'JWT Token must be returned');
    testUser1 = res.user;
  });

  await test('Duplicate email registration is rejected with 409 Conflict', async () => {
    try {
      await registerUser({
        email: testUser1.email,
        password: 'AnotherPassword123!',
        name: 'Duplicate',
      });
      assert.fail('Should have thrown 409 error');
    } catch (err) {
      assert.strictEqual(err.status, 409);
    }
  });

  await test('User Login succeeds with valid credentials', async () => {
    const res = await loginUser({
      email: testUser1.email,
      password: 'StrongPassword123!',
    });
    assert(res.token, 'JWT Token must be returned');
  });

  await test('User Login fails with invalid password (401)', async () => {
    try {
      await loginUser({
        email: testUser1.email,
        password: 'WrongPassword!',
      });
      assert.fail('Should have thrown 401 error');
    } catch (err) {
      assert.strictEqual(err.status, 401);
    }
  });

  // Register second user for authorization checks
  const u2Res = await registerUser({
    email: `intruder_${Date.now()}@convoscale.io`,
    password: 'Password123!',
    name: 'Intruder Bob',
  });
  testUser2 = u2Res.user;

  console.log('\n--- 2. Conversation & ACID Transaction Tests ---');

  let convo;
  await test('Create conversation initializes with message_count = 0', async () => {
    convo = await createConversation(testUser1.id, 'ACID Benchmark Convo');
    assert.strictEqual(convo.messageCount, 0);
    assert.strictEqual(convo.userId, testUser1.id);
  });

  await test('Atomic SendMessage inserts User Msg, Bot Msg, and increments count (+2)', async () => {
    const result = await sendMessage(convo.id, testUser1.id, 'hello');
    assert.strictEqual(result.userMessage.sender_type, 'user');
    assert.strictEqual(result.botMessage.sender_type, 'bot');
    assert(result.botMessage.content.includes('ConvoScale Bot'), 'Bot must reply based on keyword rule');
    assert.strictEqual(result.conversation.message_count, 2, 'Message count must be 2');
    assert.strictEqual(result.userMessage.sequence_number, 1);
    assert.strictEqual(result.botMessage.sequence_number, 2);
  });

  await test('Transaction Rollback: Simulated bot failure rolls back all changes', async () => {
    const beforeCountRes = await query('SELECT message_count FROM conversations WHERE id = $1', [convo.id]);
    const beforeCount = beforeCountRes.rows[0].message_count;

    try {
      await sendMessage(convo.id, testUser1.id, 'architecture', null, true); // simulateBotFailure = true
      assert.fail('Should have aborted with error');
    } catch (err) {
      assert(err.message.includes('SIMULATED_BOT_FAILURE'));
    }

    // Verify database atomicity: NO partial records written
    const afterCountRes = await query('SELECT message_count FROM conversations WHERE id = $1', [convo.id]);
    assert.strictEqual(afterCountRes.rows[0].message_count, beforeCount, 'Conversation message_count must remain unchanged');

    const msgCheck = await query('SELECT COUNT(*) AS total FROM messages WHERE content = $1', ['architecture']);
    assert.strictEqual(parseInt(msgCheck.rows[0].total, 10), 0, 'User message must have been rolled back completely');
  });

  console.log('\n--- 3. Authorization & Ownership Guards ---');

  await test('User 2 cannot send messages to User 1 conversation (403 Forbidden)', async () => {
    try {
      await sendMessage(convo.id, testUser2.id, 'Unauthorized post');
      assert.fail('Should have been rejected');
    } catch (err) {
      assert.strictEqual(err.status, 403);
    }
  });

  console.log('\n--- 4. Concurrency & Monotonic Sequencing ---');

  await test('Concurrent requests to same conversation maintain integrity without race conditions', async () => {
    const concurrentCount = 10;
    const promises = [];

    for (let i = 0; i < concurrentCount; i++) {
      promises.push(sendMessage(convo.id, testUser1.id, `Concurrent message ${i}`));
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, concurrentCount);

    // Verify conversation count = initial 2 + (10 * 2) = 22
    const finalConvo = await query('SELECT message_count FROM conversations WHERE id = $1', [convo.id]);
    assert.strictEqual(finalConvo.rows[0].message_count, 22);

    // Verify all sequence numbers are distinct and monotonically assigned
    const allMsgs = await query('SELECT sequence_number FROM messages WHERE conversation_id = $1 ORDER BY sequence_number ASC', [convo.id]);
    const seqs = allMsgs.rows.map(r => r.sequence_number);
    const uniqueSeqs = new Set(seqs);
    assert.strictEqual(uniqueSeqs.size, 22, 'All 22 messages must have strictly unique monotonic sequence numbers');
  });

  console.log('\n--- 5. Keyset / Cursor-Based Pagination ---');

  await test('Cursor pagination retrieves ordered pages without duplicate records', async () => {
    const page1 = await getConversationMessages(convo.id, { limit: 10 });
    assert.strictEqual(page1.items.length, 10);
    assert(page1.pagination.hasNextPage, 'Must have next page');
    assert(page1.pagination.nextCursor, 'Must return next cursor');

    const page2 = await getConversationMessages(convo.id, {
      limit: 10,
      cursor: page1.pagination.nextCursor.createdAt,
      cursorId: page1.pagination.nextCursor.id,
    });
    assert.strictEqual(page2.items.length, 10);

    // Ensure no overlapping message IDs between pages
    const ids1 = new Set(page1.items.map(m => m.id));
    for (const msg of page2.items) {
      assert(!ids1.has(msg.id), 'Page 2 should not contain items from Page 1');
    }
  });

  console.log('\n======================================================');
  console.log(`  Tests Completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Test Runner encountered unhandled error:', err);
  process.exit(1);
});
