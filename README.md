# Meu Financeiro — Assistente Financeiro Pessoal

Aplicação web em React e Vite com sincronização de dados e autenticação pelo Supabase.

## Configuração do Supabase

1. Crie um projeto Supabase (o plano gratuito atende ao uso do app).
2. No SQL Editor do projeto, execute [`supabase/schema.sql`](supabase/schema.sql). O script cria `transactions`, `budgets` e `accounts`, ativa RLS e configura broadcasts privados por usuário.
3. Em **Project Settings → API**, copie a URL do projeto e a chave pública `anon`/`publishable`.
4. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
5. No painel de autenticação, habilite e-mail/senha. O login Google é opcional e precisa ser habilitado em **Authentication → Providers → Google**, com as URLs de callback indicadas pelo Supabase.
6. Reinicie o servidor Vite após alterar `.env`.

Se o projeto Supabase já estava configurado antes do recurso de divisão de contas, execute os arquivos de migração necessários em `supabase/migrations/` no SQL Editor para atualizar as funções de convite sem apagar os dados existentes.

Use apenas a chave pública `anon`/`publishable` no navegador. Nunca coloque a chave `service_role` em variáveis `VITE_` ou no código cliente. Para publicar o app, configure as duas variáveis `VITE_SUPABASE_*` também no serviço de hospedagem.

## Executar

Requer Node.js 18 ou superior.

```bash
npm install
npm run dev
```

Para gerar e servir a versão de produção:

```bash
npm run build
npm run preview
```

## Dados e sincronização

- Cada conta acessa apenas os próprios registros por políticas RLS.
- Transações, orçamentos mensais e contas são armazenados nas tabelas Supabase e sincronizados em tempo real entre dispositivos.
- Ao entrar em uma conta nova no navegador que ainda tenha dados antigos, o app pergunta se deseja importar esse backup local para a nuvem.
- CSV e JSON continuam disponíveis para download manual. A preferência de tema permanece no armazenamento local do navegador.
- O tema, parcelas, meta diária, alertas e gráficos são preservados.

## Funcionalidades

- Login e cadastro por e-mail e senha, com opção Google se habilitada no projeto.
- Quatro instituições pré-configuradas e possibilidade de adicionar outras.
- Orçamento mensal, dia de fechamento, alerta diário, saldo inicial e limite por cartão.
- Registro manual ou por texto, incluindo compras parceladas em até 24 vezes.
- Meta diária dinâmica, histórico por mês, instituições, filtros e gráficos.
- Edição, exclusão de parcelas, exportação CSV e backup/restauração JSON.

O registro por texto é baseado em regras simples em português; revise os campos quando a descrição for ambígua. Não há conexão direta com bancos ou leitura automática de faturas.
