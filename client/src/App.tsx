import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Loader2 } from 'lucide-react';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RedirectIfAuthed, RequireAuth } from '@/features/auth/guards';
import LandingPage from '@/pages/marketing/LandingPage';
import { AppLayout } from '@/components/app/AppLayout';
import { BillingPage, ComingSoonPage, HelpPage, NotFoundPage } from '@/pages/app/MiscPages';

// Route-level code splitting: marketing visitors don't download the app bundle.
const AuthPages = () => import('@/pages/auth/AuthPages');
const AuthLayout = lazy(() => AuthPages().then((m) => ({ default: m.AuthLayout })));
const LoginPage = lazy(() => AuthPages().then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => AuthPages().then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => AuthPages().then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => AuthPages().then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => AuthPages().then((m) => ({ default: m.VerifyEmailPage })));
const OAuthCallbackPage = lazy(() => AuthPages().then((m) => ({ default: m.OAuthCallbackPage })));

const LegalPage = lazy(() => import('@/pages/legal/LegalPage'));
const DashboardPage = lazy(() => import('@/pages/app/DashboardPage'));
const NewProjectPage = lazy(() => import('@/pages/app/NewProjectPage'));
const ProjectsPage = lazy(() => import('@/pages/app/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('@/pages/app/ProjectDetailPage'));
const SettingsPage = lazy(() => import('@/pages/app/SettingsPage'));
const MediaLibraryPage = lazy(() => import('@/pages/app/MediaLibraryPage'));
const BrandKitPage = lazy(() => import('@/pages/app/BrandKitPage'));

const SOON: { path: string; title: string; phase: number; description: string; bullets: string[] }[] = [
  {
    path: 'avatar',
    title: 'AI Avatar',
    phase: 3,
    description: 'Create videos with your own consented digital avatar and voice.',
    bullets: ['Identity verification & explicit consent', 'Avatar and voice management', 'Lip-synced multilingual speech', 'Consent revocation & asset deletion'],
  },
  {
    path: 'faceless',
    title: 'Faceless Videos',
    phase: 4,
    description: 'Turn a topic or script into a narrated video with licensed visuals.',
    bullets: [
      'AI script improvement',
      'Scene planning & visual prompts',
      'Narration in 5 Indian languages',
      'Licensed stock media',
      'Motion Explainer style: fully animated scenes from a topic',
    ],
  },
  {
    path: 'templates',
    title: 'Templates',
    phase: 4,
    description: 'Browse, preview and favourite proven video templates for every niche.',
    bullets: ['Search & category filters', 'Video previews', 'Favourites', 'One-click “Use template”'],
  },
];

function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-label="Loading">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<MarketingLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="legal/:slug" element={<LegalPage />} />
          </Route>

          <Route element={<AuthLayout />}>
            <Route element={<RedirectIfAuthed />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
            </Route>
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="verify-email" element={<VerifyEmailPage />} />
            <Route path="auth/callback" element={<OAuthCallbackPage />} />
          </Route>

          <Route path="app" element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="new" element={<NewProjectPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="media" element={<MediaLibraryPage />} />
              <Route path="brand-kit" element={<BrandKitPage />} />
              <Route path="editor" element={<Navigate to="/app/new?mode=editor" replace />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="help" element={<HelpPage />} />
              {SOON.map(({ path, ...props }) => (
                <Route key={path} path={path} element={<ComingSoonPage {...props} />} />
              ))}
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>

          <Route element={<MarketingLayout />}>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
