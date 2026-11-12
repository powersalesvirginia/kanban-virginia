// Kanban Virginia — quadro de atividades no Firebase (dados por time, permissões pelos níveis)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261112-1044";
const APP_VERSION = '12/11 10:44';   // aparece na tela para conferir qual versão está aberta

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const fs = initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
let TEAM = null;

/* Camada fina que imita a API do protótipo, gravando em teams/{time}/... no Firestore */
const wrapSnap = s => ({ docs: s.docs, metadata: { fromCache: s.metadata.fromCache }, docChanges: () => s.docChanges().map(ch => ({ type: ch.type, doc: ch.doc })) });
const db = {
  collection(name){
    const c = collection(fs, 'teams', TEAM, name);
    return {
      doc(id){ const r = doc(c, id); return {
        set: d => setDoc(r, d), update: d => updateDoc(r, d), delete: () => deleteDoc(r),
        get: async () => { const x = await getDoc(r); return { exists: x.exists(), data: () => x.data() }; } }; },
      where(f, op, v){ const q = query(c, where(f, op, v)); return { onSnapshot: (cb, err) => onSnapshot(q, s => cb(wrapSnap(s)), err) }; },
      onSnapshot(cb, err){ return onSnapshot(c, s => cb(wrapSnap(s)), err); },
    };
  },
};
async function claimRecurrence(id, today){
  const ref = doc(fs, 'teams', TEAM, 'recurrences', id);
  return runTransaction(fs, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const r = { id, ...snap.data() };
    if ((r.lastGenerated||'') >= today || !r.active) return null;
    tx.update(ref, { lastGenerated: today });
    return r;   // devolve com a data anterior, para gerar as ocorrências que faltam
  });
}

/* ================= Configuração ================= */
const DEFAULT_LABELS = [
  {id:'comercial', name:'Comercial', color:'#2d6fb3', order:1},
  {id:'pbi', name:'Power BI', color:'#b8860b', order:2},
  {id:'operacao', name:'Operação', color:'#5b6f7e', order:3},
  {id:'automacao', name:'Automação', color:'#7a4fb0', order:4},
  {id:'reuniao', name:'Reunião', color:'#2a8a7a', order:5},
  {id:'urgente', name:'Urgente', color:'#c0392b', order:6},
];
const LABEL_COLORS = ['#2d6fb3','#b8860b','#5b6f7e','#7a4fb0','#2a8a7a','#c0392b','#c2571a','#3f7d3a','#a23b72','#1f7a99'];
const LATE_REASONS = [
  ['dados','Aguardando dados ou insumos'],
  ['dependencia','Dependência de outra área'],
  ['escopo','Mudança de escopo'],
  ['prioridade','Outra prioridade passou na frente'],
  ['volume','Volume alto de demandas'],
  ['outro','Outro motivo'],
];
const reasonName = k => (LATE_REASONS.find(r=>r[0]===k)||[,''])[1];
const WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const WEEKDAYS_LONG = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const COL_COLORS = ['#7b8a99','#1f5f8b','#b8860b','#7a4fb0','#2f7d4f','#c0392b'];
const DEFAULT_COLS = [
  {title:'A fazer', color:'#7b8a99', done:false, validation:false},
  {title:'Em andamento', color:'#1f5f8b', done:false, validation:false},
  {title:'Aguardando', color:'#5b6f7e', done:false, validation:false, waiting:true},
  {title:'Validação', color:'#b8860b', done:false, validation:true},
  {title:'Concluído', color:'#2f7d4f', done:true, validation:false},
];
const COLLS = ['columns','cards','requesters','notifications','labels','recurrences'];
const LOCAL_KEY = 'kanban-virginia-v3';
const PREF_KEY = 'kanban-virginia-view';

const S = {
  columns:[], cards:[], members:[], areas:[], levels:[], claims:[], requesters:[], notifications:[], labels:[], recurrences:[], localComments:[],
  q:'', label:'', who:'', req:'', areaFilter:'', barCollapsed:false, view:'mine', page:'board', sectorArea:'', kpiPeriod:'month', kpiPerson:null, calMonth:'',
  loaded:false, store:'pending', readOnly:false, me:null, isOwner:false, viewAs:null, booted:false, names:{},
  menuCol:null, quickCol:null, editCol:null, teamOpen:false, autoOpen:false,
};


/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const el = (tag, attrs={}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const toast = msg => { const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,3600); };
const nowISO = () => new Date().toISOString();
const isoDay = d => { const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,10); };
const todayISO = () => isoDay(new Date());
const addDays = (iso, n) => { const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return isoDay(d); };
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const fmtDate = iso => { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${+d} ${MESES[+m-1]}`; };
const fmtDT = iso => new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const daysTo = iso => Math.round((new Date(iso+'T00:00:00') - new Date(todayISO()+'T00:00:00'))/86400000);
const initials = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const firstName = n => (n||'').split(/\s+/)[0];
const sortOrd = (a,b) => (a.order??0)-(b.order??0);
const byName = (a,b) => (a.name||'').localeCompare(b.name||'','pt-BR');
const colById = id => S.columns.find(c=>c.id===id);
const colsSorted = () => S.columns.slice().sort(sortOrd);
const doneCol = () => colsSorted().find(c=>c.done);
const validationCol = () => colsSorted().find(c=>c.validation);
const waitingCol = () => colsSorted().find(c=>c.waiting);
const workCols = () => colsSorted().filter(c=>!c.done && !c.validation && !c.waiting);
const mem = id => S.members.find(m=>m.id===id);
const mname = id => mem(id)?.name || 'Alguém';
const areaName = id => S.areas.find(a=>a.id===id)?.name || '';
const reqName = id => S.areas.find(a=>a.id===id)?.name || S.requesters.find(r=>r.id===id)?.name || '';
/* Níveis vêm do cadastro do time (ordem + permissões) */
const lvlOf = m => S.levels.find(l=>l.id===m?.levelId);
const levelName = m => lvlOf(m)?.name || 'Sem nível';
const permsOf = m => lvlOf(m)?.perms || {};
const roleBadge = m => el('span',{class:'role '+(rank(m)===1?'lider':rank(m)===2?'analista':'auxiliar'), text:levelName(m)});
const labelList = () => (S.labels.length ? S.labels : DEFAULT_LABELS).slice().sort(sortOrd);
const labelById = id => labelList().find(l=>l.id===id);
const isDoneCard = c => !!colById(c.columnId)?.done;
const isValCol = c => !!colById(c.columnId)?.validation;
const isWaitCol = c => !!colById(c.columnId)?.waiting;
const pausedMs = c => (c.pauses||[]).reduce((n,p)=>n + Math.max(0, Date.parse(p.to) - Date.parse(p.from)), 0);
const pauseDaysBetween = (from, to) => Math.max(0, Math.round((new Date(isoDay(to)+'T12:00:00') - new Date(isoDay(from)+'T12:00:00'))/86400000));
const isLate = c => !isDoneCard(c) && !isWaitCol(c) && !!c.due && daysTo(c.due) < 0;
const doneDay = c => isDoneCard(c) ? isoDay(c.doneAt || c.updatedAt || c.createdAt) : null;
const deliveredLate = c => isDoneCard(c) && !!c.due && doneDay(c) > c.due;
const safeUrl = u => /^https?:\/\/[^\s]+$/i.test((u||'').trim()) ? u.trim() : null;

/* ================= Regras de acesso ================= */
const linkedMember = () => S.members.find(m => m.userId && m.userId === S.me);
const viewer = () => (S.viewAs && mem(S.viewAs)) || linkedMember() || null;
const isLider = V => !!permsOf(V).manageTeam;          // quem gerencia o time
const seesAll = V => permsOf(V).see === 'all';
const rank = m => lvlOf(m)?.rank ?? 99;
const isAbove = (a, b) => !!a && !!b && rank(a) < rank(b);
const inAreas = (V, areaId) => !!areaId && (V.areas||[]).includes(areaId);
const sharesArea = (a, b) => (a.areas||[]).some(x => (b.areas||[]).includes(x));

/* Ver: todas as atividades do time ficam visíveis para qualquer nível (alterar continua limitado, ver canEdit) */
const canSee = (card, V) => !!V;
/* Escopo de acompanhamento (permissão "Vê" do nível): define avisos da equipe, prazos e indicadores.
   só as suas · colegas do mesmo nível na área · níveis abaixo na área · todas */
function inScope(card, V){
  if (!V) return false;
  const see = permsOf(V).see || 'own';
  if (see === 'all') return true;
  if (card.assigneeId === V.id || card.createdBy === V.id || card.validatorId === V.id || card.hold?.approverId === V.id || delegatorsOf(card).includes(V.id)) return true;
  if (see === 'own') return false;
  const a = mem(card.assigneeId);
  if (!a) return see === 'area_below' && inAreas(V, card.area);
  const sameArea = sharesArea(a, V) || inAreas(V, card.area);
  if (see === 'area_peers') return sameArea && rank(a) === rank(V);
  if (see === 'area_below') return sameArea && rank(a) > rank(V);
  return false;
}
/* Alterar (permissão "Altera"): só as atribuídas · as suas e as dos níveis abaixo na área · todas */
function canEdit(card, V){
  if (!V || S.readOnly) return false;
  const ed = permsOf(V).edit || 'assigned';
  if (ed === 'all') return true;
  if (card.assigneeId === V.id) return true;
  if (ed === 'assigned') return false;
  const a = mem(card.assigneeId);
  if (!a){   // sem responsável: quem criou, ou a área — mas nunca uma criada por nível acima
    if (card.createdBy === V.id) return true;
    const cr = mem(card.createdBy);
    return inAreas(V, card.area) && !(cr && rank(cr) < rank(V));
  }
  return rank(a) > rank(V) && (sharesArea(a, V) || inAreas(V, card.area));
}
/* Atribuir (permissão "Atribui para"): só a si · níveis abaixo na área · níveis abaixo em qualquer área · qualquer pessoa */
function assignable(V, areaId){
  if (!V) return [];
  const as = permsOf(V).assign || 'self';
  const act = S.members.filter(m=>m.active);
  if (as === 'any') return act.sort(byName);
  if (as === 'self') return [V];
  const below = act.filter(m => rank(m) > rank(V) && (as === 'below_any' || (sharesArea(m, V) && (!areaId || inAreas(m, areaId)))));
  return [V, ...below.sort(byName)];
}
const areasFor = V => !V ? [] : (seesAll(V) || ['any','below_any'].includes(permsOf(V).assign)) ? S.areas.slice().sort(byName) : S.areas.filter(a => inAreas(V, a.id)).sort(byName);
const canManage = V => isLider(V) && !S.readOnly;
const realLider = () => isLider(linkedMember());
const canValidate = (card, V) => !!V && !S.readOnly && !!card.requiresValidation && (card.validatorId === V.id || isLider(V));

/* Cadeia de quem repassou a atividade (Líder → Analista → Auxiliar) */
const delegatorsOf = c => c.delegators || ((c.assignedBy && c.assignedBy !== c.assigneeId) ? [c.assignedBy] : []);
const NEW_MS = 48*3600*1000;
const isFresh = (c, V) => !!V && c.assigneeId === V.id && c.assignedBy && c.assignedBy !== V.id && c.assignedAt && (Date.now() - Date.parse(c.assignedAt)) < NEW_MS;
/* Superiores: Auxiliar → Analistas da área (ou Líderes); Analista → Líderes */
function superiorsOf(m){
  if (!m) return [];
  const above = S.members.filter(x => x.active && x.id !== m.id && rank(x) < rank(m));
  const inArea = above.filter(x => sharesArea(x, m));
  if (inArea.length){ const best = Math.max(...inArea.map(rank)); return inArea.filter(x=>rank(x)===best).map(x=>x.id); }
  return above.filter(x => permsOf(x).manageTeam).map(x=>x.id);
}
const watchersOf = card => [...new Set([...delegatorsOf(card), ...superiorsOf(mem(card.assigneeId)), card.validatorId].filter(Boolean))];

/* ================= Visualizações ================= */
function viewOptions(V){
  const o = [['mine','Minhas atividades']];
  if (V && (permsOf(V).assign||'self') !== 'self') o.push(['delegated','Que eu atribuí']);
  o.push(['sector', 'Setor / Geral']);
  return o;
}
const visibleCards = V => S.cards.filter(c => canSee(c, V));
function boardCards(V){
  const vis = visibleCards(V);
  if (S.view === 'delegated') return vis.filter(c => c.assigneeId && c.assigneeId !== V.id && delegatorsOf(c).includes(V.id));
  if (S.view === 'sector') return vis;   // o time inteiro; a barra de áreas filtra
  return vis.filter(c => c.assigneeId === V.id || (!c.assigneeId && c.createdBy === V.id) || (c.validatorId === V.id && isValCol(c) && c.validation?.status === 'pending'));
}
/* Área do cartão: a escolhida no cartão ou, sem isso, as áreas do responsável */
const cardInArea = (c, a) => c.area === a || (!c.area && (mem(c.assigneeId)?.areas||[]).includes(a));
/* Áreas que a pessoa pode filtrar: todas (quem vê tudo) ou as suas */
const areaChoices = V => !V ? [] : S.areas.slice().sort((a,b)=>((V.areas||[]).includes(b.id)) - ((V.areas||[]).includes(a.id)) || byName(a,b));   // as suas áreas primeiro
function passesFilters(c, skipArea){
  const q = S.q.trim().toLowerCase();
  return (skipArea || !S.areaFilter || cardInArea(c, S.areaFilter))
    && (!S.label || (c.labels||[]).includes(S.label))
    && (!S.who || (S.who==='__none' ? !c.assigneeId : c.assigneeId===S.who))
    && (!S.req || c.requester===S.req)
    && (!q || (c.title||'').toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q) || (mem(c.assigneeId)?.name||'').toLowerCase().includes(q) || reqName(c.requester).toLowerCase().includes(q));
}
const filteredCards = (colId, V) => boardCards(V).filter(c => c.columnId===colId && passesFilters(c)).sort(sortOrd);

/* ================= Persistência ================= */
function persistLocal(){}
function clean(o){ const r={...o}; delete r.id; return r; }
function onWriteError(e, what){
  if (e && e.code === 'permission-denied') toast(what==='team' ? 'Só quem gerencia o time pode mudar colunas, etiquetas e áreas solicitantes.' : 'Você não tem permissão para essa alteração.');
  else if (e && e.code === 'unavailable') toast('Sem conexão com o servidor. A alteração será enviada quando a conexão voltar.');
  else toast('Não foi possível salvar. Tente de novo.');
}
/* Na simulação ("Ver como") só se visualiza: as gravações seriam feitas com a sua conta, não com a da pessoa */
function simulating(){ const L = linkedMember(); return !!(S.viewAs && L && S.viewAs !== L.id); }
function blockSim(){ if (simulating()){ toast('Na simulação você só visualiza. Volte para a sua visão para alterar.'); return true; } return false; }
function upsert(list, obj){ const i=list.findIndex(x=>x.id===obj.id); if(i>=0) list[i]=obj; else list.push(obj); }
async function put(coll, obj, kind){
  if (blockSim()) return;
  upsert(S[coll], obj); render();
  if (S.store==='db') { try{ await db.collection(coll).doc(obj.id).set(clean(obj)); }catch(e){ onWriteError(e, kind); } }
  else persistLocal();
}
async function remove(coll, id, kind){
  if (blockSim()) return;
  S[coll] = S[coll].filter(x=>x.id!==id); render();
  if (S.store==='db') { try{ await db.collection(coll).doc(id).delete(); }catch(e){ onWriteError(e, kind); } }
  else persistLocal();
}

/* Histórico automático: compara antes/depois de cada gravação */
function diffHistory(before, after, actorId){
  const at = nowISO(), h = [];
  const push = (type, extra={}) => h.push({at, by:actorId, type, ...extra});
  if (!before){
    push(after.recurrenceId ? 'auto' : 'created');
    if (after.assigneeId && after.assigneeId !== actorId) push('assigned',{to:after.assigneeId});
    return h;
  }
  if (before.columnId !== after.columnId) push('moved',{fromT:colById(before.columnId)?.title||'', toT:colById(after.columnId)?.title||''});
  if ((before.assigneeId||'') !== (after.assigneeId||'')) push('assigned',{to:after.assigneeId||''});
  if ((before.due||'') !== (after.due||'')) push('due',{from:before.due||'', to:after.due||''});
  if ((before.priority||'') !== (after.priority||'')) push('priority',{to:after.priority||''});
  if (!!before.requiresValidation !== !!after.requiresValidation) push('reqval',{on:!!after.requiresValidation, v:after.validatorId||''});
  const vs = o => o.validation?.status || '';
  if (vs(before) !== vs(after) && vs(after)) push('val_'+vs(after), {note:after.validation?.note||''});
  const as = o => o.ack?.status || '';
  if (as(before) !== as(after) && as(after)) push('ack_'+as(after), {due:after.ack?.proposedDue||'', note:after.ack?.note||''});
  if ((before.lateReason||'') !== (after.lateReason||'') && after.lateReason) push('reason',{r:after.lateReason});
  const hs = o => o.hold?.status || '';
  if (hs(before) !== hs(after) && hs(after)){
    if (hs(after)==='requested') push('hold_requested',{note:after.hold.reason||''});
    if (hs(after)==='active') push(after.hold.approvedBy && after.hold.approvedBy !== after.hold.requestedBy ? 'hold_approved' : 'hold_started', {note:after.hold.reason||''});
    if (hs(after)==='denied') push('hold_denied',{note:after.hold.note||''});
  }
  if (hs(before)==='requested' && !hs(after)) push('hold_cancelled');
  return h;
}
function historyText(h){
  const by = h.by ? mname(h.by) : 'Automação';
  switch (h.type){
    case 'created': return `${by} criou a atividade`;
    case 'auto': return 'Criada pela automação de atividade recorrente';
    case 'moved': return `${by} moveu de “${h.fromT}” para “${h.toT}”`;
    case 'assigned': return h.to ? `${by} atribuiu a ${mname(h.to)}` : `${by} retirou o responsável`;
    case 'due': return `${by} mudou o prazo${h.from?` de ${fmtDate(h.from)}`:''} para ${h.to?fmtDate(h.to):'sem prazo'}`;
    case 'priority': return `${by} mudou a prioridade para ${({alta:'Alta',media:'Média',baixa:'Baixa'})[h.to]||'sem prioridade'}`;
    case 'reqval': return h.on ? `${by} passou a exigir validação de ${mname(h.v)}` : `${by} retirou a exigência de validação`;
    case 'val_pending': return `${by} enviou para validação`;
    case 'val_approved': return `${by} validou e concluiu`;
    case 'val_returned': return `${by} devolveu para ajustes${h.note?`: “${h.note}”`:''}`;
    case 'ack_ok': return `${by} confirmou o recebimento`;
    case 'ack_more_time': return `${by} pediu prazo até ${fmtDate(h.due)}${h.note?`: “${h.note}”`:''}`;
    case 'ack_accepted': return `${by} aceitou o novo prazo`;
    case 'ack_kept': return `${by} manteve o prazo original`;
    case 'reason': return `${by} informou o motivo do atraso: ${reasonName(h.r)}`;
    case 'attach': return `${by} anexou ${h.n>1 ? h.n+' arquivos' : '“'+h.name+'”'}`;
    case 'detach': return `${by} removeu o anexo “${h.name}”`;
    case 'hold_requested': return `${by} pediu para mover para Aguardando: “${h.note}”`;
    case 'hold_approved': return `${by} aprovou a pausa`;
    case 'hold_started': return `${by} moveu para Aguardando: “${h.note}”`;
    case 'hold_denied': return `${by} recusou a pausa${h.note?`: “${h.note}”`:''}`;
    case 'hold_cancelled': return `${by} cancelou o pedido de pausa`;
    case 'hold_resumed': return `${by} retomou a atividade após ${h.days} dia${h.days===1?'':'s'} parada${h.days?` (prazo estendido para ${fmtDate(h.due)})`:''}`;
    default: return `${by} alterou a atividade`;
  }
}
function saveCard(c){
  const before = S.cards.find(x=>x.id===c.id);
  const b = before ? JSON.parse(JSON.stringify(before)) : null;
  const actor = viewer();
  const wasDone = b ? !!colById(b.columnId)?.done : false, nowDone = !!colById(c.columnId)?.done;
  if (nowDone && !wasDone) c.doneAt = nowISO();
  if (!nowDone) c.doneAt = '';
  const ctx = {};
  const wasWait = b && colById(b.columnId)?.waiting && b.hold?.status === 'active';
  const nowWait = !!colById(c.columnId)?.waiting;
  if (wasWait && !nowWait){
    // fim da pausa: guarda o período e estende o prazo pelos dias parados
    const from = b.hold.startedAt || b.hold.requestedAt, to = nowISO();
    const days = pauseDaysBetween(from, to);
    c.pauses = [...(c.pauses||[]), {from, to, days, reason:b.hold.reason||'', approvedBy:b.hold.approvedBy||''}];
    if (c.due && days > 0){ if (!c.originalDue) c.originalDue = b.due; c.due = addDays(b.due, days); }
    c.hold = null; ctx.resumed = days;
  }
  if (b && c.hold?.status === 'denied' && b.columnId !== c.columnId) c.hold = null;
  c.updatedAt = nowISO(); c.updatedBy = actor?.id || '';
  const h = diffHistory(b, c, actor?.id || '');
  if (ctx.resumed != null){ h.forEach(x=>{ if (x.type==='due') x.type='_skip'; }); h.push({at:nowISO(), by:actor?.id||'', type:'hold_resumed', days:ctx.resumed, due:c.due||''}); }
  const hh = h.filter(x=>x.type!=='_skip');
  if (hh.length) c.history = [...(c.history||[]), ...hh].slice(-80);
  const p = put('cards', c);
  if (actor) withFyi(c, actor, () => cardEvents(b, c, actor, ctx));
  return p;
}
function deleteCard(id){
  const before = S.cards.find(x=>x.id===id); const actor = viewer();
  if (before && actor && before.assigneeId && before.assigneeId !== actor.id)
    withFyi(before, actor, () => notify(before.assigneeId, {type:'deleted', cardId:id, title:before.title, by:actor.id, ownerId:before.assigneeId}));
  return remove('cards', id);
}
const saveCol = c => put('columns', c, 'team');
const deleteCol = id => remove('columns', id, 'team');
const saveReq = r => put('requesters', r, 'team');
const deleteReq = id => remove('requesters', id, 'team');
async function ensureLabels(){ if (!S.labels.length) for (const l of DEFAULT_LABELS) await put('labels', {...l}, 'team'); }
async function createDefaultColumns(){
  for (let i=0;i<DEFAULT_COLS.length;i++) await saveCol({id:uid('col_'), ...DEFAULT_COLS[i], order:(i+1)*1000});
}

/* ================= Movimentação + validação ================= */
/* Decide para onde o cartão vai de fato. Com "exige validação", só o validador (ou um Líder) conclui;
   para os demais, mandar para Concluído leva o cartão para a etapa de Validação. */
function routeMove(card, targetColId, V){
  const t = colById(targetColId), from = colById(card.columnId);
  const c = {...card, columnId:targetColId};
  if (card.requiresValidation && t?.done && card.validation?.status !== 'approved'){
    if (canValidate(card, V)) { c.validation = {status:'approved', at:nowISO(), by:V.id, note:''}; return {card:c, msg:'Validada e concluída'}; }
    const vc = validationCol();
    if (vc){
      c.columnId = vc.id; c.validation = {status:'pending', at:nowISO(), by:V.id, note:''};
      return {card:c, msg:`Esta atividade precisa da validação de ${mname(card.validatorId)}. Ela foi para “${vc.title}”.`};
    }
    return {blocked:true, msg:'Esta atividade precisa de validação, mas o quadro não tem etapa de validação. Peça ao Líder para marcar uma coluna como Validação.'};
  }
  if (card.requiresValidation && t?.validation && card.validation?.status !== 'pending')
    c.validation = {status:'pending', at:nowISO(), by:V.id, note:''};
  if (card.requiresValidation && from?.validation && !t?.validation && !t?.done && card.validation?.status === 'pending')
    c.validation = canValidate(card, V) && card.assigneeId !== V.id ? {status:'returned', at:nowISO(), by:V.id, note:''} : null;
  if (from?.done && !t?.done && card.validation?.status === 'approved') c.validation = null;
  return {card:c};
}
/* ================= Aguardando (pausa com justificativa) ================= */
/* Quem aprova: o superior que passou a atividade. Sem atribuição de outra pessoa, ou se quem pede já é o superior/Líder, entra direto. */
function holdApprover(card, V){
  const a = card.assignedBy;
  if (!a || a === card.assigneeId) return null;
  if (V.id === a || isLider(V)) return null;
  return mem(a) ? a : (S.members.find(m=>m.active && permsOf(m).manageTeam)?.id || null);
}
const canApproveHold = (card, V) => !!V && !S.readOnly && card.hold?.status === 'requested' && card.hold.requestedBy !== V.id && (card.hold.approverId === V.id || isLider(V));
function requestHold(card, reason, V){
  const wc = waitingCol(); if (!wc){ toast('O quadro não tem etapa de Aguardando.'); return; }
  const at = nowISO();
  const approver = holdApprover(card, V);
  if (!approver){
    saveCard({...card, columnId:wc.id, order:nextOrder(wc.id), hold:{status:'active', reason, requestedBy:V.id, requestedAt:at, approvedBy:V.id, startedAt:at}});
    toast(`Movida para “${wc.title}”. O prazo fica parado até a atividade voltar.`);
  } else {
    saveCard({...card, hold:{status:'requested', reason, requestedBy:V.id, requestedAt:at, approverId:approver}});
    toast(`Pedido de pausa enviado para ${mname(approver)}. O cartão vai para “${wc.title}” quando for aprovado.`);
  }
}
function approveHold(card, V){
  const wc = waitingCol(); if (!wc){ toast('O quadro não tem etapa de Aguardando.'); return; }
  saveCard({...card, columnId:wc.id, order:nextOrder(wc.id), hold:{...card.hold, status:'active', approvedBy:V.id, startedAt:nowISO()}});
  toast('Pausa aprovada');
}
function askHold(card, V){
  const root = $('#modalRoot');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key==='Escape') close(); };
  document.addEventListener('keydown', esc);
  const approver = holdApprover(card, V);
  const ta = el('textarea',{id:'hold-reason',placeholder:'Ex.: aguardando base do Financeiro, que chega na quinta'});
  const modal = el('div',{class:'modal',style:'max-width:480px',role:'dialog','aria-modal':'true','aria-label':'Mover para Aguardando',onclick:e=>e.stopPropagation()},
    el('div',{class:'m-head'}, el('div',{style:'flex:1;font-family:var(--f-display);font-weight:700;font-size:18px;padding:6px 8px'},'Mover para Aguardando'),
      el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:close},'✕')),
    el('div',{class:'t-body'},
      el('div',{class:'note',text: approver
        ? `Esta atividade foi passada por ${mname(approver)}. A pausa só começa depois que ${firstName(mname(approver))} aprovar.`
        : 'Enquanto estiver em Aguardando, o prazo e o tempo de entrega param de contar. Quando a atividade voltar, o prazo é estendido pelos dias parados.'}),
      el('label',{class:'field'}, el('span',{},'Justificativa (obrigatória)'), ta)),
    el('div',{class:'m-foot'}, el('span',{class:'sp'}),
      el('button',{class:'btn ghost',type:'button',onclick:close},'Cancelar'),
      el('button',{class:'btn primary',type:'button',onclick:()=>{
        const r = ta.value.trim(); if (r.length < 5){ toast('Escreva a justificativa da pausa.'); ta.focus(); return; }
        close(); requestHold(S.cards.find(c=>c.id===card.id) || card, r, V);
      }}, approver ? 'Pedir aprovação' : 'Mover para Aguardando')));
  root.replaceChildren(el('div',{class:'scrim',onclick:close}, modal));
  setTimeout(()=>ta.focus(),0);
}
/* Atividade sem validação obrigatória indo para Validação: quem move escolhe de quem quer a validação */
function validatorChoices(card, V){
  return S.members.filter(m => m.active && m.id !== V.id && rank(m) < rank(V)).sort((a,b)=>rank(a)-rank(b) || byName(a,b));
}
function needsValidatorPick(card, colId, V){
  return !!colById(colId)?.validation && !card.requiresValidation && validatorChoices(card, V).length > 0;
}
function askValidator(card, V, targetColId){
  const root = $('#modalRoot');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key==='Escape') close(); };
  document.addEventListener('keydown', esc);
  const people = validatorChoices(card, V);
  const sup = superiorsOf(V);
  const def = (people.find(p=>p.id===card.assignedBy) || people.find(p=>sup.includes(p.id)) || people[0]).id;
  const sel = el('select',{id:'val-who'}, people.map(p=>el('option',{value:p.id,selected:p.id===def,text:`${p.name} · ${levelName(p)}`})));
  const ta = el('textarea',{id:'val-note',placeholder:'Opcional: o que a pessoa deve conferir'});
  const modal = el('div',{class:'modal',style:'max-width:480px',role:'dialog','aria-modal':'true','aria-label':'Enviar para validação',onclick:e=>e.stopPropagation()},
    el('div',{class:'m-head'}, el('div',{style:'flex:1;font-family:var(--f-display);font-weight:700;font-size:18px;padding:6px 8px'},'Enviar para validação'),
      el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:close},'✕')),
    el('div',{class:'t-body'},
      el('div',{class:'note',text:'Esta atividade não exigia validação. Escolha quem deve validar: a pessoa recebe um aviso, e os superiores acompanham.'}),
      el('label',{class:'field'}, el('span',{},'Quem vai validar'), sel),
      el('label',{class:'field'}, el('span',{},'Recado'), ta)),
    el('div',{class:'m-foot'}, el('span',{class:'sp'}),
      el('button',{class:'btn ghost',type:'button',onclick:close},'Cancelar'),
      el('button',{class:'btn primary',type:'button',onclick:()=>{
        close();
        const cur = S.cards.find(c=>c.id===card.id) || card;
        const colId = targetColId || validationCol()?.id;
        saveCard({...cur, columnId:colId, order:nextOrder(colId), requiresValidation:true, validatorId:sel.value,
          validation:{status:'pending', at:nowISO(), by:V.id, note:ta.value.trim()}});
        toast(`Enviada para a validação de ${mname(sel.value)}`);
      }}, 'Enviar')));
  root.replaceChildren(el('div',{class:'scrim',onclick:close}, modal));
  setTimeout(()=>sel.focus(),0);
}
function prevWorkCol(){
  const cols = colsSorted(), vc = validationCol();
  const before = vc ? cols.filter(c=>!c.done && !c.validation && !c.waiting && (c.order??0) < (vc.order??0)) : [];
  return before[before.length-1] || cols.find(c=>!c.done && !c.validation && !c.waiting) || cols[0];
}

/* ================= Avisos ================= */
const NOTIF_TAG = {
  assigned:{t:'Atribuída', c:'accent'}, delegated:{t:'Repassada', c:'accent'}, created:{t:'Nova atividade', c:'accent'},
  done:{t:'Concluída', c:'ok'}, reopened:{t:'Reaberta', c:'warn'}, late:{t:'Em atraso', c:'bad'}, soon:{t:'Prazo próximo', c:'warn'},
  priority:{t:'Prioridade alta', c:'bad'}, due:{t:'Prazo alterado', c:'warn'}, deleted:{t:'Excluída', c:'bad'},
  validate:{t:'Para validar', c:'warn'}, approved:{t:'Validada', c:'ok'}, returned:{t:'Devolvida', c:'bad'},
  ack_ok:{t:'Recebimento confirmado', c:'ok'}, ack_time:{t:'Pedido de prazo', c:'warn'}, ack_accepted:{t:'Prazo aceito', c:'ok'}, ack_kept:{t:'Prazo mantido', c:'warn'},
  reason:{t:'Motivo do atraso', c:'warn'}, hold_request:{t:'Pedido de pausa', c:'warn'}, hold_approved:{t:'Pausa aprovada', c:'ok'}, hold_denied:{t:'Pausa recusada', c:'bad'}, hold_started:{t:'Em aguardando', c:'warn'}, hold_resumed:{t:'Retomada', c:'accent'}, mention:{t:'Menção', c:'accent'}, repassed:{t:'Repassada', c:'accent'}, delegated:{t:'Atribuída', c:'accent'}, attach:{t:'Anexo', c:'accent'}, comment:{t:'Comentário', c:'accent'},
};
const myNotifs = V => S.notifications.filter(n => n.to === V.id).sort((a,b) => (b.at||'').localeCompare(a.at||''));
const directNotifs = V => myNotifs(V).filter(n => !n.fyi);
const teamNotifs = V => myNotifs(V).filter(n => n.fyi);
function notifText(n){
  const by = mname(n.by);
  const owner = mem(n.ownerId)?.name;
  const of = owner && n.ownerId !== n.to && n.ownerId !== n.by ? ` (de ${owner})` : '';
  if (n.fyi){   // cópia para o superior: o texto não fala com "você"
    const who = mname(n.recip);
    switch (n.type){
      case 'deleted':  return `${by} excluiu “${n.title}”${of}`;
      case 'validate': return `${by} enviou “${n.title}” para a validação de ${who}`;
      case 'mention':  return `${by} mencionou ${who} em “${n.title}”`;
      case 'returned': return `${by} devolveu “${n.title}” para ajustes de ${who}${n.note?`: “${n.note}”`:''}`;
      case 'priority': return `${by} mudou a prioridade de “${n.title}”${of} para Alta`;
      case 'due':      return `${by} mudou o prazo de “${n.title}”${of} para ${n.due ? fmtDate(n.due) : 'sem prazo'}`;
      case 'ack_accepted': return `${by} aceitou o novo prazo de “${n.title}”${of}: ${fmtDate(n.due)}`;
      case 'ack_kept': return `${by} manteve o prazo original de “${n.title}”${of}`;
      case 'hold_approved': return `${by} aprovou a pausa de “${n.title}”${of}`;
      case 'hold_denied':   return `${by} recusou a pausa de “${n.title}”${of}`;
      case 'hold_request':  return `${by} pediu para pausar “${n.title}”: “${n.note}”`;
      case 'comment':  return `${by} comentou em “${n.title}”${of}`;
    }
  }
  switch (n.type){
    case 'repassed':  return `${by} repassou “${n.title}”, que você atribuiu, para ${mname(n.toId)}`;
    case 'assigned':  return n.auto ? `Atividade recorrente criada para você: “${n.title}”` : `${by} atribuiu a você: “${n.title}”`;
    case 'delegated': return `${by} atribuiu “${n.title}” para ${mname(n.toId)}`;
    case 'created':   return `${by} criou uma nova atividade: “${n.title}”`;
    case 'done':      return `${by} concluiu “${n.title}”${of}`;
    case 'reopened':  return `${by} reabriu “${n.title}”${of}`;
    case 'late':      return `“${n.title}” está em atraso desde ${fmtDate(n.due)}${of}`;
    case 'soon':      return `“${n.title}” vence ${n.days===0?'hoje':'amanhã'}`;
    case 'priority':  return `${by} mudou a prioridade de “${n.title}” para Alta`;
    case 'due':       return `${by} mudou o prazo de “${n.title}” para ${n.due ? fmtDate(n.due) : 'sem prazo'}`;
    case 'deleted':   return `${by} excluiu “${n.title}”, que estava com você`;
    case 'validate':  return `${by} enviou “${n.title}” para a sua validação${n.note?`: “${n.note}”`:''}`;
    case 'approved':  return `${by} validou e concluiu “${n.title}”`;
    case 'returned':  return `${by} devolveu “${n.title}” para ajustes${n.note?`: “${n.note}”`:''}`;
    case 'ack_ok':    return `${by} confirmou o recebimento de “${n.title}”`;
    case 'ack_time':  return `${by} pediu prazo até ${fmtDate(n.due)} para “${n.title}”${n.note?`: “${n.note}”`:''}`;
    case 'ack_accepted': return `${by} aceitou o novo prazo de “${n.title}”: ${fmtDate(n.due)}`;
    case 'ack_kept':  return `${by} manteve o prazo original de “${n.title}”`;
    case 'reason':    return `${by} informou o motivo do atraso de “${n.title}”: ${reasonName(n.r)}`;
    case 'hold_request':  return `${by} pediu para pausar “${n.title}”: “${n.note}”`;
    case 'hold_approved': return `${by} aprovou a pausa de “${n.title}”`;
    case 'hold_denied':   return `${by} recusou a pausa de “${n.title}”${n.note?`: “${n.note}”`:''}`;
    case 'hold_started':  return `${by} moveu “${n.title}” para Aguardando: “${n.note}”`;
    case 'hold_resumed':  return `${by} retomou “${n.title}” após ${n.days} dia${n.days===1?'':'s'} parada${n.days?` · novo prazo ${fmtDate(n.due)}`:''}`;
    case 'mention':   return `${by} mencionou você em “${n.title}”`;
    case 'attach':    return `${by} anexou ${n.n>1 ? n.n+' arquivos' : '“'+n.note+'”'} em “${n.title}”`;
    case 'comment':   return `${by} comentou em “${n.title}”`;
    default:          return `${by} atualizou “${n.title}”`;
  }
}
function ago(iso){
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m/60); if (h < 24) return `há ${h} h`;
  const d = Math.round(h/24); return `há ${d} dia${d===1?'':'s'}`;
}
function notify(to, data){
  if (!to) return;
  put('notifications', {id:uid('n_'), to, read:false, at:nowISO(), ...data});
  if (FYI && !data.fyi){ FYI.sent.add(to); FYI.events.push({...data, recip:to}); }
}
/* Acompanhamento da equipe: os superiores de quem está com a atividade recebem uma cópia discreta
   de tudo o que acontece com ela (aba "Equipe" nos avisos, sem contar no sino) */
let FYI = null;
function chainUp(m){   // superiores diretos, os superiores deles, e assim por diante até o topo
  const out = new Set(); let frontier = m ? [m] : [];
  while (frontier.length){ const next = []; for (const x of frontier) for (const id of superiorsOf(x)) if (!out.has(id)){ out.add(id); next.push(mem(id)); } frontier = next.filter(Boolean); }
  return [...out];
}
function teamAbove(card, actor){
  const subj = mem(card.assigneeId) || mem(card.createdBy) || actor;
  if (!subj) return [];
  const ids = new Set([
    ...S.members.filter(x => x.active && rank(x) < rank(subj) && inScope(card, x)).map(x=>x.id),   // acima de quem está com a atividade e que enxergam o cartão
    ...chainUp(subj), ...chainUp(actor),                                                            // a cadeia de superiores (de quem está com ela e de quem agiu)
    ...S.members.filter(x => x.active && permsOf(x).manageTeam).map(x=>x.id),                         // quem gerencia o time sempre acompanha
  ]);
  ids.delete(actor?.id);
  return [...ids].filter(id => mem(id)?.active);
}
function withFyi(card, actor, fn){
  const outer = FYI; FYI = {sent:new Set(), events:[]};
  let f;
  try{ fn(); } finally { f = FYI; FYI = outer; }
  if (!card || !actor || !f.events.length) return;
  const ids = teamAbove(card, actor).filter(id => !f.sent.has(id));
  if (!ids.length) return;
  const seen = new Set();
  for (const ev of f.events){
    let e = ev;
    if (e.type === 'assigned') e = {...e, type:'delegated', toId:e.recip};
    if (e.type === 'repassed') e = {...e, type:'delegated'};
    if (seen.has(e.type)) continue; seen.add(e.type);
    for (const id of ids) put('notifications', {id:uid('n_'), to:id, read:false, at:nowISO(), ...e, fyi:true});
  }
}
function notifyMany(ids, data, skip=[]){ for (const id of new Set(ids)) if (id && !skip.includes(id)) notify(id, data); }
function notifyAssignment(card, V, prevDelegators){ withFyi(card, V, () => {
  notify(card.assigneeId, {type:'assigned', cardId:card.id, title:card.title, by:V.id});
  // quem atribuiu antes (ex.: o Líder) fica sabendo que a atividade foi repassada
  notifyMany(prevDelegators, {type:'repassed', cardId:card.id, title:card.title, by:V.id, toId:card.assigneeId}, [V.id, card.assigneeId]);
  notifyMany(superiorsOf(mem(card.assigneeId)), {type:'delegated', cardId:card.id, title:card.title, by:V.id, toId:card.assigneeId}, [V.id, card.assigneeId, ...prevDelegators]);
}); }
/* Eventos de status — a cada gravação de cartão */
function cardEvents(before, after, actor, ctx={}){
  const base = {cardId:after.id, title:after.title, by:actor.id, ownerId:after.assigneeId||''};
  const skip = [actor.id];
  if (!before){
    if (!after.assigneeId || after.assigneeId === actor.id) notifyMany(superiorsOf(actor), {...base, type:'created'}, skip);
    return;
  }
  const wasDone = !!colById(before.columnId)?.done, isDone = !!colById(after.columnId)?.done;
  const audience = [...watchersOf(after), after.assigneeId];
  const vs = o => o.validation?.status || '', as = o => o.ack?.status || '';
  const valChanged = vs(before) !== vs(after);
  if (!wasDone && isDone) notifyMany(audience, {...base, type: valChanged && vs(after)==='approved' ? 'approved' : 'done'}, skip);
  else if (wasDone && !isDone) notifyMany(audience, {...base, type:'reopened'}, skip);
  if (valChanged){
    if (vs(after) === 'pending') notifyMany([after.validatorId], {...base, type:'validate', note:after.validation?.note||''}, skip);
    if (vs(after) === 'returned') notifyMany([after.assigneeId], {...base, type:'returned', note:after.validation?.note||''}, skip);
  }
  const ackChanged = as(before) !== as(after);
  if (ackChanged){
    const s = as(after);
    if (s === 'ok') notifyMany([after.assignedBy], {...base, type:'ack_ok'}, skip);
    if (s === 'more_time') notifyMany([after.assignedBy], {...base, type:'ack_time', due:after.ack.proposedDue||'', note:after.ack.note||''}, skip);
    if (s === 'accepted') notifyMany([after.assigneeId], {...base, type:'ack_accepted', due:after.due||''}, skip);
    if (s === 'kept') notifyMany([after.assigneeId], {...base, type:'ack_kept'}, skip);
  }
  if (before.assigneeId === after.assigneeId && after.assigneeId && after.assigneeId !== actor.id){
    if (after.priority === 'alta' && before.priority !== 'alta') notify(after.assigneeId, {...base, type:'priority'});
    if ((after.due||'') !== (before.due||'') && !(ackChanged && as(after)==='accepted') && ctx.resumed == null) notify(after.assigneeId, {...base, type:'due', due:after.due||''});
  }
  if ((before.lateReason||'') !== (after.lateReason||'') && after.lateReason) notifyMany(watchersOf(after), {...base, type:'reason', r:after.lateReason}, skip);
  const hs = o => o.hold?.status || '';
  if (hs(before) !== hs(after)){
    const hd = after.hold || {};
    if (hs(after)==='requested') notifyMany([hd.approverId], {...base, type:'hold_request', note:hd.reason||''}, skip);
    if (hs(after)==='active' && hs(before)==='requested') notifyMany([hd.requestedBy], {...base, type:'hold_approved'}, skip);
    if (hs(after)==='active' && hs(before)!=='requested') notifyMany(watchersOf(after), {...base, type:'hold_started', note:hd.reason||''}, skip);
    if (hs(after)==='denied') notifyMany([hd.requestedBy], {...base, type:'hold_denied', note:hd.note||''}, skip);
  }
  if (ctx.resumed != null) notifyMany([...watchersOf(after), after.assigneeId], {...base, type:'hold_resumed', days:ctx.resumed, due:after.due||''}, skip);
}
function markRead(n){ if (!n.read) put('notifications', {...n, read:true}); }
async function markAllRead(V, list){
  const old = Date.now() - 14*86400000;
  for (const n of (list || myNotifs(V))){
    if (n.read && Date.parse(n.at) < old) await remove('notifications', n.id);
    else if (!n.read) await put('notifications', {...n, read:true});
  }
}
/* Prazos: atraso avisa responsável + superiores; prazo próximo avisa o responsável. Ids fixos = nunca duplica. */
let deadlineTimer = null;
function scheduleChecks(){ clearTimeout(deadlineTimer); deadlineTimer = setTimeout(()=>{ checkDeadlines(); runRecurrences(); }, 1500); }
async function checkDeadlines(){
  const L = linkedMember();
  if (S.store !== 'db' || !L || S.readOnly) return;
  const have = new Set(S.notifications.map(n=>n.id));
  const jobs = [];
  for (const c of S.cards){
    if (!c.due || !c.assigneeId || !mem(c.assigneeId) || isDoneCard(c) || isWaitCol(c) || !inScope(c, L)) continue;
    const n = daysTo(c.due), safe = c.due.replace(/[^0-9-]/g,'');
    if (n < 0){
      for (const to of new Set([c.assigneeId, ...watchersOf(c)])){
        const id = `n_late_${c.id}_${safe}_${to}`.slice(0,190);
        if (!have.has(id)) jobs.push({id, to, type:'late', cardId:c.id, title:c.title, due:c.due, ownerId:c.assigneeId, by:'', read:false, at:nowISO()});
      }
    } else if (n <= 1){
      const id = `n_soon_${c.id}_${safe}`.slice(0,190);
      if (!have.has(id)) jobs.push({id, to:c.assigneeId, type:'soon', cardId:c.id, title:c.title, due:c.due, days:n, by:'', read:false, at:nowISO()});
    }
  }
  for (const j of jobs.slice(0, 40)){ try{ await db.collection('notifications').doc(j.id).set(clean(j)); }catch(e){ break; } }
}

/* ================= Automações (atividades recorrentes) ================= */
function occurs(r, iso){
  const d = new Date(iso+'T12:00:00'), wd = d.getDay();
  if (r.freq === 'daily') return r.businessDays ? (wd>=1 && wd<=5) : true;
  if (r.freq === 'weekly') return (r.weekdays||[]).includes(wd);
  if (r.freq === 'monthly'){
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    const target = r.monthDay === 'last' ? last : Math.min(+r.monthDay||1, last);
    return d.getDate() === target;
  }
  return false;
}
function datesToGenerate(r, today){
  const start = r.startDate || today;
  let from = addDays(r.lastGenerated || addDays(start,-1), 1);
  if (from < start) from = start;
  const floor = addDays(today, -31); if (from < floor) from = floor;
  const out = [];
  for (let d = from; d <= today; d = addDays(d, 1)) if (occurs(r, d)) out.push(d);
  return out;
}
function nextDates(r, n){
  const today = todayISO();
  let d = (r.startDate && r.startDate > today) ? r.startDate : today;
  if ((r.lastGenerated||'') >= d) d = addDays(r.lastGenerated, 1);
  const out = [];
  for (let i=0; i<400 && out.length<n; i++, d = addDays(d,1)) if (occurs(r, d)) out.push(d);
  return out;
}
function freqText(r){
  if (r.freq === 'daily') return r.businessDays ? 'Todo dia útil' : 'Todos os dias';
  if (r.freq === 'weekly'){
    const ds = (r.weekdays||[]).slice().sort().map(i=>WEEKDAYS_LONG[i]);
    return ds.length ? 'Toda ' + (ds.length>1 ? ds.slice(0,-1).join(', ')+' e '+ds[ds.length-1] : ds[0]) : 'Semanal (sem dia definido)';
  }
  if (r.freq === 'monthly') return r.monthDay === 'last' ? 'Todo último dia do mês' : `Todo dia ${r.monthDay} do mês`;
  return '';
}
let recRunning = false;
async function runRecurrences(){
  const L = linkedMember();
  if (S.store !== 'db' || !L || S.readOnly || recRunning || !S.columns.length || simulating()) return;
  recRunning = true;
  try{
    const today = todayISO();
    for (const r of S.recurrences){
      if (!r.active || (r.lastGenerated||'') >= today) continue;
      // só um navegador gera: quem conseguir marcar "gerado hoje" primeiro (transação)
      let fr = null;
      try{ fr = await claimRecurrence(r.id, today); }catch(e){ continue; }
      if (!fr) continue;
      for (const d of datesToGenerate(fr, today)) await createOccurrence(fr, d);
    }
  } catch(e){ console.warn('automações', e); } finally { recRunning = false; }
}
async function createOccurrence(r, d){
  const id = `card_r_${r.id}_${d.replace(/-/g,'')}`.slice(0,190);
  const ref = db.collection('cards').doc(id);
  const ex = await ref.get(); if (ex.exists) return;
  const col = (colById(r.columnId) && !colById(r.columnId).waiting ? colById(r.columnId) : null) || workCols()[0] || colsSorted()[0];
  const assignee = mem(r.assigneeId) ? r.assigneeId : r.createdBy;
  const at = nowISO();
  const card = {
    title: `${r.title} · ${fmtDate(d)}`, description: r.description||'', columnId: col.id, order: Date.now()%1e9,
    area: r.area||'', assigneeId: assignee, createdBy: r.createdBy, assignedBy: r.createdBy, assignedAt: at,
    delegators: assignee !== r.createdBy ? [r.createdBy] : [], requester: r.requester||'', labels: r.labels||[], priority: r.priority||'',
    due: addDays(d, +r.dueOffset||0), checklist: (r.checklist||[]).map(t=>({id:uid('i_'), text:t, done:false})), links: [],
    createdAt: at, updatedAt: at, recurrenceId: r.id, occurrence: d,
    requiresValidation: !!r.requiresValidation, validatorId: r.requiresValidation ? r.createdBy : '',
    history: [{at, by:'', type:'auto'}],
  };
  await ref.set(card);
  if (assignee !== r.createdBy){
    const nid = `n_r_${r.id}_${d.replace(/-/g,'')}`.slice(0,190);
    try{ await db.collection('notifications').doc(nid).set({to:assignee, type:'assigned', auto:true, cardId:id, title:card.title, by:r.createdBy, at, read:false}); }catch(e){}
  }
}

/* ================= Comentários ================= */
async function addComment(card, text, V){
  text = text.trim(); if (!text) return false;
  const mentions = S.members.filter(m => m.id !== V.id && text.includes('@'+m.name)).map(m=>m.id);
  const doc = {id:uid('cm_'), cardId:card.id, by:V.id, at:nowISO(), text, mentions};
  if (S.store === 'db'){
    try{ await db.collection('comments').doc(doc.id).set(clean(doc)); }catch(e){ onWriteError(e); return false; }
  } else { S.localComments.push(doc); persistLocal(); }
  const n = (card.commentCount||0) + 1;
  const local = S.cards.find(c=>c.id===card.id);
  if (local){ local.commentCount = n; local.lastCommentAt = doc.at; }
  if (S.store === 'db') db.collection('cards').doc(card.id).update({commentCount:n, lastCommentAt:doc.at}).catch(()=>{});
  else persistLocal();
  const base = {cardId:card.id, title:card.title, by:V.id, ownerId:card.assigneeId||''};
  withFyi(card, V, () => {
    notifyMany(mentions, {...base, type:'mention'}, [V.id]);
    const others = card.assigneeId === V.id ? [card.assignedBy, card.validatorId] : [card.assigneeId];
    notifyMany(others.filter(id => id && !mentions.includes(id)), {...base, type:'comment'}, [V.id]);
  });
  render();
  return true;
}

/* ================= Cartão no quadro ================= */
function duePill(card){
  if (!card.due) return null;
  const n = daysTo(card.due);
  let cls = 'pill', tip = '';
  if (isWaitCol(card)) { tip = 'Prazo parado enquanto estiver em Aguardando'; return el('span',{class:cls,title:tip}, '⏸ ', fmtDate(card.due)); }
  if (isDoneCard(card)) { cls += deliveredLate(card) ? ' warn' : ' done'; tip = deliveredLate(card) ? 'Entregue com atraso' : 'Entregue no prazo'; }
  else if (n < 0) { cls += ' late'; tip = `Atrasada há ${-n} dia${n===-1?'':'s'}`; }
  else if (n <= 2) { cls += ' soon'; tip = n===0?'Vence hoje':`Vence em ${n} dia${n===1?'':'s'}`; }
  return el('span',{class:cls,title:tip}, '◷ ', fmtDate(card.due));
}
function statusPills(card, V){
  const out = [];
  const v = card.validation?.status;
  if (card.requiresValidation){
    if (isValCol(card) && v === 'pending') out.push(el('span',{class:'pill warn',title:'Aguardando validação',text:`Validação: ${firstName(mname(card.validatorId))}`}));
    else if (v === 'approved' && isDoneCard(card)) out.push(el('span',{class:'pill ok',text:'✓ Validada'}));
    else if (v === 'returned') out.push(el('span',{class:'pill bad',text:'Devolvida'}));
    else out.push(el('span',{class:'pill',title:`Precisa da validação de ${mname(card.validatorId)}`,text:'Com validação'}));
  }
  if (card.assignedBy && card.assignedBy !== card.assigneeId && !isDoneCard(card)){
    if (!card.ack) out.push(el('span',{class:'pill acc',text: card.assigneeId === V.id ? 'Confirmar recebimento' : 'Aguardando aceite'}));
    else if (card.ack.status === 'more_time') out.push(el('span',{class:'pill warn',text:`Pediu prazo: ${fmtDate(card.ack.proposedDue)}`}));
  }
  if (isWaitCol(card) && card.hold?.status==='active') { const n = pauseDaysBetween(card.hold.startedAt, nowISO()); out.push(el('span',{class:'pill',title:`Motivo: ${card.hold.reason||'—'}`,text:`⏸ Parada há ${n} dia${n===1?'':'s'}`})); }
  if (card.hold?.status==='requested') out.push(el('span',{class:'pill warn',title:`Motivo: ${card.hold.reason}`,text:`Pausa aguardando ${firstName(mname(card.hold.approverId))}`}));
  if (card.hold?.status==='denied') out.push(el('span',{class:'pill bad',title:card.hold.note||'',text:'Pausa recusada'}));
  if ((card.pauses||[]).length && !isWaitCol(card)) { const t=(card.pauses||[]).reduce((n,p)=>n+(p.days||0),0); if (t) out.push(el('span',{class:'pill',title:`Prazo original: ${fmtDate(card.originalDue)}`,text:`+${t}d de pausa`})); }
  if (isLate(card) && !card.lateReason && card.assigneeId === V.id) out.push(el('span',{class:'pill bad',text:'Informe o motivo do atraso'}));
  return out;
}
function cardEl(card, V){
  const list = card.checklist||[];
  const done = list.filter(i=>i.done).length;
  const editable = canEdit(card, V);
  const who = mem(card.assigneeId);
  const fresh = isFresh(card, V);
  const by = fresh ? mem(card.assignedBy) : null;
  const node = el('div',{class:'card'+(editable?'':' locked')+(fresh?' fresh':''),draggable:editable?'true':null,tabindex:'0','data-id':card.id,role:'button','aria-label':(fresh?'Nova: ':'')+card.title,
      onclick:()=>openCard(card.id), onkeydown:e=>{ if(e.key==='Enter') openCard(card.id); }},
    fresh ? el('div',{class:'fresh-row'}, el('span',{class:'new-badge',text:'New'}), el('span',{class:'fresh-by',text: by ? `de ${by.name}` : 'atribuída a você'})) : null,
    (card.labels||[]).length ? el('div',{class:'labels'}, card.labels.map(l=>{ const L=labelById(l); return L? el('span',{class:'lbl',style:`background:${L.color}`,text:L.name}):null; })) : null,
    el('div',{class:'title',text:card.title}),
    (()=>{ const p = statusPills(card, V); return p.length ? el('div',{class:'meta'}, p) : null; })(),
    el('div',{class:'meta'},
      card.recurrenceId ? el('span',{title:'Atividade recorrente',text:'↻'}) : null,
      card.area ? el('span',{class:'area-tag',text:areaName(card.area)}) : null,
      card.requester && reqName(card.requester) && card.requester!==card.area ? el('span',{class:'req-tag',title:'Área solicitante',text:'↗ '+reqName(card.requester)}) : null,
      card.priority ? el('span',{class:'prio '+card.priority,text:{alta:'Alta',media:'Média',baixa:'Baixa'}[card.priority]}) : null,
      duePill(card),
      list.length ? el('span',{class:'pill'+(done===list.length?' done':'')}, '☑ ', `${done}/${list.length}`) : null,
      (card.links||[]).length ? el('span',{class:'pill',title:'Links'}, '🔗 ', String(card.links.length)) : null,
      card.commentCount ? el('span',{class:'pill',title:'Comentários'}, '💬 ', String(card.commentCount)) : null,
      who ? el('span',{class:'who',title:`${who.name} · ${levelName(who)}`,text:initials(who.name)}) : null
    )
  );
  if (editable){
    node.addEventListener('dragstart', e => { drag.id=card.id; node.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain',card.id);}catch(_){} });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); clearDrag(); });
  }
  return node;
}
function colEl(col, V){
  const cards = filteredCards(col.id, V);
  const manage = canManage(V);
  const head = el('div',{class:'col-h'},
    el('i',{class:'dot',style:`background:${col.color||'#7b8a99'}`}),
    S.editCol===col.id
      ? el('input',{id:'rename-'+col.id,value:col.title,'aria-label':'Nome da coluna',onkeydown:e=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){S.editCol=null;render();} },
          onblur:e=>{ const v=e.target.value.trim(); S.editCol=null; if(v && v!==col.title) saveCol({...col,title:v}); else render(); }})
      : el('h2',{text:col.title + (col.validation?' ✓':'') + (col.waiting?' ⏸':''), title: col.validation ? 'Etapa de validação' : col.waiting ? 'Etapa de Aguardando: entra com justificativa e aprovação' : col.done ? 'Etapa final' : null, ondblclick:()=>{ if(manage){S.editCol=col.id;render();} }}),
    el('span',{class:'count',title:'Cartões nesta visualização',text:String(boardCards(V).filter(c=>c.columnId===col.id && passesFilters(c)).length)}),
    manage ? el('button',{class:'icon-btn',type:'button','aria-label':'Opções da coluna',onclick:e=>{ e.stopPropagation(); S.menuCol = S.menuCol===col.id?null:col.id; render(); }}, '⋯') : null
  );
  if (manage && S.menuCol===col.id){
    const total = S.cards.filter(c=>c.columnId===col.id).length;
    const idx = colsSorted().findIndex(c=>c.id===col.id);
    head.append(el('div',{class:'menu',onclick:e=>e.stopPropagation()},
      el('button',{type:'button',onclick:()=>{S.menuCol=null;S.editCol=col.id;render();}},'Renomear'),
      el('button',{type:'button',onclick:()=>{S.menuCol=null;saveCol({...col,done:!col.done,validation:false,waiting:false});}}, col.done?'Desmarcar como etapa final':'Marcar como etapa final'),
      el('button',{type:'button',onclick:()=>{S.menuCol=null;saveCol({...col,validation:!col.validation,done:false,waiting:false});}}, col.validation?'Desmarcar como etapa de validação':'Marcar como etapa de validação'),
      el('button',{type:'button',onclick:()=>{S.menuCol=null;saveCol({...col,waiting:!col.waiting,done:false,validation:false});}}, col.waiting?'Desmarcar como etapa de Aguardando':'Marcar como etapa de Aguardando'),
      el('button',{type:'button',onclick:()=>{ const c=COL_COLORS[(COL_COLORS.indexOf(col.color)+1)%COL_COLORS.length]; saveCol({...col,color:c}); }},'Trocar cor'),
      idx>0 ? el('button',{type:'button',onclick:()=>moveCol(col,-1)},'← Mover para a esquerda') : null,
      idx<S.columns.length-1 ? el('button',{type:'button',onclick:()=>moveCol(col,1)},'Mover para a direita →') : null,
      total ? el('small',{text:'Esvazie a coluna para poder excluí-la.'}) : el('button',{type:'button',class:'del',onclick:()=>{S.menuCol=null;deleteCol(col.id);}},'Excluir coluna')
    ));
  }
  const body = el('div',{class:'cards','data-col':col.id}, cards.map(c=>cardEl(c,V)));
  const node = el('section',{class:'col','data-col':col.id,'aria-label':col.title}, head, body);
  if (!S.readOnly && !col.done && !col.validation && !col.waiting){
    if (S.quickCol===col.id){
      const ta = el('textarea',{id:'quick-'+col.id,placeholder:'Título da atividade',onkeydown:e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addQuick(col.id,ta.value);} if(e.key==='Escape'){S.quickCol=null;render();} }});
      node.append(el('div',{class:'quick'}, ta, el('div',{},
        el('button',{class:'btn primary',type:'button',onclick:()=>addQuick(col.id,ta.value)},'Adicionar'),
        el('button',{class:'btn ghost',type:'button',onclick:()=>{S.quickCol=null;render();}},'Cancelar'))));
      setTimeout(()=>ta.focus(),0);
    } else node.append(el('button',{class:'add-card',type:'button',onclick:()=>{S.quickCol=col.id;render();}},'+ Adicionar cartão'));
  }
  node.addEventListener('dragover', e => onDragOver(e, col.id, body));
  node.addEventListener('dragleave', e => { if(!node.contains(e.relatedTarget)) node.classList.remove('over'); });
  node.addEventListener('drop', e => onDrop(e, col.id));
  return node;
}

/* ================= Topo ================= */
/* Menu da conta: abre ao clicar no seu nome no topo */
function renderAcct(L){
  const box = $('#acctMenu');
  if (!S.acctOpen || !L){ box.hidden = true; box.replaceChildren(); return; }
  const areas = (L.areas||[]).map(areaName).filter(Boolean);
  box.hidden = false;
  box.replaceChildren(
    el('div',{class:'acct-id'}, el('span',{class:'who',text:initials(L.name)}), el('div',{style:'min-width:0'}, el('b',{text:L.name}), el('small',{text:L.email||''}))),
    el('dl',{class:'acct-info'},
      el('dt',{text:'Time'}), el('dd',{text:S.teamName||'—'}),
      el('dt',{text:'Nível'}), el('dd',{text:levelName(L)}),
      el('dt',{text:areas.length>1?'Áreas':'Área'}), el('dd',{text:areas.join(', ')||'Sem área'}),
      S.isAdmin ? el('dt',{text:'Acesso'}) : null, S.isAdmin ? el('dd',{text:'Administrador do sistema'}) : null),
    el('div',{class:'acct-acts'},
      el('a',{class:'btn ghost',href:'./index.html#perfil'},'Meu perfil e senha'),
      el('a',{class:'btn ghost',href:'./index.html'},'Cadastros'),
      el('button',{class:'btn ghost logout',type:'button',onclick:async e=>{ e.currentTarget.disabled = true; try{ await signOut(auth); }catch(err){} location.replace('./index.html'); }},'Sair da conta')));
}
function renderTop(V){
  const bs = document.querySelector('.brand span'); if (bs) bs.textContent = `versão ${APP_VERSION}`;
  const L = linkedMember();
  $('#teamBtn').hidden = !realLider();
  $('#newCard').hidden = !V || S.readOnly || S.page==='kpi';
  $('#autoBtn').hidden = !V || S.readOnly;
  const chip = $('#meChip');
  const Lm = linkedMember();
  if (Lm){ chip.hidden=false; chip.replaceChildren(el('span',{class:'who',text:initials(Lm.name)}), el('b',{text:Lm.name}), roleBadge(Lm)); chip.setAttribute('aria-expanded', String(!!S.acctOpen)); }
  else chip.hidden = true;
  renderAcct(Lm);
  // modo de exibição
  const pages = [['board','Quadro'],['calendar','Calendário'],['kpi','Indicadores']];
  $('#pageSeg').replaceChildren(...pages.map(([k,t])=>el('button',{type:'button','aria-pressed':String(S.page===k),onclick:()=>setPage(k)}, t)));
  // tipo de visualização
  const opts = viewOptions(V);
  if (!opts.some(([k])=>k===S.view)) S.view = 'mine';
  const seg = $('#viewSeg');
  const showView = !!V && S.page !== 'kpi';
  seg.hidden = !showView; $('#vbLabel').hidden = !showView;
  seg.replaceChildren(...opts.map(([k,t])=>el('button',{type:'button','aria-pressed':String(S.view===k),onclick:()=>setView(k)}, t)));
  const vaw = $('#viewAsWrap'), vas = $('#viewAsSel');
  vaw.hidden = !(L && isLider(L));
  if (!vaw.hidden){
    const others = S.members.filter(m=>m.id!==L.id).sort((a,b)=>rank(a)-rank(b) || byName(a,b));
    vas.replaceChildren(el('option',{value:'',text:`Eu (${levelName(L)})`}), ...others.map(m=>el('option',{value:m.id,text:`${m.name} · ${levelName(m)}`})));
    vas.value = (S.viewAs && mem(S.viewAs)) ? S.viewAs : '';
  }
  document.querySelector('.viewbar').hidden = !V;
  const sa = $('#sectorArea');
  sa.hidden = true;
  if (!sa.hidden){
    sa.replaceChildren(el('option',{value:'',text:'Todas as áreas'}), ...S.areas.slice().sort(byName).map(a=>el('option',{value:a.id,text:a.name})));
    if (!S.areas.some(a=>a.id===S.sectorArea)) S.sectorArea = '';
    sa.value = S.sectorArea;
  }
  const kp = $('#kpiPeriod');
  kp.hidden = S.page !== 'kpi';
  if (!kp.hidden){
    kp.replaceChildren(...[['month','Este mês'],['prev','Mês anterior'],['d30','Últimos 30 dias'],['d90','Últimos 90 dias'],['year','Este ano']].map(([k,t])=>el('option',{value:k,text:t})));
    kp.value = S.kpiPeriod;
  }
  // filtros (não se aplicam aos indicadores)
  const filtersOn = !!V && S.page !== 'kpi';
  $('#searchWrap').hidden = !filtersOn;
  const fl = $('#flt'); fl.hidden = !filtersOn;
  fl.replaceChildren(el('option',{value:'',text:'Todas as etiquetas'}), ...labelList().map(l=>el('option',{value:l.id,text:l.name})));
  fl.value = labelById(S.label) ? S.label : ''; S.label = fl.value;
  const sel = $('#fltWho'); const cur = S.who;
  const ids = V ? [...new Set(boardCards(V).map(c=>c.assigneeId).filter(Boolean))] : [];
  sel.hidden = !filtersOn || S.view === 'mine';
  sel.replaceChildren(el('option',{value:'',text:'Todos os responsáveis'}),
    ...ids.map(id=>mem(id)).filter(Boolean).sort(byName).map(m=>el('option',{value:m.id,text:m.id===V?.id?`${m.name} (eu)`:m.name})),
    el('option',{value:'__none',text:'Sem responsável'}));
  sel.value = [...sel.options].some(o=>o.value===cur) ? cur : '';
  S.who = sel.hidden ? '' : sel.value;
  const rs = $('#fltReq'); const rcur = S.req || '';
  const rids = V ? [...new Set(boardCards(V).map(c=>c.requester).filter(id=>id && reqName(id)))] : [];
  rs.replaceChildren(el('option',{value:'',text:'Todas as solicitantes'}), ...rids.map(id=>({id,name:reqName(id)})).sort(byName).map(r=>el('option',{value:r.id,text:r.name})));
  rs.value = rids.includes(rcur) ? rcur : ''; S.req = rs.value;
  rs.hidden = !filtersOn || !rids.length;
  // avisos
  const unread = V ? directNotifs(V).filter(n=>!n.read).length : 0;
  const teamUnread = V ? teamNotifs(V).some(n=>!n.read) : false;
  const bell = $('#bellBtn');
  bell.classList.remove('team-dot');
  bell.hidden = !V;
  const tCount = V ? teamNotifs(V).filter(n=>!n.read).length : 0;
  const bc = bell.querySelector('.bell-count');
  bc.textContent = unread ? (unread > 9 ? '9+' : String(unread)) : (tCount > 9 ? '9+' : String(tCount));
  bc.hidden = !unread && !tCount;
  bc.classList.toggle('soft', !unread && !!tCount);   // só acontecimentos da equipe: número cinza, discreto
  bell.setAttribute('aria-label', unread ? `Avisos: ${unread} não lido${unread===1?'':'s'}` : 'Avisos');
  // faixa de simulação
  const bn = $('#banner');
  if (S.viewAs && L && S.viewAs !== L.id && mem(S.viewAs)){
    const m = mem(S.viewAs);
    bn.hidden = false;
    bn.replaceChildren(el('span',{}, `Simulando a visão de ${m.name} (${levelName(m)}). Aqui você só visualiza o que essa pessoa vê.`),
      el('button',{type:'button',onclick:()=>{S.viewAs=null;render();}},'Voltar para a minha visão'));
  } else bn.hidden = true;
}

/* Barra lateral de áreas (e lista no topo em telas estreitas) para quem enxerga mais de uma área */
function renderAreaBar(V){
  const bar = $('#areaBar'), sel = $('#areaSel');
  const choices = areaChoices(V);
  if (choices.length < 2){ bar.hidden = true; sel.hidden = true; if (S.areaFilter && !choices.some(a=>a.id===S.areaFilter)) S.areaFilter = ''; return; }
  if (S.areaFilter && !choices.some(a=>a.id===S.areaFilter)) S.areaFilter = '';
  const pool = boardCards(V).filter(c => !isDoneCard(c) && passesFilters(c, true));
  const count = a => pool.filter(c => !a || cardInArea(c, a)).length;
  const pick = a => { S.areaFilter = a; S.kpiPerson = null; savePrefs(); render(); };
  bar.hidden = false; sel.hidden = false;
  bar.classList.toggle('collapsed', !!S.barCollapsed);
  $('#areaOpen').hidden = true;
  if (S.barCollapsed){
    // recolhida: faixa estreita no mesmo lugar, sempre visível, para abrir de novo
    const cur = S.areaFilter ? (choices.find(a=>a.id===S.areaFilter)?.name || 'Todas as áreas') : 'Todas as áreas';
    const open = () => { S.barCollapsed = false; savePrefs(); render(); };
    bar.replaceChildren(
      el('button',{type:'button',class:'icon-btn ab-expand',title:'Mostrar as áreas','aria-label':'Mostrar as áreas',onclick:open},'›'),
      el('button',{type:'button',class:'ab-rail',title:'Mostrar as áreas',onclick:open}, el('span',{text:'Áreas · '+cur})));
    sel.replaceChildren(el('option',{value:'',text:'Todas as áreas'}), ...choices.map(a=>el('option',{value:a.id,text:a.name})));
    sel.value = S.areaFilter || '';
    return;
  }
  bar.replaceChildren(
    el('div',{class:'ab-head'}, el('b',{text:'Áreas'}), el('button',{type:'button',class:'icon-btn',title:'Recolher a barra','aria-label':'Recolher a barra',onclick:()=>{ S.barCollapsed = true; savePrefs(); render(); }},'‹')),
    el('button',{type:'button',class:'ab-item'+(!S.areaFilter?' on':''),onclick:()=>pick('')}, el('span',{text:'Todas as áreas'}), el('small',{text:String(count(''))})),
    ...choices.map(a=>el('button',{type:'button',class:'ab-item'+(S.areaFilter===a.id?' on':''),onclick:()=>pick(a.id)}, el('span',{text:a.name}), el('small',{text:String(count(a.id))}))),
    el('p',{class:'ab-note',text:'O número mostra as atividades em aberto nesta visualização.'}));
  sel.replaceChildren(el('option',{value:'',text:'Todas as áreas'}), ...choices.map(a=>el('option',{value:a.id,text:a.name})));
  sel.value = S.areaFilter || '';
}
function render(){
  const b = $('#board');
  const sx = b.scrollLeft, sy = b.scrollTop;
  b.replaceChildren();
  if (!S.loaded){ b.className='board'; b.append(el('div',{class:'empty'}, el('h2',{text:'Carregando o quadro…'}))); return; }
  const V = viewer();
  renderTop(V);
  renderAreaBar(V);
  if (!V){ b.className='board'; b.append(gateEl()); return; }
  if (S.page === 'calendar'){ b.className='page'; b.append(calendarEl(V)); b.scrollTop = sy; refreshModals(); return; }
  if (S.page === 'kpi'){ b.className='page'; b.append(kpiEl(V)); b.scrollTop = sy; refreshModals(); return; }
  b.className = 'board';
  if (!S.columns.length){
    b.append(el('div',{class:'empty'},
      el('h2',{text:'Seu quadro ainda não tem colunas'}),
      canManage(V) ? el('p',{text:'Comece com as etapas padrão (A fazer, Em andamento, Validação, Concluído) ou crie a sua primeira coluna.'}) : el('p',{text:'Peça a um Líder para criar as etapas do quadro.'}),
      canManage(V) ? el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;justify-content:center'},
        el('button',{class:'btn primary',type:'button',onclick:createDefaultColumns},'Criar colunas padrão'),
        el('button',{class:'btn',type:'button',onclick:addColumn},'Criar coluna vazia')) : null));
    return;
  }
  colsSorted().forEach(c => b.append(colEl(c, V)));
  if (canManage(V)) b.append(el('button',{class:'add-col',type:'button',onclick:addColumn},'+ Nova coluna'));
  b.scrollLeft = sx;
  if (S.editCol){ const i=document.getElementById('rename-'+S.editCol); if(i){ i.focus(); i.select(); } }
  refreshModals();
}
function refreshModals(){ if (S.teamOpen) drawTeam(); else if (S.autoOpen) drawAuto(); }

function gateEl(){
  return el('div',{class:'center-msg'},
    el('h2',{text:'Você não faz parte de um time ativo'}),
    el('p',{text:'Peça para o líder do seu time adicionar o seu e-mail. Se já foi adicionado, abra a tela de cadastros para entrar no time.'}),
    el('a',{class:'btn primary',href:'./index.html'},'Abrir cadastros'));
}

/* ================= Ações do quadro ================= */
function nextOrder(colId){ const os=S.cards.filter(c=>c.columnId===colId).map(c=>c.order||0); return (os.length?Math.max(...os):0)+1000; }
function newCardBase(V, colId){
  return {id:uid('card_'), columnId:colId || workCols()[0]?.id || colsSorted()[0]?.id, title:'', description:'', labels:[], priority:'',
    area:defaultArea(V), assigneeId:V.id, createdBy:V.id, assignedBy:V.id, assignedAt:nowISO(), delegators:[], requester:'', due:'',
    checklist:[], links:[], requiresValidation:false, validatorId:'', validation:null, ack:null, lateReason:'', createdAt:nowISO()};
}
function addQuick(colId, title){
  title = title.trim(); if(!title) return;
  const V = viewer(); if (!V) return;
  saveCard({...newCardBase(V, colId), title, order:nextOrder(colId)});
  S.quickCol = colId; render();
}
function addColumn(){
  const os = S.columns.map(c=>c.order||0);
  const col = {id:uid('col_'), title:'Nova coluna', color:COL_COLORS[S.columns.length%COL_COLORS.length], done:false, validation:false, order:(os.length?Math.max(...os):0)+1000};
  S.editCol = col.id; saveCol(col);
}
function moveCol(col, dir){
  const list = colsSorted(); const i = list.findIndex(c=>c.id===col.id); const j=i+dir;
  if (j<0||j>=list.length) return;
  const other = list[j]; const a=col.order, b=other.order;
  S.menuCol=null; saveCol({...col,order:b}); saveCol({...other,order:a});
}

/* ================= Arrastar e soltar ================= */
const drag = {id:null, col:null, index:-1, ph:null};
function clearDrag(){ drag.id=null; drag.ph?.remove(); drag.ph=null; document.querySelectorAll('.col.over').forEach(n=>n.classList.remove('over')); }
function onDragOver(e, colId, body){
  if (!drag.id) return;
  e.preventDefault(); e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.col.over').forEach(n=>{ if(n.dataset.col!==colId) n.classList.remove('over'); });
  body.parentElement.classList.add('over');
  const items = [...body.querySelectorAll('.card:not(.dragging)')];
  let idx = items.length;
  for (let i=0;i<items.length;i++){ const r=items[i].getBoundingClientRect(); if (e.clientY < r.top + r.height/2){ idx=i; break; } }
  if (!drag.ph) drag.ph = el('div',{class:'placeholder'});
  if (idx < items.length) body.insertBefore(drag.ph, items[idx]); else body.append(drag.ph);
  drag.col = colId; drag.index = idx;
}
function onDrop(e, colId){
  e.preventDefault();
  if (!drag.id) return;
  const V = viewer();
  const card = S.cards.find(c=>c.id===drag.id);
  if (!card || !canEdit(card, V) && !canValidate(card, V)) { clearDrag(); return; }
  const visible = filteredCards(colId, V).filter(c=>c.id!==drag.id);
  const idx = drag.col===colId ? drag.index : visible.length;
  const prev = visible[idx-1]?.order, next = visible[idx]?.order;
  let order;
  if (prev==null && next==null) order = 1000;
  else if (prev==null) order = next - 1000;
  else if (next==null) order = prev + 1000;
  else order = (prev+next)/2;
  clearDrag();
  if (card.columnId === colId){ saveCard({...card, order}); return; }
  if (colById(colId)?.waiting && !isWaitCol(card)){
    if (card.hold?.status==='requested'){ toast(`Já existe um pedido de pausa aguardando ${mname(card.hold.approverId)}.`); render(); return; }
    askHold(card, V); render(); return;
  }
  if (needsValidatorPick(card, colId, V)){ askValidator(card, V, colId); render(); return; }
  const r = routeMove(card, colId, V);
  if (r.blocked){ toast(r.msg); render(); return; }
  if (r.card.columnId !== colId) order = nextOrder(r.card.columnId);
  saveCard({...r.card, order});
  toast(r.msg || `Movido para “${colById(r.card.columnId)?.title}”`);
}

/* ================= Detalhe do cartão ================= */
function openCard(id, startTab){
  const V = viewer(); if (!V) return;
  const isNew = !id;
  const base = isNew ? newCardBase(V) : S.cards.find(c=>c.id===id);
  if (!base || !base.columnId) return;
  const d = JSON.parse(JSON.stringify(base));
  d.links = d.links || []; d.checklist = d.checklist || []; d.labels = d.labels || []; d.attachments = d.attachments || [];
  const ro = !isNew && !canEdit(base, V);
  let tab = startTab || 'detalhes', confirmDel = false, askTime = false, askReturn = false;
  let draftComment = '', comments = [], unsub = null;
  const root = $('#modalRoot');
  const close = () => {
    if (unsub) unsub(); root.replaceChildren(); document.removeEventListener('keydown', esc);
  };
  const esc = e => { if (e.key==='Escape') close(); };
  document.addEventListener('keydown', esc);
  if (!isNew){
    if (S.store === 'db'){
      try{ unsub = db.collection('comments').where('cardId','==',base.id).onSnapshot(snap => {
        comments = snap.docs.map(x=>({id:x.id, ...x.data()})).sort((a,b)=>(a.at||'').localeCompare(b.at||''));
        if (tab==='comentarios') draw();
      }, ()=>{}); }catch(e){}
    } else comments = S.localComments.filter(c=>c.cardId===base.id);
  }
  const act = changes => { saveCard({...JSON.parse(JSON.stringify(S.cards.find(c=>c.id===base.id)||base)), ...changes}); close(); };

  function banners(){
    const out = [];
    if (isNew) return out;
    const cur = S.cards.find(c=>c.id===base.id) || base;
    // aceite
    if (cur.assigneeId===V.id && cur.assignedBy && cur.assignedBy!==V.id && !cur.ack && !isDoneCard(cur) && !S.readOnly){
      const dateIn = el('input',{type:'date',id:'ack-date',value: cur.due ? addDays(cur.due,3) : addDays(todayISO(),3)});
      const noteIn = el('input',{id:'ack-note',placeholder:'Motivo (opcional)'});
      out.push(el('div',{class:'m-banner acc'},
        el('p',{}, el('b',{text:mname(cur.assignedBy)}), ` atribuiu esta atividade a você${cur.due?`, com prazo para ${fmtDate(cur.due)}`:''}. Confirme o recebimento.`),
        askTime
          ? el('div',{class:'acts'}, el('span',{text:'Novo prazo:'}), dateIn, noteIn,
              el('button',{class:'btn primary',type:'button',onclick:()=>{ if(!dateIn.value){toast('Escolha a data.');return;} act({ack:{status:'more_time', at:nowISO(), proposedDue:dateIn.value, note:noteIn.value.trim()}}); toast('Pedido de prazo enviado'); }},'Enviar pedido'),
              el('button',{class:'btn ghost',type:'button',onclick:()=>{askTime=false;draw();}},'Cancelar'))
          : el('div',{class:'acts'},
              el('button',{class:'btn primary',type:'button',onclick:()=>{ act({ack:{status:'ok', at:nowISO()}}); toast('Recebimento confirmado'); }},'De acordo'),
              el('button',{class:'btn',type:'button',onclick:()=>{askTime=true;draw();}},'Preciso de mais prazo'))));
    }
    if (cur.ack?.status==='more_time' && (cur.assignedBy===V.id || isLider(V)) && cur.assigneeId!==V.id && !S.readOnly){
      out.push(el('div',{class:'m-banner warn'},
        el('p',{}, el('b',{text:mname(cur.assigneeId)}), ` pediu prazo até ${fmtDate(cur.ack.proposedDue)}${cur.ack.note?`: “${cur.ack.note}”`:''}.`),
        el('div',{class:'acts'},
          el('button',{class:'btn primary',type:'button',onclick:()=>{ act({due:cur.ack.proposedDue, ack:{...cur.ack, status:'accepted', at:nowISO()}}); toast('Novo prazo aceito'); }},'Aceitar novo prazo'),
          el('button',{class:'btn',type:'button',onclick:()=>{ act({ack:{...cur.ack, status:'kept', at:nowISO()}}); toast('Prazo original mantido'); }},'Manter prazo atual'))));
    }
    // aguardando
    if (cur.hold?.status==='requested'){
      if (canApproveHold(cur, V)){
        const noteIn = el('input',{id:'hold-deny',placeholder:'Motivo da recusa (opcional)'});
        out.push(el('div',{class:'m-banner warn'},
          el('p',{}, el('b',{text:mname(cur.hold.requestedBy)}), ` pediu para mover para Aguardando: “${cur.hold.reason}”. Se aprovar, o prazo para de contar a partir de agora.`),
          el('div',{class:'acts'},
            el('button',{class:'btn primary',type:'button',onclick:()=>{ approveHold(S.cards.find(c=>c.id===base.id)||cur, V); close(); }},'Aprovar pausa'),
            noteIn,
            el('button',{class:'btn danger',type:'button',onclick:()=>{ act({hold:{...cur.hold, status:'denied', deniedBy:V.id, note:noteIn.value.trim(), at:nowISO()}}); toast('Pausa recusada'); }},'Recusar'))));
      } else {
        out.push(el('div',{class:'m-banner warn'},
          el('p',{text:`Pedido de pausa enviado para ${mname(cur.hold.approverId)}: “${cur.hold.reason}”. O cartão vai para Aguardando quando for aprovado.`}),
          cur.hold.requestedBy===V.id ? el('div',{class:'acts'}, el('button',{class:'btn ghost',type:'button',onclick:()=>{ act({hold:null}); toast('Pedido cancelado'); }},'Cancelar pedido')) : null));
      }
    }
    if (cur.hold?.status==='denied' && !isWaitCol(cur)){
      out.push(el('div',{class:'m-banner bad'}, el('p',{text:`${mname(cur.hold.deniedBy)} recusou a pausa${cur.hold.note?`: “${cur.hold.note}”`:''}. A atividade segue contando o prazo.`})));
    }
    if (isWaitCol(cur) && cur.hold?.status==='active'){
      const n = pauseDaysBetween(cur.hold.startedAt, nowISO());
      const back = prevWorkCol();
      out.push(el('div',{class:'m-banner'},
        el('p',{}, `Em Aguardando desde ${fmtDT(cur.hold.startedAt)} (${n} dia${n===1?'':'s'}). Motivo: “${cur.hold.reason}”.`,
          cur.hold.approvedBy && cur.hold.approvedBy!==cur.hold.requestedBy ? ` Aprovada por ${mname(cur.hold.approvedBy)}.` : '',
          cur.due && n ? ` Ao retomar hoje, o prazo passa de ${fmtDate(cur.due)} para ${fmtDate(addDays(cur.due, n))}.` : ''),
        canEdit(cur, V) && back ? el('div',{class:'acts'}, el('button',{class:'btn primary',type:'button',onclick:()=>{ act({columnId:back.id, order:nextOrder(back.id)}); toast(`Atividade retomada em “${back.title}”`); }},`Retomar em “${back.title}”`)) : null));
    }
    if ((cur.pauses||[]).length){
      const t = cur.pauses.reduce((n,p)=>n+(p.days||0),0);
      out.push(el('div',{class:'note full',text:`${cur.pauses.length} pausa${cur.pauses.length===1?'':'s'} registrada${cur.pauses.length===1?'':'s'}, somando ${t} dia${t===1?'':'s'}.${cur.originalDue?` Prazo original: ${fmtDate(cur.originalDue)}.`:''}`}));
    }
    // validação
    if (cur.requiresValidation){
      const vs = cur.validation?.status;
      if (vs==='pending' && canValidate(cur, V)){
        const noteIn = el('textarea',{id:'ret-note',placeholder:'O que precisa ser ajustado?'});
        out.push(el('div',{class:'m-banner warn'},
          el('p',{}, el('b',{text:mname(cur.validation.by||cur.assigneeId)}), ' enviou esta atividade para a sua validação.'),
          askReturn ? noteIn : null,
          el('div',{class:'acts'},
            askReturn
              ? [el('button',{class:'btn danger solid',type:'button',onclick:()=>{
                    const note = noteIn.value.trim(); if(!note){ toast('Escreva o que precisa ser ajustado.'); return; }
                    const col = prevWorkCol();
                    act({columnId:col.id, order:nextOrder(col.id), validation:{status:'returned', at:nowISO(), by:V.id, note}});
                    addComment(cur, `Devolvida para ajustes: ${note}`, V);
                    toast('Atividade devolvida'); }},'Devolver'),
                 el('button',{class:'btn ghost',type:'button',onclick:()=>{askReturn=false;draw();}},'Cancelar')]
              : [el('button',{class:'btn primary',type:'button',onclick:()=>{
                    const dc = doneCol(); if(!dc){ toast('O quadro não tem etapa final.'); return; }
                    act({columnId:dc.id, order:nextOrder(dc.id), validation:{status:'approved', at:nowISO(), by:V.id, note:''}}); toast('Validada e concluída'); }},'Aprovar e concluir'),
                 el('button',{class:'btn danger',type:'button',onclick:()=>{askReturn=true;draw();}},'Devolver para ajustes')])));
      } else if (vs==='pending'){
        out.push(el('div',{class:'m-banner warn'}, el('p',{text:`Aguardando a validação de ${mname(cur.validatorId)}.`})));
      } else if (vs==='approved' && isDoneCard(cur)){
        out.push(el('div',{class:'m-banner ok'}, el('p',{text:`Validada por ${mname(cur.validation.by)} em ${fmtDT(cur.validation.at)}.`})));
      } else if (!isDoneCard(cur)){
        const vc = validationCol();
        out.push(el('div',{class:'m-banner'+(vs==='returned'?' bad':'')},
          el('p',{text: vs==='returned'
            ? `${mname(cur.validation.by)} devolveu para ajustes${cur.validation.note?`: “${cur.validation.note}”`:''}. Quando terminar, envie de novo.`
            : `Esta atividade precisa da validação de ${mname(cur.validatorId)} antes de ser concluída.`}),
          canEdit(cur, V) && vc ? el('div',{class:'acts'}, el('button',{class:'btn primary',type:'button',onclick:()=>{
            const r = routeMove(cur, vc.id, V); act({...r.card, order:nextOrder(vc.id)}); toast('Enviada para validação'); }},'Enviar para validação')) : null));
      }
    }
    return out;
  }

  function detailsTab(){
    const done = d.checklist.filter(i=>i.done).length;
    const pct = d.checklist.length ? Math.round(done/d.checklist.length*100) : 0;
    const areaOpts = areasFor(V);
    if (!ro && d.area && !areaOpts.some(a=>a.id===d.area) && !isLider(V)) d.area = areaOpts[0]?.id || '';
    let people = assignable(V, d.area);
    if (ro && d.assigneeId && !people.some(p=>p.id===d.assigneeId) && mem(d.assigneeId)) people = [...people, mem(d.assigneeId)];
    else if (!ro && d.assigneeId && !people.some(p=>p.id===d.assigneeId)) d.assigneeId = (permsOf(V).assign||'self')==='self' ? V.id : '';
    const assignee = mem(d.assigneeId);
    const canSetVal = !ro && assignee && assignee.id !== V.id && isAbove(V, assignee) && !!permsOf(V).requireValidation;
    const late = isLate(d) || deliveredLate(d) || !!d.lateReason;
    const creator = mem(d.createdBy);
    const newItem = el('input',{id:'chk-new',placeholder:'Novo item do checklist',disabled:ro,onkeydown:e=>{ if(e.key==='Enter'){ e.preventDefault(); addItem(); } }});
    const addItem = () => { const v=newItem.value.trim(); if(!v) return; d.checklist.push({id:uid('i_'),text:v,done:false}); draw(); setTimeout(()=>document.getElementById('chk-new')?.focus(),0); };
    const lnLabel = el('input',{id:'ln-label',placeholder:'Nome (ex.: Painel de cobertura)',disabled:ro});
    const lnUrl = el('input',{id:'ln-url',placeholder:'https://…',disabled:ro,onkeydown:e=>{ if(e.key==='Enter'){ e.preventDefault(); addLink(); } }});
    const addLink = () => { const u = safeUrl(lnUrl.value); if(!u){ toast('Cole um link completo, começando com https://'); return; } d.links.push({id:uid('l_'), label:lnLabel.value.trim(), url:u}); draw(); };
    const startCol = colsSorted();
    return el('div',{class:'m-body'},
      ...banners(),
      ro ? el('div',{class:'note full',text:'Você pode acompanhar esta atividade, mas só o responsável (ou um nível acima) pode alterá-la.'}) : null,
      el('label',{class:'field'}, el('span',{},'Etapa'),
        el('select',{id:'m-col',disabled:ro,onchange:e=>{ d.columnId=e.target.value; }},
          startCol.map(c=>el('option',{value:c.id,selected:c.id===d.columnId,disabled:isNew && (c.waiting||c.validation) ? true : null,text:c.title + (c.validation?' (validação)':'') + (c.waiting?' (precisa de justificativa)':'')})))),
      el('label',{class:'field'}, el('span',{},'Prioridade'),
        el('select',{id:'m-prio',disabled:ro,onchange:e=>d.priority=e.target.value},
          [['','Sem prioridade'],['baixa','Baixa'],['media','Média'],['alta','Alta']].map(([v,t])=>el('option',{value:v,selected:d.priority===v,text:t})))),
      el('label',{class:'field'}, el('span',{},'Área'),
        el('select',{id:'m-area',disabled:ro,onchange:e=>{ d.area=e.target.value; draw(); }},
          (isLider(V) || !areaOpts.length) ? el('option',{value:'',selected:!d.area,text:'Sem área'}) : null,
          (ro && d.area && !areaOpts.some(a=>a.id===d.area)) ? el('option',{value:d.area,selected:true,text:areaName(d.area)}) : null,
          areaOpts.map(a=>el('option',{value:a.id,selected:a.id===d.area,text:a.name})))),
      el('label',{class:'field'}, el('span',{},'Responsável'),
        el('select',{id:'m-who',disabled:ro||(permsOf(V).assign||'self')==='self',onchange:e=>{ d.assigneeId=e.target.value; if (!canSetValFor(e.target.value)) { d.requiresValidation=false; } draw(); }},
          (permsOf(V).assign||'self') !== 'self' ? el('option',{value:'',selected:!d.assigneeId,text:'Sem responsável'}) : null,
          people.map(p=>el('option',{value:p.id,selected:p.id===d.assigneeId,text:`${p.name}${p.id===V.id?' (eu)':''} · ${levelName(p)}`})))),
      el('label',{class:'field'}, el('span',{},'Área solicitante (opcional)'),
        el('select',{id:'m-req',disabled:ro,onchange:e=>d.requester=e.target.value},
          el('option',{value:'',selected:!d.requester,text:'Não informada'}),
          S.areas.length ? el('optgroup',{label:'Times internos'}, S.areas.slice().sort(byName).map(a=>el('option',{value:a.id,selected:d.requester===a.id,text:a.name}))) : null,
          S.requesters.length ? el('optgroup',{label:'Outras áreas'}, S.requesters.slice().sort(byName).map(r=>el('option',{value:r.id,selected:d.requester===r.id,text:r.name}))) : null)),
      el('label',{class:'field'}, el('span',{},'Prazo'),
        el('input',{id:'m-due',type:'date',value:d.due,disabled:ro,onchange:e=>{ d.due=e.target.value; draw(); }})),
      (canSetVal || d.requiresValidation) ? el('div',{class:'field full'}, el('span',{},'Validação'),
        el('label',{class:'inline'},
          el('input',{type:'checkbox',id:'m-reqval',checked:!!d.requiresValidation,disabled:!(canSetVal || canValidate(base, V)) || isDoneCard(d),
            onchange:e=>{ d.requiresValidation=e.target.checked; d.validatorId = e.target.checked ? (d.validatorId && !canSetVal ? d.validatorId : V.id) : ''; draw(); }}),
          el('span',{text: d.requiresValidation
            ? `Exige validação de ${d.validatorId===V.id?'você':mname(d.validatorId)}: o responsável envia para “Validação” e só ${d.validatorId===V.id?'você conclui':'o validador conclui'}.`
            : 'Exigir minha validação antes de concluir'}))) : null,
      late ? el('label',{class:'field full'}, el('span',{},'Motivo do atraso'),
        el('select',{id:'m-reason',disabled:ro,onchange:e=>d.lateReason=e.target.value},
          el('option',{value:'',selected:!d.lateReason,text:'Selecione o motivo'}),
          LATE_REASONS.map(([k,t])=>el('option',{value:k,selected:d.lateReason===k,text:t})))) : null,
      el('div',{class:'field full'}, el('span',{},'Etiquetas'),
        el('div',{class:'chips'}, labelList().map(L=>el('button',{type:'button',class:'chip',disabled:ro,'aria-pressed':String(d.labels.includes(L.id)),
          onclick:()=>{ d.labels = d.labels.includes(L.id)? d.labels.filter(x=>x!==L.id) : [...d.labels,L.id]; draw(); }},
          el('i',{style:`background:${L.color}`}), L.name)))),
      el('label',{class:'field full'}, el('span',{},'Descrição'),
        el('textarea',{id:'m-desc',placeholder:'Contexto, critérios de entrega…',disabled:ro,oninput:e=>d.description=e.target.value}, d.description)),
      el('div',{class:'field full'}, el('span',{},`Links e anexos · ${d.links.length}`), d.links.length ? null : el('small',{class:'muted',style:'color:var(--muted);font-size:12px',text:'Para fotos, vídeos e arquivos, suba no Drive, OneDrive ou SharePoint e cole o link aqui.'}),
        d.links.length ? el('div',{class:'links'}, d.links.map(l=>el('div',{class:'link-row'},
          el('a',{href:l.url,target:'_blank',rel:'noopener noreferrer',text:l.label||l.url}),
          l.label ? el('small',{text:l.url.replace(/^https?:\/\//,'')}) : null,
          ro ? null : el('button',{class:'icon-btn',type:'button','aria-label':'Remover link',onclick:()=>{ d.links=d.links.filter(x=>x.id!==l.id); draw(); }},'✕')))) : null,
        ro ? null : el('div',{class:'link-add'}, lnLabel, lnUrl, el('button',{class:'btn',type:'button',onclick:addLink},'Adicionar link'))),
      el('div',{class:'field full'},
        el('span',{}, `Checklist · ${done}/${d.checklist.length}`),
        d.checklist.length ? el('div',{class:'check-bar'}, el('b',{style:`width:${pct}%`})) : null,
        el('div',{class:'check-list'}, d.checklist.map(it=>el('div',{class:'check-item'+(it.done?' done':'')},
          el('input',{type:'checkbox',id:'ck-'+it.id,checked:it.done,disabled:ro,onchange:e=>{ it.done=e.target.checked; draw(); }}),
          el('label',{for:'ck-'+it.id,text:it.text}),
          ro?null:el('button',{class:'icon-btn',type:'button','aria-label':'Remover item',onclick:()=>{ d.checklist=d.checklist.filter(x=>x.id!==it.id); draw(); }},'✕')))),
        ro?null:el('div',{class:'check-add'}, newItem, el('button',{class:'btn',type:'button',onclick:addItem},'Adicionar'))),
      el('div',{class:'field'}, el('span',{},'Criado por'), el('div',{style:'padding:4px 0'}, creator ? `${creator.name} · ${levelName(creator)}` : (base.recurrenceId ? 'Automação' : '—'))),
      base.recurrenceId ? el('div',{class:'field'}, el('span',{},'Recorrência'), el('div',{style:'padding:4px 0'}, (()=>{ const r=S.recurrences.find(x=>x.id===base.recurrenceId); return r ? freqText(r) : 'Automação removida'; })())) : null
    );
  }
  function canSetValFor(id){ const a = mem(id); return !!a && a.id !== V.id && isAbove(V, a) && !!permsOf(V).requireValidation; }

  function commentsTab(){
    const people = S.members.filter(m => m.id !== V.id && canSee(base, m)).sort(byName);
    const ta = el('textarea',{id:'cmt-text',placeholder:'Escreva um comentário. Use os nomes abaixo para mencionar alguém.',oninput:e=>draftComment=e.target.value}, draftComment);
    const renderText = t => {
      const parts = []; let rest = t;
      const names = S.members.map(m=>'@'+m.name).sort((a,b)=>b.length-a.length);
      while (rest){
        let hit = -1, nm = '';
        for (const n of names){ const i = rest.indexOf(n); if (i>=0 && (hit<0 || i<hit)){ hit=i; nm=n; } }
        if (hit<0){ parts.push(rest); break; }
        if (hit>0) parts.push(rest.slice(0,hit));
        parts.push(el('span',{class:'mention',text:nm}));
        rest = rest.slice(hit+nm.length);
      }
      return parts;
    };
    return el('div',{class:'t-body'},
      comments.length ? el('div',{class:'comments'}, comments.map(c=>el('div',{class:'cmt'},
        el('span',{class:'who',text:initials(mname(c.by))}),
        el('div',{class:'cmt-body'}, el('header',{}, el('b',{text:mname(c.by)}), el('span',{text:fmtDT(c.at)})), el('p',{}, renderText(c.text||''))))))
        : el('div',{class:'empty-note',text:'Nenhum comentário ainda.'}),
      canSee(base, V) && !S.readOnly ? el('div',{class:'composer'}, ta,
        people.length ? el('div',{class:'mentions'}, el('span',{text:'Mencionar:'}), people.map(p=>el('button',{type:'button',onclick:()=>{ draftComment = (draftComment && !/\s$/.test(draftComment) ? draftComment+' ' : draftComment) + '@'+p.name+' '; draw(); setTimeout(()=>{ const t=document.getElementById('cmt-text'); if(t){ t.focus(); t.setSelectionRange(t.value.length,t.value.length); } },0); }}, p.name))) : null,
        el('div',{class:'inline'}, el('button',{class:'btn primary',type:'button',onclick:async()=>{
          const ok = await addComment(S.cards.find(c=>c.id===base.id)||base, draftComment, V);
          if (ok){ draftComment=''; if (S.store!=='db') comments = S.localComments.filter(c=>c.cardId===base.id); draw(); }
        }},'Comentar'))) : null);
  }
  function historyTab(){
    const cur = S.cards.find(c=>c.id===base.id) || base;
    const h = (cur.history||[]).slice().reverse();
    return el('div',{class:'t-body'}, h.length
      ? el('div',{class:'hist'}, h.map(x=>el('div',{class:'hist-row'}, el('time',{text:fmtDT(x.at)}), el('span',{text:historyText(x)}))))
      : el('div',{class:'empty-note',text:'O histórico começa a ser registrado a partir das próximas alterações.'}));
  }

  function draw(){
    const cur = S.cards.find(c=>c.id===base.id) || base;
    const tabs = isNew ? [] : [['detalhes','Detalhes'],['comentarios',`Comentários${comments.length?` (${comments.length})`:''}`],['historico','Histórico']];
    const body = tab==='comentarios' ? commentsTab() : tab==='historico' ? historyTab() : detailsTab();
    const modal = el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-label':'Detalhes da atividade',onclick:e=>e.stopPropagation()},
      el('div',{class:'m-head'},
        el('textarea',{id:'m-title',rows:'2',placeholder:'Título da atividade',disabled:ro||tab!=='detalhes',oninput:e=>d.title=e.target.value}, d.title),
        el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:close},'✕')),
      tabs.length ? el('div',{class:'tabs',role:'tablist'}, tabs.map(([k,t])=>el('button',{type:'button',role:'tab','aria-selected':String(tab===k),onclick:()=>{ tab=k; draw(); }}, t))) : null,
      body,
      tab==='detalhes' ? el('div',{class:'m-foot'},
        isNew||ro ? null : (confirmDel
          ? el('span',{style:'display:flex;gap:6px;align-items:center;flex-wrap:wrap'}, el('small',{text:'Excluir de vez?'}),
              el('button',{class:'btn danger solid',type:'button',onclick:()=>{ deleteCard(d.id); close(); toast('Cartão excluído'); }},'Sim, excluir'),
              el('button',{class:'btn ghost',type:'button',onclick:()=>{confirmDel=false;draw();}},'Cancelar'))
          : el('button',{class:'btn danger',type:'button',onclick:()=>{confirmDel=true;draw();}},'Excluir')),
        el('span',{class:'sp'}),
        !isNew && cur.updatedAt ? el('small',{text:'Atualizado em '+fmtDT(cur.updatedAt)}) : null,
        el('button',{class:'btn ghost',type:'button',onclick:close}, ro?'Fechar':'Cancelar'),
        ro ? null : el('button',{class:'btn primary',type:'button',onclick:()=>save(cur)}, isNew?'Criar atividade':'Salvar'))
      : el('div',{class:'m-foot'}, el('span',{class:'sp'}), el('button',{class:'btn ghost',type:'button',onclick:close},'Fechar')));
    root.replaceChildren(el('div',{class:'scrim',onclick:close}, modal));
  }
  function save(cur){
    if(!d.title.trim()){ toast('Dê um título à atividade.'); document.getElementById('m-title')?.focus(); return; }
    d.title = d.title.trim();
    if (d.assigneeId && !assignable(V, d.area).some(p=>p.id===d.assigneeId) && d.assigneeId!==base.assigneeId){ toast('Você não pode atribuir para essa pessoa.'); return; }
    if (d.requiresValidation && !d.validatorId) d.validatorId = V.id;
    // validação ao mudar de etapa pelo seletor
    let out = {...cur, ...d};
    let msg = null;
    let wantHold = false, wantVal = null;
    if (!isNew && d.columnId !== cur.columnId && colById(d.columnId)?.waiting){
      if (cur.hold?.status==='requested'){ toast(`Já existe um pedido de pausa aguardando ${mname(cur.hold.approverId)}.`); return; }
      out.columnId = cur.columnId; wantHold = true;
    } else if (!isNew && d.columnId !== cur.columnId && needsValidatorPick({...cur, ...d}, d.columnId, V)){
      out.columnId = cur.columnId; wantVal = d.columnId;
    } else if (!isNew && d.columnId !== cur.columnId){
      const r = routeMove({...cur, ...d, columnId:cur.columnId}, d.columnId, V);
      if (r.blocked){ toast(r.msg); return; }
      out = r.card; msg = r.msg;
      out.order = nextOrder(out.columnId);
    } else if (isNew){
      if (d.requiresValidation && colById(d.columnId)?.done){ toast('Uma atividade com validação não pode nascer concluída.'); return; }
      out.order = nextOrder(out.columnId);
    }
    const reassigned = isNew || out.assigneeId !== cur.assigneeId;
    const prevDelegators = isNew ? [] : delegatorsOf(cur);
    if (reassigned){
      out.assignedBy = V.id; out.assignedAt = nowISO(); out.ack = null;
      out.delegators = (out.assigneeId && out.assigneeId !== V.id) ? [...new Set([...prevDelegators, V.id])] : prevDelegators;
    }
    saveCard(out); close();
    if (reassigned && out.assigneeId && out.assigneeId !== V.id) notifyAssignment(out, V, prevDelegators);
    if (wantHold){ askHold(S.cards.find(c=>c.id===out.id)||out, V); return; }
    if (wantVal){ askValidator(S.cards.find(c=>c.id===out.id)||out, V, wantVal); return; }
    const goesAway = S.view==='mine' && out.assigneeId && out.assigneeId!==V.id;
    toast(msg || (goesAway ? `Atribuída a ${mname(out.assigneeId)}. Acompanhe em “Que eu atribuí”.` : (isNew?'Atividade criada':'Alterações salvas')));
  }
  draw();
  if (isNew) setTimeout(()=>document.getElementById('m-title')?.focus(),0);
}

/* ================= Calendário ================= */
function statusOf(c){ if (isDoneCard(c)) return 'done'; if (isWaitCol(c)) return 'wait'; if (isValCol(c)) return 'val'; if (isLate(c)) return 'late'; return 'open'; }
function calChip(c){ return el('button',{type:'button',class:'cal-chip '+statusOf(c),title:`${c.title}${c.assigneeId?' · '+mname(c.assigneeId):''}`,onclick:()=>openCard(c.id)}, c.title); }
function calendarEl(V){
  if (!S.calMonth) S.calMonth = todayISO().slice(0,7);
  const [y,m] = S.calMonth.split('-').map(Number);
  const first = new Date(y, m-1, 1), days = new Date(y, m, 0).getDate();
  const startWd = first.getDay();
  const pool = boardCards(V).filter(passesFilters);
  const cards = pool.filter(c=>c.due && c.due.startsWith(S.calMonth));
  const noDue = pool.filter(c=>!c.due && !isDoneCard(c)).length;
  const byDay = {}; cards.forEach(c=>{ (byDay[c.due] ||= []).push(c); });
  const today = todayISO();
  const shift = k => { const dt = new Date(y, m-1+k, 1); S.calMonth = isoDay(dt).slice(0,7); render(); };
  const label = first.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const nav = el('div',{class:'cal-nav'},
    el('button',{class:'btn',type:'button','aria-label':'Mês anterior',onclick:()=>shift(-1)},'‹'),
    el('h2',{text:label}),
    el('button',{class:'btn',type:'button','aria-label':'Próximo mês',onclick:()=>shift(1)},'›'),
    el('button',{class:'btn ghost',type:'button',onclick:()=>{ S.calMonth = today.slice(0,7); render(); }},'Hoje'),
    el('span',{class:'cal-legend'},
      el('span',{}, el('i',{style:'background:var(--accent)'}),'Em aberto'),
      el('span',{}, el('i',{style:'background:var(--bad)'}),'Atrasada'),
      el('span',{}, el('i',{style:'background:var(--warn)'}),'Em validação'),
      el('span',{}, el('i',{style:'background:var(--muted)'}),'Aguardando'),
      el('span',{}, el('i',{style:'background:var(--ok)'}),'Concluída')));
  const grid = el('div',{class:'cal-grid'}, WEEKDAYS.map(w=>el('div',{class:'cal-wd',text:w})));
  for (let i=0;i<startWd;i++) grid.append(el('div',{class:'cal-cell out'}));
  const agenda = el('div',{class:'agenda'});
  for (let dd=1; dd<=days; dd++){
    const iso = `${S.calMonth}-${String(dd).padStart(2,'0')}`;
    const ORD={late:0,val:1,open:2,wait:3,done:4}; const list = (byDay[iso]||[]).sort((a,b)=>ORD[statusOf(a)]-ORD[statusOf(b)]);
    const open = list.filter(c=>!isDoneCard(c)).length;
    grid.append(el('div',{class:'cal-cell'+(iso===today?' today':'')},
      el('div',{class:'cal-day'}, el('span',{text:String(dd)}), open ? el('span',{class:'load'+(open>=4?' heavy':''),title:`${open} em aberto neste dia`,text:String(open)}) : null),
      list.slice(0,4).map(calChip),
      list.length>4 ? el('button',{type:'button',class:'cal-more',onclick:()=>{ S.page='board'; render(); toast(`${list.length} atividades vencem em ${fmtDate(iso)}`); }},`+${list.length-4} atividades`) : null));
    if (list.length) agenda.append(el('div',{}, el('h3',{text:new Date(iso+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'short'})}), list.map(calChip)));
  }
  const tail = (7 - ((startWd + days) % 7)) % 7;
  for (let i=0;i<tail;i++) grid.append(el('div',{class:'cal-cell out'}));
  if (!agenda.childNodes.length) agenda.append(el('div',{class:'empty-note',text:'Nenhuma atividade com prazo neste mês.'}));
  return el('div',{class:'cal'}, nav, grid, agenda,
    noDue ? el('div',{class:'note',text:`${noDue} atividade${noDue===1?'':'s'} em aberto sem prazo definido não aparece${noDue===1?'':'m'} no calendário.`}) : null);
}

/* ================= Indicadores ================= */
const defaultArea = V => (S.areaFilter && areasFor(V).some(a=>a.id===S.areaFilter)) ? S.areaFilter : ((V.areas||[])[0] || '');
function kpiPeople(V){
  const list = kpiPeopleAll(V);
  return S.areaFilter ? list.filter(p => (p.areas||[]).includes(S.areaFilter) || p.id === V.id && list.length === 1) : list;
}
function kpiPeopleAll(V){
  const k = permsOf(V).kpi || 'own';
  const act = S.members.filter(m=>m.active);
  if (k === 'all') return act.sort((a,b)=>rank(a)-rank(b) || byName(a,b));
  if (k === 'area') return [V, ...act.filter(m=>m.id!==V.id && rank(m) > rank(V) && sharesArea(m, V)).sort(byName)];
  return [V];
}
function periodRange(k){
  const t = todayISO(); const [y,m] = t.split('-').map(Number);
  if (k==='prev') return {from:isoDay(new Date(y, m-2, 1)), to:isoDay(new Date(y, m-1, 0))};
  if (k==='d30') return {from:addDays(t,-29), to:t};
  if (k==='d90') return {from:addDays(t,-89), to:t};
  if (k==='year') return {from:`${y}-01-01`, to:t};
  return {from:`${t.slice(0,7)}-01`, to:t};
}
function kpisFor(m, R){
  const inR = iso => iso && iso >= R.from && iso <= R.to;
  const mine = S.cards.filter(c=>c.assigneeId===m.id);
  const open = mine.filter(c=>!isDoneCard(c));
  const inVal = open.filter(isValCol);
  const waiting = open.filter(isWaitCol);
  const pausedDays = mine.reduce((n,c)=> n + (c.pauses||[]).filter(p=>inR(isoDay(p.to))).reduce((a,p)=>a+(p.days||0),0)
    + (isWaitCol(c) && c.hold?.status==='active' ? pauseDaysBetween(c.hold.startedAt < R.from+'T00:00' ? R.from+'T12:00:00' : c.hold.startedAt, nowISO()) : 0), 0);
  const lateOpen = open.filter(isLate);
  const delivered = mine.filter(c=>isDoneCard(c) && inR(doneDay(c)));
  const onTime = delivered.filter(c=>!deliveredLate(c));
  const lateDel = delivered.filter(deliveredLate);
  const times = delivered.map(c=>(Date.parse(c.doneAt||c.updatedAt) - Date.parse(c.assignedAt||c.createdAt) - pausedMs(c))/86400000).filter(x=>isFinite(x) && x>=0);
  const received = mine.filter(c=>c.assignedBy && c.assignedBy!==m.id && c.assignedAt && inR(isoDay(c.assignedAt))).length;
  const returned = mine.reduce((n,c)=> n + (c.history||[]).filter(h=>h.type==='val_returned' && inR(isoDay(h.at))).length, 0);
  const reasons = {}; [...lateOpen, ...lateDel].forEach(c=>{ const k = c.lateReason || '_none'; reasons[k] = (reasons[k]||0)+1; });
  const byReq = {}; [...delivered, ...open].forEach(c=>{ const k = c.requester && reqName(c.requester) ? c.requester : '_none'; byReq[k] = (byReq[k]||0)+1; });
  return {waiting:waiting.length, pausedDays, open:open.length, inVal:inVal.length, lateOpen:lateOpen.length, lateOpenList:lateOpen, delivered:delivered.length, onTime:onTime.length, lateDel:lateDel.length, times, received, returned, reasons, byReq};
}
function sumK(list){
  const t = {waiting:0,pausedDays:0,open:0,inVal:0,lateOpen:0,lateOpenList:[],delivered:0,onTime:0,lateDel:0,times:[],received:0,returned:0,reasons:{},byReq:{}};
  for (const k of list){
    ['waiting','pausedDays','open','inVal','lateOpen','delivered','onTime','lateDel','received','returned'].forEach(f=>t[f]+=k[f]);
    t.lateOpenList.push(...k.lateOpenList); t.times.push(...k.times);
    for (const [a,b] of Object.entries(k.reasons)) t.reasons[a]=(t.reasons[a]||0)+b;
    for (const [a,b] of Object.entries(k.byReq)) t.byReq[a]=(t.byReq[a]||0)+b;
  }
  return t;
}
const pctOf = k => k.delivered ? Math.round(k.onTime/k.delivered*100) : null;
const avgOf = k => k.times.length ? k.times.reduce((a,b)=>a+b,0)/k.times.length : null;
const fmtDays = v => v==null ? '—' : (v < 1 ? '< 1 dia' : `${v.toFixed(1).replace('.',',')} dias`);
function bars(title, entries, labelFn, bad){
  const max = Math.max(1, ...entries.map(e=>e[1]));
  return el('div',{class:'panel'}, el('h3',{text:title}),
    entries.length ? entries.map(([k,v])=>el('div',{class:'bar-row'}, el('span',{title:labelFn(k),text:labelFn(k)}), el('div',{class:'bar-track'}, el('i',{class:bad&&k!=='_none'?'bad':'',style:`width:${Math.round(v/max*100)}%`})), el('b',{text:String(v)})))
      : el('div',{class:'empty-note',text:'Nada no período.'}));
}
function kpiEl(V){
  const people = kpiPeople(V);
  const R = periodRange(S.kpiPeriod);
  const rows = people.map(p=>({p, k:kpisFor(p, R)}));
  if (S.kpiPerson && !people.some(p=>p.id===S.kpiPerson)) S.kpiPerson = null;
  const single = people.length === 1;
  const selId = single ? people[0].id : S.kpiPerson;
  const K = selId ? rows.find(r=>r.p.id===selId).k : sumK(rows.map(r=>r.k));
  const who = selId ? mem(selId) : null;
  const title = (who ? (who.id===V.id ? `${who.name} (você)` : who.name) : ((permsOf(V).kpi||'own')==='all' ? 'Toda a equipe' : 'Você e sua equipe')) + (S.areaFilter && !who ? ` · ${areaName(S.areaFilter)}` : '');
  const pct = pctOf(K);
  const tiles = el('div',{class:'tiles'},
    tile('Entregas no período', K.delivered, ''),
    tile('Entregues no prazo', K.onTime, 'ok', pct==null?'':`${pct}% das entregas`),
    tile('Entregues com atraso', K.lateDel, K.lateDel?'warn':''),
    tile('Atrasadas em aberto', K.lateOpen, K.lateOpen?'bad':''),
    tile('Em aberto agora', K.open, ''),
    tile('Aguardando validação', K.inVal, K.inVal?'warn':''),
    tile('Em Aguardando (pausadas)', K.waiting, ''),
    tile('Dias em pausa no período', K.pausedDays, ''),
    tile('Tempo médio de entrega', fmtDays(avgOf(K)), '', 'sem contar os dias em pausa'),
    tile('Recebidas no período', K.received, ''),
    tile('Devolvidas na validação', K.returned, K.returned?'warn':''));
  function tile(label, value, cls, sub){ return el('div',{class:'tile '+(cls||'')}, el('span',{text:label}), el('b',{text:String(value)}), sub ? el('small',{text:sub}) : null); }
  const tbl = single ? null : el('div',{class:'kpi-table-wrap'}, el('table',{class:'kpi-table'},
    el('thead',{}, el('tr',{}, ['Pessoa','Em aberto','Atrasadas','Em validação','Aguardando','Entregas','No prazo','Com atraso','% no prazo','Tempo médio'].map(h=>el('th',{text:h})))),
    el('tbody',{}, rows.map(({p,k})=>{ const pc = pctOf(k); return el('tr',{class:selId===p.id?'sel':'',tabindex:'0',onclick:()=>{ S.kpiPerson = S.kpiPerson===p.id?null:p.id; render(); },onkeydown:e=>{ if(e.key==='Enter'){ S.kpiPerson = S.kpiPerson===p.id?null:p.id; render(); } }},
      el('td',{}, el('span',{style:'display:inline-flex;gap:8px;align-items:center'}, el('b',{text:p.name+(p.id===V.id?' (você)':'')}), roleBadge(p))),
      el('td',{text:String(k.open)}), el('td',{class:k.lateOpen?'bad':'',text:String(k.lateOpen)}), el('td',{text:String(k.inVal)}), el('td',{text:String(k.waiting)}),
      el('td',{text:String(k.delivered)}), el('td',{text:String(k.onTime)}), el('td',{class:k.lateDel?'bad':'',text:String(k.lateDel)}),
      el('td',{class:pc==null?'':pc>=80?'ok':pc<60?'bad':'',text:pc==null?'—':pc+'%'}), el('td',{text:fmtDays(avgOf(k))})); })),
    (()=>{ const t = sumK(rows.map(r=>r.k)), pc = pctOf(t); return el('tfoot',{}, el('tr',{},
      el('td',{text:'Total'}), el('td',{text:String(t.open)}), el('td',{text:String(t.lateOpen)}), el('td',{text:String(t.inVal)}), el('td',{text:String(t.waiting)}), el('td',{text:String(t.delivered)}),
      el('td',{text:String(t.onTime)}), el('td',{text:String(t.lateDel)}), el('td',{text:pc==null?'—':pc+'%'}), el('td',{text:fmtDays(avgOf(t))}))); })()));
  const reasons = Object.entries(K.reasons).sort((a,b)=>b[1]-a[1]);
  const reqs = Object.entries(K.byReq).sort((a,b)=>b[1]-a[1]);
  const lateList = K.lateOpenList.filter(c=>inScope(c, V)).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
  return el('div',{class:'kpi'},
    el('div',{class:'kpi-head'}, el('h2',{text:title}), el('span',{text:`${fmtDate(R.from)} a ${fmtDate(R.to)} · entregas contadas pela data de conclusão`}),
      selId && !single ? el('button',{class:'btn ghost',type:'button',onclick:()=>{ S.kpiPerson=null; render(); }},'Ver o total') : null),
    tiles,
    tbl ? el('div',{class:'note',text:'Clique em uma pessoa para ver os indicadores dela em detalhe.'}) : null,
    tbl,
    el('div',{class:'kpi-cols'},
      bars('Motivos de atraso', reasons, k=>k==='_none'?'Sem motivo informado':reasonName(k), true),
      bars('Atividades por área solicitante', reqs, k=>k==='_none'?'Não informada':reqName(k), false),
      el('div',{class:'panel'}, el('h3',{text:`Atrasadas em aberto · ${lateList.length}`}),
        lateList.length ? el('div',{class:'mini-list'}, lateList.slice(0,12).map(c=>el('button',{type:'button',onclick:()=>openCard(c.id)},
          el('span',{text:c.title}), el('small',{class:'pill late',text:fmtDate(c.due)}), !selId||!single ? el('small',{class:'who',style:'margin:0',title:mname(c.assigneeId),text:initials(mname(c.assigneeId))}) : null)))
          : el('div',{class:'empty-note',text:'Nenhuma atividade atrasada.'}))));
}

/* ================= Automações (tela) ================= */
const A = {edit:null, draft:null, confirm:null};
function ruleVisible(r, V){
  if (isLider(V) || r.createdBy===V.id || r.assigneeId===V.id) return true;
  const a = mem(r.assigneeId);
  return !!a && rank(a) > rank(V) && sharesArea(a, V);
}
const ruleEditable = (r, V) => !S.readOnly && (isLider(V) || r.createdBy===V.id);
function openAuto(){ S.autoOpen = true; A.edit=null; A.draft=null; A.confirm=null; drawAuto(); document.addEventListener('keydown', autoEsc); }
function closeAuto(){ S.autoOpen = false; $('#modalRoot').replaceChildren(); document.removeEventListener('keydown', autoEsc); }
function autoEsc(e){ if (e.key==='Escape') closeAuto(); }
function ruleForm(V, r){
  const key = r ? r.id : 'new';
  if (!A.draft || A.draft._for !== key){
    const firstWork = workCols()[0] || colsSorted()[0];
    A.draft = r ? {...JSON.parse(JSON.stringify(r)), checklistText:(r.checklist||[]).join('\n'), _for:key}
      : {id:uid('rec_'), title:'', description:'', assigneeId:V.id, area:defaultArea(V), requester:'', labels:[], priority:'', checklistText:'',
         columnId:firstWork?.id||'', freq:'weekly', weekdays:[1], businessDays:true, monthDay:'1', dueOffset:0, startDate:todayISO(), active:true, requiresValidation:false, createdBy:V.id, _for:key};
  }
  const d = A.draft;
  const wrap = el('div',{class:'form'});
  const draw = () => {
    const people = assignable(V, d.area);
    if (!people.some(p=>p.id===d.assigneeId)) d.assigneeId = V.id;
    const a = mem(d.assigneeId);
    const canVal = a && a.id!==V.id && isAbove(V, a) && !!permsOf(V).requireValidation;
    if (!canVal) d.requiresValidation = false;
    const preview = nextDates({...d, lastGenerated: r?.lastGenerated || ''}, 3);
    wrap.replaceChildren(
      el('label',{class:'field full'}, el('span',{},'Título da atividade'), el('input',{id:'rf-title',value:d.title,placeholder:'Ex.: Atualizar ranking semanal de RNs',oninput:e=>d.title=e.target.value})),
      el('label',{class:'field'}, el('span',{},'Responsável'),
        el('select',{id:'rf-who',disabled:(permsOf(V).assign||'self')==='self',onchange:e=>{ d.assigneeId=e.target.value; draw(); }}, people.map(p=>el('option',{value:p.id,selected:p.id===d.assigneeId,text:`${p.name}${p.id===V.id?' (eu)':''}`})))),
      el('label',{class:'field'}, el('span',{},'Área'),
        el('select',{id:'rf-area',onchange:e=>{ d.area=e.target.value; draw(); }},
          (isLider(V) || !areasFor(V).length) ? el('option',{value:'',selected:!d.area,text:'Sem área'}) : null,
          areasFor(V).map(x=>el('option',{value:x.id,selected:x.id===d.area,text:x.name})))),
      el('label',{class:'field'}, el('span',{},'Frequência'),
        el('select',{id:'rf-freq',onchange:e=>{ d.freq=e.target.value; draw(); }},
          [['daily','Diária'],['weekly','Semanal'],['monthly','Mensal']].map(([k,t])=>el('option',{value:k,selected:d.freq===k,text:t})))),
      d.freq==='daily' ? el('label',{class:'field'}, el('span',{},'Dias'),
          el('select',{id:'rf-bd',onchange:e=>{ d.businessDays = e.target.value==='1'; draw(); }},
            el('option',{value:'1',selected:!!d.businessDays,text:'Só dias úteis (seg a sex)'}), el('option',{value:'0',selected:!d.businessDays,text:'Todos os dias'})))
      : d.freq==='weekly' ? el('div',{class:'field'}, el('span',{},'Dias da semana'),
          el('div',{class:'chips'}, WEEKDAYS.map((w,i)=>el('button',{type:'button',class:'chip','aria-pressed':String((d.weekdays||[]).includes(i)),onclick:()=>{ d.weekdays = (d.weekdays||[]).includes(i) ? d.weekdays.filter(x=>x!==i) : [...(d.weekdays||[]), i]; draw(); }}, w))))
      : el('label',{class:'field'}, el('span',{},'Dia do mês'),
          el('select',{id:'rf-md',onchange:e=>{ d.monthDay=e.target.value; draw(); }},
            [...Array.from({length:28},(_,i)=>[String(i+1),`Dia ${i+1}`]), ['last','Último dia do mês']].map(([k,t])=>el('option',{value:k,selected:String(d.monthDay)===k,text:t})))),
      el('label',{class:'field'}, el('span',{},'Prazo'),
        el('select',{id:'rf-due',onchange:e=>{ d.dueOffset=+e.target.value; }},
          [[0,'No mesmo dia'],[1,'1 dia depois'],[2,'2 dias depois'],[3,'3 dias depois'],[5,'5 dias depois'],[7,'7 dias depois'],[15,'15 dias depois']].map(([k,t])=>el('option',{value:String(k),selected:+d.dueOffset===k,text:t})))),
      el('label',{class:'field'}, el('span',{},'Começa em'), el('input',{id:'rf-start',type:'date',value:d.startDate,onchange:e=>{ d.startDate=e.target.value||todayISO(); draw(); }})),
      el('label',{class:'field'}, el('span',{},'Entra na etapa'),
        el('select',{id:'rf-col',onchange:e=>d.columnId=e.target.value}, workCols().map(c=>el('option',{value:c.id,selected:c.id===d.columnId,text:c.title})))),
      el('label',{class:'field'}, el('span',{},'Prioridade'),
        el('select',{id:'rf-prio',onchange:e=>d.priority=e.target.value}, [['','Sem prioridade'],['baixa','Baixa'],['media','Média'],['alta','Alta']].map(([v,t])=>el('option',{value:v,selected:d.priority===v,text:t})))),
      el('label',{class:'field'}, el('span',{},'Área solicitante'),
        el('select',{id:'rf-req',onchange:e=>d.requester=e.target.value},
          el('option',{value:'',selected:!d.requester,text:'Não informada'}),
          S.areas.length ? el('optgroup',{label:'Times internos'}, S.areas.slice().sort(byName).map(x=>el('option',{value:x.id,selected:d.requester===x.id,text:x.name}))) : null,
          S.requesters.length ? el('optgroup',{label:'Outras áreas'}, S.requesters.slice().sort(byName).map(x=>el('option',{value:x.id,selected:d.requester===x.id,text:x.name}))) : null)),
      el('div',{class:'field full'}, el('span',{},'Etiquetas'),
        el('div',{class:'chips'}, labelList().map(L=>el('button',{type:'button',class:'chip','aria-pressed':String((d.labels||[]).includes(L.id)),onclick:()=>{ d.labels=(d.labels||[]).includes(L.id)?d.labels.filter(x=>x!==L.id):[...(d.labels||[]),L.id]; draw(); }}, el('i',{style:`background:${L.color}`}), L.name)))),
      el('label',{class:'field full'}, el('span',{},'Descrição'), el('textarea',{id:'rf-desc',oninput:e=>d.description=e.target.value}, d.description||'')),
      el('label',{class:'field full'}, el('span',{},'Checklist (um item por linha)'), el('textarea',{id:'rf-chk',placeholder:'Extrair base\nValidar números\nPublicar',oninput:e=>d.checklistText=e.target.value}, d.checklistText||'')),
      canVal ? el('label',{class:'inline full'}, el('input',{type:'checkbox',id:'rf-val',checked:!!d.requiresValidation,onchange:e=>d.requiresValidation=e.target.checked}), el('span',{text:'Exigir minha validação antes de concluir cada ocorrência'})) : null,
      el('div',{class:'preview full',text: preview.length ? `${freqText(d)} · próximas: ${preview.map(fmtDate).join(', ')}` : 'Nenhuma data encontrada com essa configuração.'}),
      el('div',{class:'actions'},
        el('button',{class:'btn primary',type:'button',onclick:()=>{
          if (!d.title.trim()){ toast('Dê um título à atividade.'); return; }
          if (d.freq==='weekly' && !(d.weekdays||[]).length){ toast('Escolha pelo menos um dia da semana.'); return; }
          const out = {...d, title:d.title.trim(), checklist:(d.checklistText||'').split('\n').map(s=>s.trim()).filter(Boolean)};
          delete out.checklistText; delete out._for; delete out.assignee;
          if (!r) out.lastGenerated = addDays(out.startDate || todayISO(), -1);
          put('recurrences', out); A.edit=null; A.draft=null; drawAuto(); scheduleChecks();
          toast(r ? 'Automação atualizada' : 'Automação criada. A atividade aparece no quadro no dia programado.');
        }}, r ? 'Salvar' : 'Criar automação'),
        el('button',{class:'btn ghost',type:'button',onclick:()=>{ A.edit=null; A.draft=null; drawAuto(); }},'Cancelar'))
    );
  };
  draw();
  return wrap;
}
function drawAuto(){
  const V = viewer(); if (!V){ closeAuto(); return; }
  const rules = S.recurrences.filter(r=>ruleVisible(r, V)).sort((a,b)=>(a.title||'').localeCompare(b.title||'','pt-BR'));
  const body = el('div',{class:'t-body'},
    el('div',{class:'note',text:'Cada automação cria a atividade no quadro no dia programado, já com responsável, prazo e checklist. Ela é gerada quando alguém da equipe abre o quadro naquele dia.'}),
    A.edit==='new' ? ruleForm(V, null) : (S.readOnly ? null : el('div',{}, el('button',{class:'btn primary',type:'button',onclick:()=>{ A.edit='new'; A.draft=null; drawAuto(); }},'+ Nova automação'))),
    rules.length ? el('div',{class:'rows'}, rules.map(r => A.edit===r.id ? el('div',{class:'row',style:'display:block'}, ruleForm(V, r)) : el('div',{class:'auto-row'},
      el('div',{class:'grow',style:'min-width:0;flex:1'},
        el('div',{class:'nm',text:r.title}),
        el('div',{class:'sub',text:[freqText(r), `para ${mname(r.assigneeId)}`, r.active ? `próxima: ${nextDates(r,1).map(fmtDate)[0]||'—'}` : 'pausada'].join(' · ')})),
      el('span',{class:'pill '+(r.active?'ok':''),text:r.active?'Ativa':'Pausada'}),
      ruleEditable(r, V) ? [
        el('button',{class:'btn ghost',type:'button',onclick:()=>put('recurrences',{...r, active:!r.active})}, r.active?'Pausar':'Ativar'),
        el('button',{class:'btn',type:'button',onclick:()=>{ A.edit=r.id; A.draft=null; drawAuto(); }},'Editar'),
        A.confirm===r.id
          ? [el('button',{class:'btn danger solid',type:'button',onclick:()=>{ A.confirm=null; remove('recurrences', r.id); }},'Sim, excluir'), el('button',{class:'btn ghost',type:'button',onclick:()=>{A.confirm=null;drawAuto();}},'Cancelar')]
          : el('button',{class:'btn danger',type:'button',onclick:()=>{ A.confirm=r.id; drawAuto(); }},'Excluir')] : null)))
      : el('div',{class:'note',text:'Nenhuma automação ainda.'}));
  const modal = el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-label':'Automações',onclick:e=>e.stopPropagation()},
    el('div',{class:'m-head'}, el('div',{style:'flex:1;font-family:var(--f-display);font-weight:700;font-size:19px;padding:6px 8px'},'Atividades recorrentes'),
      el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:closeAuto},'✕')),
    body);
  const keepFocus = document.activeElement?.id;
  $('#modalRoot').replaceChildren(el('div',{class:'scrim',onclick:closeAuto}, modal));
  if (keepFocus){ const f = document.getElementById(keepFocus); if (f){ f.focus(); if (f.setSelectionRange && typeof f.value==='string' && f.type!=='date') try{ f.setSelectionRange(f.value.length,f.value.length); }catch(e){} } }
}

/* ================= Configurar o quadro (quem gerencia o time) ================= */
const T = {tab:'etiquetas', lblEdit:null, reqEdit:null};
function openTeam(){ S.teamOpen = true; drawTeam(); document.addEventListener('keydown', teamEsc); }
function closeTeam(){ S.teamOpen = false; $('#modalRoot').replaceChildren(); document.removeEventListener('keydown', teamEsc); }
function teamEsc(e){ if (e.key==='Escape') closeTeam(); }
function simpleList({items, editKey, inputId, placeholder, onAdd, onRename, onDelete, usage, swatch}){
  const inp = el('input',{id:inputId,placeholder,style:'flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)'});
  const add = () => { const v=inp.value.trim(); if(!v) return; onAdd(v); inp.value=''; };
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter') add(); });
  return [el('div',{style:'display:flex;gap:8px'}, inp, el('button',{class:'btn primary',type:'button',onclick:add},'Adicionar')),
    items.length ? el('div',{class:'rows'}, items.map(x=>{
      const n = usage(x);
      return el('div',{class:'row'},
        swatch ? swatch(x) : null,
        T[editKey]===x.id
          ? el('input',{id:'ed-'+x.id,value:x.name,onkeydown:e=>{ if(e.key==='Enter') e.target.blur(); },onblur:e=>{ const v=e.target.value.trim(); T[editKey]=null; if(v&&v!==x.name) onRename(x,v); else drawTeam(); }})
          : el('span',{class:'nm grow',text:x.name}),
        el('span',{class:'sub',text:n.label}),
        el('button',{class:'btn ghost',type:'button',onclick:()=>{T[editKey]=x.id;drawTeam();setTimeout(()=>document.getElementById('ed-'+x.id)?.focus(),0);}},'Renomear'),
        n.count ? el('span',{class:'sub',title:'Em uso'},'Em uso') : el('button',{class:'btn danger',type:'button',onclick:()=>onDelete(x)},'Excluir'));
    })) : null];
}
const PERM_TXT = {
  see:{own:'Só as suas', area_peers:'As suas e as de colegas do mesmo nível nas suas áreas', area_below:'As suas e as dos níveis abaixo nas suas áreas', all:'Todas do time'},
  edit:{assigned:'Só as atribuídas a ele', below:'As suas e as dos níveis abaixo nas suas áreas', all:'Todas do time'},
  assign:{self:'Só para si', below_area:'Níveis abaixo, nas suas áreas', below_any:'Níveis abaixo, em qualquer área', any:'Qualquer pessoa do time'},
  kpi:{own:'Os seus', area:'Os seus e os dos níveis abaixo nas suas áreas', all:'De todo o time'},
};
function drawTeam(){
  const tabs = [['etiquetas','Etiquetas'],['solicitantes','Áreas solicitantes'],['regras','Níveis e regras']];
  let body;
  if (T.tab==='etiquetas'){
    body = el('div',{class:'t-body'},
      el('div',{class:'sub',style:'color:var(--muted);font-size:13px'},'Clique na cor para trocar. Etiquetas em uso não podem ser excluídas.'),
      ...simpleList({items:labelList(), editKey:'lblEdit', inputId:'newLabel', placeholder:'Ex.: Trade, Financeiro, Relatório mensal',
        onAdd:async v=>{ await ensureLabels(); const n=S.labels.length; put('labels',{id:uid('lb_'), name:v, color:LABEL_COLORS[n%LABEL_COLORS.length], order:n+1},'team'); },
        onRename:async (x,v)=>{ await ensureLabels(); put('labels',{...(S.labels.find(l=>l.id===x.id)||x), name:v},'team'); },
        onDelete:async x=>{ await ensureLabels(); remove('labels', x.id, 'team'); },
        usage:x=>{ const c=S.cards.filter(cd=>(cd.labels||[]).includes(x.id)).length + S.recurrences.filter(r=>(r.labels||[]).includes(x.id)).length; return {count:c, label:`${c} uso${c===1?'':'s'}`}; },
        swatch:x=>el('button',{type:'button',class:'lbl-swatch',style:`background:${x.color}`,'aria-label':`Trocar cor de ${x.name}`,onclick:async()=>{ await ensureLabels(); const cur=S.labels.find(l=>l.id===x.id)||x; put('labels',{...cur, color:LABEL_COLORS[(LABEL_COLORS.indexOf(cur.color)+1)%LABEL_COLORS.length]},'team'); }})}));
  } else if (T.tab==='solicitantes'){
    body = el('div',{class:'t-body'},
      el('div',{class:'sub',style:'color:var(--muted);font-size:13px'},'Áreas de fora do time que pedem demandas (Financeiro, Nível de Serviço…). Só informam a origem no cartão e não dão acesso ao quadro. As áreas do próprio time aparecem automaticamente.'),
      ...simpleList({items:S.requesters.slice().sort(byName), editKey:'reqEdit', inputId:'newReq', placeholder:'Ex.: Financeiro',
        onAdd:v=>saveReq({id:uid('r_'), name:v}), onRename:(x,v)=>saveReq({...x,name:v}), onDelete:x=>deleteReq(x.id),
        usage:x=>{ const c=S.cards.filter(cd=>cd.requester===x.id).length; return {count:c, label:`${c} ${c===1?'cartão':'cartões'}`}; }}));
  } else {
    body = el('div',{class:'t-body'},
      el('div',{style:'overflow-x:auto'}, el('table',{class:'matrix'},
        el('thead',{}, el('tr',{}, ['Nível','Vê','Altera','Atribui para','Indicadores'].map(h=>el('th',{text:h})))),
        el('tbody',{}, S.levels.slice().sort((a,b)=>a.rank-b.rank).map(l=>el('tr',{},
          el('td',{}, el('b',{text:`${l.rank} · ${l.name}`})),
          el('td',{text:PERM_TXT.see[l.perms?.see]||'—'}), el('td',{text:PERM_TXT.edit[l.perms?.edit]||'—'}),
          el('td',{text:PERM_TXT.assign[l.perms?.assign]||'—'}), el('td',{text:PERM_TXT.kpi[l.perms?.kpi]||'—'})))))),
      el('div',{class:'note',text:'Pessoas, áreas e níveis (com as permissões) são cadastrados na tela de Cadastros.'}),
      el('a',{class:'btn primary',href:'./index.html',style:'align-self:flex-start;text-decoration:none'},'Abrir cadastros'));
  }
  const modal = el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-label':'Configurar o quadro',onclick:e=>e.stopPropagation()},
    el('div',{class:'m-head'}, el('div',{style:'flex:1;font-family:var(--f-display);font-weight:700;font-size:19px;padding:6px 8px'},'Configurar o quadro'),
      el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:closeTeam},'✕')),
    el('div',{class:'tabs',role:'tablist'}, tabs.map(([k,t])=>el('button',{type:'button',role:'tab','aria-selected':String(T.tab===k),onclick:()=>{T.tab=k;drawTeam();}}, t))),
    body);
  const keepFocus = document.activeElement?.id;
  $('#modalRoot').replaceChildren(el('div',{class:'scrim',onclick:closeTeam}, modal));
  if (keepFocus){ const f=document.getElementById(keepFocus); if (f) f.focus(); }
}

/* ================= Painel de avisos ================= */
function openNotifs(){
  const V = viewer(); if (!V) return;
  const root = $('#modalRoot');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key==='Escape') close(); };
  document.addEventListener('keydown', esc);
  let tab = 'me';
  const draw = () => {
    const direct = directNotifs(V), team = teamNotifs(V);
    const hasTeam = team.length > 0 || (permsOf(V).see||'own') !== 'own';
    if (!hasTeam) tab = 'me';
    const src = tab === 'team' ? team : direct;
    const list = src.slice(0, 60);
    const unread = list.filter(n=>!n.read).length;
    const dU = direct.filter(n=>!n.read).length, tU = team.filter(n=>!n.read).length;
    const openN = (n, group) => { (group||[n]).forEach(markRead); close(); const card = S.cards.find(c=>c.id===n.cardId); if (card && canSee(card, V)) openCard(card.id, (n.type==='mention'||n.type==='comment')?'comentarios':null); else toast('Esta atividade não está mais disponível para você.'); };
    // Equipe: uma linha por atividade (o acontecimento mais recente + quantos outros)
    const teamRows = () => {
      const groups = new Map();
      for (const n of team){ const k = n.cardId || n.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
      return [...groups.values()].slice(0, 40).map(g => {
        const n = g[0], card = S.cards.find(c=>c.id===n.cardId), col = card ? colById(card.columnId) : null;
        const un = g.filter(x=>!x.read).length;
        return el('button',{type:'button',class:'np-item team'+(un?' unread':''),onclick:()=>openN(n, g)},
          el('span',{class:'np-dot','aria-hidden':'true'}),
          el('span',{class:'np-txt'},
            NOTIF_TAG[n.type] ? el('em',{class:'np-tag '+NOTIF_TAG[n.type].c,text:NOTIF_TAG[n.type].t}) : null,
            el('span',{text:notifText(n)}),
            el('small',{text:[ago(n.at), col ? `está em ${col.title}` : 'cartão removido', g.length>1 ? `+${g.length-1} acontecimento${g.length===2?'':'s'}` : ''].filter(Boolean).join(' · ')})));
      });
    };
    const panel = el('div',{class:'notif-panel',role:'dialog','aria-label':'Avisos',onclick:e=>e.stopPropagation()},
      el('div',{class:'np-head'},
        el('b',{text:'Avisos'}),
        unread ? el('button',{class:'btn ghost',type:'button',onclick:async()=>{ await markAllRead(V, src); draw(); }},'Marcar todos como lidos') : null,
        el('button',{class:'icon-btn',type:'button','aria-label':'Fechar',onclick:close},'✕')),
      hasTeam ? el('div',{class:'np-tabs',role:'tablist'},
        el('button',{type:'button',role:'tab','aria-selected':String(tab==='me'),class:'np-tab'+(tab==='me'?' on':''),onclick:()=>{ tab='me'; draw(); }}, 'Para você', dU ? el('span',{class:'np-count',text:String(dU)}) : null),
        el('button',{type:'button',role:'tab','aria-selected':String(tab==='team'),class:'np-tab'+(tab==='team'?' on':''),onclick:()=>{ tab='team'; draw(); }}, 'Equipe', tU ? el('span',{class:'np-count soft',text:tU>99?'99+':String(tU)}) : null)) : null,
      tab === 'team' && hasTeam ? el('p',{class:'np-hint',text:'Tudo o que acontece com as atividades de quem está abaixo de você. Não conta no sino.'}) : null,
      tab === 'team' ? (team.length ? el('div',{class:'np-list'}, teamRows()) : el('div',{class:'np-empty',text:'Nenhum acontecimento da equipe por enquanto.'})) :
      list.length ? el('div',{class:'np-list'}, list.map(n=>{
        const card = S.cards.find(c=>c.id===n.cardId);
        const col = card ? colById(card.columnId) : null;
        return el('button',{type:'button',class:'np-item'+(n.read?'':' unread'),onclick:()=>{ markRead(n); close(); if (card && canSee(card, V)) openCard(card.id, (n.type==='mention'||n.type==='comment')?'comentarios':null); else toast('Esta atividade não está mais disponível para você.'); }},
          el('span',{class:'np-dot','aria-hidden':'true'}),
          el('span',{class:'np-txt'},
            NOTIF_TAG[n.type] ? el('em',{class:'np-tag '+NOTIF_TAG[n.type].c,text:NOTIF_TAG[n.type].t}) : null,
            el('span',{text:notifText(n)}),
            el('small',{text:[ago(n.at), col ? `está em ${col.title}` : 'cartão removido'].join(' · ')})));
      })) : el('div',{class:'np-empty',text:'Nenhum aviso por enquanto.'}));
    root.replaceChildren(el('div',{class:'scrim side',onclick:close}, panel));
  };
  draw();
}

/* ================= Eventos globais ================= */
function savePrefs(){ try{ localStorage.setItem(PREF_KEY, JSON.stringify({view:S.view, page:S.page, areaFilter:S.areaFilter, barCollapsed:!!S.barCollapsed, kpiPeriod:S.kpiPeriod})); }catch(e){} }
function setView(k){ S.view = k; S.who=''; savePrefs(); render(); }
function setPage(k){ S.page = k; savePrefs(); render(); }
try{ const p = JSON.parse(localStorage.getItem(PREF_KEY)||'{}'); if (p.view) S.view=p.view; if (p.page) S.page=p.page; if (p.areaFilter) S.areaFilter=p.areaFilter; S.barCollapsed=!!p.barCollapsed; if (p.kpiPeriod) S.kpiPeriod=p.kpiPeriod; }catch(e){}
$('#q').addEventListener('input', e => { S.q=e.target.value; render(); });
$('#flt').addEventListener('change', e => { S.label=e.target.value; render(); });
$('#fltWho').addEventListener('change', e => { S.who=e.target.value; render(); });
$('#fltReq').addEventListener('change', e => { S.req=e.target.value; render(); });
$('#sectorArea').addEventListener('change', e => { S.sectorArea=e.target.value; savePrefs(); render(); });
$('#areaSel').addEventListener('change', e => { S.areaFilter=e.target.value; S.kpiPerson=null; savePrefs(); render(); });
$('#areaOpen').addEventListener('click', () => { S.barCollapsed=false; savePrefs(); render(); });
$('#kpiPeriod').addEventListener('change', e => { S.kpiPeriod=e.target.value; savePrefs(); render(); });
$('#viewAsSel').addEventListener('change', e => { S.viewAs = e.target.value || null; S.who=''; S.kpiPerson=null; render(); });
$('#newCard').addEventListener('click', () => { if (!S.columns.length) { toast('O quadro ainda não tem colunas.'); return; } openCard(null); });
$('#autoBtn').addEventListener('click', openAuto);
$('#teamBtn').addEventListener('click', openTeam);
$('#bellBtn').addEventListener('click', openNotifs);
$('#meChip').addEventListener('click', e => { e.stopPropagation(); S.acctOpen = !S.acctOpen; renderTop(viewer()); });
document.addEventListener('click', e => { if (S.acctOpen && !e.target.closest('.acct-wrap')){ S.acctOpen = false; renderTop(viewer()); } });
document.addEventListener('keydown', e => { if (e.key==='Escape' && S.acctOpen){ S.acctOpen = false; renderTop(viewer()); $('#meChip').focus(); } });
document.addEventListener('click', () => { if (S.menuCol){ S.menuCol=null; render(); } });
$('#board').addEventListener('wheel', e => {
  const b = e.currentTarget;
  if (!b.classList.contains('board') || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || b.scrollWidth <= b.clientWidth) return;
  const list = e.target.closest('.cards');
  if (list && list.scrollHeight > list.clientHeight + 2) return;   // deixa a coluna rolar os próprios cartões
  if (e.target.closest('.menu, textarea, select')) return;
  b.scrollLeft += e.deltaY; e.preventDefault();
}, {passive:false});
function setSync(kind, text){ const s=$('#sync'); s.className='sync '+kind; s.title=text; s.querySelector('b').textContent=text; }

/* ================= Inicialização ================= */
function centerMsg(title, text, link){
  $('#board').className = 'board';
  $('#board').replaceChildren(el('div',{class:'center-msg'}, el('h2',{text:title}), el('p',{text}), link ? el('a',{class:'btn primary',href:'./index.html'}, link) : null));
}
onAuthStateChanged(auth, async u => {
  if (!u){ location.replace('./index.html'); return; }
  S.me = u.uid;
  setSync('', 'Conectando…');
  let profile, isAdmin = false;
  try{
    profile = (await getDoc(doc(fs,'users',u.uid))).data() || {};
    isAdmin = (await getDoc(doc(fs,'admins',u.uid))).exists();
    S.isAdmin = isAdmin;
  }catch(e){ centerMsg('Não foi possível abrir o quadro', 'Verifique a conexão e recarregue a página.'); return; }
  const status = isAdmin ? 'active' : (profile.status || 'pending');
  if (status !== 'active'){ centerMsg(status === 'inactive' ? 'Conta inativa' : 'Cadastro aguardando aprovação', 'O quadro fica disponível depois que o administrador liberar a sua conta.', 'Voltar'); return; }
  TEAM = profile.teamId || '';
  if (!TEAM){ centerMsg('Você ainda não faz parte de um time', 'Peça para o líder adicionar o seu e-mail ao time. Depois, abra a tela de cadastros para entrar.', 'Abrir cadastros'); return; }
  S.store = 'db';
  getDoc(doc(fs,'teams',TEAM)).then(t => { S.teamName = t.data()?.name || ''; }).catch(()=>{});
  const got = {};
  const need = [...COLLS, 'levels', 'areas', 'members'];
  const ready = () => { if (!S.loaded && need.every(k=>got[k])){ S.loaded = true; setSync('on','Sincronizado'); } if (S.loaded){ render(); scheduleChecks(); } };
  const fail = e => { console.warn(e); setSync('local','Sem permissão ou sem conexão. Recarregue a página.'); S.loaded = true; render(); };
  // cadastros do time (somente leitura aqui)
  onSnapshot(collection(fs,'teams',TEAM,'levels'), s => { S.levels = s.docs.map(d=>({id:d.id, ...d.data()})); got.levels = true; ready(); }, fail);
  onSnapshot(collection(fs,'teams',TEAM,'areas'), s => { S.areas = s.docs.map(d=>({id:d.id, ...d.data()})).sort(byName); got.areas = true; ready(); }, fail);
  onSnapshot(collection(fs,'teams',TEAM,'members'), s => {
    S.members = s.docs.map(d=>{ const m = d.data(); return {id:d.id, userId:d.id, name:m.name||m.email, email:m.email, levelId:m.levelId, areas:(m.areaIds&&m.areaIds.length)?m.areaIds:(m.areaId?[m.areaId]:[]), active:m.active!==false}; });
    const me = S.members.find(m=>m.id===u.uid);
    if (got.members && (!me || !me.active)){ centerMsg('Seu acesso ao time foi encerrado', 'Fale com o líder do seu time.', 'Abrir cadastros'); return; }
    got.members = true; ready();
  }, fail);
  // dados do quadro
  const handle = key => snap => {
    if (key==='notifications' && S.loaded && got.notifications){
      const fresh = snap.docChanges().filter(ch => ch.type==='added' && !ch.doc.data()?.read && ch.doc.data()?.by!==u.uid);
      if (fresh.length) toast(fresh.length===1 ? notifText(fresh[0].doc.data()) : `Você tem ${fresh.length} novos avisos`);
    }
    S[key] = snap.docs.map(d=>({id:d.id, ...d.data()}));
    got[key] = true; ready();
  };
  COLLS.forEach(k => (k === 'notifications' ? db.collection(k).where('to','==',u.uid) : db.collection(k)).onSnapshot(handle(k), fail));
});
render();
