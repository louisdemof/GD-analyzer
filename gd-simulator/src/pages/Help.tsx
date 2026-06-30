import { useNavigate } from 'react-router-dom';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-lg font-semibold text-slate-800 mb-2">{title}</h2>
      <div className="text-sm text-slate-600 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

const GLOSSARY: [string, string][] = [
  ['TUSD', 'Tarifa de Uso do Sistema de Distribuição — o "fio" (rede). Cobrada por kWh e por kW de demanda.'],
  ['TE', 'Tarifa de Energia — a energia em si (R$/kWh).'],
  ['Fora Ponta (FP) / Ponta (PT)', 'Postos horários. Ponta = horário de pico (tarifa mais cara, ~3h/dia úteis).'],
  ['Demanda contratada', 'Potência (kW) contratada com a distribuidora, faturada todo mês (Grupo A).'],
  ['Grupo A / Grupo B', 'A = alta/média tensão (tem demanda, ponta/fora-ponta). B = baixa tensão (consumo único).'],
  ['Verde / Azul', 'Modalidades tarifárias do Grupo A. Verde = demanda única. Azul = demanda ponta + fora-ponta.'],
  ['SCEE', 'Sistema de Compensação de Energia Elétrica — a GD gera créditos que abatem o consumo.'],
  ['Cativo / ACL', 'Cativo = mercado regulado (tarifa da distribuidora). ACL = Mercado Livre (energia comprada de um fornecedor).'],
  ['Energia incentivada (I50/I80/I100)', 'Fontes renováveis dão 50/80/100% de desconto na TUSD (Lei 9.427/96 art.26).'],
  ['SEM / COM', 'SEM Helexia = custo atual do cliente. COM Helexia = custo com a GD/PPA. Economia = SEM − COM.'],
  ['PPA', 'Power Purchase Agreement — preço R$/kWh que o cliente paga à Helexia pela energia gerada.'],
  ['Banco de créditos', 'Créditos de geração excedente, válidos por 60 meses (Lei 14.300).'],
  ['Rateio', 'Como a geração de uma usina é distribuída entre várias UCs.'],
];

export function Help() {
  const navigate = useNavigate();
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-800">Como funciona o GD Analyzer</h1>
        <button onClick={() => navigate('/')} className="text-sm text-teal-600 hover:underline">← Dashboard</button>
      </div>
      <p className="text-sm text-slate-500 mb-6">Simulador de Geração Distribuída — calcula a economia de um projeto solar/GD para um cliente, no mercado cativo ou livre (ACL).</p>

      <Section title="1. Visão geral">
        <p>O GD Analyzer compara o que o cliente paga hoje (<strong>SEM</strong> a Helexia) com o que pagaria adotando a geração distribuída (<strong>COM</strong> a Helexia) — e mostra a <strong>economia</strong>, o payback e o banco de créditos ao longo do contrato.</p>
      </Section>

      <Section title="2. Criar um projeto">
        <p><strong>Importar faturas (recomendado):</strong> em <em>Novo Projeto</em>, arraste os PDFs das faturas. O app detecta a distribuidora e preenche automaticamente distribuidora, tarifas, UCs, consumo e demanda (12 meses de histórico).</p>
        <p>Distribuidoras suportadas: <strong>Energisa MS, COPEL, CEMIG, Equatorial (PA/PI/MA/GO/AL), Light, Enel (RJ/CE/SP), EDP SP</strong>. Faturas COPEL/Enel pedem senha (código no nome do arquivo, ou informada).</p>
        <p>Ao importar, cada fatura mostra ✓ (ok) ou ⚠ (verifique os valores). Você também pode criar tudo manualmente.</p>
      </Section>

      <Section title="3. Mercado: Cativo vs Livre (ACL)">
        <p><strong>Cativo</strong> → o baseline usa a tarifa regulada (TUSD+TE).</p>
        <p><strong>Mercado Livre (ACL)</strong> → o baseline usa energia comprada de um fornecedor (TE, R$/MWh) + TUSD com desconto de <strong>fonte incentivada</strong>. Selecione o nível (I50/I80/I100) e o app deriva os descontos por UC: no <em>Verde</em>, fora-ponta 0%, ponta = nível×(1−TUSD_FP/TUSD_PT), demanda = nível (regra ANEEL/Lei 9.427).</p>
      </Section>

      <Section title="4. Usina e PPA">
        <p>Defina a usina (perfil de geração P50, capacidade), o <strong>PPA</strong> (R$/kWh que o cliente paga à Helexia) e o prazo. Várias usinas podem alimentar o mesmo projeto, cada uma com seu prazo e data de entrada em operação.</p>
      </Section>

      <Section title="5. Resultados">
        <p><strong>Resumo:</strong> economia líquida (R$ e %), custo SEM vs COM, payback. <strong>Mensal:</strong> evolução mês a mês. <strong>Banco de créditos:</strong> acúmulo e consumo dos créditos por UC. <strong>Rateio:</strong> distribuição da geração — use <em>Otimizar Rateio</em> para maximizar a economia. <strong>Sensibilidades:</strong> cenários de geração/tarifa.</p>
        <p>Compare cenários lado a lado em <strong>⚖ Comparar</strong>, e exporte a proposta em PDF/Excel.</p>
      </Section>

      <Section title="6. Tarifas ANEEL">
        <p>As tarifas vêm da base aberta da ANEEL. Em <em>Distribuidora &amp; Tarifas</em>, use <strong>Atualizar tarifas ANEEL</strong> para puxar a vigência mais recente.</p>
      </Section>

      <Section title="7. Colaboração">
        <p>Projetos são privados por padrão. Em <strong>Compartilhar</strong>, conceda acesso por e-mail com papéis: <strong>Admin</strong> (co-proprietário), <strong>Editor</strong> (edita), <strong>Leitor</strong> (só leitura). Projetos excluídos vão para a <strong>Lixeira</strong> (restauráveis). O <strong>Histórico</strong> registra quem fez o quê.</p>
      </Section>

      <Section title="Glossário">
        <dl className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} className="px-3 py-2">
              <dt className="font-medium text-slate-700">{term}</dt>
              <dd className="text-xs text-slate-500">{def}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
