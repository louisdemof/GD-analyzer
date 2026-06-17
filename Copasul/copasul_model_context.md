# Copasul × CS3 Cassilândia — Full Model Context
_Extracted from chat history for handover to a new Claude session working on the Excel/proposal rebuild_

---

## 1. Excel File Architecture

### Workbooks that exist

| File | Purpose | Contract length | Periods | Last col |
|---|---|---|---|---|
| `CS3_Copasul_Modelo_V10_5anos_Proposed.xlsx` | Primary 5-year model | 60 months (Jun/26–Mai/31) | 10 (P1–P10) | BK (col 63) |
| `CS3_Copasul_Modelo_V10_10anos.xlsx` | 10-year extension | 120 months (Jun/26–Mai/36) | 20 (P1–P20) | DS (col 123) |
| `CS3_Copasul_Modelo_V10_App120m.xlsx` | 10-year with App GD Analyzer rateio | 120 months | 10 annual periods | DS (col 123) |

The 10-year file was built by extending the 5-year file: adding 60 new Simulacao columns (BL–DS) and 10 new rateio periods (P11–P20) in Premissas cols L–U.

### Sheet inventory (all workbooks have the same sheet structure)

| Sheet | What it computes | Key dependencies |
|---|---|---|
| `Resumo` | Executive summary KPIs (121r × 21c). Sections: geração injetada, PPA pago, economia líquida, banco residual, VALOR TOTAL, análise visual monthly table (cols P–U), banco por UC (rows 46–64), banco atribuível Helexia (rows 65–70). | Pulls from Simulacao via direct cell references |
| `Premissas` | All hardcoded inputs and rateio table. Sections A–G clearly labeled. | Source for all Simulacao formulas |
| `Input_Consumo_GrupoA` | Annual consumption base for NHS, AMD, BAT (12-month cycles, Jan–Dez order). Used by Simulacao row 22 (NHS FP), row 40 (AMD FP), row 58 (BAT FP) with growth applied. | Fed into Simulacao via formula references |
| `Simulacao` | Core month-by-month calculation engine. 285 rows × 63 cols (5yr) or 123 cols (10yr). One block of rows per UC. | Premissas, Input_Consumo_GrupoA, Dados_Produção sheets |
| `Dados_Produção_Copasul` | Raw metered generation data from Copasul's own plants (NHS, AMD, BAT own-gen) | Source data only |
| `Amandina` / `Batayporã` / `Novo Horizonte do Sul` | UC-level production sheets with monthly own-generation values | Feed into Simulacao |
| `Dados_Consumo_Copasul` | Raw consumption data per UC | Source data only |
| `Formula Dados Copasul` | Intermediate calculations for consumption | Source data only |
| `Memória de Massa - 2025` | Distributor memory of mass data | Source data only |
| `Dados_Produção_Helexia` | CS3 production data (real, post-COD) | Used as alternative to PVSyst when toggle active |
| `PVSYST_Helexia` | PVSyst P50 generation by month for all Cassilândia plants | Source for Premissas gen rows |
| `Usinas_Helexia_PR` | Usina registry | Reference |
| `Usinas` | Usina metadata | Reference |

### Key Premissas inputs (hardcoded, column B)

| Cell | Parameter | Value |
|---|---|---|
| B5 | Tarifa Grupo A FP com tributos (R$/kWh) | 0.526471 |
| B6 | Tarifa Grupo A Ponta com tributos (R$/kWh) | 2.97238 |
| B7 | Tarifa Grupo B3 com tributos (R$/kWh) | 1.15686 |
| B8 | FA = TE_FP / TE_Ponta | 0.604267 |
| B9 | ICMS (%) | 0.17 |
| B10 | PIS + COFINS (%) | 0.0855 |
| B11 | ICMS isenção autoconsumo remoto ativa? | Sim/Não toggle |
| B13 | Usina | Cassilândia 03 |
| B14 | Distribuidora | Energisa MS |
| B15 | Início do contrato | Jun/2026 |
| B16 | Prazo (meses) | 60 (or 120 for 10yr) |
| B17 | PPA Helexia CS3 (R$/kWh) | 0.4425 |
| B19 | Grupo B tem contrato Assinatura GD concorrente? | Sim/Não toggle |
| B21 | Crescimento consumo Y2 vs Y1 (%) | 0.025 |
| B23 | Degradação geração Y2 (%) | 0.005 |
| B24 | Usar proxy Batayporã p/ Amandina gen? | Sim/Não |
| B26 | NHS opening bank (kWh) | 148,516 |
| B27 | BAT opening bank (kWh, stranded) | 906,739 |
| B28 | AMD opening bank (kWh) | 991,029 |

### Rateio table (Premissas rows 32–51)

Row 32: header (UC / Planta, P1: Jun–Set/26, P2: Out/26–Mar/27, ... P10: Dez/30–Mai/31) in cols B–K.
Rows 33–50: one row per UC, percentage allocations.
Row 51: TOTAL (must = 100%, validated).
Row 55: BAT→NHS (%) = 0.50 (editable)
Row 56: BAT→AMD (%) = 0.50

### Generation profile (Premissas rows 61–120 for 5yr, 61–180 for 10yr)

Each row is one month. Formula: `=INDEX(PVSYST_Helexia!$J$5:$U$16, MATCH(month_name, ...), MATCH(usina_name, ...)) * degradation_factor`

The PVSYST_Helexia sheet contains the base P50 values. Degradation is applied via B23 (0.5%/yr).

### Simulacao column structure

- Col D (col 4) = Jun/26 = month 1
- Col BK (col 63) = Mai/31 = month 60 (5-year end)
- Col DS (col 123) = Mai/36 = month 120 (10-year end)
- Each month is one column. No macros. No external links (all data is internal).

### Period → Premissas column mapping (CRITICAL)

| Period | Premissas col | Sim cols | Months |
|---|---|---|---|
| P1 | B | 4–7 (D–G) | Jun–Set/26 |
| P2 | C | 8–13 (H–M) | Out/26–Mar/27 |
| P3 | D | 14–19 (N–S) | Abr–Set/27 |
| P4 | E | 20–27 (T–AA) | Out/27–Mai/28 |
| P5 | F | 28–33 (AB–AG) | Jun–Nov/28 |
| P6 | G | 34–39 (AH–AM) | Dez/28–Mai/29 |
| P7 | H | 40–45 (AN–AS) | Jun–Nov/29 |
| P8 | I | 46–51 (AT–AY) | Dez/29–Mai/30 |
| P9 | J | 52–57 (AZ–BE) | Jun–Nov/30 |
| P10 | K | 58–63 (BF–BK) | Dez/30–Mai/31 |
| P11 | L | 64–69 (BL–BQ) | Jun–Nov/31 |
| P12 | M | 70–75 (BR–BW) | Dez/31–Mai/32 |
| P13 | N | 76–81 (BX–CC) | Jun–Nov/32 |
| P14 | O | 82–87 (CD–CI) | Dez/32–Mai/33 |
| P15 | P | 88–93 (CJ–CO) | Jun–Nov/33 |
| P16 | Q | 94–99 (CP–CU) | Dez/33–Mai/34 |
| P17 | R | 100–105 (CV–DA) | Jun–Nov/34 |
| P18 | S | 106–111 (DB–DG) | Dez/34–Mai/35 |
| P19 | T | 112–117 (DH–DM) | Jun–Nov/35 |
| P20 | U | 118–123 (DN–DS) | Dez/35–Mai/36 |

### Key Simulacao row map (per UC block — NHS block shown as reference)

Each UC occupies approximately 13 rows. NHS is the first Grupo A block:

| Row | Content |
|---|---|
| 6 | CS3 generation (kWh injetado) — `=Premissas!$B$[61+month_offset]` |
| 7 | PPA cost (R$) — `=D6 * Premissas!$B$17` |
| 13 | BAT→NHS credits (from BAT surplus redistribution) |
| 14 | BAT→AMD credits |
| 18 | BAT own bank (stranded, opening 906,739 kWh) |
| 22 | NHS FP consumption — `=Input_Consumo_GrupoA!$B$9 * (1+Premissas!$B$21)^yr` |
| 23 | NHS PT consumption |
| 24 | NHS own generation (solar) |
| 25 | NHS own generation PT component |
| 27 | CS3 credits allocated to NHS — `=col6 * Premissas!$[period_col]$33` |
| 28 | NHS opening bank (first col: 148,516; subsequent: previous bank balance) |
| 29 | NHS COM bank draw |
| 30 | NHS SEM bank draw |
| 31 | NHS bank end-of-month (COM) — complex formula handling multiple credit sources |
| 34 | NHS SEM bank end-of-month |
| 40 | AMD FP consumption |
| 49 | AMD bank end-of-month (COM) |
| 52 | AMD SEM bank end-of-month |
| 62+ | Grupo B UCs (one block each, 13 rows per UC) |

UC block order: NHS (rows ~18–35), AMD (~36–53), AREC (~54–67), Banheiro Motoristas (~68–81), CTC Copasul (~82–95), Depósito Irrigação (~96–109), Entreposto (~110–123), Esc. Deodápolis (~124–137), Esc. Nova Andradina (~138–151), Esc. Regional Deodápolis (~152–165), Galpão AE (~166–179), Irrigação CG (~180–193), Lab. Solos (~194–207), Posto Carreteiro (~208–221), Refeitório Deodápolis (~222–235), Subest. Fiação (~236–249), TRR Maracaju (~250–263).

**Bank end formula for NHS (row 31, any col X):**
```
=MAX(X29-X30,0) + X28 + MAX(X27 - MAX(X22-X24,0), 0) + MAX(X24-X22, 0)
```
This formula has the BAT bug: when BAT credits (X27) are added inside the formula, it can force a phantom bank draw even when NHS own-gen already covers NHS consumption. The App computes it correctly (BAT credit added separately to bank, not inside the draw formula).

**Bank end formula for Grupo B UCs (simpler, e.g. row 62 for AREC):**
```
=MAX(X60-X61,0) + MAX(X59-X58,0)
```

### Key total rows

| Row | Content | Formula (col B = total) |
|---|---|---|
| 252 | Economia líquida mensal | `=D249-D251-D253` per col; total `=SUM(D252:BK252)` |
| 255–271 | Bank per UC at end | `=BK31`, `=BK49`, ... |
| 273 | Total bank all UCs | `=BK31+BK49+BK62+...` |
| 276 | Economia líquida total | `=B252` |
| 277 | Banco residual @ PPA | `=B273*Premissas!$B$17` |
| 278 | VALOR TOTAL Helexia | `=B252+B285` |
| 281 | NHS banco atribuível | `=BK31-BK34` (COM minus SEM) |
| 282 | AMD banco atribuível | `=BK49-BK52` (COM minus SEM) |
| 283 | Grupo B banco total | sum of all B3/B1 end banks |
| 284 | Total banco atribuível | `=B281+B282+B283` |
| 285 | Banco atribuível @ PPA | `=B284*Premissas!$B$17` |

**Row 252 monthly economia formula:** `=col249 - col251 - col253`
Where: 249 = SEM cost, 251 = rede remanescente COM, 253 = ICMS additional

---

## 2. CS3 Plant Assumptions

**Plant:** Cassilândia 03 (CS3), Mato Grosso do Sul, Energisa MS concession area.
**Capacity:** 625 kWac, ground-mounted, single-axis trackers.
**Contract start:** Jun/2026. Month 1 = Jun/26.
**Status:** Operational, real production data available.

### P50 generation profile

Source: PVSYST simulation for Cassilândia 03, cross-validated against real CS1/CS2 production data. Monthly values stored in `PVSYST_Helexia` sheet, accessed via INDEX/MATCH in Premissas rows 61+.

The model has a toggle (Premissas B24): "Usar proxy Batayporã p/ Amandina gen?" — when active, uses Batayporã actual production as a proxy for Amandina's own generation (because CS3/CS2 data was more complete than Amandina's own records).

**Degradation:** 0.5%/yr (Premissas B23). Applied compoundly year over year via the PVSYST INDEX formula. The Premissas table already has the degraded values baked month by month; Simulacao row 6 simply references `=Premissas!$B$[row]`.

**Seasonality:** Peak generation Jun–Sep (MS winter, high irradiance, dry season). Lowest Jan–Feb. This is the inverse of the harvest consumption peaks — the plant generates most just before the soja harvest (Jul/Aug), giving credits time to accumulate.

**Approximate monthly P50 kWh (Y1, undegraded):**

| Month | kWh (approx) |
|---|---|
| Jun/26 | 123,990 |
| Jul/26 | 130,510 |
| Ago/26 | 156,670 |
| Set/26 | 147,010 |
| Out/26 | 151,080 |
| Nov/26 | 146,080 |
| Dez/26 | 138,710 |
| Jan/27 | 142,424 |
| Fev/27 | 126,912 |
| Mar/27 | 145,569 |
| Abr/27 | 145,250 |
| Mai/27 | 135,937 |

Annual Y1 ≈ 1,690 MWh. Total 60m ≈ 8,380 MWh (after degradation).

---

## 3. Rateio Logic

### Period structure rationale

The rateio is divided into 4 periods for 24m, 10 periods for 60m, and 20 periods for 120m. Each period is approximately 6 months (alternating Jun–Nov and Dez–Mai to capture pre-harvest and post-harvest dynamics).

**Core objective:** Maximize accumulated economia líquida by ensuring NHS and AMD banks are recharged before each harvest peak. The harvest months are Jul/Ago (soja) and Fev/Mar (milho). During these months NHS and AMD consumption spikes 3–5×, depleting their existing banks. Without CS3 credits, they pay full rede for the excess.

**Strategic logic per period:**

- **P1 (Jun–Set/26):** NHS gets 73.8%. NHS opens with only 148k kWh bank. Jul/Ago immediately hits the soja harvest. The high P1 allocation to NHS prevents NHS from paying rede in Jul/Ago. AMD has 991k kWh bank and doesn't need CS3 credits yet.
- **P2 (Out/26–Mar/27):** NHS drops to 51.8%. AMD still at 0% (bank sufficient). Entreposto gets some allocation (~10.7%) as it's the largest Grupo B UC.
- **P3 (Abr–Set/27):** NHS gets 67.1% (V8 Solver result). This is the critical decision — the optimizer pushes NHS high here to build a massive NHS bank before the next cycle of harvests (Y3/Y4/Y5). This is counterintuitive (Jul/Ago bank draws look wasteful) but the SLSQP optimizer confirms it generates ~R$509k more over 60m vs the App's 35.4% allocation.
- **P4 (Out/27–Mai/28):** NHS falls to 25.9%, AMD rises to 15.6%. Entreposto gets 21% (Entreposto is large and benefits from bank building here).
- **P5–P10:** SLSQP optimizer result — approximately NHS 47–58%, AMD 23–37%, declining allocation to BAT credits making up the bank differentials.

### Rateio table (V10 proposed, P1–P10)

Extracted directly from Premissas sheet B–K columns:

| UC | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
|---|---|---|---|---|---|---|---|---|---|---|
| NHS | 73.8% | 51.8% | 67.1% | 25.9% | 47.4% | 46.7% | 47.2% | 46.6% | 58.3% | 46.2% |
| BAT | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| AMD | 0% | 0% | 0.4% | 15.6% | 37.4% | 36.9% | 37.3% | 36.9% | 23.2% | 29.3% |
| AREC | 2.7% | 5.3% | 3.1% | 6.7% | 1.6% | 1.7% | 1.6% | 1.7% | 3.0% | 3.2% |
| Banheiro Mot. | 0.3% | 0.5% | 0.4% | 0.5% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% |
| CTC Copasul | 0.3% | 0.8% | 0.4% | 0.7% | 0.3% | 0.3% | 0.3% | 0.3% | 0.4% | 0.4% |
| Dep. Irrigação | 0.6% | 1.1% | 0.8% | 1.0% | 0.7% | 0.8% | 0.7% | 0.8% | 1.0% | 0.4% |
| Entreposto | 5.9% | 10.7% | 7.3% | 21.0% | 0.6% | 0.6% | 0.6% | 0.7% | 0.8% | 3.1% |
| Esc. Deodápolis | 2.1% | 3.6% | 2.6% | 4.4% | 1.1% | 1.2% | 1.1% | 1.2% | 1.8% | 2.1% |
| Esc. N. Andradina | 1.2% | 3.0% | 1.6% | 2.9% | 1.2% | 1.3% | 1.3% | 1.4% | 1.4% | 1.8% |
| Esc. Reg. Deod. | 0.5% | 1.6% | 0.6% | 1.5% | 0.3% | 0.3% | 0.3% | 0.3% | 0.4% | 0.5% |
| Galpão AE | 0.6% | 0.4% | 0.6% | 0.4% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% |
| Irrigação CG | 0.4% | 1.1% | 0.6% | 1.0% | 0.4% | 0.4% | 0.4% | 0.4% | 0.5% | 0.4% |
| Lab. Solos | 2.3% | 4.8% | 1.5% | 2.7% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% |
| Posto Carreteiro | 5.6% | 9.9% | 8.2% | 10.2% | 5.2% | 5.3% | 5.2% | 5.4% | 4.5% | 7.0% |
| Refeitório Deod. | 0.1% | 0.2% | 0.1% | 0.2% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% | 0.3% |
| Subest. Fiação | 0.9% | 1.5% | 1.0% | 1.3% | 0.7% | 0.8% | 0.8% | 0.8% | 1.0% | 1.1% |
| TRR Maracaju | 2.6% | 3.7% | 3.7% | 4.0% | 2.1% | 2.4% | 2.2% | 2.5% | 2.7% | 3.1% |
| TOTAL | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% | ≈100% |

### BAT stranded bank handling

**BAT (Silos Batayporã) own situation:** BAT has its own solar generation that exceeds its own consumption in most months. This generates excess credits that have no destination (the "stranded" bank of 906,739 kWh).

**What the model does with BAT:**
1. BAT gets 0% CS3 rateio allocation in all periods (it doesn't need CS3 credits)
2. Each month, BAT's own surplus (own_gen − own_consumption, when positive) is redistributed 50%/50% to NHS and AMD
3. This redistribution is computed in Simulacao rows 13 (BAT→NHS) and 14 (BAT→AMD)
4. The opening stranded bank of 906,739 kWh is also available and depletes as harvests draw from it
5. Formula for BAT redistribution: `=MAX(BAT_own_gen - BAT_consumption, 0) * NHS_pct` (NHS_pct = B55 = 0.50)

**IMPORTANT CLARIFICATION (from Copasul email response):** The BAT redistribution is NOT part of the Helexia contract. It is an operational suggestion to Copasul — they can do this independently. The analysis includes it as a separate line item to show the incremental value of CS3 vs the BAT surplus. Copasul explicitly asked for this segregation.

**BAT own-generation:** Each month, BAT's own panels generate. In months where BAT_own_gen > BAT_consumption, surplus goes to NHS/AMD. In months where BAT_own_gen < BAT_consumption, BAT draws from its opening bank.

**The BAT formula bug (identified):** In the NHS/AMD bank computation, the BAT credit is currently added inside the MAX formula rather than applied to the bank separately. This causes phantom bank draws in months where own_gen already covers consumption. The App GD Analyzer computes it correctly; the Excel understates economy by ~R$297k in Y1–Y4 as a result.

---

## 4. Bank Mechanics

### 60-month credit validity rule (Lei 14.300/2022)

Credits accumulated in the bank expire after 60 months (5 years) from the month of generation. The model does not explicitly model expiry because the 5-year contract itself is 60 months — credits generated in month 1 expire exactly at contract end. For the 10-year model, credits generated in months 1–60 could technically expire before month 120. This was not modeled as an explicit expiry rule — it was treated as a conservative assumption that any residual bank at month 60 is the starting position for months 61–120.

### FA factor (TE_FP / TE_Ponta)

FA = 0.604267 (Premissas B8). This is the ratio of TE (energy tariff) fora ponta to TE ponta.

**Why it matters:** When a Grupo A UC has ponta consumption that exceeds its fora ponta credits, the credits can partially offset ponta consumption at the FA conversion rate. In practice, for NHS (A4V Verde), the credits offset FP consumption first, and any remaining ponta cost is reduced by converting excess FP credits at FA. The formula is: `=MIN((FP_cons - own_gen) * FA, PT_cost)` capped by available credit.

Simulacao row 13 computes this for NHS: `=MIN((D9-D12)*Premissas!$B$8, D11)`.

### Priority order for credit application

1. CS3 credits allocated to UC via rateio → offset FP consumption of that UC
2. UC's own generation → offsets own FP consumption first
3. Excess own generation → goes to bank
4. Bank drawn in harvest months to cover consumption in excess of CS3 credits + own gen
5. FA conversion allows partial ponta offset from accumulated FP credits

### Bank computation (SEM vs COM)

For each UC there are two parallel bank tracks:
- **SEM bank:** What would the bank look like without CS3? Only own generation and BAT redistribution. The SEM bank depletes during harvest and slowly rebuilds in off-season.
- **COM bank:** Same, but CS3 credits are added. COM bank grows larger (or depletes more slowly) than SEM bank.

**Banco atribuível Helexia** = COM bank − SEM bank (at end of contract). This is the incremental contribution of CS3, net of what Copasul would have had anyway from their own plants.

For NHS: `=BK31 - BK34` (COM bank end minus SEM bank end)
For AMD: `=BK49 - BK52`
For Grupo B: SEM bank = 0 (no own generation), so banco atribuível = banco COM total

### Opening banks

| UC | Opening bank (kWh) |
|---|---|
| NHS | 148,516 |
| AMD | 991,029 |
| BAT | 906,739 (stranded — not included in VALOR TOTAL) |
| All Grupo B | 0 |

The opening bank feeds into the first month's bank formula via a hardcoded cell (not formula). Subsequent months use the prior month's bank end as the opening.

---

## 5. SEM vs COM Scenario Construction

### SEM (without Helexia) baseline

- All 18 UCs pay their current energy costs from the distribuidora
- NHS and AMD pay full TUSD+TE from the rede in months where their own banks are depleted
- Grupo B pays: tarifa B3 × consumption, but discounted by PLIN competitor (~20% discount on B3 tariff). This discount is modeled via Premissas B19 toggle — when "Sim", Grupo B SEM cost uses the discounted tariff.
- NHS/AMD own solar generation still generates credits in SEM — they just don't get CS3 credits
- BAT redistribution is still modeled in SEM (conservative: Copasul can do this independently of Helexia)

### COM (with Helexia)

- CS3 credits allocated via rateio reduce rede cost for each UC
- PPA cost added = EI × R$0.4425/kWh (take-or-pay on all injected energy, regardless of credit utilization)
- ICMS isenção: in autoconsumo remoto mode, ICMS is waived on the compensated energy (CONFAZ 16/2015 / Convenção ICMS). This is modeled via B11 toggle. When active, the ICMS that would have been paid in SEM is not saved in COM (it wasn't paid in SEM either) — actually the isenção means Copasul's credits are worth more because they're ICMS-free. The model captures this via the ICMS_additional row (row 253) which adjusts for scenarios where the isenção might be lost.

### Monthly economia formula

```
Economia_month = SEM_cost - COM_rede_cost - PPA_cost - ICMS_additional
```

In Simulacao: `Row 252 = Row 249 - Row 251 - Row 253`
Where:
- Row 249 = SEM total cost (rede + distribuidora charges)
- Row 251 = Rede remanescente in COM (what Copasul still pays to the distribuidora)
- Row 253 = ICMS additional (adjustment if ICMS isenção is or isn't applied)

---

## 6. Economy Calculation

### Components

**SEM cost (row 249):** Sum of all UC costs without CS3. For Grupo A: `max(consumption - own_gen - bank_draw, 0) × T_AFP + ponta_component`. For Grupo B: `consumption × T_B3 × (1 - PLIN_discount)`.

**COM rede cost (row 251):** Same structure but with CS3 credits reducing consumption before applying tariff.

**PPA cost (row 7):** `=col6 × Premissas!$B$17` (monthly generation × R$0.4425/kWh)

**ICMS additional (row 253):** In ICMS isenção active mode (B11=Sim), this captures the regulatory risk — if the isenção were lost, Copasul would owe back ICMS. The model shows this as "Risco ICMS" in the output.

### VALOR TOTAL vs Economia Líquida

**Economia Líquida** = cumulative monthly economia = what Copasul saves on rede bills net of PPA payments.

**Banco residual** = all UC banks at end of contract × PPA price. This is the economic value of credits Copasul has accumulated but not yet consumed. It's real value — Copasul will continue using these credits after the contract ends.

**VALOR TOTAL HELEXIA** = Economia Líquida + Banco Atribuível @ PPA. Note: not ALL of the bank is attributable to Helexia. The model segregates:
- Banco Atribuível = COM bank − SEM bank (incremental from CS3)
- The opening banks and own-generation credits are NOT counted as Helexia's contribution
- Formula: `=B252 + B285` where B285 = banco atribuível total @ PPA

### No smoothing or PV treatment

All figures are nominal (not discounted). No NPV calculation. No IPCA escalation applied to the PPA or to the SEM tariff baseline in the current model — the SEM and COM tariffs are both assumed flat at the current ANEEL homologated rates (Res. Hom. 3.441, 08/04/2025). The annual tariff reajuste from Energisa MS will update T_AFP, T_B3, FA in B5/B7/B8.

---

## 7. Tariff Assumptions

**Source:** ANEEL Resolução Homologatória nº 3.441, de 8 de abril de 2025 (Energisa MS).

| Component | Value | Cell |
|---|---|---|
| T_AFP (A FP, com tributos) | R$0.526471/kWh | B5 |
| T_APT (A Ponta, com tributos) | R$2.97238/kWh | B6 |
| T_B3 (B3, com tributos) | R$1.15686/kWh | B7 |
| FA (TE_FP/TE_Ponta) | 0.604267 | B8 |
| T_AFP (sem tributos, base econômica) | R$0.399610/kWh | (derived) |
| T_B3 (sem tributos) | R$0.87810/kWh | (derived: TUSD R$0.59208 + TE R$0.28602) |
| ICMS | 17% | B9 |
| PIS + COFINS | 8.55% | B10 |

**Tariff groups in play:**
- NHS: A4 Verde (horo-sazonal verde, single demand, FA applies)
- AMD: A3A (A3a subgroup, Verde modalidade)
- BAT: A4 Verde (own generation, no CS3 allocation)
- Grupo B (15 UCs): B3 (bulk) and B1 (Refeitório Deodápolis)

**No IPCA escalation on tariffs in current model.** The model uses current tariffs as flat throughout. This is a known conservative assumption — tariffs should increase annually, which would make the SEM scenario more expensive and increase economia. When Copasul asked about reajuste assumptions, the answer is: the model does not apply explicit tariff growth; it uses the last homologated tariff as a proxy.

**Next tariff update:** The Energisa MS annual reajuste was expected in April 2026. Once published, T_AFP (B5), T_B3 (B7), T_APT (B6), and FA (B8) must be updated in Premissas.

---

## 8. PPA Rate

**Rate:** R$0.4425/kWh (Premissas B17). This is the take-or-pay rate on all energy injected by CS3.

**Escalation:** The contract structure is Locação + O&M. The O&M remuneration formula is `(EI × BC) − AM` where BC starts at R$0.450/kWh and is indexed to the annual tariff reajuste of Energisa MS. The Excel model does NOT apply escalation to the PPA over time — it uses R$0.4425 flat throughout. This is conservative (underestimates future PPA revenue for Helexia, underestimates economy for Copasul).

**70% vs 80% minimum generation guarantee:**
- The V10 model does not compute the performance guarantee formula
- The O&M contract uses 70% of projected annual generation as the minimum threshold
- Copasul's legal team flagged that 80% was presented commercially — this discrepancy needs resolution before signature
- The "Multa por Baixa Performance" formula: `15% × BC × (Geração Mínima Anual − Geração Anual Verificada)` if below threshold

---

## 9. 24m vs 60m Model Differences

### Structural

Both scenarios use the same Simulacao sheet. The 24m scenario reads columns D–AA (months 1–24). The 60m scenario reads D–BK (months 1–60). The Resumo sheet was originally structured around 24m analysis (section A) and 60m analysis (section B), hence separate KPI blocks.

The PPA confusion that Copasul flagged comes from this dual structure:

| Scenario | PPA total | Explanation |
|---|---|---|
| 24m | R$1.493M | 3,375 MWh × R$0.4425 |
| 60m | R$3.708M | 8,380 MWh × R$0.4425 |

These are NOT the same contract shown twice — they are two different scenario lengths. The proposal showed both without making this clear enough, causing confusion.

### Methodology

Identical methodology, same formulas, same rateio structure (P1–P4 for 24m, P1–P10 for 60m). The 60m model is not a "renegotiation" — it's the same terms extended. The rateio periods are more granular in 60m to allow optimization across more time segments.

---

## 10. Segregation Logic (Copasul's ask)

Copasul asked for explicit separation of three value components:

### Component 1: PLIN / existing bank contribution

The NHS opening bank (148,516 kWh) came from the PLIN competitor's prior GD allocation — confirmed by Copasul in their response email. The AMD opening bank (991,029 kWh) is from their own solar generation over time.

The SEM scenario models these opening banks correctly — they deplete during harvest even without Helexia. The economia attributable to these opening banks is already excluded from VALOR TOTAL because:
- VALOR TOTAL = Economia Líquida + Banco Atribuível (COM − SEM)
- The opening bank appears in BOTH SEM and COM calculations
- Its contribution cancels out in the COM − SEM difference

**However,** the proposal visually showed the full bank as part of the value proposition. Copasul is right to ask for a clear table showing: (a) what they already had (PLIN + own-gen), (b) what Helexia adds (CS3 credits incremental).

The Resumo sheet already has section E "Banco Atribuível Helexia" (rows 65–70) which does this computation. This needs to be surfaced more prominently in the proposal.

### Component 2: BAT surplus contribution

As explained in section 3, the BAT redistribution is NOT part of the Helexia contract. Its contribution needs to be shown as a separate line:

- BAT total surplus redistributed to NHS/AMD over contract period = (not explicitly totaled in current model — needs a new output row)
- Its economy impact = the reduction in NHS/AMD rede cost from BAT credits, in both SEM and COM scenarios (note: BAT redistribution is modeled in BOTH SEM and COM, so it doesn't contribute to economia per se — it's a constant in both scenarios)

Actually: BAT redistribution, as currently modeled, appears in BOTH SEM and COM as identical credits. Therefore it does NOT appear in economia (SEM − COM difference). It affects the level of both costs but not the difference. The only thing that changes between SEM and COM is the CS3 credits.

**What Copasul actually wants:** Show that the opening NHS bank (coming from PLIN) is separate from CS3. The model already does this via the banco atribuível concept. The proposal needs a clearer table.

### Component 3: CS3 pure contribution

This is `=Economia Líquida + Banco Atribuível Helexia @ PPA` — which is already VALOR TOTAL HELEXIA as computed. The issue is the proposal didn't clearly label it as such, and the opening bank / PLIN bank was mixed into the visual presentation.

**Fix for the proposal:** Add a three-line table:

| Source | Bank at contract end (kWh) | Value @ PPA |
|---|---|---|
| Opening banks (PLIN + own-gen SEM basis) | 70,231 kWh | R$31,077 |
| BAT surplus (operational suggestion, not Helexia contract) | modeled in both SEM/COM, ≈ neutral on economia | — |
| CS3 Cassilândia incremental | 826,931 kWh | R$365,917 |
| **Total COM banco** | **897,162 kWh** | **R$396,994** |

---

## 11. Known Model Issues / Fixes Applied

### Fix 1: VALOR TOTAL aggregation bug (V7 → V8)

**Problem:** Original model added the GROSS COM banco for NHS and AMD to the economia rather than the NET banco (COM minus SEM). This overstated VALOR TOTAL by approximately R$90k because it counted credits Copasul would have had anyway (own-gen SEM banco).

**Fix:** Changed VALOR TOTAL to use Banco Atribuível (`=B281+B282+B283` at PPA price) rather than gross COM banco for NHS/AMD. Grupo B banco is 100% attributable (they have no own generation).

### Fix 2: BAT formula (identified but not yet corrected in Excel)

**Problem:** NHS/AMD bank draw formula includes BAT credits inside the MAX() function, causing phantom draws. Formula: `MAX(FP_cons - own_gen - CS3 + BAT_credit, 0)` — when BAT_credit is positive and FP_cons < own_gen, the formula forces a bank draw that shouldn't occur.

**Impact:** Excel economy understated by ~R$297k in Y1–Y4. The App GD Analyzer correctly computes this. The V10 Excel file still has this bug.

**Fix needed:** Restructure the bank formula to: `draw = MAX(FP_cons - own_gen - CS3, 0)` then apply BAT credit to bank separately.

### Fix 3: P3 NHS percentage (V6 → V7)

**Problem:** V6 used the App GD Analyzer rateio (P3 NHS = 35.4%), which is suboptimal for 60m.

**Fix:** V7 adopted the V8 Solver result (P3 NHS = 67.1%), which adds ~R$509k economy over 60m. The tradeoff is slightly lower 24m VALOR (−R$93k).

### Version history

| Version | Key change |
|---|---|
| V7 | ICMS toggle added (B11). PLIN toggle added (B19). |
| V7 (with proposed rateio) | P3 NHS changed from 35.4% to 67.1% per V8 Solver |
| V8 | Solver run in Excel to optimize P1–P4 allocations |
| V10 (5yr proposed) | 10 periods (P1–P10). P1–P4 from V8 Solver, P5–P10 from Python SLSQP |
| V10 (10yr) | Extended to 120 months, 20 periods |
| V10 (App120m) | 10-year model using App GD Analyzer rateio (10 annual periods) |

### Open known issues

1. **BAT formula bug:** Not fixed in Excel. Fixed in App. Gap ~R$297k Y1–Y4.
2. **Growth rate divergence:** Excel uses 2.5%/yr consumption growth (B21). App's `growthRate=null` in JSON export cycles Y1/Y2 flat. This explains ~R$247k App advantage in Y5–Y8 and R$449k Excel deficit in Y10.
3. **Input_Consumo_GrupoA Jan–Mai not updated:** The Input sheet still has old annual averages for Jan–Mai. But since V10 was pasted as values-only in Simulacao, this doesn't affect the output — the Simulacao has the correct App consumption values baked in directly. The Input sheet is effectively dead in the values-only file.
4. **Blank fields in contracts:** Aluguel Mensal, potência SGE, CNPJ Copasul, Interveniente Anuente, Foro, Geração Projetada (Anexo I) all need filling.

---

## 12. Decisions We Debated and Chose

### Rateio optimization method

**Options considered:**
- (A) App GD Analyzer automatic optimization — easiest, gives reasonable result, easy to update
- (B) Excel Solver for P1–P4 + Python SLSQP for P5–P10 — more control, better result for 60m
- (C) Manual tuning — too slow for 10+ periods

**Chosen:** Option B for V8/V10 proposed. Generates R$509k more economy over 60m vs App rateio. Key difference is P3 allocation: V8 pushes NHS to 67.1% (vs App's 35.4%) to aggressively build the NHS bank for Y3–Y5 harvests.

### Whether to include BAT in VALOR TOTAL

**Options considered:**
- (A) Include BAT bank activation as part of Helexia value (higher headline number)
- (B) Exclude BAT from VALOR TOTAL, present as separate operational suggestion

**Decision in progress:** Initially included in proposal visually. After Copasul's email, clarified that BAT redistribution is NOT part of the Helexia contract. Recommendation: present it as a separate advisory item, not as part of VALOR TOTAL. This requires updating the proposal to have a three-way split table.

### 24m vs 60m as lead scenario

**Options:**
- (A) Lead with 24m (lower risk for Copasul, simpler)
- (B) Lead with 60m (higher total value, better unit economics)
- (C) Show both, lead with 60m

**Chosen:** Show both, lead with 60m economia but present 24m as the contractual baseline. The confusion arose because the proposal showed both numbers without clearly labeling which PPA total belonged to which scenario.

### Conservative assumptions accepted

- No IPCA on tariffs (flat current rates)
- No PPA escalation in Excel economy model (contracts are indexed but model is static)
- P50 generation (not P90, not actual)
- No present value / discounting

---

## Canonical Numbers (as of V10 proposed, Apr 2026)

### 24 months (Jun/26–Mai/28)

| KPI | Value |
|---|---|
| Geração injetada | 3,375 MWh |
| PPA pago à Helexia | R$1,492,200 |
| Economia líquida | R$436,480 |
| Banco total @ PPA | R$599,704 |
| VALOR TOTAL | R$865,824 |
| % redução custo | 21.6% |
| Payback | Mês 2 (Jul/26) |

### 60 months (Jun/26–Mai/31) — PROPOSED RATEIO

| KPI | Value |
|---|---|
| Geração injetada | 8,380 MWh |
| PPA pago à Helexia | R$3,708,346 |
| Rede remanescente COM | R$472,611 |
| Economia líquida | R$1,930,957 |
| Banco residual (kWh) | 897,163 kWh |
| Banco atribuível @ PPA | R$365,917 |
| VALOR TOTAL | R$2,296,874 |
| % redução custo | 31.6% |
| Economia média/mês | R$32,183/mês |

### 120 months (Jun/26–Mai/36) — V10_10anos

| KPI | Value |
|---|---|
| Economia líquida | R$3,755,684 |
| Banco Mai/36 | 2,606,570 kWh |
| VALOR TOTAL | R$4,909,091 |

### App GD Analyzer (120m, updated export)

| KPI | Value |
|---|---|
| Economia líquida | R$5,009,174 |
| Banco residual | 139,784 kWh |
| VALOR TOTAL | R$5,063,906 |

The R$502k gap between App and Excel (10yr) = BAT formula bug (~R$297k) + consumption growth divergence (~R$247k Y5-Y8 Excel > App, then −R$449k Y9-Y10 App > Excel). Net: App shows higher economia over full 10 years.
