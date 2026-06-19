import React, { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useNavigate, Link } from 'react-router-dom';
import roboMainImg from '../assets/RoboMain.png';
import logoImg from '../assets/logo.png';
import '../styles/Auth.css';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const backendUrl = isLocalhost ? 'http://localhost:3000' : (import.meta.env.VITE_BACKEND_URL || '');

      const response = await fetch(`${backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Login failed with status: ${response.status}`);
      }

      const data = await response.json();
      
      // Store custom JWT access and refresh tokens
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      localStorage.setItem('user_profile', JSON.stringify(data.user));

      // Sign into Firebase Auth using the custom token to preserve client-side Firestore access
      if (data.firebaseCustomToken) {
        await signInWithCustomToken(auth, data.firebaseCustomToken);
      }

      navigate('/dashboard');
    } catch (err) {
      console.error("Error during login:", err.message);
      setError(`Login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="auth-hero">
        <img src={roboMainImg} alt="AI Robot" className="auth-hero-image" />
      </div>
      
      <div className="auth-form-container">
        <div className="auth-form-wrapper">
          <div className="auth-brand">
            <img src={logoImg} alt="CodeOrbit Logo" className="auth-logo" />
            <h1 className="auth-title">CodeOrbit</h1>
          </div>
          <p className="auth-subtitle">Everything around your code ecosystem</p>

          {error && <div className="auth-error">{error}</div>}

          <form className="auth-form" onSubmit={handleEmailLogin}>
            <div className="auth-input-group">
              <label className="auth-input-label">Email</label>
              <input 
                type="email" 
                className="auth-input" 
                placeholder="Input your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>
            
            <div className="auth-input-group">
              <label className="auth-input-label">Password</label>
              <input 
                type="password" 
                className="auth-input" 
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
              />
            </div>

            <div className="auth-form-options">
              <label className="auth-checkbox-label">
                <input type="checkbox" className="auth-checkbox" required />
                I agree to the terms and conditions
              </label>
              <a href="#" className="auth-link">Forgot Password?</a>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          {/* Social login temporarily disabled
          <div className="auth-divider">Or continue with</div>
          <div className="auth-social-buttons">
            <button 
              type="button" 
              className="auth-social-btn" 
              onClick={() => {}}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
          </div>
          */}

          <div className="auth-footer">
            Don't have an account? <Link to="/signup" className="auth-link">Sign Up</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
