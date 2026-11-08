import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LandingPage } from './pages/LandingPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { AppLayout } from './components/AppLayout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { BrandKitPage } from './pages/BrandKitPage.js';
import { TemplatesPage } from './pages/TemplatesPage.js';
import { BillingPage } from './pages/BillingPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { EditorStudioPage } from './pages/EditorStudioPage.js';
import { AvatarStudioPage } from './pages/AvatarStudioPage.js';
import { FacelessCreatorPage } from './pages/FacelessCreatorPage.js';
import { MediaLibraryPage } from './pages/MediaLibraryPage.js';
import { HelpSupportPage } from './pages/HelpSupportPage.js';
import { AdminDashboardPage } from './pages/AdminDashboardPage.js';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold">Authenticating session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Marketing & Auth */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Authenticated Workspace */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="projects" element={<DashboardPage />} />
            <Route path="projects/:id/editor" element={<EditorStudioPage />} />
            <Route path="avatars" element={<AvatarStudioPage />} />
            <Route path="faceless" element={<FacelessCreatorPage />} />
            <Route path="brand-kit" element={<BrandKitPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="media" element={<MediaLibraryPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpSupportPage />} />
            <Route path="admin" element={<AdminDashboardPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;

