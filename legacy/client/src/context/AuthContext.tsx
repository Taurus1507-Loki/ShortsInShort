import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types/index.js';
import { api } from '../services/api.js';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  loginDemoUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const token = localStorage.getItem('shortsinshort_token');
      if (!token) {
        setUser(null);
        return;
      }
      const userData = await api.get<User>('/auth/me');
      setUser(userData);
    } catch (err) {
      console.warn('Failed to fetch authenticated user session:', err);
      api.setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: User }>('/auth/login', {
      email,
      password,
    });
    api.setToken(res.accessToken);
    setUser(res.user);
  };

  const register = async (fullName: string, email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: User }>('/auth/register', {
      fullName,
      email,
      password,
    });
    api.setToken(res.accessToken);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignored
    } finally {
      api.setToken(null);
      setUser(null);
    }
  };

  const loginDemoUser = async () => {
    const demoEmail = 'creator@shortsinshort.com';
    const demoPassword = 'DemoPassword2026!';
    try {
      await login(demoEmail, demoPassword);
    } catch {
      // Auto-register demo account if not existing yet
      await register('Demo Video Creator', demoEmail, demoPassword);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        refreshUser,
        loginDemoUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

