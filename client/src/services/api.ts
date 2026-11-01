const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  data?: any;
}

class ApiService {
  private getToken(): string | null {
    return localStorage.getItem('shortsinshort_token');
  }

  public setToken(token: string | null) {
    if (token) {
      localStorage.setItem('shortsinshort_token', token);
    } else {
      localStorage.removeItem('shortsinshort_token');
    }
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { data, headers = {}, ...customConfig } = options;
    const token = this.getToken();

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string>),
    };

    const config: RequestInit = {
      ...customConfig,
      headers: requestHeaders,
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);

    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
      this.setToken(null);
      // Let caller handle or redirect
    }

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.message || 'An unexpected API error occurred');
    }

    return json.data;
  }

  get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', data });
  }

  patch<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', data });
  }

  put<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', data });
  }

  delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiService();

