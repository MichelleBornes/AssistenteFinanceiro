# Meu Financeiro

Assistente financeiro pessoal para registrar despesas, acompanhar o orçamento e organizar contas compartilhadas. O dashboard reúne os gastos do mês, o valor disponível por dia, os saldos por instituição e os compromissos futuros.

## O que o projeto oferece

- Cadastro de gastos por formulário ou registro rápido por texto.
- Seleção da instituição e do método de pagamento, com compras parceladas em até 24 vezes.
- Distribuição automática das parcelas pelos meses seguintes e acompanhamento do valor comprometido.
- Orçamento mensal e cálculo de quanto pode ser gasto por dia, considerando os saldos cadastrados e as despesas do período.
- Resumos, gráficos, filtros e navegação entre meses.
- Convites para conectar outra pessoa, dividir despesas e acompanhar acertos entre usuários.
- Separação entre gastos pessoais e compartilhados.
- Autenticação por e-mail e senha, armazenamento em nuvem e sincronização entre dispositivos.
- Exportação de transações em CSV e backup em JSON, com opção de restauração.
- Temas claro e escuro e interface adaptável a celular, tablet e desktop.

As instituições pré-cadastradas são Nubank, Santander, PicPay e Banco do Brasil. Os saldos e limites são informados pela pessoa usuária; o sistema não acessa contas bancárias nem importa faturas automaticamente.

## Tecnologias

React, Vite, Supabase (autenticação, banco de dados, políticas RLS e sincronização em tempo real), Recharts, Tailwind CSS e Lucide.
