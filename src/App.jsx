import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
  Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import {
  ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download,
  FileDown, LayoutDashboard, Plus, Search, Settings2, ShieldCheck, Trash2,
  Upload, X, Pencil, Sun, Moon, LogOut, Cloud, LoaderCircle
} from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
import { acceptUserLink, emptyFinanceData, fetchUserLinks, importLegacyData, initializeFinanceData, loadFinanceData, removeLegacyDemoBatch, requestUserLink, syncFinanceData } from './lib/cloudStore'

const STORAGE = 'meu-financeiro-v1'
const BANKS = [
  { id:'nubank', name:'Nubank', color:'#820AD1', secondary:'#820AD1', accountLabel:'Conta/Pix' },
  { id:'santander', name:'Santander', color:'#EC0000', secondary:'#EC0000', accountLabel:'Conta/Pix' },
  { id:'picpay', name:'PicPay', color:'#11C76F', secondary:'#11C76F', accountLabel:'Carteira/Pix' },
  { id:'bb', name:'Banco do Brasil', color:'#0038A8', secondary:'#F8D117', accountLabel:'Conta/Pix' }
]
const BANK_DARK_COLORS={nubank:'#B58ADC',santander:'#E9878B',picpay:'#80D4A1',bb:'#8EAFE8'}
const bankAccent=(id,theme)=>theme==='dark'?BANK_DARK_COLORS[id]||'#9CA3AF':BANKS.find(b=>b.id===id)?.color||'#9CA3AF'
const CATEGORIES = ['Alimentação','Transporte','Lazer','Contas','Compras','Saúde','Outros']
const categoryStyle=(_,theme)=>({backgroundColor:theme==='dark'?'#27272A':'#F4F4F5',color:theme==='dark'?'#D4D4D8':'#52525B',borderColor:theme==='dark'?'#3F3F46':'#E4E4E7'})
const money = n => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const dateISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const monthKey = s => String(s).slice(0,7)
const shiftMonth = (key,delta) => {
  const [year,month]=key.split('-').map(Number)
  const date=new Date(year,month-1+delta,1)
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0')].join('-')
}
const addMonthsToDate = (date,delta) => {
  const [year,month,day]=date.split('-').map(Number)
  const target=new Date(year,month-1+delta,1)
  const lastDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate()
  target.setDate(Math.min(day,lastDay))
  return dateISO(target)
}
const fmtMonth = key => new Date(Number(key.slice(0,4)),Number(key.slice(5,7))-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})
const uid = () => Math.random().toString(36).slice(2,10)
const today = new Date()
const currentKey = dateISO(today).slice(0,7)

const methodLabel=m=>m==='credit'?'Crédito':'Débito/Pix'
const bankName=id=>BANKS.find(b=>b.id===id)?.name || id

function parseQuick(text,people=[]){
  const raw=text.trim(), low=raw.toLowerCase()
  const installmentMatch=raw.match(/(?:em\s*)?(\d{1,2})\s*x\b/i)
  const match=raw.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i)
  if(!match)return {error:'Não encontrei um valor. Exemplo: Almoço 45 no crédito Nubank.'}
  const amount=Number(match[1].replace(',','.'))
  const splitPercentMatch=raw.match(/\bdividir\s+(\d+(?:[.,]\d+)?)\s*%/i)
  const splitWithMatch=raw.match(/\bdividid[oa]\s+com\s+(.+)$/i)
  const splitRequested=Boolean(splitPercentMatch||splitWithMatch)
  let sharedWith
  if(splitWithMatch){
    const requestedName=splitWithMatch[1].replace(/\bdividir\b.*$/i,'').replace(/\d+(?:[.,]\d+)?\s*%/i,'').trim().replace(/[.,;]+$/,'')
    sharedWith=people.find(person=>person.name?.toLowerCase()===requestedName.toLowerCase()||person.email?.toLowerCase()===requestedName.toLowerCase()||person.email?.split('@')[0].toLowerCase()===requestedName.toLowerCase())
    if(!sharedWith)return {error:`Não encontrei “${requestedName}” entre as pessoas vinculadas.`}
  }else if(splitRequested){
    if(people.length!==1)return {error:'Para dividir, vincule uma pessoa ou escreva “dividido com Nome”.'}
    sharedWith=people[0]
  }
  const splitPercent=splitPercentMatch?Number(splitPercentMatch[1].replace(',','.')):50
  if(splitPercent<0||splitPercent>100)return {error:'A porcentagem da divisão deve ficar entre 0% e 100%.'}
  const installmentCount=Math.min(24,Math.max(1,Number(installmentMatch?.[1]||1)))
  let bank='nubank'
  if(/santander|sant/i.test(low))bank='santander'
  else if(/picpay|pic pay/i.test(low))bank='picpay'
  else if(/\bbb\b|banco do brasil/i.test(low))bank='bb'
  let method=installmentCount>1||/cr[eé]dito|cart[aã]o/i.test(low)?'credit':'debit'
  const category=/almo|jantar|restaurante|lanche|mercado|comida/i.test(low)?'Alimentação':
    /uber|99|combust|ônibus|transporte/i.test(low)?'Transporte':
    /cinema|stream|show|jogo|bar/i.test(low)?'Lazer':
    /luz|internet|aluguel|água|conta/i.test(low)?'Contas':
    /farm[aá]cia|consulta|m[eé]dic/i.test(low)?'Saúde':
    /roupa|t[eê]nis|cal[cç]ado|sapato|compra|loja/i.test(low)?'Compras':'Outros'
  let description=raw.replace(match[0],' ').replace(/(?:em\s*)?\d{1,2}\s*x\b/i,' ')
    .replace(/\bdividid[oa]\s+com\s+.+$/i,' ').replace(/\bdividir\s+\d+(?:[.,]\d+)?\s*%?/i,' ')
    .replace(/\b(no|na|em|via|pelo|pela)\b/gi,' ')
    .replace(/nubank|santander|pic ?pay|\bbb\b|banco do brasil|cr[eé]dito|d[eé]bito|pix|cart[aã]o/gi,' ')
    .replace(/\s+/g,' ').trim().replace(/^[-–]+|[-–]+$/g,'')
  if(!description)description=category
  return {amount,bank,method,category,description,installmentCount,sharedWithUserId:sharedWith?.id,splitMode:splitPercentMatch?'percentage':splitRequested?'equal':'none',splitValue:splitPercent}
}

function createInstallments(transaction,count){
  const totalCents=Math.round(Number(transaction.transactionTotal??transaction.amount)*100)
  const payerTotalCents=Math.round(Number(transaction.payerShare??totalCents/100)*100)
  const baseCents=Math.floor(totalCents/count)
  const extraCents=totalCents%count
  const payerBaseCents=Math.floor(payerTotalCents/count)
  const payerExtraCents=payerTotalCents%count
  const group=uid()
  return Array.from({length:count},(_,index)=>({
    ...transaction,
    id:uid(),
    date:addMonthsToDate(transaction.date,index),
    amount:(payerBaseCents+(index<payerExtraCents?1:0))/100,
    transactionTotal:(baseCents+(index<extraCents?1:0))/100,
    payerShare:(payerBaseCents+(index<payerExtraCents?1:0))/100,
    sharedShare:((baseCents+(index<extraCents?1:0))-(payerBaseCents+(index<payerExtraCents?1:0)))/100,
    installmentGroup:group,
    installmentNumber:index+1,
    installmentCount:count,
    installmentTotal:totalCents/100,
    createdAt:Date.now()
  }))
}

export default function App(){
  const [data,setData]=useState(emptyFinanceData)
  const [session,setSession]=useState(null)
  const [authReady,setAuthReady]=useState(false)
  const [dataReady,setDataReady]=useState(false)
  const [syncState,setSyncState]=useState('idle')
  const [syncError,setSyncError]=useState('')
  const [connections,setConnections]=useState([])
  const [connectionError,setConnectionError]=useState('')
  const dataRef=useRef(null)
  const syncQueue=useRef(Promise.resolve())
  const activeLoad=useRef(0)
  const [theme,setTheme]=useState(()=>{
    let saved='light'
    try{saved=localStorage.getItem('meu-financeiro-theme')==='dark'?'dark':'light'}catch(e){}
    if(typeof document!=='undefined')document.documentElement.dataset.theme=saved
    return saved
  })
  const [period,setPeriod]=useState(currentKey)
  const [quick,setQuick]=useState('')
  const [quickBank,setQuickBank]=useState('')
  const [quickInstallments,setQuickInstallments]=useState('1')
  const [quickSplitEnabled,setQuickSplitEnabled]=useState(false)
  const [quickSplitPerson,setQuickSplitPerson]=useState('')
  const [toast,setToast]=useState('')
  const [modal,setModal]=useState(null)
  const [editing,setEditing]=useState(null)
  const [deleteTarget,setDeleteTarget]=useState(null)
  const [filters,setFilters]=useState({bank:'all',method:'all',category:'all',search:''})
  const [tab,setTab]=useState('dashboard')
  const fileRef=useRef(null)
  useEffect(()=>{
    if(!supabaseConfigured){setAuthReady(true);return}
    let alive=true
    supabase.auth.getSession().then(({data:result})=>{if(alive){setSession(result.session);setAuthReady(true)}})
    const {data:listener}=supabase.auth.onAuthStateChange((_event,nextSession)=>{
      if(alive){setSession(nextSession);if(!nextSession){dataRef.current=emptyFinanceData();setData(emptyFinanceData());setDataReady(false);setConnections([])}}
    })
    return()=>{alive=false;listener.subscription.unsubscribe()}
  },[])
  useEffect(()=>{
    if(session?.user?.id)refreshConnections()
    else setConnections([])
  },[session?.user?.id])
  useEffect(()=>{
    if(!session?.user?.id){if(authReady){dataRef.current=emptyFinanceData();setData(emptyFinanceData());setDataReady(false)}return}
    const userId=session.user.id
    const loadId=++activeLoad.current
    let active=true
    setDataReady(false);setSyncError('');setSyncState('loading')
    async function refresh(){
      try{
        let remote=await loadFinanceData(userId)
        if(!active||loadId!==activeLoad.current)return
        const cleanup=await removeLegacyDemoBatch(userId,remote)
        remote=cleanup.data
        if(cleanup.removed||cleanup.balancesReset)setToast(`${cleanup.removed?`${cleanup.removed} registros antigos apagados`:'Dados de demonstração removidos'}${cleanup.balancesReset?' e saldos de exemplo zerados':''}.`)
        if(!remote.hasCloudData){
          let raw=''
          try{raw=localStorage.getItem(STORAGE)||''}catch{}
          if(raw&&!sessionStorage.getItem(`legacy-dismissed-${userId}`)){
            try{
              const legacy=JSON.parse(raw)
              if(legacy?.version===1&&Array.isArray(legacy.transactions)&&Array.isArray(legacy.banks)){
                if(window.confirm(`Encontramos ${legacy.transactions.length} transações salvas neste navegador. Importar para a conta ${session.user.email}?`)){
                  remote=await importLegacyData(userId,legacy)
                  localStorage.removeItem(STORAGE)
                }else sessionStorage.setItem(`legacy-dismissed-${userId}`,'1')
              }
            }catch(error){if(error?.name!=='SyntaxError')throw error}
          }
          if(!raw)remote=await initializeFinanceData(userId,remote)
        }
        if(!active||loadId!==activeLoad.current)return
        dataRef.current=remote;setData(remote);setDataReady(true);setSyncState('synced')
      }catch(error){if(active){setSyncError(error.message||'Não foi possível carregar os dados na nuvem.');setSyncState('error');setDataReady(true);dataRef.current=emptyFinanceData();setData(dataRef.current)}}
    }
    refresh()
    let channel
    supabase.realtime.setAuth(session.access_token).then(()=>{
      if(!active)return
      channel=supabase.channel(`user:${userId}:finance`,{config:{private:true}})
        .on('broadcast',{event:'*'},()=>{refreshCloudData(userId,active,loadId);refreshConnections()})
        .subscribe()
    })
    return()=>{active=false;if(channel)supabase.removeChannel(channel)}
  },[session?.user?.id,authReady])
  useEffect(()=>{
    document.documentElement.dataset.theme=theme
    const themeColor=document.querySelector('meta[name="theme-color"]')
    if(themeColor)themeColor.content=theme==='dark'?'#0E1015':'#F8F9FA'
    try{localStorage.setItem('meu-financeiro-theme',theme)}catch(e){}
  },[theme])
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2800);return()=>clearTimeout(t)},[toast])
  async function refreshCloudData(userId,active,loadId){
    try{const fresh=await loadFinanceData(userId);if(active&&loadId===activeLoad.current){dataRef.current=fresh;setData(fresh);setSyncState('synced')}}
    catch(error){if(active){setSyncError(error.message||'Falha ao sincronizar.');setSyncState('error')}}
  }
  async function refreshConnections(){
    try{
      const rows=await fetchUserLinks()
      setConnections(rows);setConnectionError('')
    }catch(error){setConnectionError(error.message||'Não foi possível carregar as pessoas vinculadas.')}
  }
  function commitData(next){
    const previous=dataRef.current||emptyFinanceData()
    dataRef.current=next;setData(next);setSyncState('saving');setSyncError('')
    const userId=session?.user?.id
    if(!userId)return
    syncQueue.current=syncQueue.current.catch(()=>{}).then(()=>syncFinanceData(userId,previous,next))
      .then(()=>setSyncState('synced'))
      .catch(error=>{setSyncError(error.message||'Falha ao salvar na nuvem.');setSyncState('error')})
  }
  const allMonths=useMemo(()=>[...new Set(data.transactions.map(t=>monthKey(t.date)))].sort(),[data.transactions])
  const people=connections.filter(link=>link.status==='accepted').map(link=>({id:link.partner_id,name:link.partner_name||link.partner_email?.split('@')[0]||'Pessoa vinculada',email:link.partner_email}))
  const selectedMonth=period==='all'?currentKey:period
  const selected=period==='all'?data.transactions:data.transactions.filter(t=>monthKey(t.date)===period)
  const monthTransactions=selected
  const selectedBudget=period==='all'?Number(data.settings.monthlyBudget):Number(data.monthBudgets?.[selectedMonth]??data.settings.monthlyBudget)
  const dailySafetyThreshold=Math.max(0,Number(data.settings.dailySafetyThreshold??40)||0)
  const total=monthTransactions.reduce((s,t)=>s+t.amount,0)
  const credit=monthTransactions.filter(t=>t.method==='credit').reduce((s,t)=>s+t.amount,0)
  const debit=total-credit
  const dominant=BANKS.map(b=>({ ...b, value:monthTransactions.filter(t=>t.bank===b.id).reduce((s,t)=>s+t.amount,0)})).sort((a,b)=>b.value-a.value)[0]
  const [year,month]=selectedMonth.split('-').map(Number)
  const daysInMonth=new Date(year,month,0).getDate()
  const daysLeft=selectedMonth===currentKey
    ?Math.max(1,daysInMonth-today.getDate()+1)
    :daysInMonth
  const budgetTransactions=period==='all'?data.transactions.filter(t=>monthKey(t.date)===currentKey):monthTransactions
  const monthSpend=budgetTransactions.reduce((sum,t)=>sum+t.amount,0)
  const spentToday=selectedMonth===currentKey?budgetTransactions.filter(t=>t.date===dateISO(today)).reduce((s,t)=>s+t.amount,0):0
  const startingBalance=data.banks.reduce((sum,bank)=>sum+Math.max(0,Number(bank.accountBalance)||0),0)
  const spendBeforeToday=Math.max(0,monthSpend-spentToday)
  const balanceRemaining=startingBalance-monthSpend
  const budgetRemaining=selectedBudget-monthSpend
  const dailyFunds=Math.max(0,Math.min(startingBalance-spendBeforeToday,selectedBudget-spendBeforeToday))
  const daily=dailyFunds/daysLeft
  const canSpend=Math.max(0,daily-spentToday)
  const dailyTone=balanceRemaining<0||budgetRemaining<0||spentToday>daily||daily<dailySafetyThreshold?'red':'green'
  const dailyStatusMessage=dailyTone==='green'
    ?'Sua meta diária ainda mantém uma margem confortável.'
    :balanceRemaining<0?'Os gastos do mês ultrapassaram o saldo informado nas contas. Revise os próximos gastos.'
      :budgetRemaining<0?'O orçamento mensal foi ultrapassado. Revise os próximos gastos.'
      :spentToday>daily?'Você já ultrapassou o valor previsto para hoje.'
        :`O limite diário está abaixo de ${money(dailySafetyThreshold)}.`

  function notify(s){setToast(s)}
  function toggleTheme(){const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;setTheme(next)}
  function addTransaction(tx){
    const installmentCount=tx.method==='credit'?Math.min(24,Math.max(1,Number(tx.installmentCount)||1)):1
    const rows=installmentCount>1?createInstallments(tx,installmentCount):[{...tx,id:uid(),createdAt:Date.now()}]
    const monthBudgets={...(data.monthBudgets||{})}
    rows.forEach(row=>{monthBudgets[monthKey(row.date)]??=data.settings.monthlyBudget})
    commitData({...data,monthBudgets,transactions:[...rows,...data.transactions]})
    notify(installmentCount>1?`Compra parcelada em ${installmentCount}x registrada.`:'Gasto registrado com sucesso.')
  }
  function saveTransaction(tx){
    const totalAmount=Number(tx.amount)
    const sharedWithUserId=tx.splitEnabled?tx.sharedWithUserId:''
    let payerShare=totalAmount
    if(sharedWithUserId){
      if(tx.splitMode==='percentage')payerShare=Math.round(totalAmount*Number(tx.splitValue||50))/100
      else if(tx.splitMode==='amount')payerShare=Math.min(totalAmount,Math.max(0,Number(tx.splitValue)||0))
      else payerShare=Math.round(totalAmount*50)/100
    }
    const sharedShare=Math.round((totalAmount-payerShare)*100)/100
    const prepared={...tx,amount:payerShare,transactionTotal:totalAmount,payerShare,sharedShare,payerId:session.user.id,sharedWithUserId:sharedWithUserId||undefined,isPayer:true,isShared:Boolean(sharedWithUserId)}
    if(editing){commitData({...data,monthBudgets:{...(data.monthBudgets||{}),[monthKey(prepared.date)]:data.monthBudgets?.[monthKey(prepared.date)]??data.settings.monthlyBudget},transactions:data.transactions.map(t=>t.id===editing.id?{...prepared,id:editing.id}:t)});notify('Transação atualizada.')}
    else addTransaction(prepared)
    setModal(null);setEditing(null)
  }
  function submitQuick(e){e.preventDefault();const parsed=parseQuick(quick,people);if(parsed.error){notify(parsed.error);return}
    if(!data.banks.some(bank=>bank.id===quickBank)){notify('Selecione a instituição do gasto.');return}
    if(quickSplitEnabled&&!people.some(person=>person.id===quickSplitPerson)){notify('Selecione uma pessoa vinculada para dividir a conta.');return}
    const installmentCount=Number(quickInstallments)>1?Number(quickInstallments):Number(parsed.installmentCount||1)
    const transaction={...parsed,bank:quickBank,installmentCount,method:installmentCount>1?'credit':parsed.method,...(quickSplitEnabled?{sharedWithUserId:quickSplitPerson,splitMode:'equal',splitValue:50}:{})}
    saveTransaction({...transaction,date:dateISO(today),splitEnabled:Boolean(transaction.sharedWithUserId)});setQuick('');setQuickInstallments('1');setQuickSplitEnabled(false);setQuickSplitPerson('')
  }
  function removeTransaction(id){
    const target=data.transactions.find(t=>t.id===id)
    if(target?.installmentGroup){setDeleteTarget(target);setModal('delete-installment');return}
    if(!confirm('Excluir esta transação?'))return
    commitData({...data,transactions:data.transactions.filter(t=>t.id!==id)});notify('Transação excluída.')
  }
  function removeInstallments(mode){
    if(!deleteTarget)return
    const target=deleteTarget
    commitData({...data,transactions:data.transactions.filter(t=>t.installmentGroup!==target.installmentGroup||(mode==='future'&&t.installmentNumber<target.installmentNumber))})
    setDeleteTarget(null);setModal(null)
    notify(mode==='future'?'Esta parcela e as próximas foram excluídas.':'Parcela excluída.')
  }
  function changeMonth(delta){const base=period==='all'?new Date():new Date(selectedMonth+'-01T12:00:00');base.setMonth(base.getMonth()+delta);setPeriod(dateISO(base).slice(0,7))}
  function exportJSON(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});downloadBlob(blob,'meu-financeiro-backup.json')}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
  function exportCSV(){const rows=[['Data','Descrição','Categoria','Banco','Método','Valor total','Sua parte','Parte do parceiro','Quitado'],...selected.map(t=>[t.date,t.description,t.category,bankName(t.bank),methodLabel(t.method),t.transactionTotal??t.amount,t.amount,t.isPayer?(t.sharedShare||0):(t.payerShare||0),t.isSettled?'Sim':'Não'])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(';')).join('\\n');downloadBlob(new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`transacoes-${period}.csv`)}
  function restoreFile(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(d.version!==1||!Array.isArray(d.transactions)||!Array.isArray(d.banks))throw Error();commitData(d);setPeriod(currentKey);notify('Backup enviado para a nuvem.')}catch{notify('Arquivo inválido ou incompatível.')}};r.readAsText(f);e.target.value=''}
  function saveSettings(next){commitData(next);notify('Configurações salvas na nuvem.')}
  async function settleTransactions(ids){
    try{
      for(const id of ids){
        const {error}=await supabase.rpc('settle_shared_transaction',{p_transaction_id:String(id)})
        if(error)throw error
      }
      const fresh=await loadFinanceData(session.user.id)
      dataRef.current=fresh;setData(fresh);notify('Acerto marcado como quitado.')
    }catch(error){notify(error.message||'Não foi possível registrar o acerto.')}
  }
  const filtered=monthTransactions.filter(t=>(filters.bank==='all'||t.bank===filters.bank)&&(filters.method==='all'||t.method===filters.method)&&(filters.category==='all'||t.category===filters.category)&&(!filters.search||t.description.toLowerCase().includes(filters.search.toLowerCase())))
  const personalTransactions=filtered.filter(transaction=>!transaction.isShared)
  const sharedTransactions=filtered.filter(transaction=>transaction.isShared)
  const bankSummary=BANKS.map(b=>({...b,color:bankAccent(b.id,theme),debit:monthTransactions.filter(t=>t.bank===b.id&&t.method==='debit').reduce((s,t)=>s+t.amount,0),credit:monthTransactions.filter(t=>t.bank===b.id&&t.method==='credit').reduce((s,t)=>s+t.amount,0)}))
  const dailyChart=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>{const day=i+1;const key=`${selectedMonth}-${String(day).padStart(2,'0')}`;return {day:String(day),gasto:monthTransactions.filter(t=>t.date===key).reduce((s,t)=>s+t.amount,0),meta:daily}})
  const monthlyChart=allMonths.map(k=>{const row={mes:new Date(Number(k.slice(0,4)),Number(k.slice(5,7))-1,1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})};BANKS.forEach(b=>row[b.id]=data.transactions.filter(t=>monthKey(t.date)===k&&t.bank===b.id).reduce((s,t)=>s+t.amount,0));return row})
  const categoryChart=CATEGORIES.map(c=>({name:c,value:monthTransactions.filter(t=>t.category===c).reduce((s,t)=>s+t.amount,0)})).filter(x=>x.value>0)
  const chartColors=theme==='dark'
    ?{grid:'#27272A',tick:'#A1A1AA',bar:'#52525B',goal:'#71717A',positive:'#34D399',negative:'#F87171',tooltip:'#121215',tooltipBorder:'#3F3F46',text:'#FAFAFA',series:['#FAFAFA','#D4D4D8','#A1A1AA','#71717A'],palette:['#FAFAFA','#D4D4D8','#A1A1AA','#71717A','#52525B','#3F3F46','#27272A']}
    :{grid:'#E5E7EB',tick:'#71717A',bar:'#374151',goal:'#9CA3AF',positive:'#059669',negative:'#DC2626',tooltip:'#FFFFFF',tooltipBorder:'#E5E7EB',text:'#111827',series:['#111827','#4B5563','#6B7280','#9CA3AF'],palette:['#111827','#4B5563','#6B7280','#9CA3AF','#374151','#D1D5DB','#A1A1AA']}
  const palette=chartColors.palette
  const periodLabel=period==='all'?'Visão geral':fmtMonth(period)
  const monthOptions=[...new Set([...allMonths,...Array.from({length:37},(_,i)=>shiftMonth(currentKey,i-12))])].sort()
  const futureCommitments=data.transactions.filter(t=>t.installmentGroup&&monthKey(t.date)>selectedMonth)
  const futureCommitted=futureCommitments.reduce((sum,t)=>sum+t.amount,0)
  const settlementMap=new Map()
  const settlementTransactions=period==='all'?data.transactions.filter(transaction=>monthKey(transaction.date)===currentKey):monthTransactions
  for(const transaction of settlementTransactions){
    if(!transaction.sharedWithUserId||transaction.isSettled)continue
    const paidByMe=transaction.payerId===session?.user?.id
    const partnerId=paidByMe?transaction.sharedWithUserId:transaction.payerId
    if(!partnerId)continue
    const row=settlementMap.get(partnerId)||{partnerId,net:0,transactionIds:[]}
    row.net+=paidByMe?Number(transaction.sharedShare||0):-Number(transaction.sharedShare||0)
    row.transactionIds.push(transaction.id)
    settlementMap.set(partnerId,row)
  }
  const settlementBalances=[...settlementMap.values()]
  const personName=id=>people.find(person=>person.id===id)?.name||'Pessoa vinculada'
  const renderTransactionTable=transactions=><div className="overflow-x-auto"><table className="w-full text-left min-w-[700px]"><thead><tr className="text-[10px] uppercase tracking-wider muted border-b border-slate-100"><th className="py-3 font-semibold">Descrição</th><th className="py-3 font-semibold">Data</th><th className="py-3 font-semibold">Instituição</th><th className="py-3 font-semibold">Método</th><th className="py-3 font-semibold text-right">Sua parte</th><th className="py-3"></th></tr></thead><tbody>{transactions.map(t=><tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70"><td className="py-3"><div className="font-semibold text-sm">{t.description}</div><div className="flex flex-wrap items-center gap-1.5 text-[11px] muted mt-1"><span className="category-badge" style={categoryStyle(t.category,theme)}>{t.category}</span>{t.installmentCount>1&&<span className="inline-flex rounded-md bg-violet-50 px-2 py-1 font-semibold text-violet-700">Parcela {t.installmentNumber}/{t.installmentCount}</span>}{t.isShared&&<span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">Dividido {t.isPayer?'com':'por'} {personName(t.isPayer?t.sharedWithUserId:t.payerId)}</span>}{t.isShared&&t.isSettled&&<span className="inline-flex rounded-md bg-slate-100 px-2 py-1 font-semibold">Quitado</span>}</div>{t.isShared&&<div className="text-[11px] muted mt-1">Total {money(t.transactionTotal)} · sua parte {money(t.amount)} · {t.isPayer?`a receber ${money(t.sharedShare)}`:`a pagar ${money(t.sharedShare)}`}</div>}</td><td className="py-3 text-xs text-slate-500">{new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</td><td className="py-3"><span className="inline-flex items-center gap-2 text-xs font-semibold"><span className="w-2 h-2 rounded-full" style={{background:bankAccent(t.bank,theme)}}/>{data.banks.find(b=>b.id===t.bank)?.name||bankName(t.bank)}</span></td><td className="py-3"><span className={`text-[10px] font-bold px-2 py-1 rounded-md ${t.method==='credit'?'bg-blue-50 text-blue-700':'bg-emerald-50 text-emerald-700'}`}>{methodLabel(t.method)}</span></td><td className="py-3 text-right text-sm font-bold">{money(t.amount)}</td><td className="py-3 text-right">{t.isPayer&&<><button title="Editar" onClick={()=>{setEditing(t);setModal('transaction')}} className="p-2 text-slate-400 hover:text-violet-700"><Pencil size={14}/></button><button title="Excluir" onClick={()=>removeTransaction(t.id)} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 size={14}/></button></>}</td></tr>)}</tbody></table>{!transactions.length&&<div className="py-8 text-center text-sm muted">Nenhuma transação nesta seção.</div>}</div>
  const screenTitle=tab==='dashboard'?(period==='all'?'Visão geral':`Resumo de ${fmtMonth(selectedMonth)}`):tab==='transactions'?'Transações':'Configurações'
  const screenLabel=tab==='dashboard'?'RESUMO MENSAL':tab==='transactions'?'MOVIMENTAÇÕES':'PREFERÊNCIAS'
  const screenDescription=tab==='dashboard'?'Gastos, metas e compromissos em um só lugar.':tab==='transactions'?`Gastos e parcelas no período: ${periodLabel}.`:'Orçamento, instituições e pessoas vinculadas.'

  if(!authReady)return <div className="min-h-screen grid place-items-center"><LoaderCircle className="animate-spin muted"/></div>
  if(!supabaseConfigured)return <AuthScreen configured={false} theme={theme} onToggleTheme={toggleTheme}/>
  if(!session)return <AuthScreen configured theme={theme} onToggleTheme={toggleTheme}/>
  if(!dataReady)return <div className="min-h-screen grid place-items-center"><div className="flex items-center gap-3 muted text-sm"><LoaderCircle className="animate-spin" size={18}/>Sincronizando seus dados…</div></div>

  return <div className="min-h-screen">
    <header className="bg-white border-b border-slate-100 sticky top-0 z-30 overflow-x-hidden">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-5 lg:px-8 min-h-[72px] flex flex-wrap items-center justify-between gap-3 sm:gap-4 py-3">
        <div><div className="text-[10px] font-bold tracking-[.2em] text-slate-500 uppercase">Finanças pessoais</div><div className="font-bold tracking-tight text-[17px]" style={{fontFamily:'Manrope'}}>meu financeiro</div></div>
        <nav className="nav-tabs order-3 w-full md:order-none md:w-auto flex items-center justify-center gap-1 p-1 rounded-xl overflow-x-auto" aria-label="Navegação principal">
          <button onClick={()=>setTab('dashboard')} aria-current={tab==='dashboard'?'page':undefined} className={`nav-tab px-4 py-2 rounded-lg text-sm font-semibold ${tab==='dashboard'?'is-active':''}`}><span className="flex gap-2 items-center"><LayoutDashboard size={15}/>Resumo</span></button>
          <button onClick={()=>setTab('transactions')} aria-current={tab==='transactions'?'page':undefined} className={`nav-tab px-4 py-2 rounded-lg text-sm font-semibold ${tab==='transactions'?'is-active':''}`}>Transações</button>
          <button onClick={()=>setTab('settings')} aria-current={tab==='settings'?'page':undefined} className={`nav-tab px-4 py-2 rounded-lg text-sm font-semibold ${tab==='settings'?'is-active':''}`}><span className="flex gap-2 items-center"><Settings2 size={15}/>Configurações</span></button>
        </nav>
        <div className="header-actions flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3"><span className="hidden lg:flex items-center gap-1.5 text-[11px] muted max-w-[180px] truncate" title={session.user.email}>{syncState==='saving'||syncState==='loading'?<LoaderCircle size={13} className="animate-spin"/>:<Cloud size={13}/>} {session.user.email}</span><button onClick={()=>supabase.auth.signOut()} className="btn btn-light !p-2" title="Sair" aria-label="Sair"><LogOut size={16}/></button><button type="button" className="btn btn-light !p-2 theme-toggle" onClick={toggleTheme} aria-pressed={theme==='dark'} aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'} title={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'}>{theme==='dark'?<Sun size={17} strokeWidth={1.75}/>:<Moon size={17} strokeWidth={1.75}/>}</button><button className="btn btn-light !p-2" title="Exportar backup" onClick={exportJSON}><Download size={17}/></button><button className="btn btn-light !p-2" title="Restaurar backup" onClick={()=>fileRef.current?.click()}><Upload size={17}/></button><input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={restoreFile}/></div>
      </div>
    </header>
    <main className="max-w-[1440px] mx-auto px-4 sm:px-5 lg:px-8 py-6 sm:py-9 overflow-x-hidden">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
        <div><div className="text-xs font-bold uppercase tracking-[.16em] text-violet-600 mb-2">{screenLabel}</div><h1 className="text-[27px] leading-tight font-extrabold tracking-tight" style={{fontFamily:'Manrope'}}>{screenTitle}</h1><p className="muted text-sm mt-1">{screenDescription}</p></div>
        {tab!=='settings'&&<div className="flex w-full flex-wrap items-center gap-3 lg:w-auto"><div className="month-control flex max-w-full items-center bg-white border border-slate-200 rounded-xl p-1"><button type="button" onClick={()=>changeMonth(-1)} aria-label="Período anterior" title="Período anterior" className="p-2 text-slate-500 hover:text-violet-700"><ChevronLeft size={17}/></button><span aria-live="polite" aria-label="Período exibido" className="period-readout px-3 text-sm font-semibold capitalize whitespace-nowrap">{period==='all'?'Todos os meses':fmtMonth(selectedMonth)}</span><button type="button" onClick={()=>changeMonth(1)} aria-label="Próximo período" title="Próximo período" className="p-2 text-slate-500 hover:text-violet-700"><ChevronRight size={17}/></button></div><select aria-label="Escolher mês" className="field month-period-select !w-auto text-sm capitalize" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">Todos os meses</option>{monthOptions.map(m=><option key={m} value={m}>{fmtMonth(m)}</option>)}</select><button type="button" className="btn btn-light" onClick={()=>setPeriod(currentKey)}>Mês atual</button><button onClick={()=>{setEditing(null);setModal('transaction')}} className="btn btn-primary"><Plus size={16}/> Novo gasto</button></div>}
      </div>

      {tab!=='settings'&&<><form onSubmit={submitQuick} className="card p-4 md:p-5 mb-5 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
          <div className="flex-1"><div className="text-sm font-bold">Adicionar por texto <span className="text-xs font-normal muted ml-1">Escreva a descrição e o valor, por exemplo “Jantar 100”.</span></div><input value={quick} onChange={e=>setQuick(e.target.value)} className="quick-text-input w-full text-sm mt-1 placeholder:text-slate-400" placeholder="Descrição e valor do gasto" aria-label="Descrição e valor do gasto"/></div>
          <label className="text-xs font-semibold muted md:w-48">Instituição<select aria-label="Instituição do gasto rápido" className="field mt-1 text-sm" value={quickBank} onChange={e=>setQuickBank(e.target.value)}><option value="">Selecione</option>{data.banks.map(bank=><option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
          <button className="btn btn-primary shrink-0" type="submit">Registrar gasto <ArrowUpRight size={15}/></button>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2">
            <label htmlFor="quick-installments" className="text-sm font-medium">Parcelamento</label>
            <select id="quick-installments" className="field !w-auto text-sm" value={quickInstallments} onChange={e=>setQuickInstallments(e.target.value)}>
              {Array.from({length:24},(_,index)=>index+1).map(count=><option key={count} value={count}>{count}x</option>)}
            </select>
            <span className="text-xs muted">{Number(quickInstallments)>1?'Crédito · valor dividido pelos meses':'Mais de 1x ativa crédito automaticamente'}</span>
          </div>
          <label className={`inline-flex items-center gap-2 text-sm font-medium ${people.length?'cursor-pointer':'cursor-not-allowed opacity-60'}`}>
            <input type="checkbox" checked={quickSplitEnabled} disabled={!people.length} onChange={e=>{const enabled=e.target.checked;setQuickSplitEnabled(enabled);if(enabled&&!quickSplitPerson&&people[0])setQuickSplitPerson(people[0].id)}} className="accent-slate-900"/>
            Dividir conta
          </label>
          {quickSplitEnabled&&people.length>0&&<div className="flex flex-wrap items-center gap-2">
            <label htmlFor="quick-split-person" className="text-xs muted">Com</label>
            <select id="quick-split-person" className="field !w-auto text-sm" value={quickSplitPerson} onChange={e=>setQuickSplitPerson(e.target.value)}>
              <option value="" disabled>Selecione uma pessoa</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <span className="text-xs muted">Meio a meio · 50% para cada pessoa</span>
          </div>}
          {!people.length&&<span className="text-xs muted">Vincule uma pessoa em Configurações para dividir gastos.</span>}
        </div>
      </form>

      <div className={`budget-card status-${dailyTone} rounded-xl p-5 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div className="flex-1"><span className={`budget-badge status-${dailyTone}`}>{dailyTone==='green'?'Orçamento saudável — margem livre':'Atenção — reduza o ritmo de gastos'}</span><p className="text-xs text-slate-600 mt-2">{dailyStatusMessage} {daysLeft===1?'Resta 1 dia':'Restam '+daysLeft+' dias'} neste mês.</p></div>
        <div className="md:text-right"><div className="text-[11px] uppercase tracking-wider font-bold text-slate-500">{selectedMonth===currentKey?'Pode gastar hoje':'Meta diária deste mês'}</div><div className={`budget-value status-${dailyTone} text-2xl sm:text-3xl font-semibold tracking-tight whitespace-nowrap`} style={{fontFamily:'Manrope'}}>{money(canSpend)}</div><div className="text-[11px] text-slate-500">Meta diária: {money(Math.max(0,daily))}</div><div className="text-[11px] text-slate-500">Saldo inicial total: {money(startingBalance)} · após gastos: {money(Math.max(0,startingBalance-monthSpend))}</div></div>
      </div>
      </>}

      {tab==='dashboard'&&<section className="card p-5 mb-5"><div className="flex items-start justify-between gap-3 mb-4"><div><h2 className="font-bold" style={{fontFamily:'Manrope'}}>Acerto de Contas</h2><p className="text-xs muted mt-1">Pendências de despesas compartilhadas em {fmtMonth(selectedMonth)}.</p></div><span className="text-xs muted">{settlementBalances.length} pessoa(s)</span></div>{settlementBalances.length?<div className="divide-y divide-slate-100">{settlementBalances.map(balance=>{const positive=balance.net>0;const negative=balance.net<0;return <div key={balance.partnerId} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div className="flex-1"><div className="text-sm muted">{positive?`${personName(balance.partnerId)} te deve`:negative?`Você deve para ${personName(balance.partnerId)}`:`Saldo zerado com ${personName(balance.partnerId)}`}</div><div className="flex items-center gap-2 mt-1.5"><span className="settlement-amount text-2xl">{money(Math.abs(balance.net))}</span><span className={`settlement-pill ${positive?'positive':negative?'negative':'neutral'}`}>{positive?'A receber':negative?'A pagar':'Quitado'}</span></div><div className="text-xs muted mt-1">{balance.transactionIds.length} gasto(s) ainda não quitado(s)</div></div><button className="btn btn-light" onClick={()=>settleTransactions(balance.transactionIds)}>Marcar como acertado / quitado</button></div>})}</div>:<div className="text-sm muted py-2">Nenhum acerto pendente neste mês.</div>}</section>}

      {tab==='settings'?<Settings data={data} onSave={saveSettings} theme={theme} connections={connections} currentUserId={session.user.id} connectionError={connectionError} onConnectionsChanged={refreshConnections}/>:
      <>{tab==='dashboard'&&<>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <Kpi title="Gasto no período" value={money(total)} note={period==='all'?'Somatório de todos os meses':`Orçamento: ${money(selectedBudget)}`}/>
          <Kpi title="Crédito utilizado" value={money(credit)} note={`${total?Math.round(credit/total*100):0}% do total`}/>
          <Kpi title="Débito / Pix" value={money(debit)} note={`${total?Math.round(debit/total*100):0}% do total`}/>
          <Kpi title="Parcelas futuras" value={money(futureCommitted)} note={`${futureCommitments.length} parcela(s) após ${fmtMonth(selectedMonth)}`}/>
        </div>
        <section className="mb-6"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3"><div><h2 className="font-bold text-[16px]" style={{fontFamily:'Manrope'}}>Suas instituições</h2><p className="text-xs muted mt-1">{dominant?.value?`Mais usada: ${dominant.name} · `:''}Gastos por modalidade · {periodLabel}</p></div></div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{bankSummary.map(b=><div className={`card bank-card bank-${b.id} p-4`} key={b.id}><div className="flex items-center gap-2 mb-4"><span className="bank-indicator" style={{background:b.id==='bb'?'linear-gradient(135deg,#F8D117 50%,#0038A8 50%)':BANKS.find(bank=>bank.id===b.id)?.color||'#71717A'}}/><div className="font-bold text-sm">{b.name}</div><div className="ml-auto text-[10px] muted">MÊS</div></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-3"><div><div className="text-[10px] uppercase tracking-wide muted mb-1">Débito / Pix</div><div className="font-semibold text-[15px] whitespace-nowrap">{money(b.debit)}</div></div><div><div className="text-[10px] uppercase tracking-wide muted mb-1">Na fatura</div><div className="font-semibold text-[15px] whitespace-nowrap">{money(b.credit)}</div></div></div></div>)}</div></section>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
          <div className="card p-5 xl:col-span-2"><div className="flex justify-between items-start mb-4"><div><h2 className="font-bold" style={{fontFamily:'Manrope'}}>Evolução diária</h2><p className="text-xs muted mt-1">Gastos por dia e referência de meta diária</p></div><span className="text-xs bg-violet-50 text-violet-700 rounded-lg px-2 py-1"> {fmtMonth(selectedMonth)}</span></div><div className="h-[260px]">{period==='all'?<div className="h-full grid place-items-center text-sm muted">Selecione um mês para visualizar a evolução diária.</div>:<ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyChart}><CartesianGrid className="chart-grid" strokeDasharray="2 5" vertical={false} stroke={chartColors.grid} strokeOpacity={0.45}/><XAxis dataKey="day" tick={{fontSize:10,fill:chartColors.tick}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:chartColors.tick}} axisLine={false} tickLine={false} tickFormatter={v=>`R$${v}`}/><Tooltip formatter={v=>money(v)} labelFormatter={v=>`Dia ${v}`} contentStyle={{backgroundColor:chartColors.tooltip,borderColor:chartColors.tooltipBorder,color:chartColors.text,borderRadius:8}} labelStyle={{color:chartColors.text}} itemStyle={{color:chartColors.text}}/><Bar dataKey="gasto" name="Gasto" fill={chartColors.bar} radius={[4,4,0,0]} barSize={12}>{dailyChart.map(row=><Cell key={row.day} fill={row.gasto>row.meta?chartColors.negative:chartColors.positive}/>)}</Bar><Line dataKey="meta" name="Meta diária de referência" stroke={chartColors.goal} strokeWidth={1.5} dot={false} strokeDasharray="2 5"/></ComposedChart></ResponsiveContainer>}</div></div>
          <div className="card p-5"><h2 className="font-bold" style={{fontFamily:'Manrope'}}>Gastos por categoria</h2><p className="text-xs muted mt-1">Distribuição do período selecionado</p><div className="h-[210px] mt-2">{categoryChart.length?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryChart} dataKey="value" nameKey="name" innerRadius={58} outerRadius={85} paddingAngle={3}>{categoryChart.map((x,i)=><Cell key={x.name} fill={palette[CATEGORIES.indexOf(x.name)]}/>)}</Pie><Tooltip formatter={v=>money(v)} contentStyle={{backgroundColor:chartColors.tooltip,borderColor:chartColors.tooltipBorder,color:chartColors.text,borderRadius:8}} labelStyle={{color:chartColors.text}} itemStyle={{color:chartColors.text}}/><Legend iconType="circle" iconSize={7} wrapperStyle={{fontSize:10,color:chartColors.text}}/></PieChart></ResponsiveContainer>:<div className="h-full grid place-items-center text-xs muted">Sem gastos neste período</div>}</div></div>
        </div>
        <div className="card p-5 mb-6"><div className="flex items-center justify-between mb-4"><div><h2 className="font-bold" style={{fontFamily:'Manrope'}}>Histórico mensal</h2><p className="text-xs muted mt-1">Comparativo de gastos por instituição</p></div><CalendarDays size={18} className="text-slate-400"/></div><div className="h-[250px]">{monthlyChart.length?<ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyChart}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke={chartColors.grid} strokeOpacity={0.45}/><XAxis dataKey="mes" tick={{fontSize:11,fill:chartColors.tick}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:chartColors.tick}} axisLine={false} tickLine={false} tickFormatter={v=>`R$${v}`}/><Tooltip formatter={v=>money(v)} contentStyle={{backgroundColor:chartColors.tooltip,borderColor:chartColors.tooltipBorder,color:chartColors.text,borderRadius:8}} labelStyle={{color:chartColors.text}} itemStyle={{color:chartColors.text}}/><Legend wrapperStyle={{color:chartColors.text}}/><Bar dataKey="nubank" name="Nubank" stackId="a" fill={chartColors.series[0]}/><Bar dataKey="santander" name="Santander" stackId="a" fill={chartColors.series[1]}/><Bar dataKey="picpay" name="PicPay" stackId="a" fill={chartColors.series[2]}/><Bar dataKey="bb" name="Banco do Brasil" stackId="a" fill={chartColors.series[3]} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>:<div className="h-full grid place-items-center text-xs muted">Adicione transações para formar seu histórico.</div>}</div></div>
      </>}
      <section className="card p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4"><div><h2 className="font-bold" style={{fontFamily:'Manrope'}}>{tab==='transactions'?'Transações':'Últimas transações'}</h2><p className="text-xs muted mt-1">{filtered.length} registro(s) · {periodLabel}</p></div><div className="flex gap-2 flex-wrap"><button className="btn btn-light" onClick={exportCSV}><FileDown size={15}/>Exportar CSV</button>{tab==='dashboard'&&<button className="btn btn-light" onClick={()=>setTab('transactions')}>Ver todas</button>}</div></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input className="field !pl-9" placeholder="Buscar descrição..." value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/></div><select className="field" value={filters.bank} onChange={e=>setFilters({...filters,bank:e.target.value})}><option value="all">Todos os bancos</option>{BANKS.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select><select className="field" value={filters.method} onChange={e=>setFilters({...filters,method:e.target.value})}><option value="all">Todos os métodos</option><option value="credit">Crédito</option><option value="debit">Débito / Pix</option></select><select className="field" value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="all">Todas as categorias</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="space-y-6">
          {[
            {title:'Contas pessoais',description:'Gastos que pertencem somente a você.',items:personalTransactions},
            ...(people.length?[{title:'Contas em conjunto',description:'Despesas compartilhadas com pessoas vinculadas. Os valores mostram somente a sua parte.',items:sharedTransactions}]:[])
          ].map(section=>{
            const visibleItems=tab==='dashboard'?section.items.slice(0,8):section.items
            const sectionTotal=section.items.reduce((sum,transaction)=>sum+Number(transaction.amount||0),0)
            return <div key={section.title}>
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-slate-100 pb-3 mb-2">
                <div><h3 className="font-bold text-sm" style={{fontFamily:'Manrope'}}>{section.title}</h3><p className="text-xs muted mt-1">{section.description}</p></div>
                <div className="text-xs muted">{section.items.length} gasto(s) · {money(sectionTotal)}</div>
              </div>
              {renderTransactionTable(visibleItems)}
            </div>
          })}
        </div>
      </section>
      </>}
      <footer className="flex flex-col sm:flex-row justify-between gap-2 py-6 text-[11px] muted"><span>{syncError?`Erro de sincronização: ${syncError}`:syncState==='synced'?'Dados sincronizados com segurança na nuvem.':'Salvando alterações na nuvem…'}</span><div className="flex gap-3"><button onClick={exportJSON} className="hover:text-violet-700">Backup (JSON)</button></div></footer>
    </main>
    {modal==='transaction'&&<TransactionModal banks={data.banks} people={people} initial={editing} onClose={()=>{setModal(null);setEditing(null)}} onSave={saveTransaction}/>}
    {modal==='delete-installment'&&deleteTarget&&<div className="fixed inset-0 z-50 bg-slate-900/30 grid place-items-center p-4"><div className="card w-full max-w-md p-6"><h2 className="text-lg font-extrabold" style={{fontFamily:'Manrope'}}>Excluir compra parcelada</h2><p className="text-sm muted mt-2 mb-5">Esta é a parcela {deleteTarget.installmentNumber}/{deleteTarget.installmentCount} de “{deleteTarget.description}”. O que deseja apagar?</p><div className="flex flex-col gap-2"><button className="btn btn-light" onClick={()=>removeInstallments('current')}>Apenas esta parcela</button><button className="btn btn-primary" onClick={()=>removeInstallments('future')}>Esta e todas as parcelas futuras</button><button className="btn btn-light mt-1" onClick={()=>{setDeleteTarget(null);setModal(null)}}>Cancelar</button></div></div></div>}
    {toast&&<div className="fixed bottom-5 right-5 z-50 bg-white border border-slate-200 text-slate-800 rounded-xl shadow-xl px-4 py-3 text-sm flex items-center gap-2"><Check size={16}/>{toast}</div>}
  </div>
}

function AuthScreen({configured,theme,onToggleTheme}){
  const [mode,setMode]=useState('login')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const isSignup=mode==='signup'
  async function submit(event){
    event.preventDefault();setMessage('');setBusy(true)
    try{
      const result=isSignup
        ?await supabase.auth.signUp({email:email.trim(),password})
        :await supabase.auth.signInWithPassword({email:email.trim(),password})
      if(result.error)throw result.error
      if(isSignup&&!result.data.session)setMessage('Conta criada. Confirme seu e-mail para concluir o cadastro e entrar.')
    }catch(error){setMessage(error.message||'Não foi possível autenticar. Confira os dados e tente novamente.')}
    finally{setBusy(false)}
  }
  return <main className="min-h-screen grid place-items-center px-5 py-10">
    <div className="w-full max-w-md">
      <div className="flex items-start justify-between mb-8"><div><div className="text-[10px] font-bold tracking-[.2em] muted uppercase">Finanças pessoais</div><h1 className="font-bold tracking-tight text-2xl mt-1" style={{fontFamily:'Manrope'}}>meu financeiro</h1></div><button type="button" className="btn btn-light !p-2" onClick={onToggleTheme} aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'}>{theme==='dark'?<Sun size={17} strokeWidth={1.75}/>:<Moon size={17} strokeWidth={1.75}/>}</button></div>
      <section className="card p-6 sm:p-8">
        <div className="mb-6"><p className="text-xs uppercase tracking-[.16em] muted mb-2">Acesso seguro</p><h2 className="text-xl font-bold" style={{fontFamily:'Manrope'}}>{configured?(isSignup?'Criar sua conta':'Entrar na sua conta'):'Conecte seu projeto Supabase'}</h2><p className="text-sm muted mt-2">{configured?'Acesse seus dados financeiros em todos os seus dispositivos.':'Adicione as credenciais públicas do projeto para ativar o acesso.'}</p></div>
        {!configured?<div className="space-y-3 text-sm"><p>Crie um arquivo <code>.env</code> baseado em <code>.env.example</code> e preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>. Depois execute o SQL de <code>supabase/schema.sql</code> no editor SQL do projeto.</p><p className="muted text-xs">Use somente a chave pública anon/publishable no navegador. A chave service_role não deve ser colocada no app.</p></div>:
          <><form onSubmit={submit} className="space-y-4"><label className="block text-xs font-semibold">E-mail<input className="field mt-1.5" type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="voce@exemplo.com"/></label><label className="block text-xs font-semibold">Senha<input className="field mt-1.5" type="password" autoComplete={isSignup?'new-password':'current-password'} minLength={6} required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres"/></label><button className="btn btn-primary w-full justify-center" disabled={busy}>{busy&&<LoaderCircle size={15} className="animate-spin"/>}{isSignup?'Criar conta':'Entrar'}</button></form><p className="auth-switch text-center text-sm mt-5">{isSignup?'Já tem uma conta?':'Ainda não tem conta?'} <button className="auth-switch-link font-bold underline underline-offset-4" onClick={()=>{setMode(isSignup?'login':'signup');setMessage('')}}>{isSignup?'Entrar':'Criar conta'}</button></p></>}
        {message&&<p role="status" className="mt-4 rounded-lg border border-slate-200 p-3 text-sm muted">{message}</p>}
      </section>
      <p className="text-center text-[11px] muted mt-5">Os dados são privados e associados à sua conta.</p>
    </div>
  </main>
}

function Kpi({title,value,note}){
  return <div className="card p-4">
    <div className="text-[11px] uppercase tracking-[.12em] font-semibold muted">{title}</div>
    <div className="text-xl sm:text-2xl font-semibold tracking-tight mt-4 tabular-nums whitespace-nowrap truncate" style={{fontFamily:'Manrope'}}>{value}</div>
    <div className="text-xs muted mt-2">{note}</div>
  </div>
}

function TransactionModal({banks,people,initial,onClose,onSave}){
  const [form,setForm]=useState(()=>initial?{
    ...initial,
    amount:String(initial.transactionTotal??initial.amount),
    installmentCount:initial.installmentCount||1,
    splitEnabled:Boolean(initial.sharedWithUserId),
    sharedWithUserId:initial.sharedWithUserId||'',
    splitMode:initial.sharedWithUserId?'amount':'equal',
    splitValue:initial.payerShare??initial.amount
  }:{date:dateISO(new Date()),description:'',amount:'',category:'Alimentação',bank:'nubank',method:'debit',installmentCount:1,splitEnabled:false,sharedWithUserId:people[0]?.id||'',splitMode:'equal',splitValue:50})
  const update=(key,value)=>setForm(current=>({...current,[key]:value}))
  const totalAmount=Number(form.amount)||0
  const ownShare=form.splitMode==='percentage'?totalAmount*(Number(form.splitValue||0)/100):form.splitMode==='amount'?Number(form.splitValue||0):totalAmount/2
  function submit(event){
    event.preventDefault()
    if(!form.description.trim()||totalAmount<=0)return
    if(form.splitEnabled&&!form.sharedWithUserId)return
    if(form.splitEnabled&&(ownShare<0||ownShare>totalAmount))return
    onSave({...form,amount:totalAmount,installmentCount:form.method==='credit'?Number(form.installmentCount)||1:1})
  }
  return <div className="fixed inset-0 z-50 bg-slate-900/30 grid place-items-center p-4" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <form onSubmit={submit} className="card transaction-modal w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto">
      <div className="flex justify-between items-center mb-5"><div><h2 className="text-lg font-extrabold" style={{fontFamily:'Manrope'}}>{initial?'Editar gasto':'Novo gasto'}</h2><p className="text-xs muted mt-1">Preencha os dados da movimentação.</p></div><button type="button" onClick={onClose} className="p-2 text-slate-400"><X size={19}/></button></div>
      <div className="transaction-grid grid grid-cols-2 gap-4">
        <label className="col-span-2 text-xs font-semibold text-slate-600">Descrição<input required className="field mt-1.5" placeholder="Ex.: Almoço" value={form.description} onChange={event=>update('description',event.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600">Valor total da compra (R$)<input required min="0.01" step="0.01" type="number" className="field mt-1.5" placeholder="0,00" value={form.amount} onChange={event=>update('amount',event.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600">Data<input required type="date" className="field mt-1.5" value={form.date} onChange={event=>update('date',event.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600">Categoria<select className="field mt-1.5" value={form.category} onChange={event=>update('category',event.target.value)}>{CATEGORIES.map(category=><option key={category}>{category}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Instituição<select className="field mt-1.5" value={form.bank} onChange={event=>update('bank',event.target.value)}>{banks.map(bank=><option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
        <label className="col-span-2 text-xs font-semibold text-slate-600">Forma de pagamento<div className="grid grid-cols-2 gap-2 mt-1.5"><button type="button" onClick={()=>update('method','debit')} className={`p-3 rounded-xl border text-sm font-semibold ${form.method==='debit'?'border-violet-400 bg-violet-50 text-violet-700':'border-slate-200 text-slate-500'}`}>Débito / Pix</button><button type="button" onClick={()=>update('method','credit')} className={`p-3 rounded-xl border text-sm font-semibold ${form.method==='credit'?'border-violet-400 bg-violet-50 text-violet-700':'border-slate-200 text-slate-500'}`}>Crédito</button></div></label>
        {form.method==='credit'&&<label className="col-span-2 text-xs font-semibold text-slate-600">Número de parcelas<select className="field mt-1.5" value={form.installmentCount} disabled={Boolean(initial?.installmentGroup)} onChange={event=>update('installmentCount',Number(event.target.value))}>{Array.from({length:24},(_,index)=><option key={index+1} value={index+1}>{index+1}x</option>)}</select>{initial?.installmentGroup&&<span className="block mt-1 font-normal muted">Esta compra já possui parcelas vinculadas.</span>}</label>}
        <label className="col-span-2 flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold"><input type="checkbox" checked={form.splitEnabled} disabled={!people.length} onChange={event=>{update('splitEnabled',event.target.checked);if(event.target.checked&&!form.sharedWithUserId&&people[0])update('sharedWithUserId',people[0].id)}}/>Dividir este gasto{!people.length&&<span className="ml-auto text-xs font-normal muted">Vincule alguém nas configurações</span>}</label>
        {form.splitEnabled&&<>
          <label className="col-span-2 text-xs font-semibold text-slate-600">Dividir com<select className="field mt-1.5" required value={form.sharedWithUserId} onChange={event=>update('sharedWithUserId',event.target.value)}><option value="">Selecione uma pessoa</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label>
          <label className="col-span-2 text-xs font-semibold text-slate-600">Proporção<select className="field mt-1.5" value={form.splitMode} onChange={event=>setForm(current=>({ ...current, splitMode:event.target.value, splitValue:event.target.value==='percentage'?50:event.target.value==='amount'?(Number(current.amount||0)/2).toFixed(2):50 }))}><option value="equal">Meio a meio (50% / 50%)</option><option value="percentage">Porcentagem personalizada</option><option value="amount">Valor que eu pago</option></select></label>
          {form.splitMode==='percentage'&&<label className="col-span-2 text-xs font-semibold text-slate-600">Sua parte (%)<input required type="number" min="0" max="100" step="0.01" className="field mt-1.5" value={form.splitValue} onChange={event=>update('splitValue',event.target.value)}/></label>}
          {form.splitMode==='amount'&&<label className="col-span-2 text-xs font-semibold text-slate-600">Sua parte do total (R$)<input required type="number" min="0" max={totalAmount} step="0.01" className="field mt-1.5" value={form.splitValue} onChange={event=>update('splitValue',event.target.value)}/></label>}
          <div className="col-span-2 rounded-lg bg-slate-50 p-3 text-xs muted">Sua parte: <strong>{money(Math.max(0,ownShare))}</strong> · Parte de {people.find(person=>person.id===form.sharedWithUserId)?.name||'outra pessoa'}: <strong>{money(Math.max(0,totalAmount-ownShare))}</strong></div>
        </>}
      </div>
      <div className="flex justify-end gap-2 mt-6"><button type="button" onClick={onClose} className="btn btn-light">Cancelar</button><button className="btn btn-primary" type="submit"><Check size={15}/>Salvar gasto</button></div>
    </form>
  </div>
}

function Settings({data,onSave,theme,connections,currentUserId,connectionError,onConnectionsChanged}){
  const [budget,setBudget]=useState(data.settings.monthlyBudget)
  const [dailySafetyThreshold,setDailySafetyThreshold]=useState(data.settings.dailySafetyThreshold??40)
  const [banks,setBanks]=useState(data.banks)
  const [newBank,setNewBank]=useState('')
  const [inviteEmail,setInviteEmail]=useState('')
  const [inviteCode,setInviteCode]=useState('')
  const [connectionMessage,setConnectionMessage]=useState('')
  const [connectionBusy,setConnectionBusy]=useState(false)
  function save(){onSave({...data,settings:{...data.settings,monthlyBudget:Number(budget),dailySafetyThreshold:Math.max(0,Number(dailySafetyThreshold)||0)},monthBudgets:{...(data.monthBudgets||{}),[dateISO(new Date()).slice(0,7)]:Number(budget)},banks})}
  function addBank(){if(!newBank.trim())return;const id='custom-'+uid();setBanks(b=>[...b,{id,name:newBank.trim(),color:'#9CA3AF',secondary:'#9CA3AF',accountLabel:'Conta/Pix',accountBalance:0,creditLimit:0}]);setNewBank('')}
  async function invite(event){
    event.preventDefault();setConnectionBusy(true);setConnectionMessage('')
    try{
      const link=await requestUserLink(inviteEmail)
      setConnectionMessage(link?.link_status==='accepted'?'Essa pessoa já está vinculada.':`Convite criado. Envie este código para a outra pessoa: ${link?.invite_code||''}`)
      setInviteEmail('');await onConnectionsChanged()
    }catch(error){setConnectionMessage(error.message||'Não foi possível criar o convite.')}
    finally{setConnectionBusy(false)}
  }
  async function accept(code){
    setConnectionBusy(true);setConnectionMessage('')
    try{await acceptUserLink(code);setInviteCode('');setConnectionMessage('Vínculo aceito. Vocês já podem dividir despesas.');await onConnectionsChanged()}
    catch(error){setConnectionMessage(error.message||'Não foi possível aceitar o convite.')}
    finally{setConnectionBusy(false)}
  }
  return <div className="max-w-4xl space-y-5">
    <div className="card p-5">
      <h2 className="font-bold text-lg" style={{fontFamily:'Manrope'}}>Orçamento mensal</h2>
      <p className="text-xs muted mt-1 mb-4">A meta diária considera o menor entre o orçamento mensal e o saldo inicial total das contas, descontando os gastos registrados.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="text-xs font-semibold text-slate-600">Orçamento total mensal (R$)<input type="number" min="0" step=".01" className="field mt-1.5" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
        <label className="text-xs font-semibold text-slate-600">Alerta vermelho abaixo de (R$/dia)<input type="number" min="0" step=".01" className="field mt-1.5" value={dailySafetyThreshold} onChange={e=>setDailySafetyThreshold(e.target.value)}/><span className="block mt-1 font-normal muted">A meta fica vermelha quando cair abaixo deste valor.</span></label>
      </div>
    </div>

    <section className="card p-5">
      <h2 className="font-bold text-lg" style={{fontFamily:'Manrope'}}>Pessoas / Divisão de Contas</h2>
      <p className="text-xs muted mt-1 mb-4">Convide alguém cadastrado pelo e-mail. A pessoa precisa aceitar o vínculo para aparecer nos gastos.</p>
      <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2 mb-3">
        <input required type="email" className="field" placeholder="E-mail da pessoa" value={inviteEmail} onChange={event=>setInviteEmail(event.target.value)}/>
        <button disabled={connectionBusy} className="btn btn-primary whitespace-nowrap"><Plus size={15}/>Convidar</button>
      </form>
      <form onSubmit={event=>{event.preventDefault();accept(inviteCode)}} className="flex flex-col sm:flex-row gap-2">
        <input required className="field uppercase" placeholder="Código de vínculo" value={inviteCode} onChange={event=>setInviteCode(event.target.value.toUpperCase())}/>
        <button disabled={connectionBusy} className="btn btn-light whitespace-nowrap">Aceitar convite</button>
      </form>
      {(connectionMessage||connectionError)&&<p role="status" className="text-xs muted mt-3">{connectionMessage||connectionError}</p>}
      <div className="mt-4 divide-y divide-slate-100">
        {connections.map(link=><div key={link.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div><div className="font-semibold text-sm">{link.partner_name||link.partner_email}</div><div className="text-xs muted">{link.partner_email}</div></div>
          {link.status==='accepted'?<span className="text-xs rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">Vinculado</span>:link.invited_by===currentUserId?<span className="text-xs muted">Aguardando aceite · código {link.invite_code}</span>:<button className="btn btn-light" disabled={connectionBusy} onClick={()=>accept(link.invite_code)}>Aceitar convite</button>}
        </div>)}
        {!connections.length&&!connectionError&&<p className="text-xs muted pt-3">Nenhuma pessoa vinculada ainda.</p>}
      </div>
    </section>

    <div className="card p-5">
      <h2 className="font-bold text-lg" style={{fontFamily:'Manrope'}}>Contas e cartões</h2>
      <p className="text-xs muted mt-1 mb-4">Defina o saldo inicial das contas e o limite de cada cartão.</p>
      <div className="space-y-3">{banks.map((bank,index)=><div key={bank.id} className="rounded-xl border border-slate-100 p-4">
        <div className="flex items-center gap-2 mb-3"><span className="w-3 h-3 rounded-full" style={{background:bankAccent(bank.id,theme)}}/><span className="font-bold text-sm">{bank.name}</span>{index<4&&<span className="text-[10px] bg-slate-100 px-2 py-1 rounded-md muted">Pré-cadastrado</span>}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-slate-600">Saldo inicial da conta (R$)<input type="number" step=".01" className="field mt-1.5" value={bank.accountBalance??0} onChange={event=>setBanks(items=>items.map(item=>item.id===bank.id?{...item,accountBalance:Number(event.target.value)}:item))}/></label>
          <label className="text-xs font-semibold text-slate-600">Limite do cartão (R$)<input type="number" step=".01" className="field mt-1.5" value={bank.creditLimit??0} onChange={event=>setBanks(items=>items.map(item=>item.id===bank.id?{...item,creditLimit:Number(event.target.value)}:item))}/></label>
        </div>
      </div>)}</div>
      <div className="flex flex-col sm:flex-row gap-3 mt-4"><input className="field" placeholder="Nome da nova instituição" value={newBank} onChange={event=>setNewBank(event.target.value)}/><button type="button" onClick={addBank} className="btn btn-light whitespace-nowrap"><Plus size={15}/>Adicionar</button></div>
    </div>
    <div className="flex flex-wrap gap-2"><button onClick={save} className="btn btn-primary"><Check size={15}/>Salvar configurações</button></div>
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-4 text-xs leading-relaxed"><ShieldCheck size={16} className="inline mr-2"/>Seus dados são sincronizados com sua conta Supabase. CSV e JSON ficam disponíveis para exportação manual.</div>
  </div>
}
