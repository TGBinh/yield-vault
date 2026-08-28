FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir -e .
EXPOSE 8002
CMD ["python", "-m", "uvicorn", "risk_engine.api:app", "--host", "0.0.0.0", "--port", "8002"]
