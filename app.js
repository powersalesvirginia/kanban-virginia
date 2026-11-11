// Kanban Virginia — etapa 1: contas, administradores, times, níveis e áreas (Firebase)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  getDocs, onSnapshot, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ================= Configuração ================= */
const PERM_OPTIONS = {
  see: [['own','Só as suas'],['area_peers','As suas e as de colegas do mesmo nível na área'],['area_below','As suas e as dos níveis abaixo na área'],['all','Todas do time']],
  edit: [['assigned','Só as atribuídas a ele'],['below','As suas e as dos níveis abaixo na área'],['all','Todas do time']],
  assign: [['self','Só para si'],['below_area','Níveis abaixo, na sua área'],['below_any','Níveis abaixo, em qualquer área'],['any','Qualquer pessoa do time']],
  kpi: [['own','Os seus'],['area','Os seus e os dos níveis abaixo na área'],['all','De todo o time']],
};
const PERM_FLAGS = [['requireValidation','Exigir validação'],['approveHold','Aprovar pausas'],['manageTeam','Gerenciar time']];
const DEFAULT_LEVELS = [
  {id:'lider', name:'Líder', rank:1, perms:{see:'all', edit:'all', assign:'any', kpi:'all', requireValidation:true, approveHold:true, manageTeam:true}},
  {id:'analista', name:'Analista', rank:2, perms:{see:'area_below', edit:'below', assign:'below_area', kpi:'area', requireValidation:true, approveHold:true, manageTeam:false}},
  {id:'auxiliar', name:'Auxiliar / Assistente', rank:3, perms:{see:'area_peers', edit:'assigned', assign:'self', kpi:'own', requireValidation:false, approveHold:false, manageTeam:false}},
];
const configured = !String(firebaseConfig.apiKey||'').startsWith('COLE');

/* ================= Estado ================= */
const S = {
  user:null, email:'', profile:null, isAdmin:false, setupDone:true,
  membership:null, inactive:false,
  view:'team', adminTeamId:null,
  teams:{},               // teamId -> {team, levels, areas, members, invites}
  allTeams:[], teamMembers:{}, admins:[], users:[],
  authMode:'login', authErr:'', busy:false, pendingName:'', af:{name:'', email:'', pass:''},
  ui:{}, // confirmações e rascunhos de tela
};
let subs = [];
const unsubAll = () => { subs.forEach(f=>{ try{ f(); }catch(e){} }); subs = []; };

/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
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
const toast = msg => { const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,3800); };
const initials = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const byName = (a,b) => (a.name||a.email||'').localeCompare(b.name||b.email||'','pt-BR');
const byRank = (a,b) => (a.rank??99)-(b.rank??99) || byName(a,b);
const normEmail = e => (e||'').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const fmtDate = ts => { const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}) : '—'; };
const slug = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'item';
function errText(e){
  const c = e?.code || '';
  const map = {
    'auth/invalid-credential':'E-mail ou senha incorretos.', 'auth/wrong-password':'E-mail ou senha incorretos.', 'auth/user-not-found':'E-mail ou senha incorretos.',
    'auth/invalid-email':'E-mail inválido.', 'auth/email-already-in-use':'Já existe uma conta com este e-mail. Use “Entrar” ou “Esqueci a senha”.',
    'auth/weak-password':'A senha precisa ter pelo menos 6 caracteres.', 'auth/too-many-requests':'Muitas tentativas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed':'Sem conexão com a internet.', 'permission-denied':'Você não tem permissão para essa ação.',
    'unavailable':'Sem conexão com o servidor. Tente de novo.',
  };
  return map[c] || (c ? `Não foi possível concluir (${c}).` : 'Não foi possível concluir. Tente de novo.');
}
async function run(fn, okMsg){
  try{ const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; }
  catch(e){ console.error(e); toast(errText(e)); return false; }
}

/* ================= Firebase ================= */
let auth, db;
if (configured){
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ================= Permissões no app ================= */
const teamData = id => S.teams[id] || {team:null, levels:[], areas:[], members:[], invites:[]};
const levelById = (tid, id) => teamData(tid).levels.find(l=>l.id===id);
const areaName = (tid, id) => teamData(tid).areas.find(a=>a.id===id)?.name || '';
const myLevel = () => S.membership ? levelById(S.membership.teamId, S.membership.levelId) : null;
function canManage(tid){ if (S.isAdmin) return true; const l = myLevel(); return !!(S.membership && S.membership.teamId===tid && l?.perms?.manageTeam); }
const myRank = tid => S.isAdmin ? 0 : (S.membership?.teamId===tid ? (myLevel()?.rank ?? 99) : 99);
const levelAllowed = (tid, levelId) => S.isAdmin || (levelById(tid, levelId)?.rank ?? 0) >= myRank(tid);

/* ================= Sessão ================= */
if (configured){
  onAuthStateChanged(auth, async u => {
    unsubAll(); S.teams = {}; S.membership = null; S.adminTeamId = null;
    if (!u){ S.user = null; render(); return; }
    S.user = u; S.email = normEmail(u.email);
    renderLoading('Entrando…');
    try{
      await ensureProfile(u);
      S.isAdmin = (await getDoc(doc(db,'admins',u.uid))).exists();
      S.setupDone = (await getDoc(doc(db,'meta','setup'))).exists();
      await loadMembership();
      await acceptInvite();
      S.view = S.membership ? 'team' : (S.isAdmin ? 'admin-teams' : 'team');
      startSubscriptions();
    }catch(e){ console.error(e); toast(errText(e)); }
    render();
  });
}
async function ensureProfile(u){
  const ref = doc(db,'users',u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()){ S.profile = snap.data(); return; }
  const name = S.pendingName || u.displayName || S.email.split('@')[0];
  S.profile = {name, email:S.email, createdAt:serverTimestamp()};
  await setDoc(ref, S.profile);
}
/* O líder "puxa" a pessoa: o convite fica em teams/{time}/invites/{email}, com um apontador em inviteIndex/{email}.
   Ao fazer login, a pessoa lê o apontador do próprio e-mail e entra no time sozinha. Sem consultas, sem índices. */
async function acceptInvite(){
  const uid = S.user.uid;
  let idx; try{ idx = await getDoc(doc(db,'inviteIndex',S.email)); }catch(e){ return; }
  if (!idx.exists()) return;
  const teamId = idx.data().teamId;
  const invRef = doc(db,'teams',teamId,'invites',S.email);
  let inv; try{ inv = await getDoc(invRef); }catch(e){ return; }
  if (!inv.exists() || inv.data().status !== 'pending') return;
  if (S.membership){
    if (S.membership.teamId === teamId) await updateDoc(invRef, {status:'accepted', acceptedAt:serverTimestamp(), acceptedBy:uid}).catch(()=>{});
    return;   // por enquanto, cada pessoa participa de um time
  }
  const data = inv.data();
  try{
    const b = writeBatch(db);
    b.set(doc(db,'teams',teamId,'members',uid), {
      uid, email:S.email, name: data.name || S.profile?.name || S.email,
      levelId:data.levelId, areaId:data.areaId||'', active:true,
      joinedAt:serverTimestamp(), addedBy:data.createdBy||'',
    });
    b.update(invRef, {status:'accepted', acceptedAt:serverTimestamp(), acceptedBy:uid});
    b.update(doc(db,'users',uid), {teamId});
    await b.commit();
    await loadMembership();
    let tname = ''; try{ tname = (await getDoc(doc(db,'teams',teamId))).data()?.name || ''; }catch(e){}
    setTimeout(()=>toast(tname ? `Você entrou no time ${tname}.` : 'Você entrou no time.'), 300);
  }catch(e){ console.error('convite', e); }
}
/* O time da pessoa fica anotado no próprio perfil (users/{uid}.teamId) */
async function loadMembership(){
  const uid = S.user.uid;
  const u = await getDoc(doc(db,'users',uid));
  const tid = u.data()?.teamId || '';
  S.membership = null; S.inactive = false;
  if (!tid) return;
  let m; try{ m = await getDoc(doc(db,'teams',tid,'members',uid)); }catch(e){ return; }
  if (!m.exists()){ await updateDoc(doc(db,'users',uid), {teamId:''}).catch(()=>{}); return; }   // foi removido do time
  if (m.data().active) S.membership = {teamId:tid, ...m.data()};
  else S.inactive = true;
}
function subscribeTeam(teamId, withInvites){
  const t = S.teams[teamId] = S.teams[teamId] || {team:null, levels:[], areas:[], members:[], invites:[]};
  const coll = name => collection(db,'teams',teamId,name);
  const onErr = e => console.warn(teamId, e.code);
  subs.push(onSnapshot(doc(db,'teams',teamId), s => { t.team = s.exists() ? {id:s.id, ...s.data()} : null; render(); }, onErr));
  subs.push(onSnapshot(coll('levels'), s => { t.levels = s.docs.map(d=>({id:d.id, ...d.data()})).sort(byRank); render(); }, onErr));
  subs.push(onSnapshot(coll('areas'), s => { t.areas = s.docs.map(d=>({id:d.id, ...d.data()})).sort(byName); render(); }, onErr));
  subs.push(onSnapshot(coll('members'), s => {
    t.members = s.docs.map(d=>({id:d.id, ...d.data()}));
    if (S.membership?.teamId === teamId){
      const me = t.members.find(m=>m.uid===S.user.uid);
      if (me && me.active) S.membership = {teamId, ...me};
      else if (me && !me.active){ S.membership = null; S.inactive = true; toast('Seu acesso ao time foi desativado.'); }
      else { S.membership = null; S.inactive = false; updateDoc(doc(db,'users',S.user.uid), {teamId:''}).catch(()=>{}); toast('Você não faz mais parte deste time.'); }
    }
    render();
  }, onErr));
  if (withInvites) subs.push(onSnapshot(coll('invites'), s => { t.invites = s.docs.map(d=>({id:d.id, ...d.data()})); render(); }, onErr));
}
function startSubscriptions(){
  subs.push(onSnapshot(doc(db,'users',S.user.uid), s => { if (s.exists()){ S.profile = s.data(); render(); } }));
  if (S.membership) subscribeTeam(S.membership.teamId, true);   // convites só carregam para quem gerencia (as regras bloqueiam os demais)
  if (S.isAdmin){
    subs.push(onSnapshot(collection(db,'teams'), s => {
      S.allTeams = s.docs.map(d=>({id:d.id, ...d.data()})).sort(byName);
      for (const t of S.allTeams) if (!S.teamMembers[t.id]){
        S.teamMembers[t.id] = [];
        subs.push(onSnapshot(collection(db,'teams',t.id,'members'), m => { S.teamMembers[t.id] = m.docs.map(d=>d.data()); render(); }, ()=>{}));
      }
      render();
    }));
    subs.push(onSnapshot(collection(db,'admins'), s => { S.admins = s.docs.map(d=>({id:d.id, ...d.data()})); render(); }));
    subs.push(onSnapshot(collection(db,'users'), s => { S.users = s.docs.map(d=>({id:d.id, ...d.data()})).sort(byName); render(); }));
  }
  if (!S.membership){
    // aguardando o líder: quando o convite chegar, entra sozinho
    subs.push(onSnapshot(doc(db,'inviteIndex',S.email), async s => {
      if (S.membership || !s.exists()) return;
      await acceptInvite();
      if (S.membership){ subscribeTeam(S.membership.teamId, true); S.view = 'team'; render(); }
    }, ()=>{}));
  }
}

/* ================= Telas ================= */
function renderLoading(msg){ $('#app').replaceChildren(el('div',{class:'center'}, el('p',{class:'muted',text:msg}))); }
function render(){
  const root = $('#app');
  const keep = document.activeElement?.id;
  if (!configured){ root.replaceChildren(notConfigured()); return; }
  if (!S.user){ root.replaceChildren(authView()); restoreFocus(keep); return; }
  if (!S.setupDone && !S.isAdmin){ root.replaceChildren(setupView()); return; }
  const tabs = [];
  if (S.membership || !S.isAdmin) tabs.push(['team','Meu time']);
  if (S.isAdmin) tabs.push(['admin-teams','Times'], ['admin-admins','Administradores'], ['admin-users','Contas']);
  tabs.push(['profile','Meu perfil']);
  if (!tabs.some(([k])=>k===S.view || (S.view==='admin-team' && k==='admin-teams'))) S.view = tabs[0][0];
  let body;
  if (S.view === 'team') body = S.membership ? teamView(S.membership.teamId) : waitingView();
  else if (S.view === 'admin-teams') body = adminTeamsView();
  else if (S.view === 'admin-team') body = adminTeamView();
  else if (S.view === 'admin-admins') body = adminAdminsView();
  else if (S.view === 'admin-users') body = adminUsersView();
  else body = profileView();
  root.replaceChildren(topBar(), el('nav',{class:'nav',role:'tablist'}, tabs.map(([k,t])=>el('button',{type:'button',role:'tab','aria-selected':String(S.view===k || (S.view==='admin-team' && k==='admin-teams')),onclick:()=>{ S.view=k; S.ui={}; render(); }}, t))), el('main',{}, body));
  restoreFocus(keep);
}
function restoreFocus(id){ if (!id) return; const f = document.getElementById(id); if (f){ f.focus(); if (f.setSelectionRange && /^(text|email|search|password)$/.test(f.type)) try{ f.setSelectionRange(f.value.length, f.value.length); }catch(e){} } }

function notConfigured(){
  return el('div',{class:'center'}, el('div',{class:'auth'},
    el('h1',{text:'Kanban Virginia'}),
    el('div',{class:'note warn',text:'Falta configurar o Firebase. Abra o arquivo public/firebase-config.js e cole a configuração do app Web do seu projeto (o passo a passo está no README).'})));
}

function authView(){
  const m = S.authMode;
  const af = S.af;
  const name = el('input',{id:'a-name',autocomplete:'name',placeholder:'Seu nome completo',value:af.name,oninput:e=>af.name=e.target.value});
  const email = el('input',{id:'a-email',type:'email',autocomplete:'email',placeholder:'voce@empresa.com.br',value:af.email,oninput:e=>af.email=e.target.value});
  const pass = el('input',{id:'a-pass',type:'password',autocomplete:m==='signup'?'new-password':'current-password',placeholder:'Mínimo de 6 caracteres',value:af.pass,oninput:e=>af.pass=e.target.value});
  const submit = async e => {
    e.preventDefault(); S.authErr=''; S.busy=true; render();
    const em = normEmail(email.value);
    try{
      if (m === 'reset'){
        await sendPasswordResetEmail(auth, em);
        S.authMode='login'; S.busy=false; render(); toast('Enviamos um link para redefinir a senha. Confira a caixa de entrada e o spam.'); return;
      }
      if (m === 'signup'){
        if (name.value.trim().length < 3) throw {code:'x-name'};
        S.pendingName = name.value.trim();
        const cred = await createUserWithEmailAndPassword(auth, em, pass.value);
        await updateProfile(cred.user, {displayName:S.pendingName});
      } else {
        await signInWithEmailAndPassword(auth, em, pass.value);
      }
    }catch(err){ S.authErr = err.code==='x-name' ? 'Informe seu nome completo.' : errText(err); S.busy=false; render(); return; }
    S.busy=false;
  };
  const title = {login:'Entrar', signup:'Criar conta', reset:'Redefinir senha'}[m];
  return el('div',{class:'center'}, el('form',{class:'auth',onsubmit:submit,novalidate:true},
    el('h1',{text:'Kanban Virginia'}),
    el('p',{class:'sub',text: m==='signup' ? 'Crie sua conta com o e-mail que o seu líder vai usar para te adicionar ao time.' : m==='reset' ? 'Informe seu e-mail para receber o link de redefinição.' : 'Entre com seu e-mail e senha.'}),
    S.authErr ? el('div',{class:'err',role:'alert',text:S.authErr}) : null,
    m==='signup' ? el('label',{class:'field'}, el('span',{},'Nome'), name) : null,
    el('label',{class:'field'}, el('span',{},'E-mail'), email),
    m!=='reset' ? el('label',{class:'field'}, el('span',{},'Senha'), pass) : null,
    el('button',{class:'btn primary',type:'submit',disabled:S.busy}, S.busy ? 'Aguarde…' : (m==='reset' ? 'Enviar link' : title)),
    el('div',{class:'links'},
      m!=='login' ? el('button',{class:'link',type:'button',onclick:()=>{S.authMode='login';S.authErr='';render();}},'Já tenho conta') : el('button',{class:'link',type:'button',onclick:()=>{S.authMode='signup';S.authErr='';render();}},'Criar conta'),
      m!=='reset' ? el('button',{class:'link',type:'button',onclick:()=>{S.authMode='reset';S.authErr='';render();}},'Esqueci a senha') : null)));
}

function setupView(){
  return el('div',{class:'center'}, el('div',{class:'auth'},
    el('h1',{text:'Configuração inicial'}),
    el('p',{class:'sub',text:'Ainda não existe nenhum administrador. Como esta é a primeira conta, você pode se tornar o administrador do sistema. Depois disso, só um administrador pode criar outros.'}),
    el('button',{class:'btn primary',type:'button',onclick:async()=>{
      const ok = await run(async()=>{
        const b = writeBatch(db);
        b.set(doc(db,'admins',S.user.uid), {email:S.email, name:S.profile?.name||'', addedAt:serverTimestamp(), addedBy:S.user.uid});
        b.set(doc(db,'meta','setup'), {by:S.user.uid, at:serverTimestamp()});
        await b.commit();
      }, 'Você agora é administrador.');
      if (ok){ S.isAdmin = true; S.setupDone = true; unsubAll(); startSubscriptions(); S.view='admin-teams'; render(); }
    }},'Tornar-me administrador'),
    el('button',{class:'btn ghost',type:'button',onclick:()=>signOut(auth)},'Sair')));
}

function topBar(){
  const t = S.membership ? teamData(S.membership.teamId).team : null;
  const lvl = myLevel();
  return el('header',{class:'top'},
    el('h1',{text:'Kanban Virginia'}),
    t ? el('span',{class:'team',text:`Time ${t.name}`}) : null,
    el('span',{class:'sp'}),
    el('div',{class:'me'},
      el('span',{class:'who',text:initials(S.profile?.name)}),
      el('b',{text:S.profile?.name||S.email}),
      lvl ? el('span',{class:'role'+(lvl.rank===1?' r1':''),text:lvl.name}) : null,
      S.isAdmin ? el('span',{class:'role adm',text:'Admin'}) : null),
    el('button',{class:'btn ghost sm',type:'button',onclick:()=>signOut(auth)},'Sair'));
}

function waitingView(){
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text: S.inactive ? 'Seu acesso ao time está desativado' : 'Você ainda não faz parte de um time'})),
    el('div',{class:'note'+(S.inactive?' warn':'')},
      S.inactive ? 'Fale com o líder do seu time para reativar o seu acesso.'
        : ['Peça para o seu líder adicionar o e-mail ', el('b',{text:S.email}), ' ao time. Assim que ele adicionar, você entra automaticamente, sem precisar sair e entrar de novo.']));
}

/* ---------- Gestão do time (líder e administrador usam a mesma tela) ---------- */
function teamView(tid){
  const D = teamData(tid);
  if (!D.team) return el('div',{class:'section'}, el('p',{class:'muted',text:'Carregando o time…'}));
  const manage = canManage(tid);
  return [
    el('div',{class:'section'},
      el('header',{}, el('h2',{text:`Time ${D.team.name}`}), el('span',{class:'sp'}),
        el('span',{class:'pill',text:`${D.members.filter(m=>m.active).length} ativo${D.members.filter(m=>m.active).length===1?'':'s'}`}),
        manage ? el('span',{class:'pill warn',text:`${D.invites.filter(i=>i.status==='pending').length} aguardando login`}) : null),
      el('div',{class:'note',text:'O quadro de atividades passa a usar este login na próxima etapa. Por enquanto, aqui ficam os cadastros do time.'})),
    peopleSection(tid, manage),
    areasSection(tid, manage),
    levelsSection(tid, manage),
  ];
}
function levelSelect(tid, id, value, disabled, onchange){
  const opts = teamData(tid).levels.filter(l => levelAllowed(tid, l.id) || l.id===value);
  return el('select',{id, disabled:disabled||null, onchange:e=>onchange(e.target.value)},
    opts.map(l=>el('option',{value:l.id,selected:l.id===value,disabled:!levelAllowed(tid,l.id)||null,text:`${l.rank} · ${l.name}`})));
}
function areaSelect(tid, id, value, disabled, onchange){
  return el('select',{id, disabled:disabled||null, onchange:e=>onchange(e.target.value)},
    el('option',{value:'',selected:!value,text:'Sem área'}),
    teamData(tid).areas.map(a=>el('option',{value:a.id,selected:a.id===value,text:a.name})));
}
function peopleSection(tid, manage){
  const D = teamData(tid);
  const ui = S.ui[tid] = S.ui[tid] || {};
  const allowedLevels = D.levels.filter(l=>levelAllowed(tid,l.id));
  const defLevel = allowedLevels[allowedLevels.length-1]?.id || '';
  ui.inv = ui.inv || {email:'', name:'', levelId:defLevel, areaId:''};
  if (!allowedLevels.some(l=>l.id===ui.inv.levelId)) ui.inv.levelId = defLevel;
  const members = D.members.slice().sort((a,b)=>(levelById(tid,a.levelId)?.rank??99)-(levelById(tid,b.levelId)?.rank??99) || byName(a,b));
  const pending = D.invites.filter(i=>i.status==='pending' && !D.members.some(m=>m.email===i.email && m.active));
  const addForm = manage ? el('div',{class:'form'},
    el('label',{class:'field'}, el('span',{},'E-mail da pessoa'), el('input',{id:`inv-email-${tid}`,type:'email',value:ui.inv.email,placeholder:'nome@empresa.com.br',oninput:e=>ui.inv.email=e.target.value})),
    el('label',{class:'field'}, el('span',{},'Nome (opcional)'), el('input',{id:`inv-name-${tid}`,value:ui.inv.name,oninput:e=>ui.inv.name=e.target.value})),
    el('label',{class:'field'}, el('span',{},'Nível'), levelSelect(tid, `inv-level-${tid}`, ui.inv.levelId, false, v=>ui.inv.levelId=v)),
    el('label',{class:'field'}, el('span',{},'Área'), areaSelect(tid, `inv-area-${tid}`, ui.inv.areaId, false, v=>ui.inv.areaId=v)),
    el('div',{class:'actions'}, el('button',{class:'btn primary',type:'button',onclick:()=>invite(tid)},'Adicionar ao time'))) : null;
  const memberRow = m => {
    const lvl = levelById(tid, m.levelId);
    const editable = manage && (S.isAdmin || (lvl?.rank ?? 99) >= myRank(tid));
    const isMe = m.uid === S.user.uid;
    const confirming = ui.rm === m.uid;
    return el('div',{class:'row'},
      el('span',{class:'who',text:initials(m.name||m.email)}),
      el('div',{class:'grow'}, el('div',{class:'nm',text:(m.name||m.email)+(isMe?' (você)':'')}), el('div',{class:'sub',text:`${m.email} · desde ${fmtDate(m.joinedAt)}`})),
      editable && !isMe ? levelSelect(tid, `lv-${m.uid}`, m.levelId, false, v=>run(()=>updateDoc(doc(db,'teams',tid,'members',m.uid),{levelId:v}),'Nível atualizado'))
        : el('span',{class:'role'+(lvl?.rank===1?' r1':''),text:lvl?.name||'Nível removido'}),
      editable ? areaSelect(tid, `ar-${m.uid}`, m.areaId, false, v=>run(()=>updateDoc(doc(db,'teams',tid,'members',m.uid),{areaId:v}),'Área atualizada'))
        : el('span',{class:'pill',text:areaName(tid,m.areaId)||'Sem área'}),
      el('span',{class:'pill '+(m.active?'ok':'bad'),text:m.active?'Ativo':'Desativado'}),
      editable && !isMe ? (confirming
        ? [el('button',{class:'btn danger solid sm',type:'button',onclick:()=>{ ui.rm=null; removeMember(tid, m); }},'Remover'),
           el('button',{class:'btn ghost sm',type:'button',onclick:()=>{ ui.rm=null; render(); }},'Cancelar')]
        : [el('button',{class:'btn sm',type:'button',onclick:()=>run(()=>updateDoc(doc(db,'teams',tid,'members',m.uid),{active:!m.active}), m.active?'Acesso desativado':'Acesso reativado')}, m.active?'Desativar':'Reativar'),
           el('button',{class:'btn ghost sm',type:'button','aria-label':`Remover ${m.name||m.email}`,onclick:()=>{ ui.rm=m.uid; render(); }},'Remover')]) : null);
  };
  const inviteRow = i => el('div',{class:'row'},
    el('span',{class:'who',text:initials(i.name||i.email)}),
    el('div',{class:'grow'}, el('div',{class:'nm',text:i.name||i.email}), el('div',{class:'sub',text:`${i.email} · convidado em ${fmtDate(i.createdAt)}`})),
    el('span',{class:'role',text:levelById(tid,i.levelId)?.name||'—'}),
    el('span',{class:'pill',text:areaName(tid,i.areaId)||'Sem área'}),
    el('span',{class:'pill warn',text:'Aguardando login'}),
    manage && levelAllowed(tid, i.levelId) ? el('button',{class:'btn ghost sm',type:'button',onclick:()=>cancelInvite(tid, i.id)},'Cancelar convite') : null);
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:'Pessoas'}),
      manage ? el('p',{text:'Adicione pelo e-mail. Se a pessoa já tem conta, ela entra no time no próximo acesso. Se ainda não tem, entra assim que criar a conta com esse e-mail.'}) : null),
    addForm,
    members.length ? el('div',{class:'rows'}, members.map(memberRow)) : el('div',{class:'empty',text:'Ninguém no time ainda.'}),
    manage && pending.length ? [el('h3',{style:'font-size:14px',text:`Aguardando login · ${pending.length}`}), el('div',{class:'rows'}, pending.map(inviteRow))] : null);
}
async function invite(tid){
  const ui = S.ui[tid]; const D = teamData(tid);
  const email = normEmail(ui.inv.email);
  if (!validEmail(email)){ toast('Informe um e-mail válido.'); return; }
  if (!ui.inv.levelId){ toast('Escolha o nível.'); return; }
  if (D.members.some(m=>m.email===email && m.active)){ toast('Essa pessoa já está no time.'); return; }
  // o e-mail pode estar ligado a outro time
  try{
    const idx = await getDoc(doc(db,'inviteIndex',email));
    if (idx.exists() && idx.data().teamId !== tid){ toast('Esse e-mail já está em outro time. Peça para o líder de lá remover a pessoa primeiro.'); return; }
  }catch(e){ toast('Esse e-mail já está em outro time. Peça para o líder de lá remover a pessoa primeiro.'); return; }
  const ok = await run(async()=>{
    const b = writeBatch(db);
    b.set(doc(db,'teams',tid,'invites',email), {email, name:ui.inv.name.trim(), levelId:ui.inv.levelId, areaId:ui.inv.areaId||'', status:'pending', createdBy:S.user.uid, createdAt:serverTimestamp()});
    b.set(doc(db,'inviteIndex',email), {teamId:tid, at:serverTimestamp()});
    await b.commit();
  }, 'Pessoa adicionada. Ela entra no time no próximo acesso.');
  if (ok){ ui.inv = {email:'', name:'', levelId:ui.inv.levelId, areaId:ui.inv.areaId}; render(); }
}
async function cancelInvite(tid, email){
  await run(async()=>{
    const b = writeBatch(db);
    b.delete(doc(db,'teams',tid,'invites',email));
    b.delete(doc(db,'inviteIndex',email));
    await b.commit();
  }, 'Convite cancelado');
}
async function removeMember(tid, m){
  await run(async()=>{
    const b = writeBatch(db);
    b.delete(doc(db,'teams',tid,'members',m.uid));
    if (m.email){ b.delete(doc(db,'teams',tid,'invites',m.email)); b.delete(doc(db,'inviteIndex',m.email)); }
    await b.commit();
  }, 'Pessoa removida do time');
}
function areasSection(tid, manage){
  const D = teamData(tid); const ui = S.ui[tid] = S.ui[tid] || {};
  const add = async () => {
    const name = (ui.newArea||'').trim(); if (!name) return;
    if (D.areas.some(a=>a.name.toLowerCase()===name.toLowerCase())){ toast('Essa área já existe.'); return; }
    let id = slug(name); while (D.areas.some(a=>a.id===id)) id += '-2';
    if (await run(()=>setDoc(doc(db,'teams',tid,'areas',id), {name, createdAt:serverTimestamp()}), 'Área criada')){ ui.newArea=''; render(); }
  };
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:'Áreas'}), el('p',{text:'A área define o que Analistas e Auxiliares enxergam no quadro.'})),
    manage ? el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'},
      el('input',{id:`new-area-${tid}`,value:ui.newArea||'',placeholder:'Ex.: Inteligência Comercial',style:'flex:1;min-width:200px;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--surface)',oninput:e=>ui.newArea=e.target.value,onkeydown:e=>{ if(e.key==='Enter') add(); }}),
      el('button',{class:'btn primary',type:'button',onclick:add},'Adicionar área')) : null,
    D.areas.length ? el('div',{class:'rows'}, D.areas.map(a=>{
      const used = D.members.filter(m=>m.areaId===a.id).length + D.invites.filter(i=>i.areaId===a.id && i.status==='pending').length;
      return el('div',{class:'row'},
        ui.editArea===a.id
          ? el('input',{id:`ea-${a.id}`,value:a.name,style:'flex:1;height:32px;border:1px solid var(--accent);border-radius:7px;padding:0 8px;background:var(--surface)',onkeydown:e=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){ ui.editArea=null; render(); } },onblur:e=>{ const v=e.target.value.trim(); ui.editArea=null; if (v && v!==a.name) run(()=>updateDoc(doc(db,'teams',tid,'areas',a.id),{name:v}),'Área renomeada'); else render(); }})
          : el('span',{class:'nm grow',text:a.name}),
        el('span',{class:'sub',text:`${used} pessoa${used===1?'':'s'}`}),
        manage ? el('button',{class:'btn ghost sm',type:'button',onclick:()=>{ ui.editArea=a.id; render(); setTimeout(()=>document.getElementById(`ea-${a.id}`)?.focus(),0); }},'Renomear') : null,
        manage ? (used ? el('span',{class:'sub',title:'Tire as pessoas desta área antes de excluir'},'Em uso') : el('button',{class:'btn danger sm',type:'button',onclick:()=>run(()=>deleteDoc(doc(db,'teams',tid,'areas',a.id)),'Área excluída')},'Excluir')) : null);
    })) : el('div',{class:'empty',text:'Nenhuma área cadastrada.'}));
}
function levelsSection(tid, manage){
  const D = teamData(tid); const ui = S.ui[tid] = S.ui[tid] || {};
  const mine = myRank(tid);
  const save = (l, patch, msg) => run(()=>updateDoc(doc(db,'teams',tid,'levels',l.id), patch), msg);
  const rows = D.levels.map(l=>{
    const editable = manage && (S.isAdmin || l.rank >= mine);
    const isMyLevel = !S.isAdmin && S.membership?.teamId===tid && S.membership.levelId===l.id;
    const used = D.members.filter(m=>m.levelId===l.id).length + D.invites.filter(i=>i.levelId===l.id && i.status==='pending').length;
    const sel = (key) => el('select',{id:`lv-${l.id}-${key}`,disabled:!editable||null,onchange:e=>save(l,{[`perms.${key}`]:e.target.value},'Permissão atualizada')},
      PERM_OPTIONS[key].map(([v,t])=>el('option',{value:v,selected:l.perms?.[key]===v,text:t})));
    return el('tr',{},
      el('td',{}, el('input',{type:'text',id:`lv-${l.id}-name`,value:l.name,disabled:!editable||null,onchange:e=>{ const v=e.target.value.trim(); if (v) save(l,{name:v},'Nome atualizado'); }})),
      el('td',{}, el('input',{type:'number',id:`lv-${l.id}-rank`,min:String(S.isAdmin?1:mine),value:String(l.rank),disabled:!editable||isMyLevel||null,title:'1 = nível mais alto',onchange:e=>{ const v=Math.max(S.isAdmin?1:mine, parseInt(e.target.value,10)||l.rank); save(l,{rank:v},'Ordem atualizada'); }})),
      el('td',{}, sel('see')), el('td',{}, sel('edit')), el('td',{}, sel('assign')), el('td',{}, sel('kpi')),
      PERM_FLAGS.map(([k])=>el('td',{class:'c'}, el('input',{type:'checkbox',id:`lv-${l.id}-${k}`,checked:!!l.perms?.[k],disabled:!editable||(isMyLevel && k==='manageTeam')||null,title:isMyLevel && k==='manageTeam'?'Você não pode tirar a gestão do seu próprio nível':null,onchange:e=>save(l,{[`perms.${k}`]:e.target.checked},'Permissão atualizada')}))),
      el('td',{}, editable && !isMyLevel ? (used ? el('span',{class:'sub',title:'Mude as pessoas deste nível antes de excluir'},`${used} em uso`) : el('button',{class:'btn danger sm',type:'button',onclick:()=>run(()=>deleteDoc(doc(db,'teams',tid,'levels',l.id)),'Nível excluído')},'Excluir')) : el('span',{class:'sub',text:used?`${used} pessoa${used===1?'':'s'}`:''})));
  });
  const addLevel = async () => {
    const name = (ui.newLevel||'').trim(); if (!name){ toast('Dê um nome ao nível.'); return; }
    const rank = Math.max(S.isAdmin?1:mine, parseInt(ui.newRank,10) || ((D.levels[D.levels.length-1]?.rank||0)+1));
    let id = slug(name); while (D.levels.some(l=>l.id===id)) id += '-2';
    const base = D.levels.slice().reverse().find(l=>l.rank<=rank) || D.levels[D.levels.length-1] || DEFAULT_LEVELS[2];
    const perms = {...(base?.perms||DEFAULT_LEVELS[2].perms), manageTeam:false};
    if (await run(()=>setDoc(doc(db,'teams',tid,'levels',id), {name, rank, perms, createdAt:serverTimestamp()}), 'Nível criado')){ ui.newLevel=''; ui.newRank=''; render(); }
  };
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:'Níveis e permissões'}),
      el('p',{text:'Ordem 1 é o nível mais alto. Quem gerencia o time só cadastra e edita níveis iguais ou abaixo do seu. Estas permissões passam a valer no quadro na próxima etapa.'})),
    el('div',{class:'matrix-wrap'}, el('table',{class:'matrix'},
      el('thead',{}, el('tr',{}, ['Nível','Ordem','Vê','Altera','Atribui para','Indicadores', ...PERM_FLAGS.map(f=>f[1]), ''].map(h=>el('th',{text:h})))),
      el('tbody',{}, rows))),
    manage ? el('div',{class:'form'},
      el('label',{class:'field'}, el('span',{},'Novo nível'), el('input',{id:`new-level-${tid}`,value:ui.newLevel||'',placeholder:'Ex.: Coordenador',oninput:e=>ui.newLevel=e.target.value})),
      el('label',{class:'field'}, el('span',{},'Ordem'), el('input',{id:`new-rank-${tid}`,type:'number',min:String(S.isAdmin?1:mine),value:ui.newRank||'',placeholder:'Ex.: 2',oninput:e=>ui.newRank=e.target.value})),
      el('div',{class:'actions'}, el('button',{class:'btn primary',type:'button',onclick:addLevel},'Criar nível')),
      el('div',{class:'note',style:'grid-column:1/-1',text:'Ao inserir um nível no meio (por exemplo, Coordenador com ordem 2), ajuste a ordem dos níveis abaixo dele (Analista para 3, Auxiliar para 4). O novo nível começa com as permissões do nível logo acima, sem “Gerenciar time”.'})) : null);
}

/* ---------- Administração ---------- */
function adminTeamsView(){
  const ui = S.ui.admin = S.ui.admin || {name:'', leaderEmail:'', leaderName:''};
  const createTeam = async () => {
    const name = ui.name.trim(), email = normEmail(ui.leaderEmail);
    if (name.length < 2){ toast('Digite o nome do time.'); return; }
    if (!validEmail(email)){ toast('Informe o e-mail do líder.'); return; }
    if (S.allTeams.some(t=>t.name.toLowerCase()===name.toLowerCase())){ toast('Já existe um time com esse nome.'); return; }
    let id = slug(name); while (S.allTeams.some(t=>t.id===id)) id += '-2';
    const idx = await getDoc(doc(db,'inviteIndex',email)).catch(()=>null);
    if (idx?.exists()){ toast('Esse e-mail já está em outro time. Remova a pessoa de lá primeiro.'); return; }
    const ok = await run(async()=>{
      const b = writeBatch(db);
      b.set(doc(db,'teams',id), {name, leaderEmail:email, createdAt:serverTimestamp(), createdBy:S.user.uid});
      DEFAULT_LEVELS.forEach(l => b.set(doc(db,'teams',id,'levels',l.id), {name:l.name, rank:l.rank, perms:l.perms, createdAt:serverTimestamp()}));
      b.set(doc(db,'teams',id,'invites',email), {email, name:ui.leaderName.trim(), levelId:'lider', areaId:'', status:'pending', createdBy:S.user.uid, createdAt:serverTimestamp()});
      b.set(doc(db,'inviteIndex',email), {teamId:id, at:serverTimestamp()});
      await b.commit();
    }, email===S.email ? 'Time criado. Você é o líder.' : 'Time criado. O líder entra no time no próximo acesso.');
    if (ok){
      S.ui.admin = {name:'', leaderEmail:'', leaderName:''};
      if (email === S.email && !S.membership){ await acceptInvite(); if (S.membership){ subscribeTeam(S.membership.teamId, true); } }
      render();
    }
  };
  const countMembers = tid => (S.teamMembers[tid]||[]).filter(m=>m.active).length;
  const leadersOf = tid => { const l = (S.teamMembers[tid]||[]).filter(m=>m.levelId==='lider' && m.active).map(m=>m.name||m.email); return l.length ? l : [(S.allTeams.find(t=>t.id===tid)?.leaderEmail||'') + ' (aguardando o primeiro acesso)']; };
  return [
    el('div',{class:'section'},
      el('header',{}, el('h2',{text:'Novo time'}), el('p',{text:'Digite o nome do time e o e-mail do líder. O time já nasce com os níveis Líder, Analista e Auxiliar, que o líder pode ajustar.'})),
      el('div',{class:'form'},
        el('label',{class:'field'}, el('span',{},'Nome do time'), el('input',{id:'nt-name',value:ui.name,placeholder:'Ex.: Sales Ops Paraná',oninput:e=>ui.name=e.target.value})),
        el('label',{class:'field'}, el('span',{},'E-mail do líder'), el('input',{id:'nt-email',type:'email',value:ui.leaderEmail,placeholder:'lider@empresa.com.br',oninput:e=>ui.leaderEmail=e.target.value})),
        el('label',{class:'field'}, el('span',{},'Nome do líder (opcional)'), el('input',{id:'nt-lname',value:ui.leaderName,oninput:e=>ui.leaderName=e.target.value})),
        el('div',{class:'actions'}, el('button',{class:'btn primary',type:'button',onclick:createTeam},'Criar time')))),
    el('div',{class:'section'},
      el('header',{}, el('h2',{text:`Times · ${S.allTeams.length}`})),
      S.allTeams.length ? el('div',{class:'rows'}, S.allTeams.map(t=>{
        const n = countMembers(t.id), leaders = leadersOf(t.id);
        const confirming = ui.del === t.id;
        return el('div',{class:'row'},
          el('div',{class:'grow'}, el('div',{class:'nm',text:t.name}), el('div',{class:'sub',text:`${n} pessoa${n===1?'':'s'} · líder: ${leaders.join(', ') || 'aguardando o primeiro acesso'} · criado em ${fmtDate(t.createdAt)}`})),
          el('button',{class:'btn sm',type:'button',onclick:()=>{ openAdminTeam(t.id); }},'Gerenciar'),
          n ? null : (confirming
            ? [el('button',{class:'btn danger solid sm',type:'button',onclick:()=>{ ui.del=null; deleteTeam(t.id); }},'Excluir time'), el('button',{class:'btn ghost sm',type:'button',onclick:()=>{ ui.del=null; render(); }},'Cancelar')]
            : el('button',{class:'btn ghost sm',type:'button',onclick:()=>{ ui.del=t.id; render(); }},'Excluir')));
      })) : el('div',{class:'empty',text:'Nenhum time criado ainda.'})),
  ];
}
function openAdminTeam(tid){
  if (!S.teams[tid] || !S.teams[tid]._admin){
    if (!(S.membership?.teamId === tid)) subscribeTeam(tid, true);
    S.teams[tid]._admin = true;
  }
  S.adminTeamId = tid; S.view = 'admin-team'; render();
}
async function deleteTeam(tid){
  await run(async()=>{
    const b = writeBatch(db);
    for (const sub of ['levels','areas','invites']){
      const s = await getDocs(collection(db,'teams',tid,sub));
      s.docs.forEach(d=>{ b.delete(d.ref); if (sub==='invites') b.delete(doc(db,'inviteIndex',d.id)); });
    }
    b.delete(doc(db,'teams',tid));
    await b.commit();
  }, 'Time excluído');
}
function adminTeamView(){
  const tid = S.adminTeamId;
  return [el('div',{}, el('button',{class:'btn ghost sm',type:'button',onclick:()=>{ S.view='admin-teams'; render(); }},'← Todos os times')), ...[teamView(tid)].flat()];
}
function adminAdminsView(){
  const ui = S.ui.adm = S.ui.adm || {email:''};
  const add = async () => {
    const email = normEmail(ui.email);
    if (!validEmail(email)){ toast('Informe um e-mail válido.'); return; }
    const u = S.users.find(x=>x.email===email);
    if (!u){ toast('Essa pessoa precisa criar a conta primeiro, com esse e-mail.'); return; }
    if (S.admins.some(a=>a.id===u.id)){ toast('Essa pessoa já é administradora.'); return; }
    if (await run(()=>setDoc(doc(db,'admins',u.id), {email, name:u.name||'', addedAt:serverTimestamp(), addedBy:S.user.uid}), 'Administrador adicionado')){ ui.email=''; render(); }
  };
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:'Administradores'}), el('p',{text:'Administradores criam times, indicam líderes e podem gerenciar qualquer time. Não precisam participar das atividades.'})),
    el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'},
      el('input',{id:'adm-email',type:'email',value:ui.email,placeholder:'E-mail de quem já tem conta',style:'flex:1;min-width:220px;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--surface)',oninput:e=>ui.email=e.target.value,onkeydown:e=>{ if(e.key==='Enter') add(); }}),
      el('button',{class:'btn primary',type:'button',onclick:add},'Tornar administrador')),
    el('div',{class:'rows'}, S.admins.slice().sort(byName).map(a=>el('div',{class:'row'},
      el('span',{class:'who',text:initials(a.name||a.email)}),
      el('div',{class:'grow'}, el('div',{class:'nm',text:(a.name||a.email)+(a.id===S.user.uid?' (você)':'')}), el('div',{class:'sub',text:`${a.email} · desde ${fmtDate(a.addedAt)}`})),
      a.id===S.user.uid ? null : el('button',{class:'btn ghost sm',type:'button',onclick:()=>run(()=>deleteDoc(doc(db,'admins',a.id)),'Administrador removido')},'Remover')))));
}
function adminUsersView(){
  const ui = S.ui.users = S.ui.users || {q:''};
  const teamOf = uid => { const u = S.users.find(x=>x.id===uid); const tid = u?.teamId; return tid && (S.teamMembers[tid]||[]).some(m=>m.uid===uid) ? (S.allTeams.find(t=>t.id===tid)?.name || '') : ''; };
  const q = ui.q.trim().toLowerCase();
  const list = S.users.filter(u => !q || (u.name||'').toLowerCase().includes(q) || (u.email||'').includes(q));
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:`Contas criadas · ${S.users.length}`}), el('p',{text:'Todas as pessoas que criaram conta. Quem está sem time aguarda o líder adicionar o e-mail.'})),
    el('input',{id:'users-q',type:'search',value:ui.q,placeholder:'Buscar por nome ou e-mail',style:'height:36px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--surface);max-width:360px',oninput:e=>{ ui.q=e.target.value; render(); }}),
    list.length ? el('div',{class:'rows'}, list.map(u=>{ const t = teamOf(u.id); return el('div',{class:'row'},
      el('span',{class:'who',text:initials(u.name||u.email)}),
      el('div',{class:'grow'}, el('div',{class:'nm',text:u.name||u.email}), el('div',{class:'sub',text:`${u.email} · conta criada em ${fmtDate(u.createdAt)}`})),
      S.admins.some(a=>a.id===u.id) ? el('span',{class:'role adm',text:'Admin'}) : null,
      el('span',{class:'pill '+(t?'ok':'warn'),text:t?`Time ${t}`:'Sem time'})); })) : el('div',{class:'empty',text:'Nenhuma conta encontrada.'}));
}
function profileView(){
  const ui = S.ui.prof = S.ui.prof || {name:S.profile?.name||''};
  const saveName = async () => {
    const name = ui.name.trim(); if (name.length < 3){ toast('Informe seu nome completo.'); return; }
    await run(async()=>{
      await updateDoc(doc(db,'users',S.user.uid), {name});
      await updateProfile(S.user, {displayName:name});
      if (S.membership) await updateDoc(doc(db,'teams',S.membership.teamId,'members',S.user.uid), {name});
    }, 'Nome atualizado');
  };
  const lvl = myLevel();
  return el('div',{class:'section'},
    el('header',{}, el('h2',{text:'Meu perfil'})),
    el('div',{class:'form'},
      el('label',{class:'field'}, el('span',{},'Nome'), el('input',{id:'p-name',value:ui.name,oninput:e=>ui.name=e.target.value})),
      el('label',{class:'field'}, el('span',{},'E-mail'), el('input',{id:'p-email',value:S.email,disabled:true})),
      el('div',{class:'actions'}, el('button',{class:'btn primary',type:'button',onclick:saveName},'Salvar nome'),
        el('button',{class:'btn',type:'button',onclick:()=>run(()=>sendPasswordResetEmail(auth, S.email),'Enviamos um link para trocar a senha.')},'Trocar senha'))),
    el('div',{class:'note'},
      S.membership ? `Time ${teamData(S.membership.teamId).team?.name||''} · ${lvl?.name||''}${S.membership.areaId?` · ${areaName(S.membership.teamId,S.membership.areaId)}`:''}` : 'Você ainda não faz parte de um time.',
      S.isAdmin ? ' · Administrador do sistema' : ''));
}

render();
