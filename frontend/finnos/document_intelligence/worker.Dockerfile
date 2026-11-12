# FDI OCR worker image (not deployed by this branch).
# Build from the repo root:  docker build -f frontend/finnos/document_intelligence/worker.Dockerfile .
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY frontend/finnos/document_intelligence/requirements-ocr.txt /tmp/requirements-ocr.txt
RUN pip install --no-cache-dir -r /tmp/requirements-ocr.txt

# Models are fetched once at build time and baked in; requests never download.
ENV FDI_PADDLE_MODEL_DIR=/models/paddle PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
RUN python - <<'EOF'
import os, shutil
from paddleocr import PaddleOCR
PaddleOCR(lang="pt", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
cache = os.path.expanduser("~/.paddlex/official_models")
names = sorted(os.listdir(cache))
det = next(n for n in names if n.endswith("_det"))
rec = next(n for n in names if n.endswith("_rec"))
os.makedirs("/models/paddle", exist_ok=True)
shutil.copytree(os.path.join(cache, det), "/models/paddle/det")
shutil.copytree(os.path.join(cache, rec), "/models/paddle/rec")
print("models:", det, rec)
EOF

COPY frontend/finnos /srv/finnos
RUN useradd --create-home --uid 10001 fdi && chown -R fdi /srv
USER fdi
ENV PYTHONPATH=/srv PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["uvicorn", "finnos.document_intelligence.worker:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
