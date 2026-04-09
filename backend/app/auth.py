from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from uuid import uuid4

from .deps import get_db
from .models import User, Credential, SessionToken
from .schemas import UserCreate, UserOut
from .security import hash_password, verify_password
from .jwt_handler import create_access_token, decode_access_token
from .dependencies_auth import get_current_identity

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 10


def _create_session_record(token: str, user_id: int, db: Session):
    """Persist a session token so it can be validated or revoked later."""
    payload = decode_access_token(token)
    if not payload:
        return
    now = datetime.now().isoformat()
    db.add(SessionToken(
        token_id=payload.get("jti", str(uuid4())),
        user_id=user_id,
        issued_at=now,
        expires_at=payload.get("exp", now),
        is_revoked=False,
    ))


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()

    if len(payload.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password too long (max 72 bytes)")

    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed = hash_password(payload.password)
    now = datetime.now().isoformat()

    user = User(
        email=email,
        password_hash=hashed,
        role="user",
        created_at=now,
        is_active=True,
    )
    db.add(user)
    db.flush()  # get user.id before creating credential

    # Create credential record for login tracking
    db.add(Credential(
        user_id=user.id,
        email=email,
        password_hash=hashed,
        failed_attempts=0,
        last_login=None,
    ))

    db.commit()
    db.refresh(user)
    return user


@router.post("/login")
def login(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check lockout via credential record
    cred = db.query(Credential).filter(Credential.user_id == user.id).first()
    if cred and cred.failed_attempts >= MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Account temporarily locked due to too many failed attempts",
        )

    if not verify_password(payload.password, user.password_hash):
        # Track failed attempt
        if cred:
            cred.failed_attempts = (cred.failed_attempts or 0) + 1
            db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Successful login: reset counter and track
    now = datetime.now().isoformat()
    if cred:
        cred.failed_attempts = 0
        cred.last_login = now
    else:
        # Backfill credential if it doesn't exist (legacy user)
        cred = Credential(
            user_id=user.id,
            email=email,
            password_hash=user.password_hash,
            failed_attempts=0,
            last_login=now,
        )
        db.add(cred)

    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email, "role": "user"}
    )

    # Track session token
    _create_session_record(access_token, user.id, db)
    db.commit()

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/guest")
def guest_login():
    guest_id = str(uuid4())
    access_token = create_access_token(
        data={"sub": f"guest:{guest_id}", "role": "guest"}
    )
    return {"access_token": access_token, "token_type": "bearer", "guest_id": guest_id}


@router.get("/me")
def get_me(identity=Depends(get_current_identity)):
    if identity["kind"] == "guest":
        return {"kind": "guest", "guest_id": identity["guest_id"]}

    user = identity["user"]
    return {"kind": "user", "id": user.id, "email": user.email}


@router.post("/logout")
def logout(
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    """Revoke the current session token."""
    jti = identity.get("payload", {}).get("jti")
    if jti:
        token = db.query(SessionToken).filter(SessionToken.token_id == jti).first()
        if token:
            token.is_revoked = True
            db.commit()
    return {"status": "ok"}


@router.post("/validate")
def validate_token(identity=Depends(get_current_identity)):
    """Check whether the current token is still valid."""
    if identity["kind"] == "guest":
        return {"valid": True, "kind": "guest", "guest_id": identity["guest_id"]}
    user = identity["user"]
    return {"valid": True, "kind": "user", "id": user.id, "email": user.email}


@router.post("/refresh")
def refresh_token(
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    """Issue a new token and revoke the old one."""
    payload = identity.get("payload", {})

    # Revoke old token if tracked
    old_jti = payload.get("jti")
    if old_jti:
        old = db.query(SessionToken).filter(SessionToken.token_id == old_jti).first()
        if old:
            old.is_revoked = True

    # Issue new token
    if identity["kind"] == "guest":
        guest_id = identity["guest_id"]
        new_token = create_access_token(
            data={"sub": f"guest:{guest_id}", "role": "guest"}
        )
    else:
        user = identity["user"]
        new_token = create_access_token(
            data={"sub": str(user.id), "email": user.email, "role": "user"}
        )
        _create_session_record(new_token, user.id, db)

    db.commit()
    return {"access_token": new_token, "token_type": "bearer"}
