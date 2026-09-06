export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  mongodbUri: string;
  redis: { host: string; port: number };
  jwt: {
    accessSecret: string;
    accessTtl: number;
    refreshSecret: string;
    refreshTtl: number;
  };
  otp: { ttlSeconds: number; maxAttempts: number };
  /** 'memory' is correct for one task; 'redis' is required for more than one. */
  throttleStore: 'memory' | 'redis';
  media: {
    /** Defaults to local disk: a missing MEDIA_DRIVER must never mean S3. */
    driver: 'local' | 's3';
    /** Empty means the local driver picks its own default under the API app. */
    localRoot: string;
    s3: { bucket: string; region: string; endpoint: string };
  };
  payments: {
    /** 'fake' runs the whole flow locally with no credentials. */
    gateway: 'fake' | 'razorpay';
    fakeWebhookSecret: string;
    razorpay: { keyId: string; keySecret: string; webhookSecret: string };
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  // URI versioning appends /v1 itself, so the prefix must not already contain it.
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  mongodbUri:
    process.env.MONGODB_URI ??
    'mongodb://localhost:27017/eventhub?replicaSet=rs0&directConnection=true',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: Number(process.env.JWT_ACCESS_TTL ?? 900),
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: Number(process.env.JWT_REFRESH_TTL ?? 2_592_000),
  },
  otp: {
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 600),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  },
  throttleStore: process.env.THROTTLE_STORE === 'redis' ? 'redis' : 'memory',
  media: {
    // Local disk unless explicitly told otherwise, the same way the payment
    // gateway defaults to the fake one: a missing variable must not silently
    // point a developer's machine at a real bucket.
    driver: process.env.MEDIA_DRIVER === 's3' ? 's3' : 'local',
    // Where the local driver writes. Outside src/ so a rebuild never sweeps
    // uploaded files away, and gitignored so they are never committed.
    localRoot: process.env.MEDIA_LOCAL_ROOT ?? '',
    s3: {
      bucket: process.env.MEDIA_S3_BUCKET ?? '',
      region: process.env.MEDIA_S3_REGION ?? process.env.AWS_REGION ?? '',
      // Set only for S3-compatible stores such as MinIO in a test environment.
      endpoint: process.env.MEDIA_S3_ENDPOINT ?? '',
    },
  },
  payments: {
    // Defaults to the fake gateway: a missing PAYMENT_GATEWAY must not silently
    // point a developer's machine at a real payment provider.
    gateway: process.env.PAYMENT_GATEWAY === 'razorpay' ? 'razorpay' : 'fake',
    fakeWebhookSecret:
      process.env.PAYMENT_FAKE_WEBHOOK_SECRET ?? 'fake_webhook_secret_local_dev',
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID ?? '',
      keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    },
  },
});
