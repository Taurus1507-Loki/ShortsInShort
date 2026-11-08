import { z } from 'zod';

export const emailSchema = z
  .email('Enter a valid email address.')
  .max(254)
  .transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers.');

export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters.').max(80);

export const registerSchema = z
  .object({
    fullName: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    acceptTerms: z.literal(true, { error: 'You must accept the Terms and Privacy Policy.' }),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.').max(128),
  })
  .strict();

export const emailOnlySchema = z.object({ email: emailSchema }).strict();

export const tokenSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();
