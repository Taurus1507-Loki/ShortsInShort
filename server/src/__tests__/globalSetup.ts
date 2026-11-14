import { existsSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

// Use a locally installed mongod when available (avoids a large binary download).
const LOCAL_MONGOD = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';
/**
 * Fallback when a throwaway mongod can't be started (e.g. Windows application-control policy blocks
 * launching mongod.exe): a dedicated test database on the running MongoDB — never the dev database.
 */
const FALLBACK_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/shortsinshort_test';

let mongod: MongoMemoryServer | undefined;

export async function setup(project: TestProject) {
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(LOCAL_MONGOD)) {
    process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  }
  try {
    mongod = await MongoMemoryServer.create();
    project.provide('mongoUri', mongod.getUri('sis_test'));
  } catch (err) {
    const db = new URL(FALLBACK_URI).pathname.slice(1);
    if (!/test/i.test(db)) throw new Error(`Refusing to run tests against "${db}": the fallback database name must contain "test".`);
    console.warn(`[tests] Could not start a throwaway mongod (${(err as Error).message}); using ${FALLBACK_URI}`);
    project.provide('mongoUri', FALLBACK_URI);
  }
}

export async function teardown() {
  await mongod?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
