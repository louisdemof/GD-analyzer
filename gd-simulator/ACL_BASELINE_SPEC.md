# SPEC — ACL (Cliente Livre) baseline for the GD Analyzer

**Status:** proposal · **Author:** Louis · **Date:** 2026-06-18
**Driver case:** SUPERFRIO (5 UCs, COPEL/PR) — all are **A4 Verde, já no mercado livre (ACL)**
with a fonte-incentivada TUSD discount. The current simulator compares a GD/PPA offer
against a **captive (cativo)** baseline, which is wrong for these clients and **overstates the
savings**. This spec adds an explicit **ACL baseline mode**.

---

## 1. Problem

`runSimulation` builds the **SEM** ("sem GD", i.e. *what the client pays today*) scenario in
`simulateUCBank(..., isSEM:true)`. For Grupo A the cost is (see `bank.ts:207, 330`):

```
costRede_SEM = fpUncovered·T_AFP + ptUncovered·T_APT + demandaFaturada·T_A_DEMANDA
```

where `T_AFP`/`T_APT` are the **full captive all-in tariffs (TUSD+TE com tributos)** and the
demand is at the full captive demand tariff. That is correct for a captive prospect, but **a
Cliente Livre does not pay that.** A Cliente Livre with fonte incentivada pays:

* **Energia (TE)** bought in the ACL at a contracted `R$/MWh` (≈ R$300/MWh sem imp for SUPERFRIO) — **not** the regulated TE;
* **TUSD (Fio B) only** to the distribuidora, **with an incentivada discount** (~44% consumo, ~49% demanda for SUPERFRIO);
* the energy line passes through the distributor as ICMS-ST and is deducted (`DEDUCAO ENERGIA ELETRICA ACL`).

The existing `competitorDiscount` ("Plin") flag is **not** a fix: it is applied **only to Grupo B**
(`bank.ts:287` — `effectiveT_B = T_B3·(1−discount)`) and is a flat haircut on the captive tariff,
not an energy + discounted-wire build-up.

### Why it matters (the two distortions)
1. **Baseline too high.** SUPERFRIO's true effective FP cost ≈ R$0.568/kWh com imp — *coincidentally*
   ≈ the captive tariff (R$0.562) only because their ACL energy (R$300/MWh) is expensive. In general
   the ACL baseline ≠ captive, and the captive baseline silently inflates `economia`.
2. **Demand cancels — wrongly.** Today the engine bills the *same* demand in SEM and COM, so demand
   nets to zero in `economia`. But an ACL→GD migration **loses the incentivada demand discount**:
   SEM demand is discounted (~−49%), COM (captive GD) demand is full. **Demand must stop cancelling**
   and the clawback must appear in `economia`.

---

## 2. Regulatory framing (the model to encode)

A fonte-incentivada Cliente Livre that adopts Helexia GD/SCEE **returns to the captive market (ACR)**
for the participating UCs. On migration it:

* **loses** the ACL energy contract (stops paying the ACL `R$/MWh`);
* **loses** the incentivada TUSD discount on **both** consumo **and** demanda;
* **gains** SCEE credits that compensate **consumo** (TE + TUSD), with the ICMS-on-TUSD leak per
  `icmsScope` (PR = `TE_ONLY`);
* **demanda is never compensated by SCEE** and is now billed at the **full captive** demand tariff.

So the honest comparison is:

```
economia = CUSTO_ACL_hoje(SEM)  −  CUSTO_GD_cativo(COM)
```

with the demand-discount loss living inside that delta.

> **Assumption flagged to user (not modelled numerically):** the incentivada discount is tied to the
> client's ACL supply contract + the supplying plant's grandfathered outorga (Lei 14.120/2021). The
> SEM baseline should let the discount **step down or expire** along the horizon (see §4 `tusdDiscountSchedule`).

---

## 3. Data-model changes (`types.ts`)

Add an ACL baseline config. Per-project default, overridable per-UC (UCs may have different
supply contracts — e.g. SUPERFRIO's CCV is a different CNPJ).

```ts
export interface ACLBaseline {
  enabled: boolean;                 // false ⇒ keep current captive baseline (back-compat)
  // Energy bought in the ACL (the TE the client pays today)
  energyPriceSemImp: number;        // R$/kWh sem impostos (ex.: 0.300)
  energyIndexation?: 'FIXO' | 'IPCA' | 'IGPM' | 'PLD';   // for escalation of the SEM energy price
  energyEscalationPct?: number;     // annual %, applied to energyPriceSemImp in SEM (default 0)
  // Incentivada TUSD discount the client enjoys TODAY (SEM only)
  tusdDiscountConsumo: number;      // ex.: 0.44
  tusdDiscountDemanda: number;      // ex.: 0.49
  // Optional: discount erosion along the horizon (month index → discount factor 0..1).
  // If absent, discount is held flat for the whole horizon.
  tusdDiscountSchedule?: { consumo: number[]; demanda: number[] };
  // Does ACL energy carry PIS/COFINS + ICMS in the SEM build-up? (PR: yes)
  energyIcms?: boolean;             // default true
  energyPisCofins?: boolean;        // default true
}
```

Wire it onto `Project`:

```ts
export interface Project {
  // ...
  aclBaseline?: ACLBaseline;             // project-level default
}
export interface ConsumptionUnit {
  // ...
  aclBaselineOverride?: ACLBaseline;     // optional per-UC override (e.g. CCV)
}
```

No new tariff fields are needed: `computeDerivedTariffs` already yields `T_AFP_TUSD`,
`T_APT_TUSD`, `T_B3_TUSD` (TUSD-only all-in) and `T_A_DEMANDA` (demand all-in). The ACL energy
price is the **only** new tariff input; everything else is recombination.

---

## 4. Cost formulas

Let `acl = uc.aclBaselineOverride ?? project.aclBaseline` (when `acl?.enabled`).

Define the ACL energy all-in price (reuse `computeAllInTariff` with the relevant taxes toggled):

```
TE_ACL_allin(m) = computeAllInTariff(
    acl.energyPriceSemImp · (1 + esc)^yearIdx,           // esc = energyEscalationPct
    { ICMS: acl.energyIcms? d.taxes.ICMS : 0,
      PIS:  acl.energyPisCofins? d.taxes.PIS : 0,
      COFINS: acl.energyPisCofins? d.taxes.COFINS : 0 } )
```

### 4.1 SEM — Cliente Livre (replaces captive block in `bank.ts` when `acl.enabled`)

Per UC per month, **all consumption is "uncovered" in SEM** (no GD credits), so:

```
discCons = scheduleOrFlat(acl.tusdDiscountConsumo, m)
discDem  = scheduleOrFlat(acl.tusdDiscountDemanda,  m)

costRede_SEM =
    consFP · ( T_AFP_TUSD·(1 − discCons) + TE_ACL_allin )
  + consPT · ( T_APT_TUSD·(1 − discCons) + TE_ACL_allin )
  + consRSV· ( (T_ARSV_TUSD ?? T_AFP_TUSD)·(1 − discCons) + TE_ACL_allin )   // if irrigante
  + demandaFaturada · T_A_DEMANDA · (1 − discDem)
```

Notes:
* `T_*_TUSD` is the **un-discounted captive TUSD** all-in; we apply the incentivada discount to it.
* Grupo B analogue: `consB · ( T_B3_TUSD·(1 − discCons) + TE_ACL_allin )` (no demand, no PT).
* This is the line that today wrongly uses `T_AFP` (TUSD+**regulated** TE).

### 4.2 COM — GD cativo (mostly unchanged, **one fix**)

The COM path already computes: compensated kWh → PPA (in `simulation.ts:ppaCost`) + ICMS-on-TUSD
leak (`icmsScope:'TE_ONLY'`, `bank.ts:233`) + residual uncovered kWh at captive `T_AFP/T_APT`.
**Required change:** in COM the demand must be the **full captive** demand tariff with **no
incentivada discount** (i.e. keep `demandaFaturada · T_A_DEMANDA`, *not* discounted). Since SEM is
now discounted and COM is full, demand **no longer cancels** and the clawback flows into `economia`
automatically through the existing `economia = semTotalCost − comTotalCost − leaks` (`simulation.ts:343`).

> ⚠️ Do **not** apply `acl.tusdDiscount*` to the COM scenario. The discount only exists while the
> client is a Cliente Livre incentivado; under GD-cativo it is gone.

### 4.3 PPA on ponta (FA) — unchanged but document it
Compensating 1 kWh **PT** consumes `1/FA` kWh of (fora-ponta) credits, so the effective PPA on ponta
is `ppa/FA` (FA≈0.622 for COPEL). This already falls out of the bank simulation (credits are FP and
drain against PT at the posto ratio). If the commercial offer is a **truly flat** PPA on every
compensated kWh regardless of posto, add a scenario flag `ppaFlatAcrossPostos: boolean` and bill PT
credits at `ppa` instead of `ppa/FA`. (For CWBII this swings the result materially — see §6.)

---

## 5. Output / UI changes

* Rename scenarios when `acl.enabled`: **"Cenário atual (ACL)"** vs **"Cenário Helexia (GD cativo)"**.
* In "Detalhe de Impostos por UC" and "De Onde Vem a Economia", show the SEM build-up as
  **`Energia ACL` + `TUSD (Fio B, −X%)` + `Demanda (−Y%)`** instead of the captive `TUSD+TE` line.
* Add an explicit **"Perda do desconto de demanda"** line in the savings decomposition (it is the
  single biggest drag and must be visible, not buried).
* Surface the **discount-continuity assumption**: a banner stating the SEM discount is held flat
  (or per `tusdDiscountSchedule`) and that real continuity depends on the ACL contract term + the
  supplying plant's outorga.
* The captive PT windfall (R$2.41/kWh) must **not** appear — ACL PT baseline is `T_APT_TUSD·(1−disc)+TE_ACL`.

---

## 6. Acceptance test — CWBII (use these as unit-test fixtures)

Inputs (avg month): `consFP=230,673 kWh`, `consPT=22,604 kWh`, `demanda=650 kW`.
Distributor COPEL/PR, `icmsScope='TE_ONLY'`. ACL: `energyPriceSemImp=0.300`,
`tusdDiscountConsumo=0.44`, `tusdDiscountDemanda=0.4875`. Invoice gross-up ≈ 1.3254.
Tariffs com imp from fatura Maio/26: `TUSD_FP=0.160249`, `TUSD_PT=0.901004`, `TUSD_dem=14.1135`.

| Linha | SEM (ACL) | COM (GD, PPA R$0,450) |
|---|--:|--:|
| Energia / PPA FP | TE·tot = 100,705 | 230,673·0,450 = 103,803 |
| Energia / PPA PT | (incl. acima) | 22,604·(0,450/0,622) = 16,353 |
| TUSD FP (−44%) | 36,965 | — (compensada) |
| TUSD PT (−44%) | 20,366 | — (compensada) |
| ICMS s/ TUSD (leak) | — | 13,114 |
| Demanda | 650·14,1135 = **9,174** (−49%) | 650·(14,1135/0,5125) = **17,900** (full) |
| **TOTAL/mês** | **167,210** | **151,171** |

**Expected `economia` ≈ R$16,039/mês (9.6%), ≈ R$192k/ano.** Decomposition the engine must
reproduce: energia FP +R$18,259 · energia PT +R$6,506 · **demanda −R$8,726**.

Sanity guards for the test:
* With `acl.enabled=false` (captive), the same inputs must reproduce the legacy ~20% number — proves back-compat.
* If `ppaFlatAcrossPostos=true`, PT PPA = 22,604·0,450 = 10,172 ⇒ economia ≈ R$22,221/mês (13.3%).
* If `energyPriceSemImp` ↓, SEM ↓ and economia ↓ (energy is the dominant SEM term).

---

## 7. Scope / non-goals
* **In:** ACL SEM build-up; demand-discount clawback; discount erosion schedule; per-UC override;
  flat-PPA-across-postos flag; UI relabelling + leak/clawback visibility.
* **Out (future):** modelling a "renew-ACL-at-future-price" counterfactual; partial migration
  (some UCs stay ACL); reactive energy and bandeiras; intermediação/markup (already handled elsewhere).

## 8. Implementation checklist
- [ ] `types.ts`: `ACLBaseline`, `Project.aclBaseline`, `ConsumptionUnit.aclBaselineOverride`, scenario flag `ppaFlatAcrossPostos`.
- [ ] `bank.ts`: branch SEM Grupo A/B cost on `acl.enabled` (formula §4.1); ensure COM demand is full (no incentivada discount).
- [ ] `tariff.ts`: helper `aclEnergyAllIn(acl, taxes, yearIdx)` (§4).
- [ ] `simulation.ts`: thread `acl` into `simulateUCBank`; keep `economia` formula (clawback now non-zero).
- [ ] PDF/Excel (`pdf.ts`, `excel.ts`): relabel scenarios, add SEM build-up rows + "Perda desconto demanda" + discount-continuity banner.
- [ ] Tests: CWBII fixtures (§6) incl. back-compat captive case.
