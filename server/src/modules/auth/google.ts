import type { Request, Response } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { User } from '../../models/User.js';
import { randomToken, safeEqual } from '../../utils/crypto.js';
import { notConfigured } from '../../utils/errors.js';
import { createSession, revokeAllSessions } from '../../services/session.service.js';
import { audit } from '../../services/audit.service.js';
import { createUserWithWorkspace, grantSignupCredits } from './auth.service.js';

const STATE_COOKIE = 'sis_oauth';
const cookieOpts = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'lax' as const, // must survive the top-level redirect back from Google
  path: '/api/auth/google',
  maxAge: 10 * 60 * 1000,
});

const client = () => {
  if (!env.google) throw notConfigured('Google sign-in');
  return new OAuth2Client({
    clientId: env.google.clientId,
    clientSecret: env.google.clientSecret,
    redirectUri: env.google.redirectUri,
  });
};

/** Step 1: redirect to Google with CSRF `state` and a PKCE challenge. */
export async function startGoogle(_req: Request, res: Response) {
  const oauth = client();
  const state = randomToken(24);
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  res.cookie(STATE_COOKIE, `${state}.${codeVerifier}`, cookieOpts());
  const url = oauth.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: codeChallenge!,
    code_challenge_method: CodeChallengeMethod.S256,
    prompt: 'select_account',
  });
  res.redirect(url);
}

/** Step 2: verify state, exchange the code, verify the ID token, sign in or create the user. */
export async function googleCallback(req: Request, res: Response) {
  const fail = (reason: string) => {
    logger.warn({ reason }, 'Google sign-in failed');
    res.clearCookie(STATE_COOKIE, { ...cookieOpts(), maxAge: undefined });
    res.redirect(`${env.appUrl}/login?error=google_failed`);
  };
  try {
    const oauth = client();
    const cookie = req.cookies?.[STATE_COOKIE] as string | undefined;
    const { code, state } = req.query as { code?: string; state?: string };
    if (!cookie || !code || !state) return fail('missing_params');
    const [expectedState, codeVerifier] = cookie.split('.');
    if (!expectedState || !codeVerifier || !safeEqual(expectedState, String(state))) return fail('state_mismatch');
    res.clearCookie(STATE_COOKIE, { ...cookieOpts(), maxAge: undefined });

    const { tokens } = await oauth.getToken({ code: String(code), codeVerifier });
    if (!tokens.id_token) return fail('no_id_token');
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: env.google!.clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified) return fail('email_unverified');

    const email = p.email.toLowerCase();
    let user = await User.findOne({ googleId: p.sub }).select('+passwordHash');
    if (!user) {
      user = await User.findOne({ email }).select('+passwordHash');
      if (user) {
        // Linking to an existing account. If that account never verified its email, someone else
        // may have registered it with a password — drop that password and its sessions.
        if (!user.emailVerifiedAt) {
          user.passwordHash = null;
          await revokeAllSessions(user._id);
          user.emailVerifiedAt = new Date();
          await grantSignupCredits(user);
        }
        user.googleId = p.sub;
        if (!user.avatarUrl && p.picture) user.avatarUrl = p.picture;
        await audit(req, 'auth.google_linked', { actorId: user._id });
      } else {
        user = await createUserWithWorkspace({
          email,
          fullName: (p.name ?? email.split('@')[0] ?? 'Creator').slice(0, 80),
          passwordHash: null,
          googleId: p.sub,
          emailVerified: true,
          avatarUrl: p.picture ?? null,
        });
        await grantSignupCredits(user);
        await audit(req, 'auth.register', { actorId: user._id, metadata: { method: 'google' } });
      }
    }
    if (user.status !== 'active') return fail('inactive');
    user.lastLoginAt = new Date();
    await user.save();
    await createSession(req, res, user, 'google');
    await audit(req, 'auth.login', { actorId: user._id, metadata: { method: 'google' } });
    res.redirect(`${env.appUrl}/auth/callback`);
  } catch (err) {
    logger.error({ err }, 'Google callback error');
    fail('exception');
  }
}
