import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

/**
 * ✅ En Vercel/Preview/Production: usa VITE_API_URL (Railway)
 * ✅ En local: si no existe env var, cae a localhost:8000 (solo DEV)
 */
const API_BASE =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

if (!API_BASE) console.error("VITE_API_URL is missing in this deployment");

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

  // solo para UI (preguntas). Docs ya NO son source of truth.
  const [guestData, setGuestData] = useState(() => {
    const saved = sessionStorage.getItem("guestData");
    return saved ? JSON.parse(saved) : { questionsAsked: 0 };
  });

  // contador real de docs guest (viene del backend)
  const [guestDocsCount, setGuestDocsCount] = useState(() => {
    const saved = sessionStorage.getItem("guestDocsCount");
    return saved ? Number(saved) : 0;
  });

  useEffect(() => {
    if (isGuest) {
      sessionStorage.setItem("guestData", JSON.stringify(guestData));
      sessionStorage.setItem("guestDocsCount", String(guestDocsCount));
    }
  }, [guestData, guestDocsCount, isGuest]);

  const getToken = useCallback(() => localStorage.getItem("token"), []);

  // Re-hidrata sesión desde token (USER o GUEST) y sincroniza contador de docs si es guest
  useEffect(() => {
    async function checkAuth() {
      const token = localStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          localStorage.removeItem("token");
          setUser(null);
          setIsGuest(false);
          setGuestDocsCount(0);
          return;
        }

        const me = await res.json();

        if (me?.kind === "guest") {
          setUser(me);
          setIsGuest(true);

          // trae count real de docs del backend
          try {
            const docsRes = await fetch(`${API_BASE}/documents`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (docsRes.ok) {
              const docs = await docsRes.json();
              setGuestDocsCount(Array.isArray(docs) ? docs.length : 0);
            }
          } catch {}
        } else {
          setUser(me);
          setIsGuest(false);
          setGuestDocsCount(0);
        }
      } catch (e) {
        console.error("Auth check failed:", e);
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Login failed");
      }

      const data = await res.json();
      const access_token = data.access_token;

      localStorage.setItem("token", access_token);

      const meRes = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (!meRes.ok) throw new Error("Failed to fetch /auth/me");

      const me = await meRes.json();
      setUser(me);
      setIsGuest(false);

      sessionStorage.removeItem("guestData");
      sessionStorage.removeItem("guestDocsCount");
      setGuestData({ questionsAsked: 0 });
      setGuestDocsCount(0);

      return { success: true };
    } catch (e) {
      setError(e.message);
      return { success: false, error: e.message };
    }
  }, []);

  const register = useCallback(
    async (email, password) => {
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Registration failed");
        }

        return await login(email, password);
      } catch (e) {
        setError(e.message);
        return { success: false, error: e.message };
      }
    },
    [login]
  );

  const enterAsGuest = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/guest`, { method: "POST" });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Guest login failed");
      }

      const data = await res.json(); // { access_token, guest_id, token_type }
      localStorage.setItem("token", data.access_token);

      setIsGuest(true);
      setUser({ kind: "guest", guest_id: data.guest_id });

      sessionStorage.removeItem("guestData");
      sessionStorage.removeItem("guestDocsCount");
      setGuestData({ questionsAsked: 0 });
      setGuestDocsCount(0); // luego MainApp refreshDocs lo actualiza

      return { success: true };
    } catch (e) {
      setError(e.message);
      return { success: false, error: e.message };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setIsGuest(false);
    localStorage.removeItem("token");
    sessionStorage.removeItem("guestData");
    sessionStorage.removeItem("guestDocsCount");
    setGuestData({ questionsAsked: 0 });
    setGuestDocsCount(0);
  }, []);

  const incrementGuestQuestions = useCallback(() => {
    setGuestData((prev) => ({
      ...prev,
      questionsAsked: (prev.questionsAsked || 0) + 1,
    }));
  }, []);

  // ahora el límite docs sale del backend (guestDocsCount)
  const guestLimits = {
    documentsUsed: guestDocsCount,
    documentsRemaining: Math.max(0, GUEST_LIMITS.maxDocuments - guestDocsCount),
    questionsRemaining: Math.max(
      0,
      GUEST_LIMITS.maxQuestions - (guestData.questionsAsked || 0)
    ),
    maxDocuments: GUEST_LIMITS.maxDocuments,
    maxQuestions: GUEST_LIMITS.maxQuestions,
    canUpload: guestDocsCount < GUEST_LIMITS.maxDocuments,
    canAsk: (guestData.questionsAsked || 0) < GUEST_LIMITS.maxQuestions,
  };

  const value = {
    user,
    isGuest,
    isAuthenticated: !!user && user?.kind !== "guest",
    loading,
    error,
    guestData,
    guestDocsCount,
    setGuestDocsCount,
    guestLimits,
    login,
    register,
    logout,
    enterAsGuest,
    incrementGuestQuestions,
    getToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
