FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/backend \
    DMT_METRICS_PIPELINE_PATH=/metrics_pipeline \
    DMT_RELEASE_SPECS_DIR=/data/metrics/release-specs \
    DMT_ARTIFACT_DIR=/backend/runtime-artifacts

WORKDIR /backend

RUN apt-get update \
    && apt-get install --no-install-recommends -y libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY data/metrics/python/metrics_pipeline /metrics_pipeline
COPY data/metrics/fixtures /data/metrics/fixtures
COPY data/metrics/release-specs /data/metrics/release-specs

RUN chmod +x /backend/docker/entrypoint.sh \
    && useradd --system --uid 10001 --home /backend appuser \
    && mkdir -p /backend/runtime-artifacts /backend/runtime-cache \
    && chown -R appuser:appuser /backend /metrics_pipeline /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

ENTRYPOINT ["/backend/docker/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
