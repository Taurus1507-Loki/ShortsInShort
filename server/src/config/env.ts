import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/shortsinshort',
  jwtSecret: process.env.JWT_SECRET || 'shortsinshort_jwt_super_secret_production_key_2026_x8934k',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'shortsinshort_refresh_token_super_secret_key_84920',
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_shortsinshort123',
    keySecret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_shortsinshort456',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_shortsinshort789',
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    heygenApiKey: process.env.HEYGEN_API_KEY || '',
    pexelsApiKey: process.env.PEXELS_API_KEY || '',
  }
};

