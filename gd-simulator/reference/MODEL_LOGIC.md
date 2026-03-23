# GD Simulator — Model Logic Reference

## 1. Credit compensation mechanics (Lei 14.300/2022)

When a solar plant injects 1 kWh fora-ponta into the grid, Energisa MS
issues 1 credit kWh to the registered UC. That credit offsets:
- 1 kWh of fora-ponta consumption (1:1 ratio), OR
- FA kWh of ponta consumption (FA = TE_FP/TE_Ponta, e.g. 0.6043 for EMS)

Credits are applied in this priority order each month:
1. Offset fora-ponta consumption first
2. Convert remaining credits to ponta equivalent via FA, offset ponta consumption
3. Remaining credits go to the credit bank (valid 60 months)
4. If credits + bank are insufficient, the UC pays for residual consumption at
   the full distributor tariff

## 2. Rateio Fixo — 4 periods

Generation is split across UCs via fixed % allocations. In this model,
4 periods are used:
- P1: months 1–4 (Jun–Sep of year 1)
- P2: months 5–10 (Oct year 1 – Mar year 2)
- P3: months 11–16 (Apr–Sep year 2)
- P4: months 17–24 (Oct year 2 – May year 3)

For each period, allocations must sum to 1.0 (100%) across all UCs.
The BAT (stranded bank) UC always receives 0% allocation.

## 3. BAT stranded bank (T+1 lag)

If a BAT (stranded bank) UC exists:
- Its opening bank is redistributed to target UCs (e.g. NHS and AMD)
- Split defined by percentages (e.g. 50%/50%)
- Credits arrive at target UCs with a 1-month lag (month N BAT generates →
  target UCs receive in month N+1)
- In month 1, T+1 receives 0 BAT credits (no prior month)

## 4. SEM vs COM scenarios

SEM (without Helexia):
- No CS3 generation credits are allocated
- BAT rateio still activates (conservative baseline)
- NHS and AMD own generation still contributes
- Grupo B UCs pay full tariff every month
- Banks deplete over time for Grupo A UCs

COM (with Helexia):
- CS3 credits allocated per rateio
- All other flows identical to SEM

## 5. Economy calculation

Monthly economy = SEM_cost_month - COM_cost_month - ICMS_additional_month

Where:
- SEM_cost = sum across all UCs of their cost without CS3 credits
- COM_cost = rede_cost + PPA_cost (PPA = generation_kWh * ppa_rate)
- ICMS_additional = 0 if isenção applies; else sum of (credits_applied * ICMS_rate) per UC

## 6. VALOR TOTAL (corrected formula)

VALOR TOTAL = Economia Líquida + Banco Net Helexia @ PPA

Where:
Banco Net Helexia = Σ(bank_COM_all_UCs at month 24)
                  - Σ(bank_SEM_NHS + bank_SEM_AMD at month 24)
(Grupo B SEM banks are always 0, so they are fully attributable to Helexia)
This corrects the original Excel error of using gross COM banco.

## 7. ICMS risk formula

ICMS per kWh = T_all_in * ICMS_rate / (1 + ICMS_rate)

For EMS:
- Grupo B: R$ 1.1569 * 0.17 / 1.17 = R$ 0.1681/kWh
- Grupo A FP: R$ 0.5265 * 0.17 / 1.17 = R$ 0.0765/kWh
- Grupo A Ponta: R$ 2.9724 * 0.17 / 1.17 = R$ 0.4319/kWh

## 8. Competitor discount (Plin-type)

When a competitor offers a % discount on Grupo B tariff:
SEM_cost_B_month = consumption_kWh * T_B3 * (1 - competitor_discount_pct)

This reduces the apparent economy from Helexia (conservative baseline).
