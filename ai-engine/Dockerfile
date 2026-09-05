FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
# Vault Security Audit - Medium: python:3.11-slim chạy root theo mặc định - tạo user
# riêng thay vì để RCE trong bất kỳ dependency nào có sẵn quyền root trong container.
RUN useradd --system --no-create-home --uid 10001 appuser && chown -R appuser /app
USER appuser
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health',timeout=2).status==200 else 1)" || exit 1
CMD ["python", "-m", "uvicorn", "ai_engine.main:app", "--host", "0.0.0.0", "--port", "8001"]
