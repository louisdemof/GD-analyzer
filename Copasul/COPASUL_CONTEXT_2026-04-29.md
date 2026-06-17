# Copasul CS3 — Context for GD Analyzer Attribution Feature

**Date:** 2026-04-29
**Author:** Louis de Moffarts
**Purpose:** Establish full context before implementing Helexia value-attribution decomposition in the GD Analyzer (`gd-simulator`).

---

## 1. The deal (one-paragraph recap)

Copasul (cooperative, Mato Grosso do Sul) is buying solar credits from the Helexia HCS03 plant (Cassilândia, ~16,557 MWh over 10y P50). Distribution to **17 consumer UCs** via a per-period rateio matrix in the Energisa MS distributor zone. PPA rate fixed at **R$ 0,5222/kWh** with **+4,5%/year escalation parallel to tariff escalation** (REH 3.582/2026 homologated 22/04/2026, headline +12,11% médio Energisa MS — Grupo A FP +21,38% / Ponta +5,56% / Grupo B +12,36%). Two contract durations under offer: **60m (5y)** and **120m (10y)**.

**Customer's pre-existing assets (NOT Helexia's):**
- NHS plant (Novo Horizonte do Sul) — own generation
- BAT plant (Batayporã) — own generation, surplus distributed 50/50 to NHS/AMD via the F-section rateio in Premissas
- AMD plant (Amandina) — own generation
- **Initial credit banks: 786,669 kWh (NHS) + 791,092 kWh (BAT) = 1,577,761 kWh**

**Helexia's incremental contribution:** the HCS03 plant + monthly credit dispatch via 20-period rateio across the 17 UCs.

---

## 2. Current Excel state (as of 2026-04-29 06:14)

Files in `/Users/louisdemoffarts/Desktop/COPASUL/RTA_2026_update_27Apr2026/`:

| File | Headline | Status |
|---|---|---|
| `CS3_Copasul_V11_5anos_RTA2026_PPA_0.5222.xlsx` | R$ 2.81M VT / 26,9% | active 5y |
| `CS3_Copasul_V11_10anos_RTA2026_PPA_0.5222.xlsx` | R$ 5.97M VT / 22,3% | active 10y |
| `..._backup_pre_BAT_fix.xlsx` | pre-BAT-tracking | backup |
| `..._backup_pre_rateio_fix.xlsx` | restored to this | backup |

**10y current numbers (active file):**
```
Custo SEM Helexia          R$ 26,168,602
Rede remanescente          R$  9,740,081
PPA pago à Helexia         R$ 10,604,512
Custo COM total            R$ 20,344,593
Economia Líquida           R$  5,824,009
Banco residual @ PPA       R$    143,388
VALOR TOTAL                R$  5,967,397
% redução                       22,3%
```

**Presentation:** `Copasul_CS3_Proposta_Comercial_v10_RTA2026_Excel_aligned_ldm.pptx` — aligned with 5y R$ 2,81M and 10y R$ 5,59M (this last figure is now stale since BAT fix → 5,97M; not yet propagated to slides).

---

## 3. What changed in the past days

### 3.1 Pass A (rateio with consumption cap) — completed earlier this week
Diagnosed that Config H (V10 inherited rateio) over-allocated to 15 small B3 UCs (75 MWh/mês to UCs that only consume 47 MWh/mês = ~20× over-allocation creating fictitious credits). Rebuilt rateio with cap = consumo médio × 1,10, redistributed surplus to NHS (57%) + AMD (43%). Result: R$ 6,06M Eco for 120m at the time.

### 3.2 Pass B-2 (100% HCS03 utilization) — completed earlier this week
Discovered ~626k kWh of HCS03 (~3,8%/period × 20 periods) was orphaned by rateio sums < 1,0. Reallocated 100% to NHS Ponta (highest tariff-PPA differential R$ 1,37/kWh/credit). Headline at this point: **R$ 6,98M Eco / 29,5% redução / R$ 7,25M VALOR TOTAL** for 120m.

### 3.3 V10 of presentation (yesterday, 2026-04-28)
- Removed the 24-month slide (no longer offering 24m option)
- Aligned slide numbers with Excel: 5y at R$ 2,81M / 27,5% and 10y at R$ 5,59M / 23,0%
- File: `Copasul_CS3_Proposta_Comercial_v10_RTA2026_Excel_aligned_ldm.pptx`

### 3.4 BAT cost tracking added today (2026-04-29 morning)
**Problem found:** The Excel `Simulacao` tab summed costs across only 17 UCs (NHS + AMD + 14 B3 + TRR Maracaju). **BAT-the-UC's electricity bill was missing entirely** — the model treated BAT as just a plant, but BAT also has its own building/silo consuming electricity.

**Fix applied:** Added 3 new rows to `Simulacao`:
- `R286: BAT HCS03 créditos recebidos (kWh)` (mirrors NHS R27 logic, uses `$34` rateio row)
- `R287: BAT Custo SEM Helexia (R$)` (only when BAT bank empty; FP + Ponta deficit × tariffs with escalation)
- `R288: BAT Custo COM Helexia rede remanescente (R$)` (same with HCS03 credits subtracted)

Updated `D249` and `D250` (CUSTO TOTAL SEM/COM rede) to include these new rows.

**Impact:**
| | Pre-BAT-fix | Post-BAT-fix | Δ |
|---|---:|---:|---:|
| Custo SEM 10y | R$ 23,641k | R$ 26,168k | +R$ 2,527k (BAT bills Y6-Y10) |
| Eco Líquida | R$ 5,442k | R$ 5,824k | +R$ 382k (HCS03 helps some of BAT bills) |
| VALOR TOTAL | R$ 5,586k | R$ 5,967k | +R$ 382k |
| % redução | 23,0% | 22,3% | −0,7pp |

**Same fix applied to 5y file:** smaller impact (BAT bank covers full 5 years, Δ Eco only +R$ 2,7k, % drops 27,55% → 26,87%).

### 3.5 Rateio rebalance experiment — attempted and reverted
**User insight:** "10y % redução (23%) is lower than 5y (27,5%) — that doesn't make sense. After Y5, customer banks deplete so HCS03 should generate MORE economy in Y6-Y10."

**Investigation revealed two bugs:**

**Bug 1: Rateio sum > 1,0 in 17 of 20 periods** (P1-P10: 1,021-1,040 / P11-P17: 1,047 / P18-P20: 0,9995). The percentages allocate MORE than 100% of HCS03 generation = phantom kWh that don't physically exist. From a previous heuristic optimizer that didn't enforce sum=1,0 constraint.

**Bug 2: BAT rateio = 0 in P1-P17, only activates at 33% in P18-P20.** When BAT bank depletes (end of Y5), BAT-the-UC bleeds R$ 2,5M of grid bills across Y6-Y9 with zero offset.

**Attempted fix:**
1. Scale all P1-P17 rateios so each period sums to exactly 1,000
2. Activate BAT at 20% in P11-P17 (Y6-Y9), redistribute proportionally from NHS+AMD

**Result was WORSE:**
| | Before fix | After fix | Δ |
|---|---:|---:|---:|
| Eco Líquida | R$ 5,824k | R$ 4,092k | −R$ 1,732k |
| VALOR TOTAL | R$ 5,967k | R$ 4,235k | −R$ 1,732k |
| % redução | 22,3% | 15,6% | −6,7pp |
| Y10 Eco | −R$ 55k | −R$ 139k | worse |

**Why it failed:** BAT plant generation already exceeds BAT consumption annually (1,072 vs 850 MWh). BAT plant's surplus is configured to flow 50/50 to NHS/AMD (Premissas rows 55-56), so BAT bank only depletes from initial 791k → 0 because surplus is auto-sent away. Sending HCS03 to BAT just **fills BAT's bank with credits that have no monthly deficit to land on**, while NHS/AMD lose 20% of their HCS03 share. Net: credits stranded + NHS/AMD bleeding more.

**Reverted to pre-fix state.** Current Excel has the rateio sum > 1,0 bug present but is the version aligned with the v10 presentation.

---

## 4. Open issues / problems

### 4.1 The math-honesty gap
The current R$ 5,97M / 22,3% includes ~R$ 1-1,5M of phantom Eco from the rateio sum>1,0 bug. A mathematically clean optimization would produce R$ 4-4,5M / 15-17%. **Risk:** Copasul could spot the rateio sum violation by summing Premissas C33:U50 columns themselves.

### 4.2 10y < 5y % redução is structurally awkward
After BAT cost tracking, 10y at 22,3% is lower than 5y at 26,9%. The narrative for offering 10y to a customer should be that longer locks-in more value, not less. The truth is that with this specific UC mix:
- **BAT plant overgenerates** (annual surplus of 222 MWh sent to NHS/AMD)
- **AMD plant adequate** for AMD consumption
- **Only NHS truly needs HCS03** for its consumption
- Initial banks cover Y1-Y4 mostly
- Y6-Y10: HCS03 is genuinely modest incremental value because the customer's own assets are already strong

### 4.3 No transparency layer for value attribution
Customer can read R$ 5,97M as "what Helexia delivers" but can't see the breakdown:
- How much comes from initial bank usage (their pre-existing 1,578 MWh credits)
- How much from own plants (NHS + AMD + BAT generation)
- How much from BAT distribution to NHS/AMD (their internal optimization)
- How much from Helexia HCS03 (the only thing they pay PPA for)

This decomposition matters for both customer trust ("we're not claiming your existing assets as our value") and internal sanity (avoiding cases where rateio choices accidentally inflate Helexia attribution).

---

## 5. What we're building now — Helexia attribution decomposition

### 5.1 Goal
Add to the `gd-simulator` (TypeScript/React app at `/Users/louisdemoffarts/Desktop/Helexia/GD-analyzer/gd-simulator/`) a feature that decomposes monthly Eco into:

```
Total customer benefit (vs no assets at all)
  ├── Initial Bank effect    (customer's pre-existing bank credits)
  ├── Own Plants effect      (NHS + AMD + BAT plant generation)
  ├── BAT distribution effect (BAT plant surplus → NHS/AMD)
  └── Helexia HCS03 effect   ← THE ONLY THING THE CUSTOMER PAYS PPA FOR
```

### 5.2 Approach — sequential scenario subtraction

Run 5 scenarios per simulation:
| # | Scenario | Initial Bank | Own Plants | BAT distrib | HCS03 |
|---|---|:-:|:-:|:-:|:-:|
| 1 | Bare | OFF | OFF | OFF | OFF |
| 2 | + Initial Bank | ON | OFF | OFF | OFF |
| 3 | + Own Plants | ON | ON | OFF | OFF |
| 4 | + BAT distrib (=SEM) | ON | ON | ON | OFF |
| 5 | + HCS03 (=COM) | ON | ON | ON | ON |

Marginal value of each component = `cost(scenario_n) − cost(scenario_n+1)`.

### 5.3 Existing engine readiness
`engine/simulation.ts:179-200` already runs 2 scenarios (SEM/COM) by toggling `includeCS3Credits` flag passed to `simulateUCBank()`. Extending to 5 scenarios requires:
- New flags in `simulateUCBank()` options: `includeInitialBank`, `includeOwnGen`, `includeBATDistrib`
- New result types: `AttributionScenarios`, `AttributionResult`
- 3 new flag-driven branches in `bank.ts` (the per-UC simulation core)

### 5.4 Files to modify
| File | Change | Effort |
|---|---|---|
| `engine/types.ts` | Add `AttributionScenarios` + `AttributionResult` types | small |
| `engine/bank.ts` | Add 3 new flags to `SimulateUCBankOptions`, gate logic | medium |
| `engine/simulation.ts` | Run 5 scenarios, return decomposition | medium |
| `pages/Results.tsx` | New collapsible "Atribuição de Valor" section | medium |
| `engine/excel.ts` | New "Atribuição" sheet in Excel export | small |
| `engine/pdf.ts` | Optional attribution page (off by default) | small |

**Total effort: ~1.5 working days.**

### 5.5 Tradeoffs flagged
- **Interaction effects:** sequential subtraction is order-dependent. Shapley-value attribution (16 combos averaged) is more rigorous but heavier compute. For Copasul, sequential is fine and explanation is intuitive. Proposal: ship sequential first, leave Shapley as a future toggle.
- **Performance:** 5× simulations vs 2× ≈ 2,5× compute. Already <1s for Copasul scale, no real impact.
- **UI complexity:** attribution panel is detail Copasul might not want to see in headline. Build as collapsed-by-default tab.

### 5.6 Reconciliation with current Excel
After implementation, the GD Analyzer with the same rateio (after enforcing sum=1,0) should produce:
- A **headline Eco** (= Helexia HCS03 effect, scenario 4 − scenario 5) that is mathematically clean
- A **separate "customer self-value"** number (= scenarios 1→4 marginal sum) that explains where their existing savings come from
- **Honesty:** these two should always reconcile to total customer benefit vs bare baseline

This becomes the durable answer to "are you sure these aren't our own bank credits?"

---

## 6. Implementation plan (current task list)

| # | Subject | Status |
|---|---|---|
| 5 | Design attribution scenarios (bare/bank/plants/SEM/COM) | pending |
| 6 | Extend simulation.ts to run multiple scenarios | pending |
| 7 | Add Helexia attribution UI panel | pending |
| 8 | Export attribution to Excel/PDF | pending |

Sequential build order: 5 → 6 → 7 → 8.

---

## 7. References

- `/Users/louisdemoffarts/Desktop/COPASUL/RTA_2026_update_27Apr2026/README.md` — earlier readme with Pass A and Pass B-2 details
- `/Users/louisdemoffarts/Desktop/Helexia/GD-analyzer/Copasul/copasul_model_context.md` — older modeling context
- `/Users/louisdemoffarts/Desktop/Helexia/GD-analyzer/Copasul/V11_CHANGELOG.md` — V11 model changelog
- Active 10y Excel: `/Users/louisdemoffarts/Desktop/COPASUL/RTA_2026_update_27Apr2026/CS3_Copasul_V11_10anos_RTA2026_PPA_0.5222.xlsx`
- Active 5y Excel: `/Users/louisdemoffarts/Desktop/COPASUL/RTA_2026_update_27Apr2026/CS3_Copasul_V11_5anos_RTA2026_PPA_0.5222.xlsx`
- Presentation v10: `/Users/louisdemoffarts/Desktop/COPASUL/RTA_2026_update_27Apr2026/Copasul_CS3_Proposta_Comercial_v10_RTA2026_Excel_aligned_ldm.pptx`
