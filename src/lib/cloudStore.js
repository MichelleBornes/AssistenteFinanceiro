import { supabase } from './supabase'

const BANKS = [
  { id:'nubank', name:'Nubank', color:'#820AD1', secondary:'#820AD1', accountLabel:'Conta/Pix' },
  { id:'santander', name:'Santander', color:'#EC0000', secondary:'#EC0000', accountLabel:'Conta/Pix' },
  { id:'picpay', name:'PicPay', color:'#11C76F', secondary:'#11C76F', accountLabel:'Carteira/Pix' },
  { id:'bb', name:'Banco do Brasil', color:'#0038A8', secondary:'#F8D117', accountLabel:'Conta/Pix' }
]
const LEGACY_DEMO_EXAMPLES = [
  ['Almoço executivo',42,'Alimentação','nubank','debit'],
  ['Mercado da semana',186.4,'Compras','picpay','debit'],
  ['Uber',23.9,'Transporte','santander','credit'],
  ['Farmácia',57.8,'Saúde','bb','debit'],
  ['Streaming',39.9,'Lazer','nubank','credit'],
  ['Conta de internet',109.9,'Contas','santander','debit'],
  ['Jantar',78,'Alimentação','picpay','credit'],
  ['Tênis',219.9,'Compras','bb','credit'],
  ['Ônibus e metrô',24,'Transporte','nubank','debit'],
  ['Cinema',64,'Lazer','santander','credit'],
  ['Mercado',132.5,'Compras','picpay','debit'],
  ['Consulta',160,'Saúde','bb','credit']
]
const currentMonth = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function emptyFinanceData() {
  return {
    version: 1,
    settings: { monthlyBudget: 3200, cycleDay: 1, dailySafetyThreshold: 40 },
    monthBudgets: {},
    banks: BANKS.map(bank => ({ ...bank, accountBalance: 0, creditLimit: 0 })),
    transactions: []
  }
}

export async function loadFinanceData(userId) {
  const [transactionsResult, budgetsResult, accountsResult] = await Promise.all([
    supabase.from('transactions').select('*').or(`user_id.eq.${userId},shared_with_user_id.eq.${userId}`),
    supabase.from('budgets').select('*').eq('user_id', userId),
    supabase.from('accounts').select('*').eq('user_id', userId)
  ])
  for (const result of [transactionsResult, budgetsResult, accountsResult]) {
    if (result.error) throw result.error
  }

  const budgets = budgetsResult.data || []
  const preferredBudget = budgets.find(row => row.month === currentMonth()) || budgets[0]
  const monthBudgets = Object.fromEntries(budgets.map(row => [row.month, Number(row.monthly_budget)]))
  const remoteAccounts = accountsResult.data || []
  const accountById = new Map(remoteAccounts.map(row => [row.id, row]))
  const banks = [
    ...BANKS.map(bank => {
      const row = accountById.get(bank.id)
      return { ...bank, ...(row ? {
        name: row.name,
        accountLabel: row.account_label || bank.accountLabel,
        accountBalance: Number(row.account_balance || 0),
        creditLimit: Number(row.credit_limit || 0)
      } : { accountBalance: 0, creditLimit: 0 }) }
    }),
    ...remoteAccounts.filter(row => !BANKS.some(bank => bank.id === row.id)).map(row => ({
      id: row.id, name: row.name, color: row.color || '#9CA3AF', secondary: row.secondary_color || row.color || '#9CA3AF',
      accountLabel: row.account_label || 'Conta/Pix', accountBalance: Number(row.account_balance || 0), creditLimit: Number(row.credit_limit || 0)
    }))
  ]

  return {
    version: 1,
    settings: {
      monthlyBudget: Number(preferredBudget?.monthly_budget ?? 3200),
      cycleDay: Number(preferredBudget?.closing_day ?? 1),
      dailySafetyThreshold: Number(preferredBudget?.daily_safety_threshold ?? 40)
    },
    monthBudgets,
    banks,
    hasCloudData: Boolean((transactionsResult.data || []).length || budgets.length || remoteAccounts.length),
    transactions: (transactionsResult.data || []).map(row => {
      const payerId=row.payer_id||row.user_id
      const isPayer=payerId===userId
      const payerShare=Number(row.payer_share??row.amount)
      const sharedShare=Number(row.shared_share||0)
      return {
        ...row,
        date: String(row.date).slice(0, 10),
        amount: isPayer?payerShare:sharedShare,
        transactionTotal: Number(row.amount),
        payerShare,
        sharedShare,
        payerId,
        sharedWithUserId: row.shared_with_user_id||undefined,
        isPayer,
        isShared: Boolean(row.shared_with_user_id),
        isSettled: Boolean(row.settled_at),
        settledAt: row.settled_at||undefined,
        settledBy: row.settled_by||undefined,
        installmentTotal: row.installment_total == null ? undefined : Number(row.installment_total),
        installmentNumber: row.installment_number ?? undefined,
        installmentCount: row.installment_count ?? undefined,
        installmentGroup: row.installment_group_id ?? undefined,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
      }
    })
  }
}

function demoSignature(row) {
  return [String(row.date).slice(0,10),row.description,Math.round(Number(row.amount)*100),row.category,row.bank,row.method].join('|')
}

function legacyDemoSignatures(anchorMonth) {
  const [anchorYear,anchorMonthNumber]=anchorMonth.split('-').map(Number)
  const signatures=[]
  for(let offset=0;offset<3;offset++){
    const first=new Date(Date.UTC(anchorYear,anchorMonthNumber-1-offset,1))
    const year=first.getUTCFullYear(),month=first.getUTCMonth()
    const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate()
    for(const [index,[description,baseAmount,category,bank,method]] of LEGACY_DEMO_EXAMPLES.entries()){
      const day=Math.min(Math.max(2,27-index*2),lastDay)
      const date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      signatures.push([date,description,Math.round((baseAmount+offset*3.2)*100),category,bank,method].join('|'))
    }
  }
  return signatures
}

export async function removeLegacyDemoBatch(userId, data) {
  const oldDemoBalances={nubank:1850,santander:920,picpay:640,bb:2300}
  const hasUntouchedDemoBalances=Object.entries(oldDemoBalances).every(([id,balance])=>
    Number(data.banks.find(bank=>bank.id===id)?.accountBalance||0)===balance
  )
  if(hasUntouchedDemoBalances){
    const updates=Object.keys(oldDemoBalances).map(id=>supabase.from('accounts').update({account_balance:0}).eq('user_id',userId).eq('id',id))
    const results=await Promise.all(updates)
    const updateError=results.find(result=>result.error)?.error
    if(updateError)throw updateError
    data=await loadFinanceData(userId)
  }
  const transactions=data.transactions||[]
  if(transactions.length<30)return {data,removed:0,balancesReset:hasUntouchedDemoBalances}
  const anchors=[...new Set(transactions.map(row=>String(row.date).slice(0,7)))]
  const ordered=transactions.map(row=>({...row,_time:new Date(row.created_at||row.createdAt||0).getTime()}))
    .filter(row=>Number.isFinite(row._time)).sort((a,b)=>a._time-b._time)
  let best=[]
  for(const anchor of anchors){
    const expected=new Set(legacyDemoSignatures(anchor))
    for(let startIndex=0;startIndex<ordered.length;startIndex++){
      const start=ordered[startIndex]
      const window=[]
      for(let index=startIndex;index<ordered.length&&ordered[index]._time<=start._time+15000;index++)window.push(ordered[index])
      const matches=[]
      const unmatched=new Set(expected)
      for(const row of window){
        const signature=demoSignature(row)
        if(unmatched.delete(signature))matches.push(row)
      }
      if(matches.length>best.length)best=matches
      if(best.length===36)break
    }
    if(best.length===36)break
  }
  // Exigir pelo menos 30 das 36 linhas e o mesmo lote de criação evita confundir
  // gastos reais isolados com os registros gerados pela antiga demonstração.
  if(best.length<30)return {data,removed:0}
  const ids=best.map(row=>String(row.id))
  const {error}=await supabase.from('transactions').delete().eq('user_id',userId).in('id',ids)
  if(error)throw error
  return {data:await loadFinanceData(userId),removed:ids.length,balancesReset:hasUntouchedDemoBalances}
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function budgetRows(data, userId) {
  const months = new Set(Object.keys(data.monthBudgets || {}))
  const thisMonth = currentMonth()
  months.add(thisMonth)
  return [...months].map(month => ({
    user_id: userId,
    month,
    monthly_budget: Number(data.monthBudgets?.[month] ?? data.settings.monthlyBudget ?? 3200),
    closing_day: Number(data.settings.cycleDay ?? 1),
    daily_safety_threshold: Number(data.settings.dailySafetyThreshold ?? 40)
  }))
}

function transactionRow(item, userId) {
  const transactionTotal=Number(item.transactionTotal??item.amount)
  const payerShare=Number(item.payerShare??transactionTotal)
  const sharedShare=Number(item.sharedShare??Math.max(0,transactionTotal-payerShare))
  return {
    id: String(item.id), user_id: item.payerId||userId, payer_id: item.payerId||userId,
    shared_with_user_id: item.sharedWithUserId||null,
    payer_share: payerShare, shared_share: sharedShare,
    settled_at: item.settledAt||null, settled_by: item.settledBy||null,
    date: item.date, description: item.description,
    amount: transactionTotal, category: item.category || 'Outros', bank: item.bank || 'nubank',
    method: item.method || 'debit', installment_group_id: item.installmentGroup || null,
    installment_number: item.installmentNumber ?? null, installment_count: item.installmentCount ?? null,
    installment_total: item.installmentTotal ?? null, created_at: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString()
  }
}

export async function fetchUserLinks() {
  const {data,error}=await supabase.rpc('list_user_links')
  if(error)throw error
  return data||[]
}

export async function requestUserLink(email) {
  const {data,error}=await supabase.rpc('request_user_link',{target_email:email.trim()})
  if(error)throw error
  return data?.[0]
}

export async function acceptUserLink(code) {
  const {error}=await supabase.rpc('accept_user_link',{code:code.trim()})
  if(error)throw error
}

function accountRow(item, userId) {
  return {
    id: String(item.id), user_id: userId, name: item.name, account_label: item.accountLabel || 'Conta/Pix',
    account_balance: Number(item.accountBalance || 0), credit_limit: Number(item.creditLimit || 0),
    color: item.color || '#9CA3AF', secondary_color: item.secondary || item.color || '#9CA3AF'
  }
}

export async function syncFinanceData(userId, before, after) {
  const oldTransactions = new Map((before?.transactions || []).map(item => [String(item.id), item]))
  const newTransactions = new Map((after.transactions || []).map(item => [String(item.id), item]))
  const changedTransactions = [...newTransactions.values()].filter(item => !same(item, oldTransactions.get(String(item.id))))
  const removedTransactionIds = [...oldTransactions.keys()].filter(id => !newTransactions.has(id))
  if (changedTransactions.length) {
    const { error } = await supabase.from('transactions').upsert(changedTransactions.map(item => transactionRow(item, userId)))
    if (error) throw error
  }
  if (removedTransactionIds.length) {
    const { error } = await supabase.from('transactions').delete().eq('user_id', userId).in('id', removedTransactionIds)
    if (error) throw error
  }

  const oldAccounts = new Map((before?.banks || []).map(item => [String(item.id), item]))
  const newAccounts = new Map((after.banks || []).map(item => [String(item.id), item]))
  const changedAccounts = [...newAccounts.values()].filter(item => !same(item, oldAccounts.get(String(item.id))))
  const removedAccountIds = [...oldAccounts.keys()].filter(id => !newAccounts.has(id))
  if (changedAccounts.length) {
    const { error } = await supabase.from('accounts').upsert(changedAccounts.map(item => accountRow(item, userId)))
    if (error) throw error
  }
  if (removedAccountIds.length) {
    const { error } = await supabase.from('accounts').delete().eq('user_id', userId).in('id', removedAccountIds)
    if (error) throw error
  }

  const oldBudgets = new Map(budgetRows(before || emptyFinanceData(), userId).map(item => [item.month, item]))
  const nextBudgetRows = budgetRows(after, userId)
  const newBudgets = new Map(nextBudgetRows.map(item => [item.month, item]))
  const changedBudgets = nextBudgetRows.filter(item => !same(item, oldBudgets.get(item.month)))
  const removedMonths = [...oldBudgets.keys()].filter(month => !newBudgets.has(month))
  if (changedBudgets.length) {
    const { error } = await supabase.from('budgets').upsert(changedBudgets, { onConflict: 'user_id,month' })
    if (error) throw error
  }
  if (removedMonths.length) {
    const { error } = await supabase.from('budgets').delete().eq('user_id', userId).in('month', removedMonths)
    if (error) throw error
  }
}

export async function importLegacyData(userId, legacyData) {
  const isDemoBackup = legacyData.demo === true
  const defaults = emptyFinanceData()
  const data = {
    ...defaults,
    settings: isDemoBackup ? defaults.settings : { ...defaults.settings, ...(legacyData.settings || {}) },
    monthBudgets: isDemoBackup ? {} : (legacyData.monthBudgets || {}),
    banks: isDemoBackup ? defaults.banks : (legacyData.banks || []).map(bank => {
      const preset = BANKS.find(item => item.id === bank.id)
      return { ...bank, color: preset?.color || bank.color || '#9CA3AF', secondary: preset?.secondary || bank.secondary || '#9CA3AF' }
    }),
    transactions: isDemoBackup ? [] : (Array.isArray(legacyData.transactions) ? legacyData.transactions : [])
  }
  const baseline = emptyFinanceData()
  baseline.banks = []
  baseline.settings.monthlyBudget = 0
  await syncFinanceData(userId, baseline, data)
  return loadFinanceData(userId)
}

export async function initializeFinanceData(userId, data = emptyFinanceData()) {
  const baseline = emptyFinanceData()
  baseline.banks = []
  baseline.settings.monthlyBudget = 0
  await syncFinanceData(userId, baseline, data)
  return loadFinanceData(userId)
}
