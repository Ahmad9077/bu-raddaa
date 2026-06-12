# بو رضّاعة: مهمة الديوانية

لعبة موبايل عربية باللهجة الكويتية مبنية بـ Vite + React + TypeScript + Canvas.

## تعديل الاسم والليدربورد

عدّل الملف `src/config.ts`:

```ts
export const CONFIG = {
  PLAYER_NAME: 'بو رضّاعة',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
}
```

- غيّر `PLAYER_NAME` لاسم صاحبك.
- ضع `SUPABASE_URL` و `SUPABASE_ANON_KEY` لتفعيل الليدربورد.
- إذا تركت مفاتيح Supabase فاضية، اللعبة تشتغل كاملة ويتخطى الليدربورد الإرسال.

## Supabase SQL

انسخ هذا في Supabase Dashboard مرة واحدة:

```sql
create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 20),
  score int not null check (score between 0 and 5000),
  created_at timestamptz not null default now()
);
alter table public.leaderboard enable row level security;
create policy "public insert" on public.leaderboard for insert to anon with check (true);
create policy "public read" on public.leaderboard for select to anon using (true);
```

## Local Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run build
```

## Cloudflare Pages Deploy

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
- Node version: `24`

## GitHub Pages

This repo also deploys through `.github/workflows/deploy.yml`.
