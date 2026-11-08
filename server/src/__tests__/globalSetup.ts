import { existsSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

// Use a locally installed mongod when available (avoids a large binary download).
const LOCAL_MONGOD = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';

let mongod: MongoMemoryServer | undefined;

export async function setup(project: TestProject) {
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(LOCAL_MONGOD)) {
    process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  }
  mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri('sis_test'));
}

export async function teardown() {
  await mongod?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
