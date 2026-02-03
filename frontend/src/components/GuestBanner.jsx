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
        <span className="guestBannerIcon">👤</span>
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
