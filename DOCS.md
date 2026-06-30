# GD Analyzer — Documentation

Simulador de Geração Distribuída (GD) for Helexia Brasil. It quantifies the savings of a
solar/GD project for a client — in the **captive** (regulated) or **free** (ACL) market —
and produces a comparable, shareable analysis.

---

## What it does

Compares the client's current bill (**SEM** Helexia) with the cost under GD/PPA
(**COM** Helexia) and outputs the **economia** (R$ and %), payback, the 60-month credit
bank dynamics, and per-UC rateio — across the contract horizon.

## Core flow

1. **Create a project** — manually or by **importing bill PDFs** (auto-fills distributor,
   tariffs, UCs, 12-month consumption + demand history).
2. **Configure** — distributor & ANEEL tariffs, solar plant(s) + P50 profile, PPA price,
   horizon; market (Cativo / ACL + incentivada level).
3. **Results** — Resumo (economia/payback), Mensal, Banco de créditos, Rateio (+ optimizer),
   Sensibilidades; export PDF/Excel; compare scenarios side-by-side.
4. **Collaborate** — share per-project (Admin/Editor/Viewer), trash/restore, audit history.

## Fatura import (8 distributors)

Auto-detected from the PDF: **Energisa MS, COPEL, CEMIG, Equatorial (PA/PI/MA/GO/AL),
Light, Enel (RJ/CE Grupo B/SP), EDP SP**. COPEL/Enel bills are password-protected
(prompted / filename code). Each parser extracts the embedded consumption history; a
**health check** (`faturaHealth`) flags likely mis-parses (missing months, zero/outlier
consumption, missing demand). Scanned/image bills (no text layer) require OCR (not yet
supported). ACL bills auto-configure market = ACL + incentivada (I50 default, or the
stated % from CEMIG/Light).

## Regulatory basis (energia incentivada)

- **Lei 9.427/96 art. 26 §1º** — 50/80/100% reduction on TUSD/TUST for incentivized
  sources, on production and consumption.
- **ANEEL "Cálculo do Desconto Aplicado à TUSD/TUST"** (REN 1.000/2021 / PRORET Submódulo
  7.1) — per modality:
  - **Verde**: demanda = nível; consumo ponta = nível × (TUSD_Ponta − TUSD_FP) premium;
    consumo **fora-ponta = 0%**.
  - **Azul**: demanda (ponta & FP) = nível; energy = 0%.
- Taxes: the discount applies to the **sem-impostos** TUSD base; ICMS + PIS/COFINS remain on
  the full tariff (Decreto 7.891/2013) → net ≈ 71% of gross. The engine derives these per UC
  from the live ANEEL tariffs.

## Architecture

- **Frontend**: React 19 + Vite + TypeScript + Zustand + React Router + Tailwind 4.
- **Engine** (`src/engine/`): pure TS — `simulation.ts` (SEM/COM), `bank.ts` (SCEE credit
  bank), `tariff.ts`, `demandaOptimizer.ts`, `optimiser.ts` (rateio), `faturaParser.ts`
  (PDF parsers, pdf.js), `taxBreakdown.ts`. 98 unit/regression tests (vitest), incl.
  snapshot locks on the real demo cases (default + optimized).
- **Storage**: local-first IndexedDB (`idb`) + cloud sync to **Supabase** (Postgres + Auth +
  RLS), hosted in São Paulo (sa-east-1).
- **Tariffs**: ANEEL open-data API (refreshable in-app); bundled snapshot in
  `data/aneel-tariffs.json`.
- **Hosting**: Vercel (auto-deploy on push), same-origin `/api/aneel` proxy for CORS.

## Collaboration & rights (Supabase RLS)

- Projects private by default; shared by email with role **admin / editor / viewer**.
- **Super-admins** (allowlist) have full control over all projects.
- Signup restricted to `@helexia.eu`. Soft-delete (Lixeira) + append-only audit log.
- SQL migrations live in `supabase/*.sql` (run once each in the SQL editor).

## In-app help

`/ajuda` (sidebar → "❔ Como funciona") — a plain-language guide + glossary
(TUSD, TE, FP/PT, SCEE, Verde/Azul, incentivada, etc.).
