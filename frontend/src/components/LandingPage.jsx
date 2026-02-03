import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LandingPage({ onNavigateToAuth }) {
  const { enterAsGuest, guestLimits } = useAuth();

  return (
    <div className="landing">
      <div className="landingCard">
        <div className="landingHeader">
          <div className="landingLogo">📄</div>
          <h1 className="landingTitle">IntelliDocs</h1>
          <p className="landingSubtitle">
            Haz preguntas inteligentes sobre tus documentos.
            <br />
            Sube PDFs, TXT o DOC y obtén respuestas al instante.
          </p>
        </div>

        <div className="landingActions">
          <button
            className="btnPrimary"
            onClick={onNavigateToAuth}
          >
            Crear cuenta / Iniciar sesión
          </button>

          <button
            className="btnSecondary"
            onClick={enterAsGuest}
          >
            Continuar como invitado
          </button>
        </div>

        <div className="landingGuestInfo">
          <h3>Modo invitado incluye:</h3>
          <ul>
            <li>Hasta {guestLimits.maxDocuments} documentos</li>
            <li>Hasta {guestLimits.maxQuestions} preguntas por sesión</li>
            <li>Sin persistencia (datos se pierden al cerrar)</li>
          </ul>
          <p className="landingGuestHint">
            Crea una cuenta gratuita para acceso ilimitado y guardar tu historial.
          </p>
        </div>
      </div>
    </div>
  );
}
