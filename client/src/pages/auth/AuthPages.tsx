import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, Eye, EyeOff, Loader2, MailCheck, XCircle } from 'lucide-react';
import { Logo, ThemeToggle } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Notice } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { safeNext } from '@/features/auth/guards';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useMeta } from '@/lib/queries';

/* ── Shared validation (mirrors server rules) ───────────────────────── */
const email = z.email('Enter a valid email address.');
const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include letters and numbers.');

/* ── Layout ─────────────────────────────────────────────────────────── */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden border-r border-border bg-card lg:block">
        <div className="absolute inset-0 bg-brand-gradient opacity-[0.14]" aria-hidden />
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Logo />
          <div>
            <p className="font-display text-4xl font-extrabold leading-tight">
              Your Script.
              <br />
              Your AI Editor.
              <br />
              <span className="text-gradient">Your Video. Done.</span>
            </p>
            <p className="mt-5 max-w-sm text-muted-foreground">Professional Reels, Shorts and videos — without professional editing skills.</p>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} ShortsInShort</p>
        </div>
      </aside>
      <main id="main" className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Logo className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} ref={ref} type={show ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

function GoogleButton() {
  const { data: meta } = useMeta();
  if (!meta?.auth.google) return null;
  return (
    <>
      <Button asChild variant="outline" className="w-full">
        {/* Full-page navigation: the OAuth flow is a redirect, not a fetch. */}
        <a href="/api/auth/google">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
          </svg>
          Continue with Google
        </a>
      </Button>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

/* ── Login ──────────────────────────────────────────────────────────── */
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.') });

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(params.get('error') === 'google_failed' ? 'Google sign-in didn’t complete. Please try again.' : null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await login(v.email, v.password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  return (
    <>
      <Heading title="Welcome back" subtitle={<>New here? <Link to="/register" className="font-semibold text-highlight hover:underline">Create a free account</Link></>} />
      <GoogleButton />
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="you@example.com" {...register('email')} />
        </Field>
        <Field
          id="password"
          label="Password"
          error={formState.errors.password?.message}
          action={<Link to="/forgot-password" className="text-xs font-semibold text-highlight hover:underline">Forgot password?</Link>}
        >
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} className="w-full">Log in</Button>
      </form>
    </>
  );
}

/* ── Register ───────────────────────────────────────────────────────── */
const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(80),
  email,
  password,
  acceptTerms: z.literal(true, { error: 'Please accept the Terms and Privacy Policy.' }),
});

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await signUp(v);
      toast.success('Account created. Check your inbox to verify your email.');
      navigate('/app', { replace: true });
    } catch (e) {
      setFormError(e instanceof ApiError && e.code === 'EMAIL_TAKEN' ? 'An account with this email already exists. Try logging in.' : errorMessage(e));
    }
  });

  return (
    <>
      <Heading title="Create your free account" subtitle={<>Already have one? <Link to="/login" className="font-semibold text-highlight hover:underline">Log in</Link></>} />
      <GoogleButton />
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field id="fullName" label="Full name" error={formState.errors.fullName?.message}>
          <Input autoComplete="name" placeholder="Priya Sharma" {...register('fullName')} />
        </Field>
        <Field id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="you@example.com" {...register('email')} />
        </Field>
        <Field id="password" label="Password" error={formState.errors.password?.message} hint="At least 10 characters with letters and numbers.">
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <div className="grid gap-1.5">
          <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]" {...register('acceptTerms')} />
            <span>
              I agree to the{' '}
              <Link to="/legal/terms" target="_blank" className="font-semibold text-foreground hover:underline">Terms</Link> and{' '}
              <Link to="/legal/privacy" target="_blank" className="font-semibold text-foreground hover:underline">Privacy Policy</Link>.
            </span>
          </label>
          {formState.errors.acceptTerms && <p className="text-xs font-medium text-destructive" role="alert">{formState.errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" variant="gradient" loading={formState.isSubmitting} className="w-full">Create account</Button>
      </form>
    </>
  );
}

/* ── Forgot password ────────────────────────────────────────────────── */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: v });
      setSent(true);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-12 w-12 text-success" />
        <Heading title="Check your inbox" subtitle="If an account exists for that email, we’ve sent a link to reset your password. It expires in 1 hour." />
        <Button asChild variant="outline" className="w-full"><Link to="/login">Back to login</Link></Button>
      </div>
    );
  }
  return (
    <>
      <Heading title="Reset your password" subtitle="Enter your account email and we’ll send you a reset link." />
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} className="w-full">Send reset link</Button>
        <Link to="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">Back to login</Link>
      </form>
    </>
  );
}

/* ── Reset password ─────────────────────────────────────────────────── */
const resetSchema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { clear } = useAuth();
  const [formError, setFormError] = useState<string | null>(token ? null : 'This reset link is missing its token. Request a new one.');
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } });
      clear();
      toast.success('Password updated. Please log in with your new password.');
      navigate('/login', { replace: true });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  return (
    <>
      <Heading title="Choose a new password" subtitle="You’ll be signed out of all devices." />
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        {formError && (
          <Notice tone="error">
            {formError} <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>
          </Notice>
        )}
        <Field id="password" label="New password" error={formState.errors.password?.message} hint="At least 10 characters with letters and numbers.">
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <Field id="confirm" label="Confirm password" error={formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} disabled={!token} className="w-full">Update password</Button>
      </form>
    </>
  );
}

/* ── Verify email ───────────────────────────────────────────────────── */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { status, reload } = useAuth();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [message, setMessage] = useState(token ? '' : 'This verification link is missing its token.');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // StrictMode double-invoke would burn the single-use token
    ran.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(async () => {
        setState('ok');
        if (status === 'authenticated') await reload();
      })
      .catch((e) => {
        setState('error');
        setMessage(errorMessage(e));
      });
  }, [token, status, reload]);

  return (
    <div className="text-center" aria-live="polite">
      {state === 'pending' && (
        <>
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
          <Heading title="Verifying your email…" />
        </>
      )}
      {state === 'ok' && (
        <>
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <Heading title="Email verified" subtitle="Your free starter credits have been added. You can now create projects." />
          <Button asChild className="w-full"><Link to={status === 'authenticated' ? '/app' : '/login'}>{status === 'authenticated' ? 'Go to dashboard' : 'Log in'}</Link></Button>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
          <Heading title="Link not valid" subtitle={`${message} Sign in and use “Resend email” on your dashboard to get a fresh link.`} />
          <Button asChild variant="outline" className="w-full"><Link to="/app">Go to dashboard</Link></Button>
        </>
      )}
    </div>
  );
}

/* ── OAuth callback ─────────────────────────────────────────────────── */
export function OAuthCallbackPage() {
  const { reload } = useAuth();
  const navigate = useNavigate();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    reload().then((ok) => navigate(ok ? '/app' : '/login?error=google_failed', { replace: true }));
  }, [reload, navigate]);
  return (
    <div className="text-center" role="status">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
      <p className="mt-4 text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
