# Pharmacy Duty Scheduler

Eczacı odaları için nöbet çizelgeleme yönetim sistemi. Bkz. `CLAUDE.md` için
ürün kapsamı ve geliştirme kuralları.

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM + SQLite

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the admin dashboard,
and [http://localhost:3000/vatandas](http://localhost:3000/vatandas) for the
public duty pharmacy screen.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — lint the project
- `npm run db:seed` — seed the database with sample data (3 users, 5 regions,
  100 pharmacies, holidays, and unavailability records)
