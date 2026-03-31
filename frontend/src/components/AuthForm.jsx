import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthForm({ onBack, onSuccess }) {
  const { login, register, error } = useAuth();

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setLocalError('');
  };

  const validateForm = () => {
    if (!email.trim()) {
      setLocalError('Email is required');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setLocalError('Invalid email address');
      return false;
    }

    if (!password) {
      setLocalError('Password is required');
      return false;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return false;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');

    if (!validateForm()) return;

    setLoading(true);

    try {
      const result = mode === 'login'
        ? await login(email, password)
        : await register(email, password);

      if (result.success) {
        onSuccess?.();
      } else {
        setLocalError(result.error || 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className="authPage">
      <div className="authCard">
        <div className="authHeader">
          <button className="authBack" onClick={onBack} type="button">
            &larr; Back
          </button>
          <div className="authLogo">📄</div>
          <h2 className="authTitle">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>
        </div>

        <form className="authForm" onSubmit={handleSubmit}>
          {displayError && (
            <div className="authError">
              {displayError}
            </div>
          )}

          <div className="authField">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="authField">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div className="authField">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            className="btnPrimary authSubmit"
            disabled={loading}
          >
            {loading ? 'Loading...' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <div className="authToggle">
          {mode === 'login' ? (
            <p>
              Don&apos;t have an account?{' '}
              <button className="authToggleBtn" onClick={toggleMode} type="button">
                Create account
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button className="authToggleBtn" onClick={toggleMode} type="button">
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
