'use strict';
// Segundo Cérebro — plataforma web que lê e grava no vault (servidor local ou repositório privado no GitHub).

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const H = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = d => d.toLocaleDateString('sv-SE');
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const TODAY = iso(new Date());
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = parseD(s); d.setMonth(d.getMonth() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const fmtD = s => s ? s.split('-').reverse().join('/') : '—';
const num = (v, d = 1) => v == null || v === '' || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d });
const mondayOf = s => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const C = { pri: '#3d5af1', green: '#1f9d6b', purple: '#8b6fd6', orange: '#f08a24', red: '#e5484d', teal: '#18a0a8', grid: '#eef1f6', muted: '#6b7a99', soft: '#dfe5fb' };
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }

// ---------- armazenamento ----------
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const b64 = s => { let bin = ''; new TextEncoder().encode(s).forEach(x => bin += String.fromCharCode(x)); return btoa(bin); };

const Local = {
  nome: 'Servidor local',
  async list() { const r = await fetch('/__list', { cache: 'no-store' }); return r.json(); },
  async read(p) { const r = await fetch('/' + encPath(p), { cache: 'no-store' }); if (!r.ok) throw new Error(p); return r.text(); },
  async write(p, text) { const r = await fetch('/' + encPath(p), { method: 'PUT', body: text }); if (!r.ok) throw new Error('Falha ao salvar'); return null; }
};

const GH = {
  nome: 'GitHub', cfg: null,
  h(extra) { return { Authorization: 'Bearer ' + this.cfg.token, Accept: 'application/vnd.github+json', ...extra }; },
  base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; },
  async list() {
    const r = await fetch(this.base() + '/git/trees/main?recursive=1', { headers: this.h(), cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub respondeu ' + r.status + '. Confira usuário, repositório e token.');
    return (await r.json()).tree.filter(t => t.type === 'blob').map(t => ({ path: t.path, sha: t.sha }));
  },
  async read(p) {
    const r = await fetch(this.base() + '/contents/' + encPath(p) + '?ref=main', { headers: this.h({ Accept: 'application/vnd.github.raw' }), cache: 'no-store' });
    if (!r.ok) throw new Error(p); return r.text();
  },
  async write(p, text, sha) {
    const body = { message: 'plataforma: ' + p, content: b64(text), branch: 'main' };
    if (sha) body.sha = sha;
    const r = await fetch(this.base() + '/contents/' + encPath(p), { method: 'PUT', headers: this.h(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Falha ao salvar (' + r.status + '). Recarregue e tente de novo.');
    return (await r.json()).content.sha;
  }
};

const S = { store: null, files: {}, m: null, ui: { semana: null, sessao: null, exEvol: null } };
const WANT = /^(00 Painel|10 Saúde|20 Treino|30 Dieta)\/.*\.(md|json)$/;

async function load() {
  const list = (await S.store.list()).filter(f => WANT.test(f.path.normalize('NFC')));
  const files = {};
  await Promise.all(list.map(async f => { files[f.path.normalize('NFC')] = { text: await S.store.read(f.path), sha: f.sha, real: f.path }; }));
  S.files = files; S.m = model();
}

async function save(path, text) {
  const cur = S.files[path];
  const sha = await S.store.write(cur ? cur.real : path, text, cur && cur.sha);
  S.files[path] = { text, sha: sha || (cur && cur.sha), real: cur ? cur.real : path };
  S.m = model();
}

// ---------- markdown / frontmatter ----------
const FM = /^---\r?\n([\s\S]*?)\r?\n---/;
function fm(text) {
  const m = FM.exec(text || ''), o = {};
  if (!m) return o;
  m[1].split(/\r?\n/).forEach(l => {
    const k = /^([\w_]+):\s*(.*)$/.exec(l); if (!k) return;
    let v = k[2].trim();
    if (v === '') v = null;
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else v = v.replace(/^["']|["']$/g, '');
    o[k[1]] = v;
  });
  return o;
}
function setFm(text, changes) {
  const m = FM.exec(text); const lines = m[1].split(/\r?\n/);
  for (const [k, v] of Object.entries(changes)) {
    const line = k + ': ' + (v ?? '');
    const i = lines.findIndex(l => l.startsWith(k + ':'));
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  return '---\n' + lines.join('\n') + '\n---' + text.slice(m[0].length);
}
const mkNote = (props, body) => '---\n' + Object.entries(props).map(([k, v]) => k + ': ' + (v ?? '')).join('\n') + '\n---\n\n' + body;
const notesIn = dir => Object.keys(S.files).filter(p => p.startsWith(dir) && p.endsWith('.md'))
  .map(p => ({ path: p, nome: p.split('/').pop().replace(/\.md$/, ''), ...fm(S.files[p].text) }));
const json = p => { try { return JSON.parse(S.files[p].text); } catch { return null; } };

function parseSets(text) {
  const out = [];
  (text || '').split(/\r?\n/).forEach(l => {
    const r = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d.,]+)\s*\|\s*(\d+)\s*\|\s*([\d.,]*)\s*\|/.exec(l);
    if (r) out.push({ ex: r[1], serie: +r[2], kg: +r[3].replace(',', '.'), reps: +r[4], rir: r[5] });
  });
  return out;
}

function parseTasks() {
  const out = [];
  for (const [p, f] of Object.entries(S.files)) {
    if (!p.endsWith('.md') || p.startsWith('90 Modelos')) continue;
    f.text.split(/\r?\n/).forEach((l, i) => {
      const t = /^\s*- \[( |x)\] (.*)$/.exec(l); if (!t) return;
      const due = (/📅\s*(\d{4}-\d{2}-\d{2})/.exec(t[2]) || [])[1] || null;
      const done = (/✅\s*(\d{4}-\d{2}-\d{2})/.exec(t[2]) || [])[1] || null;
      const txt = t[2].replace(/[📅✅]\s*\d{4}-\d{2}-\d{2}/g, '').replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1').trim();
      if (txt) out.push({ path: p, line: i, ok: t[1] === 'x', txt, due, done, area: p.split('/')[0].replace(/^\d+ /, '') });
    });
  }
  return out;
}

async function toggleTask(t) {
  const lines = S.files[t.path].text.split(/\r?\n/);
  let l = lines[t.line];
  if (t.ok) l = l.replace('- [x]', '- [ ]').replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
  else l = l.replace('- [ ]', '- [x]') + ' ✅ ' + TODAY;
  lines[t.line] = l;
  await save(t.path, lines.join('\n'));
}

// ---------- modelo de dados ----------
function exStatus(e) {
  if (isDate(e.proximo) && e.proximo < TODAY) return 'vencido';
  if (!e.ultimo) return 'pendente';
  if (isDate(e.proximo) && daysBetween(TODAY, e.proximo) <= 30) return 'em breve';
  return 'em dia';
}
function model() {
  const perfil = fm(S.files['10 Saúde/Perfil de Saúde.md']?.text);
  const exames = notesIn('10 Saúde/Exames de rotina/').filter(e => e.tipo === 'exame-rotina')
    .map(e => ({ ...e, status: exStatus(e) })).sort((a, b) => String(a.proximo || '9').localeCompare(String(b.proximo || '9')));
  const medicoes = notesIn('20 Treino/Medições/').filter(m => m.tipo === 'medicao' && isDate(m.data)).sort((a, b) => a.data.localeCompare(b.data));
  const sessoes = notesIn('20 Treino/Sessões/').filter(s => s.tipo === 'sessao-treino' && isDate(s.data))
    .map(s => ({ ...s, sets: parseSets(S.files[s.path].text) })).sort((a, b) => a.data.localeCompare(b.data));
  const diario = notesIn('30 Dieta/Diário/').filter(d => d.tipo === 'diario-dieta' && isDate(d.data));
  const prog = json('20 Treino/programa.json');
  const dplano = json('30 Dieta/plano.json');
  const last = k => [...medicoes].reverse().find(m => m[k] != null)?.[k];
  const peso = last('peso_kg') ?? perfil.peso_kg, alt = perfil.altura_cm;
  const cintura = last('cintura_cm') ?? perfil.circunferencia_abdominal_cm;
  const grupoDe = {};
  if (prog) Object.values(prog.sessoes).forEach(s => s.exercicios.forEach(e => grupoDe[e.nome] = e.grupo));
  return {
    perfil, exames, medicoes, sessoes, diario, prog, dplano, tasks: parseTasks(), grupoDe, last,
    peso, alt, cintura, imc: peso && alt ? peso / ((alt / 100) ** 2) : null
  };
}
function weekType(s) {
  const w = Math.round((parseD(mondayOf(s)) - parseD(S.m.prog.base_semana_a)) / (7 * 864e5));
  return ((w % 2) + 2) % 2 === 0 ? 'A' : 'B';
}
const slotFor = s => S.m.prog.semanas[weekType(s)][(parseD(s).getDay() + 6) % 7];
const slotNome = id => id === 'futebol' ? '⚽ Futebol' : id === 'cardio' ? 'Cardio Z2' : (S.m.prog.sessoes[id]?.nome || id);
const diarioDe = d => S.m.diario.find(x => x.data === d);
const sessoesSemana = () => { const mon = mondayOf(TODAY); return S.m.sessoes.filter(s => s.data >= mon && s.data <= addDays(mon, 6)); };

// ---------- gráficos ----------
const charts = {};
function chart(id, cfg) {
  charts[id]?.destroy();
  const el = document.getElementById(id); if (!el || !window.Chart) return;
  charts[id] = new Chart(el, cfg);
}
const gridY = { grid: { color: C.grid } }, noGrid = { grid: { display: false } };
const emptyChart = msg => `<div class="empty">${msg}</div>`;

// ---------- navegação ----------
const routes = { inicio: renderInicio, saude: renderSaude, treino: renderTreino, dieta: renderDieta, config: renderConfig };
function route() {
  const [p, sub] = (location.hash.slice(1) || 'inicio').split('/');
  document.querySelectorAll('[data-p]').forEach(a => a.classList.toggle('on', a.dataset.p === p));
  Object.values(charts).forEach(c => c.destroy());
  if (!S.m && p !== 'config') { renderConfig(); return; }
  (routes[p] || renderInicio)(sub);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const view = html => { $('#view').innerHTML = html; };
const kpi = (ico, cls, lab, val, extra = '') => `<div class="card kpi"><div class="lab"><div class="ico ${cls}">${ico}</div>${lab}</div><div class="val">${val}</div>${extra}</div>`;
const header = (t, sub, actions = '') => `<div class="top"><div><h1>${t}</h1><p>${sub}</p></div><div class="chips">${actions}<button class="pill" onclick="refresh()" title="Recarregar dados">⟳</button></div></div>`;

async function refresh() { view('<div class="loading">Atualizando…</div>'); try { await load(); route(); toast('Dados atualizados'); } catch (e) { toast(e.message); route(); } }
async function act(btn, fn, msg) {
  if (btn) btn.disabled = true;
  try { await fn(); if (msg) toast(msg); route(); } catch (e) { toast(e.message); if (btn) btn.disabled = false; }
}

// ---------- INÍCIO ----------
function renderInicio() {
  const m = S.m, mon = mondayOf(TODAY), sun = addDays(mon, 6);
  const slot = slotFor(TODAY), d = diarioDe(TODAY) || {};
  const treinou = m.sessoes.some(s => s.data === TODAY);
  const hoje = m.tasks.filter(t => !t.ok && t.due && t.due <= TODAY);
  const semana = m.tasks.filter(t => t.due && t.due > TODAY && t.due <= sun && !t.ok);
  const semTot = m.tasks.filter(t => t.due && t.due >= mon && t.due <= sun);
  const semOk = semTot.filter(t => t.ok).length;
  const sup = (m.dplano?.suplementos || []);
  const autoItems = [
    m.prog.sessoes[slot] ? { txt: 'Treino: ' + slotNome(slot), ok: treinou, href: '#treino', c: C.pri, w: 'academia' } : { txt: slotNome(slot), ok: false, c: C.green, w: 'hoje', href: '#treino' },
    ...sup.map(s => ({ txt: s.nome, ok: d[s.id] === true, c: C.green, w: 'suplemento', supl: s.id })),
    { txt: `Refeições do plano (${(d.refeicoes ? String(d.refeicoes).split(',').filter(Boolean).length : 0)}/${m.dplano?.refeicoes.length || 4})`, ok: false, c: C.orange, w: 'dieta', href: '#dieta' }
  ];
  const exVenc = m.exames.filter(e => e.status === 'vencido').length, exPend = m.exames.filter(e => e.status !== 'em dia').length;
  const prox = m.exames.find(e => isDate(e.proximo));
  const semSess = sessoesSemana().length;
  const ref = d.refeicoes ? String(d.refeicoes).split(',').filter(Boolean) : [];
  const kcal = (m.dplano?.refeicoes || []).filter(r => ref.includes(r.id)).reduce((a, r) => a + r.kcal, 0);
  const imcTag = m.imc == null ? '' : m.imc < 18.5 ? '<span class="tag t-orange">baixo</span>' : m.imc < 25 ? '<span class="tag t-green">normal</span>' : m.imc < 30 ? '<span class="tag t-orange">sobrepeso</span>' : '<span class="tag t-red">obesidade</span>';
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  view(`
  ${header(`Olá${m.perfil.nome ? ', ' + H(m.perfil.nome) : ''} 👋`, dias[new Date().getDay()] + ', ' + new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }), `<div class="pill">📅 Semana ${weekType(TODAY)}</div>`)}
  <div class="grid g21">
    <div class="card"><h3>Prioridades de hoje <small>${fmtD(TODAY)}</small></h3>
      <ul class="list">
        ${autoItems.map((a, i) => `<li><span class="chk ${a.ok ? 'ok' : ''}" ${a.supl ? `data-supl="${a.supl}"` : ''}>${a.ok ? '✓' : ''}</span><span class="dot" style="background:${a.c}"></span><a ${a.href ? `href="${a.href}"` : ''} class="${a.ok ? 'done' : ''}">${H(a.txt)}</a><span class="when">${a.w}</span></li>`).join('')}
        ${hoje.map(t => `<li><span class="chk" data-task="${m.tasks.indexOf(t)}"></span><span class="dot" style="background:${t.due < TODAY ? C.red : C.orange}"></span>${H(t.txt)}<span class="when">${t.due < TODAY ? 'atrasada · ' : ''}${fmtD(t.due)}</span></li>`).join('')}
      </ul></div>
    <div class="card"><h3>Esta semana <small>${fmtD(mon)} – ${fmtD(sun)}</small></h3>
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div style="position:relative;width:110px;height:110px"><canvas id="cSem"></canvas>
          <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center"><div><b style="font-size:20px">${semSess}/5</b><br><small class="muted">treinos</small></div></div></div>
        <div style="flex:1;min-width:160px"><div class="small muted">Tarefas da semana</div><b style="font-size:20px">${semOk}/${semTot.length}</b>
          <div class="progress mt" style="margin-top:8px"><i style="width:${semTot.length ? semOk / semTot.length * 100 : 0}%;background:var(--green)"></i></div></div>
      </div>
      <ul class="list mt">${semana.length ? semana.map(t => `<li><span class="chk" data-task="${m.tasks.indexOf(t)}"></span>${H(t.txt)}<span class="when">${fmtD(t.due)}</span></li>`).join('') : '<li class="muted">Nada mais com prazo nesta semana.</li>'}</ul>
    </div>
  </div>
  <h3 class="sec">Áreas</h3>
  <div class="grid g3">
    <a class="card cat" href="#saude"><div class="head"><div class="t"><div class="ico b-red">❤</div>Saúde</div>${exPend ? `<span class="tag ${exVenc ? 't-red' : 't-orange'}">${exPend} pendências</span>` : '<span class="tag t-green">em dia</span>'}</div>
      <div class="rows">
        <div><small>Próximo exame</small><b>${H(prox?.nome || '—')}</b><div class="small muted">${prox ? fmtD(prox.proximo) : ''}</div></div>
        <div><small>IMC</small><b>${num(m.imc)}</b> ${imcTag}</div>
        <div><small>Cintura</small><b>${num(m.cintura, 0)} cm</b> ${m.cintura ? (m.cintura < 94 ? '<span class="tag t-green">ok</span>' : '<span class="tag t-orange">atenção</span>') : ''}</div>
        <div><small>Exames vencidos</small><b>${exVenc}</b></div>
      </div><span class="go">→</span></a>
    <a class="card cat" href="#treino"><div class="head"><div class="t"><div class="ico b-blue">🏋</div>Treino</div><span class="tag t-blue">Semana ${weekType(TODAY)}</span></div>
      <div class="rows">
        <div><small>Hoje</small><b>${H(slotNome(slot))}</b><div class="small muted">${treinou ? '✓ concluído' : m.prog.sessoes[slot] ? m.prog.sessoes[slot].exercicios.length + ' exercícios' : ''}</div></div>
        <div><small>Sessões na semana</small><b>${semSess} / 5</b></div>
        <div><small>Peso</small><b>${num(m.peso)} kg</b></div>
        <div><small>Mesociclo</small><b>${m.prog.mesociclo}</b></div>
      </div><span class="go">→</span></a>
    <a class="card cat" href="#dieta"><div class="head"><div class="t"><div class="ico b-green">🥗</div>Dieta</div><span class="tag t-green">ganho controlado</span></div>
      <div class="rows">
        <div><small>Hoje</small><b>${num(kcal, 0)} kcal</b><div class="small muted">de ${num(m.dplano?.metas.kcal, 0)}</div></div>
        <div><small>Refeições</small><b>${ref.length} / ${m.dplano?.refeicoes.length || 4}</b></div>
        <div><small>Água</small><b>${num(d.agua_l || 0)} L</b></div>
        <div><small>Suplementos</small><b>${sup.filter(s => d[s.id] === true).length} / ${sup.length}</b></div>
      </div><span class="go">→</span></a>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-orange">💰</div>Finanças</div><span class="tag t-gray">em breve</span></div><p class="muted">Receitas, despesas, investimentos e metas.</p></div>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-purple">📚</div>Educação</div><span class="tag t-gray">em breve</span></div><p class="muted">Cursos, estudos e metas de aprendizado.</p></div>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-teal">💼</div>Carreira</div><span class="tag t-gray">em breve</span></div><p class="muted">Desenvolvimento, renda extra e posts.</p></div>
  </div>`);
  chart('cSem', { type: 'doughnut', data: { datasets: [{ data: [semSess, Math.max(0, 5 - semSess)], backgroundColor: [C.pri, C.grid], borderWidth: 0 }] }, options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } } });
  document.querySelectorAll('[data-task]').forEach(el => el.onclick = () => act(null, () => toggleTask(S.m.tasks[+el.dataset.task]), 'Tarefa atualizada'));
  document.querySelectorAll('[data-supl]').forEach(el => el.onclick = () => act(null, () => saveDiario({ [el.dataset.supl]: !(diarioDe(TODAY) || {})[el.dataset.supl] })));
}

// ---------- SAÚDE ----------
function renderSaude() {
  const m = S.m, p = m.perfil;
  const prox = m.exames.find(e => isDate(e.proximo));
  const rel = m.cintura && m.alt ? m.cintura / m.alt : null;
  const pa = m.last('pa_sistolica') ? `${m.last('pa_sistolica')}/${m.last('pa_diastolica') ?? '—'}` : '—';
  const tagSt = { vencido: 't-red', pendente: 't-orange', 'em breve': 't-orange', 'em dia': 't-green' };
  const idade = isDate(p.data_nascimento) ? Math.floor(daysBetween(p.data_nascimento, TODAY) / 365.25) : p.idade;
  view(`
  ${header('Saúde', 'Exames, consultas e indicadores.')}
  <div class="grid g4">
    ${kpi('⚖', 'b-orange', 'IMC', `${num(m.imc)} <span>kg/m²</span>`, m.imc ? `<span class="tag ${m.imc < 25 ? 't-green' : 't-orange'}">${m.imc < 25 ? 'normal' : m.imc < 30 ? 'sobrepeso' : 'obesidade'} (OMS)</span>` : '')}
    ${kpi('📏', 'b-green', 'Cintura / altura', num(rel, 2), rel ? `<span class="tag ${rel < 0.5 ? 't-green' : 't-orange'}">${rel < 0.5 ? 'abaixo de 0,50' : 'acima de 0,50'}</span>` : '')}
    ${kpi('🩺', 'b-red', 'Pressão arterial', `${pa} <span>mmHg</span>`, pa === '—' ? '<span class="tag t-gray">registre numa medição</span>' : '')}
    ${kpi('📅', 'b-blue', 'Próximo exame', `<span style="font-size:20px;color:var(--ink);font-weight:700">${H(prox?.nome || '—')}</span>`, prox ? `<span class="tag t-orange">${daysBetween(TODAY, prox.proximo) < 0 ? 'atrasado ' + -daysBetween(TODAY, prox.proximo) + ' dias' : 'em ' + daysBetween(TODAY, prox.proximo) + ' dias'}</span>` : '')}
  </div>
  <div class="grid g21 mt">
    <div class="card"><h3>Calendário de exames <small>dias até o próximo</small></h3><div class="ch lg"><canvas id="cEx"></canvas></div></div>
    <div class="card"><h3>Posição do IMC <small>classificação OMS</small></h3><div class="ch sm"><canvas id="cImc"></canvas></div>
      <p class="note">${m.cintura && m.cintura < 94 ? 'Cintura abaixo de 94 cm: o IMC elevado tende a refletir massa muscular.' : ''}</p></div>
  </div>
  <div class="grid g21 mt">
    <div class="card"><h3>Exames de rotina <small>clique em "Feito" ao realizar</small></h3><div class="tbl"><table>
      <thead><tr><th>Exame</th><th>Periodicidade</th><th>Último</th><th>Próximo</th><th>Status</th><th></th></tr></thead>
      <tbody>${m.exames.map((e, i) => `<tr><td><b>${H(e.nome)}</b></td><td>${e.periodicidade_meses ? e.periodicidade_meses + ' meses' : H(e.frequencia || '1x na vida')}</td><td>${fmtD(e.ultimo)}</td><td>${fmtD(e.proximo)}</td>
        <td><span class="tag ${tagSt[e.status]}">${e.status}</span></td><td><button class="btn sm ghost" data-ex="${i}">Feito</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Perfil</h3><ul class="list">
      <li>Idade<span class="when">${idade ?? '—'} anos</span></li>
      <li>Altura<span class="when">${num(m.alt, 0)} cm</span></li>
      <li>Peso<span class="when">${num(m.peso)} kg</span></li>
      <li>Tipo sanguíneo<span class="when">${H(p.tipo_sanguineo || 'a descobrir')}</span></li>
      ${String(p.fatores_risco || '').split(';').map(s => s.trim()).filter(Boolean).map(s => `<li><span class="dot" style="background:var(--red)"></span>${H(s)}<span class="when">risco</span></li>`).join('')}
      ${String(p.fatores_protecao || '').split(';').map(s => s.trim()).filter(Boolean).map(s => `<li><span class="dot" style="background:var(--green)"></span>${H(s)}<span class="when">protetor</span></li>`).join('')}
    </ul></div>
  </div>`);
  const ex = m.exames.filter(e => isDate(e.proximo));
  const dd = ex.map(e => daysBetween(TODAY, e.proximo));
  chart('cEx', { type: 'bar', data: { labels: ex.map(e => e.nome), datasets: [{ data: dd.map(d => Math.max(d, 1)), backgroundColor: dd.map((d, i) => ex[i].status === 'vencido' ? C.red : d < 60 ? C.orange : C.green), borderRadius: 6 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => dd[c.dataIndex] + ' dias' } } }, scales: { x: { ...gridY, title: { display: true, text: 'dias' } }, y: noGrid } } });
  if (m.imc) chart('cImc', { type: 'bar', data: { labels: ['IMC'], datasets: [
      { label: '< 18,5', data: [18.5], backgroundColor: '#dfe6f5' }, { label: 'Normal', data: [6.5], backgroundColor: '#bfe9d6' },
      { label: 'Sobrepeso', data: [5], backgroundColor: '#ffe0bf' }, { label: 'Obesidade', data: [10], backgroundColor: '#f9caca' }] },
    options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { enabled: false } }, scales: { x: { stacked: true, min: 15, max: 35, grid: { display: false } }, y: { stacked: true, display: false } } },
    plugins: [{ id: 'mark', afterDatasetsDraw(ch) { const x = ch.scales.x.getPixelForValue(m.imc), { top, bottom } = ch.chartArea, c = ch.ctx; c.save(); c.strokeStyle = C.pri; c.lineWidth = 3; c.beginPath(); c.moveTo(x, top - 4); c.lineTo(x, bottom + 4); c.stroke(); c.fillStyle = C.pri; c.font = '600 12px Inter'; c.textAlign = 'center'; c.fillText('você ' + num(m.imc), x, top - 8); c.restore(); } }] });
  document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
    const e = m.exames[+b.dataset.ex];
    const d = prompt(`Data em que "${e.nome}" foi feito (AAAA-MM-DD):`, TODAY);
    if (!d) return; if (!isDate(d)) { toast('Data inválida'); return; }
    const proximo = e.periodicidade_meses ? addMonths(d, e.periodicidade_meses) : '';
    act(b, () => save(e.path, setFm(S.files[e.path].text, { ultimo: d, proximo })), 'Exame registrado');
  });
}

// ---------- TREINO ----------
function renderTreino(sub = 'hoje') {
  const tabs = [['hoje', 'Hoje'], ['evolucao', 'Evolução'], ['medicoes', 'Medições'], ['plano', 'Plano']];
  const body = { hoje: treinoHoje, evolucao: treinoEvol, medicoes: treinoMedicoes, plano: treinoPlano }[sub] || treinoHoje;
  view(`${header('Treino', `Mesociclo ${S.m.prog.mesociclo} · hipertrofia, força e condicionamento.`)}
    <div class="tabs">${tabs.map(([k, t]) => `<a href="#treino/${k}" class="${k === sub ? 'on' : ''}">${t}</a>`).join('')}</div><div id="tb"></div>`);
  body();
}

function lastSets(nome) {
  for (let i = S.m.sessoes.length - 1; i >= 0; i--) { const s = S.m.sessoes[i].sets.filter(x => x.ex === nome); if (s.length) return s; }
  return [];
}
const draftKey = id => 'rascunho-' + TODAY + '-' + id;

function treinoHoje() {
  const m = S.m, slot = slotFor(TODAY);
  if (!S.ui.semana) S.ui.semana = weekType(TODAY);
  if (!S.ui.sessao) S.ui.sessao = m.prog.sessoes[slot] ? slot : 'supA';
  const sess = m.prog.sessoes[S.ui.sessao];
  const semS = sessoesSemana(), series = semS.reduce((a, s) => a + s.sets.length, 0);
  let draft = {}; try { draft = JSON.parse(localStorage.getItem(draftKey(S.ui.sessao)) || '{}'); } catch { }
  const pesos = m.medicoes.filter(x => x.peso_kg != null).slice(-10);
  const idx = (parseD(TODAY).getDay() + 6) % 7;
  const feitos = new Set(semS.map(s => s.sessao));
  $('#tb').innerHTML = `
  <div class="grid g4">
    ${kpi('⚖', 'b-blue', 'Peso', `${num(m.peso)} <span>kg</span>`, '<div class="spark"><canvas id="sp"></canvas></div>')}
    ${kpi('%', 'b-purple', 'Gordura', `${num(m.last('gordura_pct'))} <span>%</span>`, '<span class="tag t-blue">meta 10–14%</span>')}
    ${kpi('✓', 'b-green', 'Sessões', `${semS.length} <span>/ 5</span>`, `<div class="progress"><i style="width:${semS.length / 5 * 100}%;background:var(--green)"></i></div>`)}
    ${kpi('🔥', 'b-orange', 'Séries na semana', `${series} <span>séries</span>`, '<span class="tag t-blue">plano ≈ 98</span>')}
  </div>
  <div class="card mt"><h3>Semana <span class="toggle"><a data-w="A" class="${S.ui.semana === 'A' ? 'on' : ''}">A · futebol seg</a><a data-w="B" class="${S.ui.semana === 'B' ? 'on' : ''}">B · futebol ter</a></span></h3>
    <div class="week">${m.prog.semanas[S.ui.semana].map((id, i) => `<div class="day ${id === 'futebol' ? 'fut' : ''} ${i === idx && S.ui.semana === weekType(TODAY) ? 'today' : ''} ${feitos.has(slotNome(id)) && S.ui.semana === weekType(TODAY) ? 'feito' : ''}"><b>${DIAS[i]}</b>${slotNome(id)}</div>`).join('')}</div>
    <p class="note">Esta semana é a <b>${weekType(TODAY)}</b>. Nunca há inferiores no dia seguinte ao futebol.</p></div>
  <div class="grid g21 mt">
    <div class="card"><h3>Registrar treino
      <select id="selS" style="width:auto">${Object.entries(m.prog.sessoes).map(([k, s]) => `<option value="${k}" ${k === S.ui.sessao ? 'selected' : ''}>${s.nome}${k === slot ? ' (hoje)' : ''}</option>`).join('')}</select></h3>
      <p class="note" style="margin:-6px 0 14px">Os números em cinza são do último treino. Na dupla progressão, ao bater o topo da faixa em todas as séries, suba a carga.</p>
      <div id="reg">${sess.exercicios.map((e, ei) => { const ls = lastSets(e.nome); return `<div class="ex"><div class="h"><span>${H(e.nome)}</span><span class="tag t-blue">${e.series} × ${e.reps} · RIR ${e.rir}</span></div>
        <div class="set hd"><span>Série</span><span>kg</span><span>reps</span><span>RIR</span></div>
        ${Array.from({ length: e.series }, (_, si) => { const k = ei + '-' + si, dv = draft[k] || {}, l = ls[si] || ls[ls.length - 1] || {};
          return `<div class="set"><b>${si + 1}</b><input inputmode="decimal" data-k="${k}" data-f="kg" value="${H(dv.kg || '')}" placeholder="${l.kg ?? '—'}"><input inputmode="numeric" data-k="${k}" data-f="reps" value="${H(dv.reps || '')}" placeholder="${l.reps ?? '—'}"><input inputmode="numeric" data-k="${k}" data-f="rir" value="${H(dv.rir || '')}" placeholder="${H(e.rir)}"></div>`; }).join('')}</div>`; }).join('')}</div>
      <button class="btn" id="salvarT" style="width:100%">Concluir e salvar treino</button></div>
    <div class="card"><h3>Volume por grupo <small>séries na semana</small></h3><div class="ch" style="height:440px"><canvas id="cVol"></canvas></div></div>
  </div>`;
  document.querySelectorAll('[data-w]').forEach(a => a.onclick = () => { S.ui.semana = a.dataset.w; treinoHoje(); });
  $('#selS').onchange = e => { S.ui.sessao = e.target.value; treinoHoje(); };
  $('#reg').oninput = e => { const t = e.target; if (!t.dataset.k) return; (draft[t.dataset.k] ||= {})[t.dataset.f] = t.value; localStorage.setItem(draftKey(S.ui.sessao), JSON.stringify(draft)); };
  $('#salvarT').onclick = ev => salvarTreino(ev.target, sess, draft);
  if (pesos.length) chart('sp', { type: 'line', data: { labels: pesos.map(x => x.data), datasets: [{ data: pesos.map(x => x.peso_kg), borderColor: C.pri, borderWidth: 2, pointRadius: 0, tension: .4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } } });
  // volume planejado (semana atual) x feito
  const grupos = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Quadríceps', 'Posterior', 'Glúteos', 'Panturrilha', 'Abdômen'];
  const plan = Object.fromEntries(grupos.map(g => [g, 0])), feito = Object.fromEntries(grupos.map(g => [g, 0]));
  m.prog.semanas[weekType(TODAY)].forEach(id => m.prog.sessoes[id]?.exercicios.forEach(e => plan[e.grupo] += e.series));
  semS.forEach(s => s.sets.forEach(x => { const g = m.grupoDe[x.ex]; if (g) feito[g]++; }));
  chart('cVol', { type: 'bar', data: { labels: grupos, datasets: [{ label: 'Planejado', data: grupos.map(g => plan[g]), backgroundColor: C.soft, borderRadius: 5 }, { label: 'Feito', data: grupos.map(g => feito[g]), backgroundColor: C.green, borderRadius: 5 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: gridY, y: noGrid } } });
}

function salvarTreino(btn, sess, draft) {
  const rows = [];
  sess.exercicios.forEach((e, ei) => { for (let si = 0; si < e.series; si++) { const d = draft[ei + '-' + si]; if (d && d.reps) rows.push({ ex: e.nome, s: si + 1, kg: String(d.kg || 0).replace(',', '.'), reps: d.reps, rir: d.rir || '' }); } });
  if (!rows.length) { toast('Preencha ao menos uma série (reps).'); return; }
  const volume = Math.round(rows.reduce((a, r) => a + (+r.kg) * (+r.reps), 0));
  let path = `20 Treino/Sessões/${TODAY} ${sess.nome}.md`, n = 2;
  while (S.files[path]) path = `20 Treino/Sessões/${TODAY} ${sess.nome} ${n++}.md`;
  const text = mkNote({ tipo: 'sessao-treino', data: TODAY, sessao: sess.nome, semana: weekType(TODAY), mesociclo: S.m.prog.mesociclo, series: rows.length, volume_kg: volume },
    `# ${sess.nome} — ${TODAY}\n\n| Exercício | Série | kg | Reps | RIR |\n|---|---|---|---|---|\n` + rows.map(r => `| ${r.ex} | ${r.s} | ${r.kg} | ${r.reps} | ${r.rir} |`).join('\n') + '\n');
  act(btn, async () => { await save(path, text); localStorage.removeItem(draftKey(S.ui.sessao)); }, `Treino salvo: ${rows.length} séries, ${volume.toLocaleString('pt-BR')} kg de volume`);
}

function treinoEvol() {
  const m = S.m;
  const e1rm = {}; // exercício -> [{data, v}]
  m.sessoes.forEach(s => { const best = {}; s.sets.forEach(x => { const v = x.kg * (1 + x.reps / 30); if (!best[x.ex] || v > best[x.ex]) best[x.ex] = v; });
    Object.entries(best).forEach(([ex, v]) => (e1rm[ex] ||= []).push({ data: s.data, v: Math.round(v) })); });
  const exs = Object.keys(e1rm).sort();
  if (!S.ui.exEvol || !e1rm[S.ui.exEvol]) S.ui.exEvol = exs.find(e => /Supino reto|Agachamento livre|terra/i.test(e)) || exs[0];
  const semanas = Array.from({ length: 8 }, (_, i) => addDays(mondayOf(TODAY), -7 * (7 - i)));
  const porSem = semanas.map(w => m.sessoes.filter(s => s.data >= w && s.data <= addDays(w, 6)).reduce((a, s) => a + s.sets.length, 0));
  const meds = m.medicoes, pes = meds.filter(x => x.peso_kg != null);
  const circ = [['peito_cm', 'Peito'], ['cintura_cm', 'Cintura'], ['braco_contraido_cm', 'Braço'], ['coxa_cm', 'Coxa'], ['panturrilha_cm', 'Panturrilha']];
  const first = k => meds.find(x => x[k] != null)?.[k], lastv = k => m.last(k);
  $('#tb').innerHTML = `<div class="grid g2">
    <div class="card"><h3>Peso corporal <small>medições</small></h3>${pes.length > 1 ? '<div class="ch"><canvas id="cPeso"></canvas></div>' : emptyChart('Registre medições para ver a curva.')}</div>
    <div class="card"><h3>1RM estimado ${exs.length ? `<select id="selEx" style="width:auto">${exs.map(e => `<option ${e === S.ui.exEvol ? 'selected' : ''}>${H(e)}</option>`).join('')}</select>` : ''}</h3>${exs.length ? '<div class="ch"><canvas id="cForca"></canvas></div>' : emptyChart('Os treinos registrados aparecem aqui.')}</div>
    <div class="card"><h3>Séries por semana <small>últimas 8</small></h3><div class="ch"><canvas id="cSeries"></canvas></div></div>
    <div class="card"><h3>Circunferências <small>primeira × última</small></h3>${circ.some(([k]) => first(k) != null) ? '<div class="ch"><canvas id="cCirc"></canvas></div>' : emptyChart('Registre circunferências em Medições.')}</div>
    <div class="card"><h3>Gordura e massa muscular <small>bioimpedância</small></h3>${meds.some(x => x.gordura_pct != null) ? '<div class="ch"><canvas id="cComp"></canvas></div>' : emptyChart('Registre a bioimpedância do relógio em Medições.')}</div>
    <div class="card"><h3>Volume total por sessão <small>kg × reps</small></h3>${m.sessoes.length ? '<div class="ch"><canvas id="cVolS"></canvas></div>' : emptyChart('Os treinos registrados aparecem aqui.')}</div>
  </div>`;
  if (pes.length > 1) chart('cPeso', { type: 'line', data: { labels: pes.map(x => fmtD(x.data)), datasets: [{ label: 'Peso (kg)', data: pes.map(x => x.peso_kg), borderColor: C.pri, backgroundColor: 'rgba(61,90,241,.08)', fill: true, tension: .35 }] }, options: { maintainAspectRatio: false, scales: { y: gridY, x: noGrid } } });
  if (exs.length) { const d = e1rm[S.ui.exEvol]; chart('cForca', { type: 'line', data: { labels: d.map(x => fmtD(x.data)), datasets: [{ label: S.ui.exEvol + ' (kg)', data: d.map(x => x.v), borderColor: C.green, tension: .35 }] }, options: { maintainAspectRatio: false, scales: { y: gridY, x: noGrid } } });
    $('#selEx').onchange = e => { S.ui.exEvol = e.target.value; treinoEvol(); }; }
  chart('cSeries', { type: 'bar', data: { labels: semanas.map(fmtD), datasets: [{ label: 'Séries', data: porSem, backgroundColor: C.pri, borderRadius: 6 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: gridY, x: noGrid } } });
  if (circ.some(([k]) => first(k) != null)) chart('cCirc', { type: 'bar', data: { labels: circ.map(c => c[1]), datasets: [{ label: 'Primeira', data: circ.map(([k]) => first(k)), backgroundColor: C.soft, borderRadius: 5 }, { label: 'Última', data: circ.map(([k]) => lastv(k)), backgroundColor: C.pri, borderRadius: 5 }] }, options: { maintainAspectRatio: false, scales: { y: gridY, x: noGrid } } });
  const comp = meds.filter(x => x.gordura_pct != null);
  if (comp.length) chart('cComp', { type: 'line', data: { labels: comp.map(x => fmtD(x.data)), datasets: [{ label: 'Gordura (%)', data: comp.map(x => x.gordura_pct), borderColor: C.orange, yAxisID: 'y', tension: .35 }, { label: 'Massa muscular (kg)', data: comp.map(x => x.massa_muscular_kg), borderColor: C.purple, yAxisID: 'y1', tension: .35 }] }, options: { maintainAspectRatio: false, scales: { y: gridY, y1: { position: 'right', grid: { display: false } }, x: noGrid } } });
  if (m.sessoes.length) chart('cVolS', { type: 'bar', data: { labels: m.sessoes.slice(-20).map(s => fmtD(s.data).slice(0, 5)), datasets: [{ label: 'Volume (kg)', data: m.sessoes.slice(-20).map(s => s.volume_kg), backgroundColor: C.teal, borderRadius: 5 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: gridY, x: noGrid } } });
}

const CAMPOS = [['peso_kg', 'Peso (kg)'], ['gordura_pct', 'Gordura (%)'], ['massa_muscular_kg', 'Massa muscular (kg)'], ['cintura_cm', 'Cintura (cm)'], ['pescoco_cm', 'Pescoço (cm)'], ['peito_cm', 'Peito (cm)'],
  ['quadril_cm', 'Quadril (cm)'], ['braco_relaxado_cm', 'Braço relaxado (cm)'], ['braco_contraido_cm', 'Braço contraído (cm)'], ['antebraco_cm', 'Antebraço (cm)'], ['coxa_cm', 'Coxa (cm)'], ['panturrilha_cm', 'Panturrilha (cm)'],
  ['fc_repouso', 'FC repouso (bpm)'], ['vo2max', 'VO₂máx'], ['sono_medio_h', 'Sono médio (h)'], ['pa_sistolica', 'PA sistólica'], ['pa_diastolica', 'PA diastólica']];
function treinoMedicoes() {
  const meds = [...S.m.medicoes].reverse();
  $('#tb').innerHTML = `<div class="card"><h3>Nova medição <small>preencha só o que mediu</small></h3>
    <div class="form"><label class="f">Data<input type="date" id="mData" value="${TODAY}"></label>${CAMPOS.map(([k, l]) => `<label class="f">${l}<input inputmode="decimal" data-m="${k}"></label>`).join('')}</div>
    <button class="btn mt" id="salvarM">Salvar medição</button></div>
  <div class="card mt"><h3>Histórico</h3><div class="tbl"><table><thead><tr><th>Data</th>${CAMPOS.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
    <tbody>${meds.map(x => `<tr><td><b>${fmtD(x.data)}</b></td>${CAMPOS.map(([k]) => `<td>${num(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  $('#salvarM').onclick = ev => {
    const data = $('#mData').value; if (!isDate(data)) { toast('Data inválida'); return; }
    const vals = {}; document.querySelectorAll('[data-m]').forEach(i => { if (i.value.trim()) vals[i.dataset.m] = Number(i.value.replace(',', '.')); });
    if (!Object.keys(vals).length) { toast('Preencha ao menos um campo.'); return; }
    const path = `20 Treino/Medições/${data} Medição.md`;
    const text = S.files[path] ? setFm(S.files[path].text, vals)
      : mkNote({ tipo: 'medicao', data, ...Object.fromEntries(CAMPOS.map(([k]) => [k, vals[k] ?? null])) }, `# Medição — ${data}\n\n## Observações\n- \n`);
    act(ev.target, () => save(path, text), 'Medição salva');
  };
}

function treinoPlano() {
  const p = S.m.prog;
  $('#tb').innerHTML = `<div class="grid g2">${Object.values(p.sessoes).map(s => `<div class="card"><h3>${s.nome} <small>${s.foco}</small></h3><div class="tbl"><table>
    <thead><tr><th>Exercício</th><th>Séries × reps</th><th>RIR</th><th>Grupo</th></tr></thead>
    <tbody>${s.exercicios.map(e => `<tr><td><b>${H(e.nome)}</b></td><td>${e.series} × ${e.reps}</td><td>${e.rir}</td><td><span class="tag t-gray">${e.grupo}</span></td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>
    <p class="note">O plano fica em <code>20 Treino/programa.json</code>. A cada mesociclo, o Claude gera as novas variações a partir do seu histórico.</p>`;
}

// ---------- DIETA ----------
async function saveDiario(changes) {
  const path = `30 Dieta/Diário/${TODAY}.md`;
  const sup = Object.fromEntries((S.m.dplano?.suplementos || []).map(s => [s.id, false]));
  const text = S.files[path] ? setFm(S.files[path].text, changes)
    : mkNote({ tipo: 'diario-dieta', data: TODAY, refeicoes: '', agua_l: 0, ...sup, ...changes }, `# Diário alimentar — ${TODAY}\n`);
  await save(path, text);
}
function renderDieta() {
  const m = S.m, pl = m.dplano, meta = pl.metas, d = diarioDe(TODAY) || {};
  const ref = d.refeicoes ? String(d.refeicoes).split(',').filter(Boolean) : [];
  const feitas = pl.refeicoes.filter(r => ref.includes(r.id));
  const sum = k => feitas.reduce((a, r) => a + r[k], 0);
  const agua = Number(d.agua_l || 0);
  const bar = (v, t, c) => `<div class="progress"><i style="width:${Math.min(100, v / t * 100)}%;background:${c}"></i></div>`;
  const dias = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i - 13));
  const ader = dias.map(x => { const dd = diarioDe(x); return dd && dd.refeicoes ? String(dd.refeicoes).split(',').filter(Boolean).length : 0; });
  view(`${header('Dieta', 'Ganho de massa controlado · ajuste das calorias a cada 2 semanas pela média do peso.')}
  <div class="grid g4">
    ${kpi('🔥', 'b-orange', 'Calorias', `${num(sum('kcal'), 0)} <span>/ ${num(meta.kcal, 0)} kcal</span>`, bar(sum('kcal'), meta.kcal, C.orange))}
    ${kpi('🥩', 'b-blue', 'Proteína', `${sum('p')} <span>/ ${meta.proteina} g</span>`, bar(sum('p'), meta.proteina, C.pri))}
    ${kpi('💧', 'b-teal', 'Água', `${num(agua, 2)} <span>/ ${num(meta.agua_l)} L</span>`, `${bar(agua, meta.agua_l, C.teal)}<div class="chips mt" style="margin-top:10px"><button class="btn sm ghost" data-agua="0.25">+250 ml</button><button class="btn sm ghost" data-agua="0.5">+500 ml</button><button class="btn sm ghost" data-agua="-0.25">−</button></div>`)}
    ${kpi('💊', 'b-green', 'Suplementos', `${pl.suplementos.filter(s => d[s.id] === true).length} <span>/ ${pl.suplementos.length}</span>`, `<div class="chips">${pl.suplementos.map(s => `<button class="btn sm ${d[s.id] === true ? '' : 'ghost'}" data-sup="${s.id}">${d[s.id] === true ? '✓ ' : ''}${s.nome}</button>`).join('')}</div>`)}
  </div>
  <div class="grid g21 mt">
    <div class="card"><h3>Refeições de hoje <small>marque ao seguir o plano</small></h3>
      ${pl.refeicoes.map(r => `<div class="meal"><span class="chk ${ref.includes(r.id) ? 'ok' : ''}" data-ref="${r.id}">${ref.includes(r.id) ? '✓' : ''}</span>
        <div class="info"><b>${r.nome}</b><small>${H(r.exemplo)}</small></div><div class="mac">${r.kcal} kcal<br>P ${r.p} · C ${r.c} · G ${r.g}</div></div>`).join('')}</div>
    <div class="card"><h3>Macros <small>consumido × meta</small></h3><div class="ch"><canvas id="cMac"></canvas></div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>Adesão <small>refeições seguidas · 14 dias</small></h3><div class="ch sm"><canvas id="cAd"></canvas></div></div>
    <div class="card"><h3>Distribuição da meta <small>kcal por macro</small></h3><div class="ch sm"><canvas id="cDist"></canvas></div></div>
  </div>`);
  chart('cMac', { type: 'bar', data: { labels: ['Proteína', 'Carboidrato', 'Gordura'], datasets: [{ label: 'Meta (g)', data: [meta.proteina, meta.carboidrato, meta.gordura], backgroundColor: C.soft, borderRadius: 6 }, { label: 'Consumido (g)', data: [sum('p'), sum('c'), sum('g')], backgroundColor: [C.pri, C.green, C.orange], borderRadius: 6 }] }, options: { maintainAspectRatio: false, scales: { y: gridY, x: noGrid } } });
  chart('cAd', { type: 'bar', data: { labels: dias.map(x => fmtD(x).slice(0, 5)), datasets: [{ data: ader, backgroundColor: ader.map(v => v >= pl.refeicoes.length ? C.green : v >= 2 ? C.orange : C.red), borderRadius: 5 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ...gridY, max: pl.refeicoes.length, ticks: { stepSize: 1 } }, x: noGrid } } });
  chart('cDist', { type: 'doughnut', data: { labels: [`Proteína ${meta.proteina} g`, `Carboidrato ${meta.carboidrato} g`, `Gordura ${meta.gordura} g`], datasets: [{ data: [meta.proteina * 4, meta.carboidrato * 4, meta.gordura * 9], backgroundColor: [C.pri, C.green, C.orange], borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right' } } } });
  document.querySelectorAll('[data-ref]').forEach(el => el.onclick = () => {
    const set = new Set(ref); set.has(el.dataset.ref) ? set.delete(el.dataset.ref) : set.add(el.dataset.ref);
    act(null, () => saveDiario({ refeicoes: [...set].join(',') }));
  });
  document.querySelectorAll('[data-agua]').forEach(b => b.onclick = () => act(b, () => saveDiario({ agua_l: Math.max(0, Math.round((agua + Number(b.dataset.agua)) * 100) / 100) })));
  document.querySelectorAll('[data-sup]').forEach(b => b.onclick = () => act(b, () => saveDiario({ [b.dataset.sup]: !(d[b.dataset.sup] === true) })));
}

// ---------- CONFIGURAÇÕES ----------
function renderConfig() {
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem('gh') || '{}'); } catch { }
  const local = S.store === Local;
  view(`${header('Ajustes', 'Conexão com os dados do seu vault.')}
  <div class="card" style="max-width:640px"><h3>Fonte de dados <small>${S.store ? 'conectado: ' + S.store.nome : 'não conectado'}</small></h3>
    ${local ? '<p>Você está usando o <b>servidor local</b> no computador. Os dados são lidos e gravados direto na pasta do vault.</p>' : `
    <p class="muted" style="margin-bottom:16px">Os dados ficam no seu repositório <b>privado</b> do GitHub. O token fica salvo só neste aparelho.</p>
    <div class="form" style="grid-template-columns:1fr">
      <label class="f">Usuário do GitHub<input id="cOwner" value="${H(cfg.owner || '')}"></label>
      <label class="f">Repositório<input id="cRepo" value="${H(cfg.repo || 'segundo-cerebro')}"></label>
      <label class="f">Token (fine-grained, acesso só a este repositório: Contents read/write)<input id="cTok" type="password" placeholder="${cfg.token ? 'token salvo — deixe em branco para manter' : 'github_pat_…'}"></label>
    </div>
    <div class="chips mt"><button class="btn" id="cSave">Conectar</button>${cfg.token ? '<button class="btn ghost" id="cOut">Remover token deste aparelho</button>' : ''}</div>`}
  </div>`);
  if (local) return;
  $('#cSave').onclick = async ev => {
    const n = { owner: $('#cOwner').value.trim(), repo: $('#cRepo').value.trim(), token: $('#cTok').value.trim() || cfg.token };
    if (!n.owner || !n.repo || !n.token) { toast('Preencha usuário, repositório e token.'); return; }
    ev.target.disabled = true; GH.cfg = n; S.store = GH;
    try { await load(); localStorage.setItem('gh', JSON.stringify(n)); $('#modo').textContent = 'GitHub'; toast('Conectado!'); location.hash = '#inicio'; route(); }
    catch (e) { toast(e.message); ev.target.disabled = false; S.store = null; }
  };
  if ($('#cOut')) $('#cOut').onclick = () => { localStorage.removeItem('gh'); S.store = null; S.m = null; toast('Token removido'); renderConfig(); };
}

// ---------- início ----------
(async function init() {
  if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = C.muted; Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.maintainAspectRatio = false; }
  try { const r = await fetch('/__list', { method: 'HEAD', cache: 'no-store' }); if (r.ok && location.hostname === 'localhost') S.store = Local; } catch { }
  if (!S.store) { try { const cfg = JSON.parse(localStorage.getItem('gh') || 'null'); if (cfg && cfg.token) { GH.cfg = cfg; S.store = GH; } } catch { } }
  if (!S.store) { $('#modo').textContent = 'não conectado'; location.hash = '#config'; renderConfig(); return; }
  $('#modo').textContent = S.store.nome;
  try { await load(); } catch (e) { toast(e.message); S.m = null; location.hash = '#config'; renderConfig(); return; }
  const nome = S.m.perfil.nome; if (nome) { $('#nomeU').textContent = nome; $('#avU').textContent = nome[0]; }
  route();
})();
