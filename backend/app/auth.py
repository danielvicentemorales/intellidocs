from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import uuid4

from .deps import get_db
from .models import User
from .schemas import UserCreate, UserOut
from .security import hash_password, verify_password
from .jwt_handler import create_access_token
from .dependencies_auth import get_current_user, get_current_identity

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()

    if len(payload.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password too long (max 72 bytes)")

    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login")
def login(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()

    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": "user"})
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/guest")
def guest_login():
    guest_id = str(uuid4())
    access_token = create_access_token(data={"sub": f"guest:{guest_id}", "role": "guest"})
    return {"access_token": access_token, "token_type": "bearer", "guest_id": guest_id}


@router.get("/me")
def get_me(identity=Depends(get_current_identity)):
    if identity["kind"] == "guest":
        return {"kind": "guest", "guest_id": identity["guest_id"]}

    user = identity["user"]
    return {"kind": "user", "id": user.id, "email": user.email}
