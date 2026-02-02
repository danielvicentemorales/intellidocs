import bcrypt

def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")

def verify_password(password: str, hashed) -> bool:
    if hashed is None:
        return False

    pwd_bytes = password.encode("utf-8")

    # DB might return bytes (if column is BLOB/LargeBinary)
    if isinstance(hashed, (bytes, bytearray)):
        hashed_bytes = bytes(hashed)
    else:
        hashed_bytes = str(hashed).encode("utf-8")

    return bcrypt.checkpw(pwd_bytes, hashed_bytes)