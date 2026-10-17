import { z } from 'zod';
import { APPROVED_STAGING_TARGET_FINGERPRINT, catalogueTargetFingerprint } from '../lib/catalogue-stage.js';

const connectionUrl = (protocols: string[]) => z.string().url().refine(value =>
  protocols.includes(new URL(value).protocol));
const optionalCredential = (minimum: number) => z.preprocess(value =>
  typeof value === 'string' && !value.trim() ? undefined : value, z.string().min(minimum).max(512).optional());
const createSchema = (approvedStagingFingerprint: string) => z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEV_RAZORPAY_TEST_CHECKOUT: z.enum(['true','false']).default('false'),
  STAGING_RAZORPAY_TEST_CHECKOUT: z.enum(['true','false']).default('false'),
  STAGING_CATALOGUE_MODE: z.enum(['true','false']).default('false'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: connectionUrl(['postgres:', 'postgresql:']),
  REDIS_URL: connectionUrl(['redis:', 'rediss:']),
  JWT_SECRET: z.string().min(32).refine(value => value.trim().length >= 32),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(1).max(86400).default(86400),
  GOOGLE_CLIENT_ID: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().max(256).regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/).optional()),
  TMDB_READ_ACCESS_TOKEN: optionalCredential(1),
  BREVO_API_KEY: optionalCredential(1),
  PASSWORD_RESET_FROM: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().email().max(254).optional()),
  PASSWORD_RESET_FROM_NAME: z.string().trim().min(1).max(100).default('CineHook'),
  RAZORPAY_KEY_ID: optionalCredential(1),
  // This key is issued by the provider; only our chosen webhook/JWT secrets
  // follow the application's minimum-length policy.
  RAZORPAY_KEY_SECRET: optionalCredential(1),
  RAZORPAY_WEBHOOK_SECRET: optionalCredential(32),
  CLOUDINARY_CLOUD_NAME: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional()),
  CLOUDINARY_API_KEY: optionalCredential(1),
  CLOUDINARY_API_SECRET: optionalCredential(1),
  FRONTEND_ORIGIN: connectionUrl(['http:', 'https:']).refine(value => {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password;
  }),
}).refine(value=>{
  if(value.DEV_RAZORPAY_TEST_CHECKOUT!=='true')return true;
  if(value.STAGING_RAZORPAY_TEST_CHECKOUT==='true')return false;
  const db=new URL(value.DATABASE_URL);
  return value.NODE_ENV!=='production' && ['localhost','127.0.0.1','[::1]'].includes(db.hostname)
    && db.pathname==='/cinehook_dev' && (!db.port||db.port==='5432') && !db.search && !db.hash
    && /^rzp_test_[A-Za-z0-9]+$/.test(value.RAZORPAY_KEY_ID??'') && !!value.RAZORPAY_KEY_SECRET && !!value.RAZORPAY_WEBHOOK_SECRET;
},{path:['DEV_RAZORPAY_TEST_CHECKOUT']}).refine(value => {
  if(value.STAGING_RAZORPAY_TEST_CHECKOUT!=='true')return true;
  const db=new URL(value.DATABASE_URL);
  return value.NODE_ENV==='production' && value.STAGING_CATALOGUE_MODE==='true'
    && db.hostname.toLowerCase().endsWith('.neon.tech')
    && catalogueTargetFingerprint(value.DATABASE_URL)===approvedStagingFingerprint
    && /^rzp_test_[A-Za-z0-9]+$/.test(value.RAZORPAY_KEY_ID??'')
    && !!value.RAZORPAY_KEY_SECRET && !!value.RAZORPAY_WEBHOOK_SECRET;
},{path:['STAGING_RAZORPAY_TEST_CHECKOUT']}).refine(value => {
  const count = [value.RAZORPAY_KEY_ID, value.RAZORPAY_KEY_SECRET, value.RAZORPAY_WEBHOOK_SECRET].filter(Boolean).length;
  return count === 0 || count === 3;
}, { path: ['RAZORPAY_CONFIG'] }).refine(value => {
  const count = [value.CLOUDINARY_CLOUD_NAME, value.CLOUDINARY_API_KEY, value.CLOUDINARY_API_SECRET].filter(Boolean).length;
  return count === 0 || count === 3;
}, { path: ['CLOUDINARY_CONFIG'] });

export function parseConfig(env: Record<string, string | undefined>, approvedStagingFingerprint = APPROVED_STAGING_TARGET_FINGERPRINT) {
  const result = createSchema(approvedStagingFingerprint).safeParse(env);
  if (!result.success) {
    // Field names are useful diagnostics; actual values may contain secrets.
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  return {
    nodeEnv: result.data.NODE_ENV,
    devRazorpayTestCheckout: result.data.DEV_RAZORPAY_TEST_CHECKOUT==='true',
    stagingRazorpayTestCheckout: result.data.STAGING_RAZORPAY_TEST_CHECKOUT==='true',
    stagingCatalogueMode: result.data.STAGING_CATALOGUE_MODE==='true',
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    redisUrl: result.data.REDIS_URL,
    frontendOrigin: result.data.FRONTEND_ORIGIN,
    jwtSecret: result.data.JWT_SECRET,
    jwtExpiresInSeconds: result.data.JWT_EXPIRES_IN_SECONDS,
    googleClientId: result.data.GOOGLE_CLIENT_ID,
    tmdbReadAccessToken: result.data.TMDB_READ_ACCESS_TOKEN,
    passwordResetMail: result.data.BREVO_API_KEY && result.data.PASSWORD_RESET_FROM
      ? { apiKey: result.data.BREVO_API_KEY, from: result.data.PASSWORD_RESET_FROM, fromName: result.data.PASSWORD_RESET_FROM_NAME } : undefined,
    cloudinary: result.data.CLOUDINARY_CLOUD_NAME && result.data.CLOUDINARY_API_KEY && result.data.CLOUDINARY_API_SECRET
      ? { cloudName: result.data.CLOUDINARY_CLOUD_NAME, apiKey: result.data.CLOUDINARY_API_KEY, apiSecret: result.data.CLOUDINARY_API_SECRET }
      : undefined,
    razorpay: result.data.RAZORPAY_KEY_ID && result.data.RAZORPAY_KEY_SECRET && result.data.RAZORPAY_WEBHOOK_SECRET
      ? { keyId: result.data.RAZORPAY_KEY_ID, keySecret: result.data.RAZORPAY_KEY_SECRET, webhookSecret: result.data.RAZORPAY_WEBHOOK_SECRET }
      : undefined,
  };
}
