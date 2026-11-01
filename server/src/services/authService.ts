import { User, IUser } from '../models/User.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  TokenPayload,
} from '../utils/jwt.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    creditBalance: number;
    planTier: string;
    workspaceId: string;
    brandKit: IUser['brandKit'];
  };
}

export class AuthService {
  static formatUserPayload(user: IUser) {
    return {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      creditBalance: user.creditBalance,
      planTier: user.planTier,
      workspaceId: user.workspaceId.toString(),
      brandKit: user.brandKit,
    };
  }

  static async register(data: {
    fullName: string;
    email: string;
    password: string;
  }): Promise<AuthTokens> {
    const existing = await User.findOne({ email: data.email.toLowerCase().trim() });
    if (existing) {
      throw new Error('An account with this email address already exists.');
    }

    const passwordHash = await hashPassword(data.password);
    const user = await User.create({
      fullName: data.fullName,
      email: data.email.toLowerCase().trim(),
      passwordHash,
      creditBalance: 50, // 50 Welcome Trial Credits for video testing
    });

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId.toString(),
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      accessToken,
      refreshToken,
      user: this.formatUserPayload(user),
    };
  }

  static async login(data: { email: string; password: string }): Promise<AuthTokens> {
    const user = await User.findOne({ email: data.email.toLowerCase().trim() });
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    const isValid = await comparePassword(data.password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password.');
    }

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId.toString(),
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      accessToken,
      refreshToken,
      user: this.formatUserPayload(user),
    };
  }

  static async refresh(refreshToken: string): Promise<{ accessToken: string; user: any }> {
    const payload = verifyRefreshToken(refreshToken);
    const user = await User.findById(payload.userId);
    if (!user) {
      throw new Error('User account associated with token not found.');
    }

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId.toString(),
    };

    const accessToken = generateAccessToken(tokenPayload);
    return {
      accessToken,
      user: this.formatUserPayload(user),
    };
  }
}

