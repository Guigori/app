"""FINNOS compatibility entrypoint — Firebase/Firestore only.

The original MongoDB FastAPI server is retired. Git history preserves the old
source for forensic review, but there is no longer a runnable MongoDB HTTP
entrypoint in this location.

Use `cd frontend && python -m uvicorn api.index:app --port 8002` for development.
Existing `cd backend && uvicorn server:app` launches that same Firebase API,
never the legacy MongoDB routes. No Mongo environment variables are read.
"""
from pathlib import Path
import sys

frontend_root = Path(__file__).resolve().parent.parent / "frontend"
if not frontend_root.is_dir():
    raise RuntimeError("FINNOS Firebase API missing: frontend/ directory is required.")

if str(frontend_root) not in sys.path:
    sys.path.insert(0, str(frontend_root))

from api.index import app  # noqa: E402,F401 — canonical Vercel/Firebase ASGI app
