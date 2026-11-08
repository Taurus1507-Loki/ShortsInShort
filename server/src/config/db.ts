import mongoose from 'mongoose';
import { logger } from './logger.js';

// NoSQL-injection defence: every request body/query/param is parsed by a zod schema into
// primitive types before it reaches a query, so `{ "$gt": "" }` payloads are rejected with 400
// (see auth.test.ts). The global `sanitizeFilter` option is NOT used because it also neutralises
// the server's own operators ($gt on expiry dates, $gte on balances).
mongoose.set('strictQuery', true);

export async function connectDB(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, autoIndex: true });
  logger.info({ host: mongoose.connection.host, db: mongoose.connection.name }, 'MongoDB connected');
  // Ensure indexes are built before serving traffic (unique email etc.).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function dbState(): 'connected' | 'disconnected' | 'connecting' | 'disconnecting' {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'] as const;
  return states[mongoose.connection.readyState as number] ?? 'disconnected';
}
