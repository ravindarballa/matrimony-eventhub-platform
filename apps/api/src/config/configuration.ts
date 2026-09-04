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
});
