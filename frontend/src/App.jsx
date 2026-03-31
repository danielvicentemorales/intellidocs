import React, { useEffect, useState } from "react";
import "./styles.css";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LandingPage from "./components/LandingPage";
import AuthForm from "./components/AuthForm";
import GuestBanner from "./components/GuestBanner";
import MainApp from "./components/MainApp";

function AppContent() {
  const { user, isGuest, loading, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState("landing");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("intellidocs-theme");
    if (saved) return saved;
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("intellidocs-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  if (loading) {
    return (
      <>
        <button className="themeToggle" onClick={toggleTheme}>
          {theme === "dark" ? "🌙 Dark mode" : "☀ Light mode"}
        </button>
        <div className="loadingScreen">
          <div className="loadingSpinner">📄</div>
          <p>Loading IntelliDocs...</p>
        </div>
      </>
    );
  }

  if (user || isGuest) {
    return (
      <div className="appWrapper">
        {isGuest && (
          <GuestBanner
            onUpgrade={() => {
              logout();
              setCurrentPage("auth");
            }}
          />
        )}

        <MainApp
          onLogout={() => {
            logout();
            setCurrentPage("landing");
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>
    );
  }

  if (currentPage === "auth") {
    return (
      <>
        <button className="themeToggle" onClick={toggleTheme}>
          {theme === "dark" ? "🌙 Dark mode" : "☀ Light mode"}
        </button>
        <AuthForm
          onBack={() => setCurrentPage("landing")}
          onSuccess={() => setCurrentPage("app")}
        />
      </>
    );
  }

  return (
    <LandingPage
      onNavigateToAuth={() => setCurrentPage("auth")}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
