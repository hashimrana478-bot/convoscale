import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/env.js';
import { recordAuditAction } from './backgroundQueue.js';

export async function registerUser({ email, password, name }, ipAddress) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    const error = new Error('A user with this email address already exists.');
    error.status = 409;
    error.type = 'https://convoscale.io/errors/conflict';
    throw error;
  }

  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  await query(
    `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [userId, email.toLowerCase(), passwordHash, name, now]
  );

  const token = jwt.sign({ id: userId, email: email.toLowerCase(), name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

  const sessionId = uuidv4();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, tokenHash, expiresAt]
  );

  recordAuditAction({
    userId,
    action: 'USER_REGISTERED',
    resourceType: 'users',
    resourceId: userId,
    details: { email },
    ipAddress,
  });

  return {
    user: { id: userId, email: email.toLowerCase(), name },
    token,
  };
}

export async function loginUser({ email, password }, ipAddress) {
  const result = await query(
    'SELECT id, email, password_hash, name FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    const error = new Error('Invalid email or password.');
    error.status = 401;
    error.type = 'https://convoscale.io/errors/unauthorized';
    throw error;
  }

  const user = result.rows[0];
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    recordAuditAction({
      userId: user.id,
      action: 'LOGIN_FAILED',
      resourceType: 'users',
      resourceId: user.id,
      details: { email },
      ipAddress,
    });

    const error = new Error('Invalid email or password.');
    error.status = 401;
    error.type = 'https://convoscale.io/errors/unauthorized';
    throw error;
  }

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

  const sessionId = uuidv4();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, user.id, tokenHash, expiresAt]
  );

  recordAuditAction({
    userId: user.id,
    action: 'USER_LOGGED_IN',
    resourceType: 'users',
    resourceId: user.id,
    details: { email },
    ipAddress,
  });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    token,
  };
}

export async function getUserProfile(userId) {
  const result = await query('SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}
