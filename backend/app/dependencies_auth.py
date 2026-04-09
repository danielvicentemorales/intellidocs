from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Dict, Any

from .deps import get_db
from .models import User, SessionToken
from .jwt_handler import decode_access_token

security = HTTPBearer()


def _is_token_revoked(jti: str, db: Session) -> bool:
    """Check if a token has been explicitly revoked."""
    token = (
        db.query(SessionToken)
        .filter(SessionToken.token_id == jti, SessionToken.is_revoked.is_(True))
        .first()
    )
    return token is not None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    # Check revocation if the token carries a jti
    jti = payload.get("jti")
    if jti and _is_token_revoked(jti, db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        user_id = int(sub)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


def get_current_identity(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    # Check revocation if the token carries a jti
    jti = payload.get("jti")
    if jti and _is_token_revoked(jti, db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    sub = payload.get("sub")
    role = payload.get("role")

    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    # Guest token
    if role == "guest" or (isinstance(sub, str) and sub.startswith("guest:")):
        guest_id = sub.split("guest:", 1)[1] if "guest:" in sub else sub
        return {"kind": "guest", "guest_id": guest_id, "payload": payload}

    # User normal token
    try:
        user_id = int(sub)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return {"kind": "user", "user": user, "payload": payload}
