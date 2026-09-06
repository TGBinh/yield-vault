# Pin theo digest (không chỉ tag "3.11-slim") để build không bị âm thầm đổi base image
# khi Docker Hub tag lại "3.11-slim" trỏ tới bản khác - digest lấy thật qua
# `docker pull python:3.11-slim && docker inspect --format='{{index .RepoDigests 0}}'`.
FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534
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
