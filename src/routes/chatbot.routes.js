import express from 'express';
import { getActiveBotRules } from '../services/chatBotEngine.js';

const router = express.Router();

router.get('/rules', async (req, res, next) => {
  try {
    const rules = await getActiveBotRules();
    res.status(200).json({
      success: true,
      data: rules,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
