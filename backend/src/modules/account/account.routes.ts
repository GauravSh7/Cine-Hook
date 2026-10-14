import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../errors/app-error.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { AccountService } from './account.service.js';
import { AccountController } from './account.controller.js';
import { avatarByteLimit } from './avatar-image.js';
export function accountRoutes(service: AccountService, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router();
  const controller = new AccountController(service);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(authMiddleware(auth.tokens), requireCurrentUser(auth.service));
  router.patch('/profile', controller.updateProfile);
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: avatarByteLimit, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, cb) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new AppError(400, 'INVALID_IMAGE', 'Use a JPEG, PNG or WebP image.'));
      cb(null, true);
    },
  }).single('image');
  const upload: RequestHandler = (req, res, next) => parse(req, res, error => {
    if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      error.code === 'LIMIT_FILE_SIZE' ? 'AVATAR_TOO_LARGE' : 'INVALID_UPLOAD', 'Upload one image of at most 3 MiB and no other fields.'));
    if (error) return next(error instanceof AppError ? error : new AppError(400, 'INVALID_UPLOAD', 'Image upload is invalid.'));
    next();
  });
  router.post('/avatar', upload, controller.uploadAvatar);
  return router;
}
