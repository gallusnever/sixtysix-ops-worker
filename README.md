# Proofing Worker

Node + TypeScript worker that renders watermarked proofs, stores PDFs in Supabase Storage, and exposes the `/api/proofs` endpoints consumed by the frontend.

## Requirements

- Node 18+
- Redis 7+
- Supabase project (URL + service role key)
- Playwright Chromium dependencies (included if you use the provided Docker image)

## Setup

1. Copy `.env.example` to `.env` and fill in the Supabase/Redis values.
2. Install dependencies and Chromium:

   ```bash
   npm install
   npx playwright install chromium
   ```

3. Start Redis locally or use the provided `docker-compose.yml` from the project root.
4. Run the worker:

   ```bash
   npm run dev
   ```

   or build + run:

   ```bash
   npm run build
   npm start
   ```

## API Endpoints

- `POST /api/proofs/:orderId/generate` — queue proof generation (auth required)
- `GET /api/proofs` — list proofs for the authenticated user
- `GET /api/proofs/:id/signed` — refresh signed URL (auth required)
- `GET /api/public/proofs/:id?token=` — public viewer
- `POST /api/public/proofs/:id/approve?token=` — public approval

The worker uses BullMQ + Redis to process jobs and Playwright to render PDFs.
