import type { Types } from 'mongoose';
import type { UserDoc } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: UserDoc;
        sessionId: string;
        /** Tenant key for every user-owned query. */
        workspaceId: Types.ObjectId;
      };
    }
  }
}

export {};
