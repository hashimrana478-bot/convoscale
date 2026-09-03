import express from 'express';
import {
  createConversation,
  getUserConversations,
  getConversationMessages,
  sendMessage,
  updateConversation,
  deleteConversation,
} from '../services/conversationService.js';
import { authenticateToken, authorizeConversationOwnership } from '../middleware/auth.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { validate, schemas } from '../middleware/validator.js';

const router = express.Router();

// All conversation routes require authentication
router.use(authenticateToken);

// Create conversation
router.post('/', validate(schemas.createConversation), async (req, res, next) => {
  try {
    const conversation = await createConversation(req.user.id, req.body.title);
    res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      data: conversation,
    });
  } catch (err) {
    next(err);
  }
});

// List user conversations with cursor pagination
router.get('/', validate(schemas.pagination, 'query'), async (req, res, next) => {
  try {
    const { limit, cursor, cursorId } = req.query;
    const result = await getUserConversations(req.user.id, { limit, cursor, cursorId });
    res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
});

// Get single conversation details
router.get('/:id', authorizeConversationOwnership, async (req, res) => {
  res.status(200).json({
    success: true,
    data: req.conversation,
  });
});

// Update conversation title
router.patch('/:id', authorizeConversationOwnership, validate(schemas.updateConversation), async (req, res, next) => {
  try {
    const updated = await updateConversation(req.params.id, req.user.id, req.body.title);
    res.status(200).json({
      success: true,
      message: 'Conversation updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// Delete conversation
router.delete('/:id', authorizeConversationOwnership, async (req, res, next) => {
  try {
    const result = await deleteConversation(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// Get conversation messages with cursor pagination
router.get('/:id/messages', authorizeConversationOwnership, validate(schemas.pagination, 'query'), async (req, res, next) => {
  try {
    const { limit, cursor, cursorId } = req.query;
    const result = await getConversationMessages(req.params.id, { limit, cursor, cursorId });
    res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
});

// Send message to conversation (Protected with Idempotency & ACID transaction)
router.post(
  '/:id/messages',
  authorizeConversationOwnership,
  idempotencyMiddleware(),
  validate(schemas.sendMessage),
  async (req, res, next) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] || null;
      const simulateFailure = req.query.simulateFailure === 'true';

      const result = await sendMessage(
        req.params.id,
        req.user.id,
        req.body.content,
        idempotencyKey,
        simulateFailure
      );

      res.status(201).json({
        success: true,
        message: 'Message processed and answered successfully',
        data: {
          userMessage: result.userMessage,
          botMessage: result.botMessage,
          conversation: result.conversation,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
