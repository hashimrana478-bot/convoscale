import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 Options for 10,000 requests per minute (~167 requests/sec)
export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 users
    { duration: '1m',  target: 170 }, // Steady state at ~170 users (~170 req/s = 10,200 RPM)
    { duration: '30s', target: 200 }, // Peak burst stress test at 200 users
    { duration: '30s', target: 0 },   // Graceful ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<150', 'p(99)<300'], // 95% of requests under 150ms
    http_req_failed: ['rate<0.01'],                 // Less than 1% error rate
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
let authToken = null;
let conversationId = null;

export function setup() {
  // 1. Authenticate demo user
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: 'alice@convoscale.io',
      password: 'Password123!',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(loginRes, {
    'setup login succeeded': (r) => r.status === 200,
  });

  const token = loginRes.json('data.token');

  // 2. Create test conversation
  const convoRes = http.post(
    `${BASE_URL}/api/v1/conversations`,
    JSON.stringify({ title: 'k6 Load Test Conversation' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const convoId = convoRes.json('data.id');

  return { token, convoId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // 1. Health Probe (Read)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
  });

  // 2. Fetch Conversation Messages (Read with cursor pagination)
  const listRes = http.get(`${BASE_URL}/api/v1/conversations/${data.convoId}/messages?limit=10`, { headers });
  check(listRes, {
    'fetch messages status is 200': (r) => r.status === 200,
  });

  // 3. Send Message with Idempotency Key (Write with ACID transaction)
  const idempotencyKey = `k6_${__VU}_${__ITER}_${Date.now()}`;
  const sendRes = http.post(
    `${BASE_URL}/api/v1/conversations/${data.convoId}/messages`,
    JSON.stringify({ content: 'architecture' }),
    {
      headers: {
        ...headers,
        'Idempotency-Key': idempotencyKey,
      },
    }
  );

  check(sendRes, {
    'message sent status is 201': (r) => r.status === 201,
    'bot replied': (r) => r.json('data.botMessage') !== undefined,
  });

  // Small pacing interval between iterations
  sleep(0.5);
}
