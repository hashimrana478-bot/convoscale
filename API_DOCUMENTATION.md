# ConvoScale REST API Documentation

ConvoScale provides a high-performance RESTful API engineered for high-concurrency messaging, sub-50ms P95 latency, and ACID transactional integrity.

Base URL: `http://localhost:3000` (or your deployed URL)

---

## Standard Headers

| Header | Description | Required |
|---|---|---|
| `Content-Type` | `application/json` | For all POST/PATCH/PUT requests |
| `Authorization` | `Bearer <jwt-token>` | For all authenticated endpoints |
| `Idempotency-Key` | Unique request UUID / string | Recommended for POST message requests to prevent duplicates |
| `X-Request-Id` | Tracing UUID | Optional (auto-generated if omitted) |

---

## Authentication Endpoints

### 1. User Registration
`POST /api/v1/auth/register`

Creates a new user account with bcrypt-hashed password storage.

#### Request Body
```json
{
  "email": "developer@convoscale.io",
  "password": "Password123!",
  "name": "Alex Developer"
}
```

#### Response (`201 Created`)
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "a95d12ef-7603-4c91-9e7f-64a8b79d2bf1",
      "email": "developer@convoscale.io",
      "name": "Alex Developer"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 2. User Login
`POST /api/v1/auth/login`

Authenticates credentials and returns a signed JWT access token.

#### Request Body
```json
{
  "email": "alice@convoscale.io",
  "password": "Password123!"
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "11111111-1111-1111-1111-111111111111",
      "email": "alice@convoscale.io",
      "name": "Alice Engineer"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 3. User Profile
`GET /api/v1/auth/me`

Retrieves authenticated user profile.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "alice@convoscale.io",
    "name": "Alice Engineer",
    "created_at": "2026-09-03T16:00:00.000Z"
  }
}
```

---

## Conversation Endpoints

### 4. Create Conversation
`POST /api/v1/conversations`

Creates a new conversation thread for the authenticated user.

#### Request Body
```json
{
  "title": "Backend Optimization Discussion"
}
```

#### Response (`201 Created`)
```json
{
  "success": true,
  "message": "Conversation created successfully",
  "data": {
    "id": "33333333-3333-3333-3333-333333333333",
    "userId": "11111111-1111-1111-1111-111111111111",
    "title": "Backend Optimization Discussion",
    "messageCount": 0,
    "version": 1,
    "createdAt": "2026-09-03T16:00:00.000Z"
  }
}
```

---

### 5. List Conversations
`GET /api/v1/conversations?limit=20&cursor=2026-09-03T16:00:00.000Z&cursorId=uuid`

Lists user conversations using cursor-based pagination.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "user_id": "11111111-1111-1111-1111-111111111111",
      "title": "System Scalability Chat",
      "message_count": 4,
      "version": 3,
      "last_message_at": "2026-09-03T16:05:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "hasNextPage": false,
    "nextCursor": null
  }
}
```

---

### 6. Send Message (Transactional)
`POST /api/v1/conversations/:id/messages`

Executes an atomic ACID transaction that:
1. Row-locks the conversation (`FOR UPDATE`).
2. Inserts user message with sequence number `N+1`.
3. Evaluates chatbot rule (cached in Redis).
4. Inserts bot response message with sequence number `N+2`.
5. Updates conversation metadata (`message_count + 2`, `version + 1`, `last_message_at`).
6. Saves idempotency response.

#### Headers
- `Idempotency-Key`: `unique-request-id-12345`

#### Request Body
```json
{
  "content": "architecture"
}
```

#### Response (`201 Created`)
```json
{
  "success": true,
  "message": "Message processed and answered successfully",
  "data": {
    "userMessage": {
      "id": "e98ab341-b0e2-4752-9b2f-769018e69fae",
      "conversation_id": "33333333-3333-3333-3333-333333333333",
      "sender_type": "user",
      "content": "architecture",
      "sequence_number": 3,
      "created_at": "2026-09-03T16:05:10.000Z"
    },
    "botMessage": {
      "id": "67b931e0-7c2a-4bc3-9562-b1d6f2963ba1",
      "conversation_id": "33333333-3333-3333-3333-333333333333",
      "sender_type": "bot",
      "content": "ConvoScale Architecture: PostgreSQL connection pooling (max 30), Redis sliding-window rate limiting & response cache, ACID transactions with row-locking, and cursor-based pagination.",
      "sequence_number": 4,
      "created_at": "2026-09-03T16:05:10.010Z"
    },
    "conversation": {
      "id": "33333333-3333-3333-3333-333333333333",
      "message_count": 4,
      "version": 3,
      "last_message_at": "2026-09-03T16:05:10.010Z"
    }
  }
}
```

---

### 7. Get Conversation Messages (Cursor Pagination)
`GET /api/v1/conversations/:id/messages?limit=20`

Fetches chronological messages using keyset cursor pagination based on `(created_at, id)`.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": "e98ab341-b0e2-4752-9b2f-769018e69fae",
      "conversation_id": "33333333-3333-3333-3333-333333333333",
      "sender_type": "user",
      "content": "architecture",
      "sequence_number": 3,
      "created_at": "2026-09-03T16:05:10.000Z"
    },
    {
      "id": "67b931e0-7c2a-4bc3-9562-b1d6f2963ba1",
      "conversation_id": "33333333-3333-3333-3333-333333333333",
      "sender_type": "bot",
      "content": "ConvoScale Architecture: ...",
      "sequence_number": 4,
      "created_at": "2026-09-03T16:05:10.010Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "hasNextPage": false,
    "nextCursor": null
  }
}
```

---

## Health & Monitoring Endpoints

### 8. System Health
`GET /health`

Returns deep health inspection of PostgreSQL connection pool, Redis cache, process memory, and uptime.

```json
{
  "status": "healthy",
  "timestamp": "2026-09-03T16:10:00.000Z",
  "uptimeSeconds": 120,
  "components": {
    "database": {
      "status": "healthy",
      "latencyMs": 2,
      "poolSize": 30,
      "idleClients": 28,
      "waitingClients": 0
    },
    "redis": {
      "status": "healthy",
      "latencyMs": 1
    }
  },
  "system": {
    "nodeVersion": "v24.18.0",
    "memoryUsage": {
      "rss": 84598784,
      "heapUsed": 45123984
    }
  }
}
```

### 9. System Statistics
`GET /api/v1/system/stats`

Returns live database metrics, table row counts, and performance counters.
