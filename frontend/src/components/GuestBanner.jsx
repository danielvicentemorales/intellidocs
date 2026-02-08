import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function GuestBanner({ onUpgrade }) {
  const { guestLimits, isGuest } = useAuth();

  if (!isGuest) return null;

  const isLowOnDocs = guestLimits.documentsRemaining <= 1;
  const isLowOnQuestions = guestLimits.questionsRemaining <= 3;
  const showWarning = isLowOnDocs || isLowOnQuestions;

  return (
    <div className={`guestBanner ${showWarning ? 'warning' : ''}`}>
      <div className="guestBannerContent">
        <span className="guestBannerIcon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
        <span className="guestBannerText">
          Modo invitado: {guestLimits.documentsRemaining}/{guestLimits.maxDocuments} docs
          | {guestLimits.questionsRemaining}/{guestLimits.maxQuestions} preguntas
        </span>
      </div>
      <button className="guestBannerUpgrade" onClick={onUpgrade}>
        Crear cuenta gratis
      </button>
    </div>
  );
}
