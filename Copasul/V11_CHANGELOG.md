# CS3 Copasul · V11 Changelog

**Arquivo:** `CS3_Copasul_Modelo_V11_5anos.xlsx`
**Base:** V10 5-anos (60 meses, Jun/2026 – Mai/2031)
**Última atualização:** 2026-04-25 (sessões 23, 24, 25)

---

## Estado atual do modelo (2026-04-23, último update: escalação ativa)

### KPIs Resumo — Cenário atual: **B123=4.5% (PPA) / B124=6% (Distribuidora)**

| KPI | Baseline (0%/0%) | Cenário atual (4.5%/6%) | Δ |
|---|---:|---:|---:|
| ★ VALOR TOTAL (60m) | R$ 2.280.790 | **R$ 2.885.665** | +R$ 604.875 (+26.5%) |
| Economia líquida | R$ 1.851.043 | **R$ 2.373.184** | +R$ 522.141 (+28.2%) |
| Banco atribuível @ Y5 PPA | R$ 429.747 | **R$ 512.481** | +R$ 82.734 (+19.3%) |
| Custo SEM Helexia | R$ 6.436.997 | R$ 7.346.404 | +R$ 909.407 (+14.1%) |
| PPA pago Helexia | R$ 3.708.346 | R$ 4.055.813 | +R$ 347.467 (+9.4%) |
| Custo total COM | R$ 4.585.954 | R$ 4.973.220 | +R$ 387.266 (+8.4%) |
| % redução custo | 28,76% | **32,30%** | +3,54pp |
| Banco residual Mai/2031 (kWh) | 1.041.411 | 1.041.411 | — (kWh não escalado) |

### Para reverter à baseline: setar B123=0 e B124=0 em Premissas.

### Banco inicial (Premissas B26-B28)

| Célula | UC | Valor V11 | Fonte |
|---|---|---:|---|
| B26 | NHS — Silos Novo Horizonte | **786.669 kWh** | Demonstrativo 04/2026 UC 1.482.049.051-58 (Disponível end-Abr/26) |
| B27 | BAT — Silos Batayporã | **791.092 kWh** | Demonstrativo 03/2026 UC 1.111.942.051-90 (Disponível end-Mar/26) |
| B28 | AMD — Silos Amandina | **0 kWh** | Demonstrativo 04/2026 UC 175.267.051-44 (totalmente consumido pela safra Abr/26) |

Todos valores correspondem exatamente aos demonstrativos Energisa recebidos (NHS via cliente, BAT/AMD via arquivos 40/41). **Conservador** — sem projeção Mai-Jun/26, bank real em Jun/26 provavelmente será um pouco maior (own-gen durante low-season).

### Escalação anual (novo — Premissas B123/B124)

| Célula | Parâmetro | Valor atual |
|---|---|---:|
| B123 | PPA Helexia — Reajuste anual (%) | **4,50%** |
| B124 | Tarifa Distribuidora — Reajuste anual (%) | **6,00%** |

Composto anualmente a partir do aniversário Jun do contrato (Y2 = Jun/27, Y3 = Jun/28, …). Ao editar o valor em B123/B124, Excel recalcula automaticamente:
- **B123** escala PPA pago em row 7 + valoração terminal de banco residual (rows 255-285, Y5 PPA)
- **B124** escala tarifas A4 FP/Ponta (B5/B6) e tarifa B3 com/sem assinatura (B7/F19)

### ⚠️  CUIDADO: Excel para Mac — NÃO usar CalculateFullRebuild

`Application.CalculateFullRebuild` **remove os wrappers de escalação** (2.121 células) durante o save cycle. Usar sempre `Application.Calculate` para recalcular. Se as fórmulas perderem os wrappers, o script Python em `~/.claude/.../memory/feedback_excel_macos_recalc.md` tem o procedimento de reaplicação.

### Propriedade estrutural importante

O modelo é **simétrico em B27 (BAT) e B28 (AMD)** — seus valores iniciais se cancelam entre cenários SEM e COM Helexia. Mudanças em B27/B28 **não alteram VALOR TOTAL/economia/banco atribuível**. Apenas B26 (NHS) e os valores de tarifas/PPA/rateio afetam os outputs. Esta é uma feature desejada (BAT 50/50 é neutro à economia Helexia — responde à pergunta Weslen 2.3 por construção).

---

## Histórico de mudanças

### Sessão 2026-04-22 (inicial V11)

- V11 criado como cópia do V10
- Banco inicial B26 atualizado: 148.516 → 786.669 (demonstrativo NHS 04/2026)
- Bug: B27 e B28 atualizados para valores projetados (1.200.000 / 226.521) que não refletiam realidade Apr/26
- Labels A25 atualizados

### Sessão 2026-04-23 (correção + escalação + Weslen 2.2/2.4)

**1. Banco inicial corrigido aos demonstrativos**
- B26 NHS: 786.669 (mantido — já estava correto)
- B27 BAT: 1.200.000 → **791.092** (valor end-Mar/26, sem projeção)
- B28 AMD: 226.521 → **0** (demonstrativo Abr/26 confirma safra drenou todo o banco)
- A25 label atualizado: `D. BANCOS DE CRÉDITOS — SALDO INICIAL (NHS/AMD: demonstrativo Abr/2026 | BAT: demonstrativo Mar/2026 | Conservador: sem projeção Mai-Jun/2026)`

**2. Investigação estrutural**
- Confirmado: VALOR TOTAL é insensível a B27 e B28 (simetria SEM/COM)
- Implicação: correção do banco inicial é necessária para defensabilidade (matches Weslen's demonstrativos) mas não altera headline commercial
- Propriedade documentada em memory: `project_copasul_model_symmetry.md`

**3. Toggle de escalação anual adicionado**
- Nova seção Premissas I (rows 122-124): PPA reajuste + Distribuidora reajuste
- Refactor de 2.121 células de fórmula em Simulacao:
  - Row 7 (PPA monthly, cols D-BK): `*(1+B123)^year_exp`
  - Rows 35/36/53/54 (NHS/AMD SEM+COM): `*(1+B124)^year_exp` aplicado a B5 e B6
  - 15 rows B3 COM (row 67, 80, 93…): `*(1+B124)^year_exp` aplicado a B7
  - 15 rows B3 SEM (row 66, 79, 92…): `*(1+B124)^year_exp` aplicado a F19
  - Terminal: 21 células (C255-C273, B277, B285) usam `*(1+B123)^4` (Y5 PPA, Option B)
- Year exponent per column: Y1=0, Y2=1, Y3=2, Y4=3, Y5=4, determinado por `(col_idx-4)//12`
- Regressão confirmada: B123=0, B124=0 → VALOR TOTAL idêntico à baseline (R$ 2.280.789,51)

**4. Seção F — Segregação por origem (Weslen 2.2)**
- Resumo rows 84-97 — tabela dupla (kWh + R$ @ PPA) decompondo saldo Mai/2031 em:
  - Pré-existente (SEM Helexia): 70.232 kWh (NHS PLIN-legacy 32.298, AMD 37.933, Grupo B 0)
  - Helexia incremental (COM−SEM): 971.179 kWh (NHS 379.848, AMD 558.135, Grupo B 33.197)
  - Total Mai/2031: 1.041.411 kWh = R$ 460.824
- Valoração @ Y5 PPA consistente com terminal valuation (Option B)

**5. Seção G — Economia anual por UC + reconciliação (Weslen 2.4)**
- Resumo rows 100-126 — matriz 17 UCs × 5 anos + reconciliação completa:
  - Rows 104-120: economia de rede por UC por ano (soma dos 12 meses)
  - Row 121: TOTAL economia de rede R$ 5.620.895
  - Row 122: (−) PPA pago à Helexia por ano (R$ -3.708.346 total)
  - Row 123: (−) Ajuste ICMS (R$ 0 enquanto isenção ativa)
  - Row 124: ★ Economia Líquida por ano (reconcilia com E14 = R$ 1.851.043) ✓
  - Row 125: (+) Banco atribuível @ Y5 PPA (R$ 429.747, realizado só no end)
  - Row 126: ★ VALOR TOTAL Helexia por ano (reconcilia com E16 = R$ 2.280.790) ✓
- **Insight revelado**: Y1 economia líquida = **−R$ 290.108** (PPA > rede savings enquanto banco NHS grande está sendo drenado). Flip para positivo em Y2; maior contribuição em Y4-Y5. Narrativa para diretoria: período de investimento Y1 seguido de payoff Y3-Y5.

**6. Cleanup de labels stale**
- Simulacao A275: "24m" → "60m"
- Simulacao A276: "24m" → "60m"
- Premissas A54: já estava correto (50/50)

**7. Diagnóstico e correção do CalculateFullRebuild bug**
- Problema descoberto: `Application.CalculateFullRebuild` no Excel para Mac **remove os 2.121 wrappers de escalação** que openpyxl escreveu. Wrappers aparecem corretamente em disco após save do openpyxl, mas somem após Excel open + CalculateFullRebuild + save.
- Workaround confirmado: usar `Application.Calculate` (simples recalc) preserva os wrappers.
- Reaplicado escalação após descobrir o bug (2.121 células de novo).
- **Teste experimental**: com B123=4.5% e B124=6%, VALOR TOTAL sobe de R$ 2.280.790 → R$ 2.885.665 (+26.5%). Escalação funciona corretamente.
- Bug documentado em memory `feedback_excel_macos_recalc.md`.

### Sessão 2026-04-24 (análise de demanda + GD Analyzer demand fields)

**8. Análise das 36 faturas Energisa MS (Grupo A)**
- Faturas: NHS (Fev/25-Jan/26), AMD (Fev/25-Jan/26), BAT (Jan/25-Dez/25)
- Extraído: demanda contratada FP, demanda medida FP, ultrapassagem por mês
- CSV gerado: `Copasul/Demandas_Faturadas_GrupoA.csv` (36 linhas, separador `;`)
- **Padrão observado**: NHS+AMD têm 8/12 meses de ultrapassagem (sub-contratadas para 500 kW). BAT nunca ultrapassou 410 kW e está com 625 kW contratada (super-contratada).

**9. Otimizador de demanda contratada (REN 1000 Art. 154/155)**
- Tarifa demanda FP usada: R$ 34,69/kW/mês sem tributos (~ R$ 44,31/kW com tributos)
- Resultados (cenários ANEEL-compliant):
  - **NHS**: manter 500 kW e continuar pagando multa (subir DC custaria mais caro)
  - **AMD**: subir DC 500 → 753 kW via Art. 154 → +R$ 31k/ano
  - **BAT**: reduzir DC 625 → 188 kW via Art. 155 (90 dias) → +R$ 147k/ano
- **Total adicional defensável: +R$ 178k/ano** (≈ R$ 892k em 60 meses), independente da CS3
- Erro corrigido durante a análise: pensei que CS3 ajudaria peak-shaving — está errado, GD remoto compensa kWh mas NÃO compensa demanda (kW). NHS continua pagando multa mesmo com CS3 ativa.

**10. GD Analyzer — atualização do projeto demo Copasul**
- `gd-simulator/reference/SAMPLE_DATA.json` atualizado para refletir realidade Copasul:
  - Bancos iniciais: NHS 786.669 / BAT 791.092 / AMD 0 (do demonstrativo)
  - `batBank.openingKWh`: 791.092 (alinhado com BAT)
  - `demandaContratadaFP`: NHS 500 kW, AMD 500 kW, BAT 625 kW
  - `demandaMedidaMensal`: 12 meses calendário Jan-Dez para cada UC
  - `tariffs.A_FP_DEMANDA: 34.69` (demanda Energisa MS)
- Pushed para origin/master + deployed em GitHub Pages (gh-pages)

**11. GD Analyzer — fix bundle ANEEL tariffs**
- `scripts/build-tariffs.ts` reescrito: agora fetch direto da API ANEEL, parseia kW (demanda)
- Bundle `aneel-tariffs.json` regenerado: 37 concessionárias com `A_FP_DEMANDA` (antes 0)
- Botão "Atualizar tarifas ANEEL" agora reaplica também à distribuidora atual (não só atualiza dropdown)
- Deployed em commits 574bc33, d42e96b, afdec96

### Sessão 2026-04-25 (status review + prep para segunda)

**12. Resumo executivo + plano de segunda 2026-04-27** (ver final do documento)

---

## Mapeamento às 5 perguntas de Weslen (email 2026-04-22)

| # | Pergunta | Status | Ação restante |
|---|---|---|---|
| 2.1 | PPA R$ 1,493M vs R$ 3,708M divergência | ✅ **não é erro de modelo** | Correção só na apresentação: rotular claramente 24m vs 60m em cada R$ mostrado |
| 2.2 | Segregar banco PLIN legado vs Helexia incremental | ✅ **FEITO** | Seção F no Resumo (rows 84-97). Decomposição kWh + R$ @ PPA para NHS/AMD/Grupo B |
| 2.3 | Segregar rateio BAT 50/50 vs rateio CS3 | ✅ **correto por construção** | BAT é simétrico SEM/COM → contribui R$ 0 à economia Helexia. Precisa apenas nota explicativa na apresentação |
| 2.4 | Agrupamento anual da economia por UC (17 UCs × 5 anos) | ✅ **FEITO** | Seção G no Resumo (rows 100-126). Matriz 17 UCs × 5 anos + reconciliação PPA/ICMS → Economia Líquida → VALOR TOTAL |
| 2.5 | Tarifas novas Energisa MS + premissa de reajuste PPA explícita | ⚠️ **estrutura pronta, valores pendentes** | Escalação toggle **implementado** (B123/B124). Falta: (a) decidir taxa PPA, (b) decidir taxa distribuidora, (c) possivelmente atualizar base tarifária B5/B6/B7 |

---

## Pendências (ordem recomendada)

### ✅ Feito nesta sessão

1. ~~Lift segregação → Resumo (2.2)~~ — **FEITO** em rows 84-97 (seção F)
2. ~~Matriz anual economia por UC (2.4)~~ — **FEITO** em rows 100-126 (seção G) com reconciliação
3. ~~Cleanup de labels stale~~ — **FEITO** (Sim A275/A276; Premissas A54 já estava correto)
4. ~~Estrutura de escalação anual~~ — **FEITO** (Premissas B123/B124 + 2.121 wrappers Simulacao)

### Dependente de decisão Louis (aberto)

5. **Confirmar taxas de escalação**. Cenário atual salvo: **4.5% PPA / 6% Distribuidora**. VALOR TOTAL resultante: R$ 2.885.665.
   - Manter 4.5% / 6% (conservador, IPCA + média histórica) ✅ atual
   - Reverter a 0% / 0% (baseline estática, sem modelar escalação)
   - Agressivo: 4.5% / 12.39% (ANEEL 22/04/26 flat-forward)
   - Qualquer outra combinação

6. **Base tarifária pré-escalação**. V11 ainda usa valores do ciclo ANEEL 2024 (REH 3.316).
   - V11 B5/B6/B7 reflectem ciclo 2024
   - Reajuste 2025 (REH 3.440/3.441) não aplicado à base
   - Reajuste 2026 (+12,39%/+11,98% aprovado 22/04/26) não aplicado à base
   - **Decisão pendente**: atualizar B5/B6/B7 à tarifa vigente 04/2026, ou manter ciclo 2024 e usar a escalação para cobrir a diferença?

### Não pedido por Weslen, mas defensivo

7. **Premissa PLIN na apresentação**. Estado atual: modelo assume PLIN=0 durante contrato Helexia. Se Copasul quer validação adicional, adicionar frase explícita: *"Premissa: contrato PLIN encerrado em Jun/2026, saldo remanescente tratado como banco pré-existente (não atribuível à Helexia)."* Responde Weslen 2.2 com narrativa limpa.

---

## Perguntas abertas (para Louis ou Weslen)

1. **[Louis]** Confirmar taxas de escalação: manter 4.5% / 6% ou ajustar?
2. **[Louis]** Atualizar base tarifária para valores Abr/2026 antes de aplicar escalação, ou manter base 2024?
3. **[Weslen, opcional]** Confirmar premissa de encerramento PLIN em Jun/2026 (para deixar explícito na proposta revisada).

---

## V12 scope (futuro, não bloqueia proposta revisada)

1. Fix bug fórmula BAT (subestima economia Y1-Y4 em ~R$297k per HTML PLIN analysis)
2. Re-otimização rateio com novos saldos iniciais (NHS saturado, AMD drenado — P1-P4 possivelmente subótimos)
3. Modelar Fio B Lei 14.300 (CS3 sujeita a 30% desconto 2026, 75% 2029)
4. Cenário com PLIN contínuo (apenas se Copasul pedir)
5. Atualizar demonstrativos se Weslen enviar dados mais recentes

---

## Plano para segunda-feira 2026-04-27

### Ações pendentes (decisões + envio)

1. **Decidir taxas de escalação** (Premissas B123/B124)
   - Atual: 4.5% PPA / 6% Distribuidora → VALOR TOTAL R$ 2.885.665
   - Alternativa agressiva: 4.5% PPA / 12.39% Distribuidora (matching ANEEL 22/04/26) — usar se diretoria quer números mais robustos
   - Reverter a 0%/0% se decidir não modelar escalação na proposta

2. **Decidir base tarifária** (Premissas B5/B6/B7)
   - Atual: ciclo ANEEL 2024 (REH 3.316)
   - Opção A (simples): manter 2024 + escalação compensa
   - Opção B (limpo): atualizar para Abril/2026 (REH com +12,39% A / +11,98% B) e zerar escalação Y1

3. **Reply email Weslen** (assunto: revisão da proposta CS3 60m, 22/04/26)
   - 2.1: PPA R$ 1,493M vs R$ 3,708M → não é bug, rotular 24m/60m
   - 2.2: segregação PLIN vs Helexia → ver Resumo seção F
   - 2.3: BAT 50/50 separado da CS3 → simétrico SEM/COM, contribui R$ 0 a economia Helexia
   - 2.4: matriz anual por UC → ver Resumo seção G
   - 2.5: tarifas + escalação PPA → premissas explícitas (PPA X%/ano + tarifa Y%/ano com aniversário Jun)
   - **Bonus pitch**: oportunidade adicional de **+R$ 178k/ano** via otimização de demanda Art. 154/155 REN 1000 (AMD subir DC, BAT reduzir DC) — independente da CS3

4. **Pergunta defensiva a Weslen** (opcional mas recomendado): confirmar premissa de encerramento do contrato Plin Energia em Jun/2026, com saldo remanescente NHS tratado como banco pré-existente.

### Prompt sugerido para iniciar a sessão de segunda

```
Boa tarde, vamos retomar o Copasul. Lê o V11_CHANGELOG.md
em /Users/louisdemoffarts/Desktop/Helexia/GD-analyzer/Copasul/
para te atualizar do estado.

Hoje quero:
1. [escolher: 4.5%/6% atual | 4.5%/12.39% agressivo | 0/0 sem escalação]
2. [escolher: manter base tarifária 2024 | atualizar para Abril/2026]
3. Preparar a resposta ao email do Weslen (5 pontos do email 22/04/26)

Pode começar?
```

Se quiser ir direto para o email sem revisitar o modelo, basta dizer:
*"Vamos manter 4.5%/6% e base tarifária 2024. Escreve a resposta ao Weslen com os 5 pontos abordados + o pitch de demanda."*

---

## Arquivos relacionados

- `copasul_model_context.md` — handover doc completo da arquitetura do modelo
- `Copasul_NHS_Analise_Plin_vs_CS3.html` — análise comparativa PLIN vs CS3 para NHS (apoio à conversa)
- `Faturas_NHS_e_Plin/` — evidências originais (11 demonstrativos NHS + demos BAT/AMD)
- `~/Downloads/demonstrativo_compensacao (40).pdf` — AMD Ref 04/2026
- `~/Downloads/demonstrativo_compensacao (41).pdf` — BAT Ref 03/2026
