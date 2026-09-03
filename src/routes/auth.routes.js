import express from 'express';
import { registerUser, loginUser, getUserProfile } from '../services/authService.js';
import { validate, schemas } from '../middleware/validator.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', validate(schemas.register), async (req, res, next) => {
  try {
    const result = await registerUser(req.body, req.ip);
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validate(schemas.login), async (req, res, next) => {
  try {
    const result = await loginUser(req.body, req.ip);
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await getUserProfile(req.user.id);
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
