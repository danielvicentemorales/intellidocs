import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_BASE = "http://localhost:8000";

const GUEST_LIMITS = {
  maxDocuments: 3,
  maxQuestions: 10,
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [guestData, setGuestData] = useState(() => {
    const saved = sessionStorage.getItem('guestData');
    return saved ? JSON.parse(saved) : {
      documents: [],
      questionsAsked: 0,
    };
  });

  useEffect(() => {
    if (isGuest) {
      sessionStorage.setItem('guestData', JSON.stringify(guestData));
    }
  }, [guestData, isGuest]);

  useEffect(() => {
    async function checkAuth() {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setIsGuest(false);
        } else {
          localStorage.removeItem('token');
        }
      } catch (e) {
        console.error('Auth check failed:', e);
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Login failed');
      }

      const { access_token } = await res.json();
      localStorage.setItem('token', access_token);

      const meRes = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      if (meRes.ok) {
        const userData = await meRes.json();
        setUser(userData);
        setIsGuest(false);
        sessionStorage.removeItem('guestData');
        setGuestData({ documents: [], questionsAsked: 0 });
      }

      return { success: true };
    } catch (e) {
      setError(e.message);
      return { success: false, error: e.message };
    }
  }, []);

  const register = useCallback(async (email, password) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Registration failed');
      }

      return await login(email, password);
    } catch (e) {
      setError(e.message);
      return { success: false, error: e.message };
    }
  }, [login]);

  const enterAsGuest = useCallback(() => {
    setIsGuest(true);
    setUser(null);
    localStorage.removeItem('token');
    setGuestData({ documents: [], questionsAsked: 0 });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setIsGuest(false);
    localStorage.removeItem('token');
    sessionStorage.removeItem('guestData');
    setGuestData({ documents: [], questionsAsked: 0 });
  }, []);

  const addGuestDocument = useCallback((doc) => {
    setGuestData(prev => ({
      ...prev,
      documents: [doc, ...prev.documents],
    }));
  }, []);

  const removeGuestDocument = useCallback((docId) => {
    setGuestData(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== docId),
    }));
  }, []);

  const updateGuestDocument = useCallback((docId, updates) => {
    setGuestData(prev => ({
      ...prev,
      documents: prev.documents.map(d =>
        d.id === docId ? { ...d, ...updates } : d
      ),
    }));
  }, []);

  const incrementGuestQuestions = useCallback(() => {
    setGuestData(prev => ({
      ...prev,
      questionsAsked: prev.questionsAsked + 1,
    }));
  }, []);

  const guestLimits = {
    documentsRemaining: GUEST_LIMITS.maxDocuments - guestData.documents.length,
    questionsRemaining: GUEST_LIMITS.maxQuestions - guestData.questionsAsked,
    maxDocuments: GUEST_LIMITS.maxDocuments,
    maxQuestions: GUEST_LIMITS.maxQuestions,
    canUpload: guestData.documents.length < GUEST_LIMITS.maxDocuments,
    canAsk: guestData.questionsAsked < GUEST_LIMITS.maxQuestions,
  };

  const getToken = useCallback(() => {
    return localStorage.getItem('token');
  }, []);

  const value = {
    user,
    isGuest,
    isAuthenticated: !!user,
    loading,
    error,
    guestData,
    guestLimits,
    login,
    register,
    logout,
    enterAsGuest,
    addGuestDocument,
    removeGuestDocument,
    updateGuestDocument,
    incrementGuestQuestions,
    getToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
