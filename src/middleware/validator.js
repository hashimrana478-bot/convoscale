import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));

        return res.status(422).json({
          type: 'https://convoscale.io/errors/validation-error',
          title: 'Validation Failed',
          status: 422,
          detail: 'One or more request parameters failed validation constraints.',
          errors,
        });
      }
      next(err);
    }
  };
}

// Common Zod Schemas
export const schemas = {
  register: z.object({
    email: z.string().email('Valid email address required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  }),

  login: z.object({
    email: z.string().email('Valid email address required'),
    password: z.string().min(1, 'Password is required'),
  }),

  createConversation: z.object({
    title: z.string().min(1).max(255).optional().default('New Conversation'),
  }),

  updateConversation: z.object({
    title: z.string().min(1).max(255),
  }),

  sendMessage: z.object({
    content: z.string().min(1, 'Message content cannot be empty').max(5000, 'Message cannot exceed 5000 characters'),
  }),

  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    cursorId: z.string().optional(),
  }),
};
