import React, { useState } from "react";
import "./styles.css";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LandingPage from "./components/LandingPage";
import AuthForm from "./components/AuthForm";
import GuestBanner from "./components/GuestBanner";
import MainApp from "./components/MainApp";

function AppContent() {
  const { user, isGuest, loading, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState("landing");

  if (loading) {
    return (
      <div className="loadingScreen">
        <div className="loadingSpinner">📄</div>
        <p>Cargando IntelliDocs...</p>
      </div>
    );
  }

  if (user || isGuest) {
    return (
      <div className="appWrapper">
        <GuestBanner onUpgrade={() => {
          logout();
          setCurrentPage('auth');
        }} />
        <MainApp
          onLogout={() => {
            logout();
            setCurrentPage('landing');
          }}
        />
      </div>
    );
  }

  if (currentPage === 'auth') {
    return (
      <AuthForm
        onBack={() => setCurrentPage('landing')}
        onSuccess={() => setCurrentPage('app')}
      />
    );
  }

  return (
    <LandingPage
      onNavigateToAuth={() => setCurrentPage('auth')}
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
