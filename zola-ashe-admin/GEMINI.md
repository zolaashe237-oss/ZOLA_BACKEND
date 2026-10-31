# ZOLA ASHÉ - Project Context & Guidelines

This document provides essential information for AI agents and developers working on the ZOLA ASHÉ project, encompassing both the Admin Dashboard (Frontend) and the Backend API.

## Project Overview

**ZOLA ASHÉ** is a platform dedicated to spirituality, culture, and education. It consists of a robust Django backend and a modern Next.js admin dashboard.

### Core Technologies

- **Frontend:** Next.js 15 (App Router), React 18, TypeScript, Axios.
- **Backend:** Django 5, Django Rest Framework (DRF), PostgreSQL, Redis, Celery.
- **Infrastructure:** Cloudflare R2/S3 (Storage), Brevo (Email), Swinmo (Payments).
- **Authentication:** JWT (SimpleJWT) with OTP support. Access tokens are kept in memory (frontend) for security.

## Project Structure

### Admin Dashboard (Frontend)
Located at: `E:\CabrelDouanla\Documents\Projets\ZOLA_DAHBOARD_ADMIN`

- `src/app/`: Next.js App Router pages and layouts.
  - `(auth)/`: Authentication pages (Login).
  - `(dashboard)/`: Core admin features (Members, Content, Finance, etc.).
- `src/components/`: Reusable UI components.
- `src/lib/`:
  - `api.ts`: Axios client with JWT interceptors and refresh logic.
  - `endpoints.ts`: Centralized API definitions.
  - `types.ts`: TypeScript interfaces for API models.

### Backend API
Located at: `E:\CabrelDouanla\Documents\Projets\zolaashe\zola-ashe-backend`

- `apps/`: Modular Django applications.
  - `accounts/`: User management, OTP, and authentication.
  - `admin_api/`: Specific endpoints for the admin dashboard.
  - `content/`: Courses, modules, formations, and resources.
  - `billing/`: Payments, subscriptions, and Swinmo integration.
  - `community/`: Channels, posts, and moderation.
- `config/`: Project configuration.
  - `settings/`: Environment-based settings (base, dev, prod).
- `celery.py`: Asynchronous task configuration.

## Development Workflows

### Building and Running

#### Frontend (Dashboard)
```bash
cd E:\CabrelDouanla\Documents\Projets\ZOLA_DAHBOARD_ADMIN
npm install
npm run dev
```

#### Backend
```bash
cd E:\CabrelDouanla\Documents\Projets\zolaashe\zola-ashe-backend
# Activate virtual environment
.\.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8010
```

#### Celery (Backend)
```bash
celery -A config worker -l info
celery -A config beat -l info
```

### Key Conventions

- **API Integration:** Always use the centralized `api` client in `src/lib/api.ts` for frontend requests. Do not store JWT in localStorage; the refresh token is handled via HttpOnly cookies.
- **Types:** Maintain strict TypeScript definitions in `src/lib/types.ts` matching the backend serializers.
- **Backend Settings:** Sensitive data must be in `.env`. Use `django-environ` to access them.
- **Mocking:** For local development without external service keys, use `EMAIL_MOCK=True` and `SWINMO_MOCK=True` in the backend `.env`.

## Architectural Notes

- **Content Hierarchy:** Formation → Module → Course → Resource.
- **Access Control:** Based on subscription levels (`ACTIF`, `RESTREINT`, `BLOQUE`) and specific access levels for content.
- **Storage:** All media resources (Videos, PDFs, Audios) are stored in S3-compatible storage (Cloudflare R2) and accessed via signed URLs.
- **Throttling:** 100 req/min for users, 20 req/min for auth routes.
