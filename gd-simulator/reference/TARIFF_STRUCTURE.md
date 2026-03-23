# Tariff Structure Reference — Brazilian GD Market

## How Brazilian electricity tariffs work

Every UC pays: TE (Tarifa de Energia) + TUSD (Tarifa de Uso do Sistema de Distribuição)
+ taxes (ICMS state-level + PIS/COFINS federal)

The gross tariff formula:
T_all_in = T_sem_tributos / ((1 - PIS - COFINS) * (1 - ICMS))

Where T_sem_tributos = TUSD + TE (without taxes)

## Grupo B (low voltage, <2.3 kV)
Single tariff: one rate for all consumption (no ponta/fora-ponta split)
Subgroups: B1 (residential), B2 (rural), B3 (commercial/industrial), B4 (public lighting)

## Grupo A (high voltage)
Split into ponta (peak hours) and fora-ponta (off-peak)
Subgroups: A4 (<13.8 kV), A3a (13.8 kV), A3 (30 kV), A2 (88 kV), A1 (230 kV+)
Modalidades: Verde (one demand price) or Azul (separate demand FP and Ponta)

For GD compensation, what matters is the TE component for FA calculation,
and the all-in TUSD+TE for credit value calculation.

## Verified tariffs — Energisa MS (Res. ANEEL 3.441/2025)

| Parameter     | Sem tributos | Com tributos | Source              |
|---------------|-------------|-------------|---------------------|
| Grupo B TUSD  | R$ 0.59     | —           | Res. 3.441/2025     |
| Grupo B TE    | R$ 0.29     | —           | Res. 3.441/2025     |
| Grupo B total | R$ 0.8780   | R$ 1.1569   | Invoice verified ✓  |
| A FP TUSD+TE  | R$ 0.3996   | R$ 0.5265   | Invoice verified ✓  |
| A PT TUSD+TE  | R$ 2.2559   | R$ 2.9724   | Invoice verified ✓  |
| TE FP only    | R$ 0.27     | —           | Res. 3.441/2025     |
| TE PT only    | R$ 0.45     | —           | Res. 3.441/2025     |
| FA            | 0.6043      | —           | Invoice verified ✓  |
| ICMS          | 17%         | —           | RICMS/MS            |
| PIS           | 1.53%       | —           | Invoice verified ✓  |
| COFINS        | 7.03%       | —           | Invoice verified ✓  |

Note: sem-tributos values use back-calculated exact figures to produce
invoice-verified all-in tariffs. The published rounded values (0.59+0.29=0.88)
produce a 0.23% rounding difference.

## ICMS exemption — Lei 14.300/2022 + RICMS/MS Art. 23-A

Minigeração (>75 kW and ≤1 MW) qualifies for ICMS exemption on compensated
energy under SCEE. CS3 at 625 kWac qualifies formally.

Risk: SEFAZ/MS may challenge ownership structure (Helexia owns plant, not client).
This is a structural risk, not a capacity risk.

## Fator de Ajuste (FA)

FA = TE_FP / TE_Ponta (ratio of energy-only tariff components)
This is distributor-specific and changes with each tariff revision.
EMS: 0.27/0.45 = 0.60 (rounded) or 0.6043 (confirmed from invoice)
