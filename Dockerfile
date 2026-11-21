FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
EXPOSE 3000
# One worker: the arm/enrol sessions live in memory and the reader is a single device.
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "3000"]
