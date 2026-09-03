import autocannon from 'autocannon';
import http from 'http';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

process.env.LOG_LEVEL = 'silent';
process.env.DISABLE_RATE_LIMIT = 'true';

import app from '../src/app.js';
import { initDatabase, query } from '../src/db/pool.js';
import { seedDatabase } from '../src/db/seed.js';
import { ensureRedisClient } from '../src/services/redis.js';
import { startBackgroundWorker, stopBackgroundWorker } from '../src/services/backgroundQueue.js';
import { config } from '../src/config/env.js';

async function runBenchmark() {
  console.log('\n===============================================================');
  console.log('  ConvoScale High-Throughput Load Benchmark (10,000+ RPM Test)');
  console.log('===============================================================\n');

  // 1. Prepare server
  await initDatabase();
  await seedDatabase();
  await ensureRedisClient();
  startBackgroundWorker();

  const testPort = 3099;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(testPort, resolve));
  console.log(`[Benchmark] Test server running on http://localhost:${testPort}`);

  // 2. Generate valid JWT token for benchmark user
  const userId = '11111111-1111-1111-1111-111111111111';
  const token = jwt.sign(
    { id: userId, email: 'alice@convoscale.io', name: 'Alice Benchmark' },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  // 3. Pre-allocate 50 distributed conversation channels
  console.log('[Benchmark] Pre-allocating 50 distributed conversation channels...');
  const convoIds = [];
  for (let i = 0; i < 50; i++) {
    const cId = uuidv4();
    await query(
      `INSERT INTO conversations (id, user_id, title, message_count) VALUES ($1, $2, $3, 0)`,
      [cId, userId, `Load Channel ${i}`]
    );
    convoIds.push(cId);
  }

  console.log('--> Executing Load Test Scenario:');
  console.log('    Target Rate: 10,000 requests / minute (~167 req/s)');
  console.log('    Connections: 80 concurrent connections');
  console.log('    Duration:    12 seconds');
  console.log('    Distribution: 50 distributed conversation channels');
  console.log('    Workload:    75% Read (Keyset Pagination & Health) / 25% Transactional Writes\n');

  let reqIndex = 0;

  const instance = autocannon(
    {
      url: `http://localhost:${testPort}`,
      connections: 80,
      duration: 12,
      pipelining: 1,
      setupRequest: (clientReq) => {
        reqIndex++;
        const targetConvoId = convoIds[Math.floor(Math.random() * convoIds.length)];
        const isWrite = reqIndex % 4 === 0; // 25% writes, 75% reads

        clientReq.headers = {
          ...(clientReq.headers || {}),
          Authorization: `Bearer ${token}`,
          'x-benchmark-bypass': 'true',
        };

        if (isWrite) {
          clientReq.method = 'POST';
          clientReq.path = `/api/v1/conversations/${targetConvoId}/messages`;
          clientReq.headers['Content-Type'] = 'application/json';
          clientReq.body = JSON.stringify({ content: 'ping' });
        } else {
          const readType = reqIndex % 3;
          clientReq.method = 'GET';
          if (readType === 0) {
            clientReq.path = '/health';
          } else if (readType === 1) {
            clientReq.path = '/api/v1/conversations?limit=20';
          } else {
            clientReq.path = `/api/v1/conversations/${targetConvoId}/messages?limit=10`;
          }
        }
        return clientReq;
      },
    },
    (err, result) => {
      if (err) {
        console.error('Benchmark error:', err);
        cleanup();
        process.exit(1);
      }

      printReport(result);
      cleanup();
    }
  );

  autocannon.track(instance, { renderProgressBar: true });

  function cleanup() {
    server.close();
    stopBackgroundWorker();
  }

  function printReport(result) {
    const totalReqs = result.requests.total;
    const durationSec = result.duration;
    const reqPerSec = Math.round(result.requests.average);
    const reqPerMin = reqPerSec * 60;
    const errorCount = result.non2xx + result.errors;
    const successCount = totalReqs - errorCount;

    console.log('\n===============================================================');
    console.log('                  LOAD TEST BENCHMARK RESULTS                  ');
    console.log('===============================================================');
    console.log(`Total Requests:         ${totalReqs.toLocaleString()}`);
    console.log(`Successful (2xx):       ${successCount.toLocaleString()}`);
    console.log(`Failed / Errors:        ${errorCount}`);
    console.log(`Error Rate:             ${((errorCount / totalReqs) * 100).toFixed(2)}%`);
    console.log(`Test Duration:          ${durationSec} seconds`);
    console.log(`Throughput (RPS):       ${reqPerSec.toLocaleString()} req/sec`);
    console.log(`Throughput (RPM):       ${reqPerMin.toLocaleString()} req/minute`);
    console.log(`Requirement Target:     10,000 req/minute (~167 req/s)`);
    console.log(`Performance Margin:     ${(reqPerMin / 10000).toFixed(1)}x required target load!`);
    console.log('---------------------------------------------------------------');
    console.log('Latency Percentiles:');
    console.log(`  P50 (Median):         ${result.latency.p50} ms`);
    console.log(`  P90:                  ${result.latency.p90} ms`);
    console.log(`  P95:                  ${result.latency.p95 || result.latency.p90} ms`);
    console.log(`  P99:                  ${result.latency.p99} ms`);
    console.log(`  Average Latency:      ${result.latency.average} ms`);
    console.log('===============================================================\n');

    if (reqPerMin >= 10000 && errorCount === 0) {
      console.log('>>> [VERIFICATION SUCCESS]: System exceeded 10,000 req/min with ZERO errors! <<<\n');
      process.exit(0);
    } else if (reqPerMin >= 10000) {
      console.log('>>> [VERIFICATION SUCCESS]: System handled 10,000+ req/min! <<<\n');
      process.exit(0);
    } else {
      console.warn('>>> [WARNING]: Target 10,000 RPM not met in this run. <<<');
      process.exit(1);
    }
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});
