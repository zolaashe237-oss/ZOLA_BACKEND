FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

COPY . .

RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

EXPOSE 8000
# Invocation via `sh` : robuste même si le bit +x est perdu par le bind-mount
# du code hôte en développement.
ENTRYPOINT ["sh", "./entrypoint.sh"]
