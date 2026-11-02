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
  if (prog) Object.values(prog.sessoes).forEach(s => s.exercicios.forEach(e => [e.nome, ...(e.alternativas || [])].forEach(n => grupoDe[n] = e.grupo)));
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
  $('#modal')?.classList.remove('on');
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

// ---------- modal ----------
function modal(html, buttons = [['Fechar']]) {
  let el = $('#modal');
  if (!el) { el = document.createElement('div'); el.id = 'modal'; document.body.appendChild(el); }
  const close = () => el.classList.remove('on');
  el.innerHTML = `<div class="mbox">${html}<div class="chips mt" style="justify-content:flex-end">${buttons.map((b, i) => `<button class="btn ${i === buttons.length - 1 ? '' : 'ghost'}" data-mb="${i}">${b[0]}</button>`).join('')}</div></div>`;
  el.classList.add('on');
  el.onclick = e => { if (e.target === el) close(); };
  el.querySelectorAll('[data-mb]').forEach(b => b.onclick = () => { const f = buttons[+b.dataset.mb][1]; if (f && f(el) === false) return; close(); });
  return el;
}
const irPara = (msg, destino, rotulo) => modal(`<h3>Concluir pela aba ${rotulo}</h3><p>${msg}</p>`, [['Agora não'], ['Ir para ' + rotulo, () => { location.hash = destino; }]]);

// ---------- dieta: dados do dia ----------
const diaPath = d => `30 Dieta/Diário/${d}.md`;
function dia(d = TODAY) {
  const f = S.files[diaPath(d)]; let D = null;
  if (f) { const j = /```json\r?\n([\s\S]*?)\r?\n```/.exec(f.text); try { D = j && JSON.parse(j[1]); } catch { } }
  D = D || {}; D.refeicoes = D.refeicoes || {}; D.suplementos = D.suplementos || []; D.agua_l = D.agua_l || 0;
  return D;
}
function totaisRef(r, D) {
  const x = D.refeicoes[r.id]; if (!x) return null;
  if (x.modo === 'plano') return { kcal: r.kcal, p: r.p, c: r.c, g: r.g };
  return (x.itens || []).reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, g: a.g + i.gord }), { kcal: 0, p: 0, c: 0, g: 0 });
}
function totaisDia(D) {
  const t = { kcal: 0, p: 0, c: 0, g: 0, n: 0 };
  (S.m.dplano?.refeicoes || []).forEach(r => { const x = totaisRef(r, D); if (x) { t.kcal += x.kcal; t.p += x.p; t.c += x.c; t.g += x.g; t.n++; } });
  return t;
}
async function salvarDia(D, d = TODAY) {
  const t = totaisDia(D), r = Math.round;
  const text = mkNote({ tipo: 'diario-dieta', data: d, kcal: r(t.kcal), proteina_g: r(t.p), carboidrato_g: r(t.c), gordura_g: r(t.g),
    agua_l: D.agua_l, refeicoes: Object.keys(D.refeicoes).join(','), suplementos: D.suplementos.join(',') },
    `# Diário alimentar — ${d}\n\n\`\`\`json\n${JSON.stringify(D)}\n\`\`\`\n`);
  await save(diaPath(d), text);
}
async function toggleSupl(id) {
  const D = dia(); D.suplementos = D.suplementos.includes(id) ? D.suplementos.filter(x => x !== id) : [...D.suplementos, id];
  await salvarDia(D);
}

// ---------- medições compartilhadas (Saúde e Treino) ----------
const CAMPOS = [['peso_kg', 'Peso (kg)'], ['gordura_pct', 'Gordura (%)'], ['massa_muscular_kg', 'Massa muscular (kg)'], ['cintura_cm', 'Cintura (cm)'], ['pescoco_cm', 'Pescoço (cm)'], ['peito_cm', 'Peito (cm)'],
  ['quadril_cm', 'Quadril (cm)'], ['braco_relaxado_cm', 'Braço relaxado (cm)'], ['braco_contraido_cm', 'Braço contraído (cm)'], ['antebraco_cm', 'Antebraço (cm)'], ['coxa_cm', 'Coxa (cm)'], ['panturrilha_cm', 'Panturrilha (cm)'],
  ['fc_repouso', 'FC repouso (bpm)'], ['vo2max', 'VO₂máx'], ['sono_medio_h', 'Sono médio (h)'], ['pa_sistolica', 'PA sistólica'], ['pa_diastolica', 'PA diastólica']];
const ROTULO = Object.fromEntries(CAMPOS);
function formMedidas(campos, comAltura = false) {
  return `<div class="form fm-med"><label class="f">Data<input type="date" data-mdata value="${TODAY}"></label>
    ${comAltura ? `<label class="f">Altura (cm)<input inputmode="decimal" data-alt placeholder="${S.m.alt ?? ''}"></label>` : ''}
    ${campos.map(k => `<label class="f">${ROTULO[k]}<input inputmode="decimal" data-m="${k}" placeholder="${num(S.m.last(k))}"></label>`).join('')}</div>`;
}
async function salvarMedidas(root) {
  const data = root.querySelector('[data-mdata]').value;
  if (!isDate(data)) throw new Error('Data inválida');
  const vals = {}; root.querySelectorAll('[data-m]').forEach(i => { if (i.value.trim()) vals[i.dataset.m] = Number(i.value.replace(',', '.')); });
  const alt = root.querySelector('[data-alt]')?.value.trim();
  if (!Object.keys(vals).length && !alt) throw new Error('Preencha ao menos um campo.');
  if (alt) { const p = '10 Saúde/Perfil de Saúde.md'; await save(p, setFm(S.files[p].text, { altura_cm: Number(alt.replace(',', '.')), altura_atualizada_em: data })); }
  if (Object.keys(vals).length) {
    const path = `20 Treino/Medições/${data} Medição.md`;
    const text = S.files[path] ? setFm(S.files[path].text, vals)
      : mkNote({ tipo: 'medicao', data, ...Object.fromEntries(CAMPOS.map(([k]) => [k, vals[k] ?? null])) }, `# Medição — ${data}\n\n## Observações\n- \n`);
    await save(path, text);
  }
}
const NOTA_SYNC = '<p class="note">🔗 Saúde e Treino usam as mesmas medições: atualizar em uma aba atualiza a outra.</p>';

// ---------- INÍCIO ----------
function renderInicio() {
  const m = S.m, mon = mondayOf(TODAY), sun = addDays(mon, 6);
  const slot = slotFor(TODAY), D = dia(), t = totaisDia(D);
  const treinou = m.sessoes.some(s => s.data === TODAY);
  const hoje = m.tasks.filter(x => !x.ok && x.due && x.due <= TODAY);
  const semana = m.tasks.filter(x => x.due && x.due > TODAY && x.due <= sun && !x.ok);
  const semTot = m.tasks.filter(x => x.due && x.due >= mon && x.due <= sun);
  const semOk = semTot.filter(x => x.ok).length;
  const sup = m.dplano?.suplementos || [], nRef = m.dplano?.refeicoes.length || 4;
  const auto = [
    m.prog.sessoes[slot]
      ? { txt: 'Treino: ' + slotNome(slot), ok: treinou, c: C.pri, w: 'academia', fn: () => treinou ? toast('Treino de hoje já registrado ✓') : irPara('Para concluir o treino, registre as séries na aba Treino. Ele é marcado aqui automaticamente ao salvar.', '#treino', 'Treino') }
      : { txt: slotNome(slot), ok: false, c: C.green, w: 'hoje', fn: () => modal(`<h3>${slotNome(slot)}</h3><p>${slot === 'futebol' ? 'Dia de futebol: nada para registrar. Amanhã não há treino de inferiores.' : 'Cardio em Zona 2, de 30 a 60 min, no ritmo em que dá para conversar.'}</p>`) },
    { txt: `Refeições (${t.n}/${nRef})`, ok: t.n >= nRef, c: C.orange, w: 'dieta', fn: () => irPara('Para concluir, marque cada refeição na aba Dieta: seguiu o plano ou registre o que comeu.', '#dieta', 'Dieta') },
    ...sup.map(s => ({ txt: s.nome, ok: D.suplementos.includes(s.id), c: C.green, w: 'suplemento', fn: () => act(null, () => toggleSupl(s.id)) }))
  ];
  const exVenc = m.exames.filter(e => e.status === 'vencido').length, exPend = m.exames.filter(e => e.status !== 'em dia').length;
  const prox = m.exames.find(e => isDate(e.proximo));
  const semSess = sessoesSemana().length;
  const imcTag = m.imc == null ? '' : m.imc < 18.5 ? '<span class="tag t-orange">baixo</span>' : m.imc < 25 ? '<span class="tag t-green">normal</span>' : m.imc < 30 ? '<span class="tag t-orange">sobrepeso</span>' : '<span class="tag t-red">obesidade</span>';
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  view(`
  ${header(`Olá${m.perfil.nome ? ', ' + H(m.perfil.nome) : ''} 👋`, dias[new Date().getDay()] + ', ' + new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }), `<div class="pill">📅 Semana ${weekType(TODAY)}</div>`)}
  <div class="grid g21">
    <div class="card"><h3>Prioridades de hoje <small>${fmtD(TODAY)}</small></h3>
      <ul class="list">
        ${auto.map((a, i) => `<li class="clk" data-auto="${i}"><span class="chk ${a.ok ? 'ok' : ''}">${a.ok ? '✓' : ''}</span><span class="dot" style="background:${a.c}"></span><span class="${a.ok ? 'done' : ''}">${H(a.txt)}</span><span class="when">${a.w}</span></li>`).join('')}
        ${hoje.map(x => `<li class="clk" data-task="${m.tasks.indexOf(x)}"><span class="chk"></span><span class="dot" style="background:${x.due < TODAY ? C.red : C.orange}"></span>${H(x.txt)}<span class="when">${x.due < TODAY ? 'atrasada · ' : ''}${fmtD(x.due)}</span></li>`).join('')}
      </ul></div>
    <div class="card"><h3>Esta semana <small>${fmtD(mon)} – ${fmtD(sun)}</small></h3>
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div style="position:relative;width:110px;height:110px"><canvas id="cSem"></canvas>
          <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center"><div><b style="font-size:20px">${semSess}/5</b><br><small class="muted">treinos</small></div></div></div>
        <div style="flex:1;min-width:160px"><div class="small muted">Tarefas da semana</div><b style="font-size:20px">${semOk}/${semTot.length}</b>
          <div class="progress" style="margin-top:8px"><i style="width:${semTot.length ? semOk / semTot.length * 100 : 0}%;background:var(--green)"></i></div></div>
      </div>
      <ul class="list mt">${semana.length ? semana.map(x => `<li class="clk" data-task="${m.tasks.indexOf(x)}"><span class="chk"></span>${H(x.txt)}<span class="when">${fmtD(x.due)}</span></li>`).join('') : '<li class="muted">Nada mais com prazo nesta semana.</li>'}</ul>
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
        <div><small>Hoje</small><b>${num(t.kcal, 0)} kcal</b><div class="small muted">de ${num(m.dplano?.metas.kcal, 0)}</div></div>
        <div><small>Proteína</small><b>${num(t.p, 0)} / ${m.dplano?.metas.proteina} g</b></div>
        <div><small>Água</small><b>${num(D.agua_l, 2)} L</b></div>
        <div><small>Suplementos</small><b>${sup.filter(s => D.suplementos.includes(s.id)).length} / ${sup.length}</b></div>
      </div><span class="go">→</span></a>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-orange">💰</div>Finanças</div><span class="tag t-gray">em breve</span></div><p class="muted">Receitas, despesas, investimentos e metas.</p></div>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-purple">📚</div>Educação</div><span class="tag t-gray">em breve</span></div><p class="muted">Cursos, estudos e metas de aprendizado.</p></div>
    <div class="card cat off"><div class="head"><div class="t"><div class="ico b-teal">💼</div>Carreira</div><span class="tag t-gray">em breve</span></div><p class="muted">Desenvolvimento, renda extra e posts.</p></div>
  </div>`);
  chart('cSem', { type: 'doughnut', data: { datasets: [{ data: [semSess, Math.max(0, 5 - semSess)], backgroundColor: [C.pri, C.grid], borderWidth: 0 }] }, options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } } });
  document.querySelectorAll('[data-task]').forEach(el => el.onclick = () => act(null, () => toggleTask(S.m.tasks[+el.dataset.task]), 'Tarefa atualizada'));
  document.querySelectorAll('[data-auto]').forEach(el => el.onclick = () => auto[+el.dataset.auto].fn());
}

// ---------- SAÚDE ----------
const INDICADORES = [
  ['peso_kg', 'Peso', 'kg', 7, 'Toda semana (use a média)', 'Balança ou relógio'],
  ['cintura_cm', 'Cintura', 'cm', 30, 'Todo mês', 'Fita métrica, na altura do umbigo'],
  ['gordura_pct', 'Gordura corporal', '%', 7, 'Toda semana', 'Bioimpedância do relógio, em jejum'],
  ['pa_sistolica', 'Pressão arterial', 'mmHg', 90, 'A cada 3 meses em casa; anual no consultório', 'Medidor de braço (SBC 2025)'],
  ['fc_repouso', 'FC de repouso', 'bpm', 30, 'Todo mês', 'Relógio, ao acordar'],
  ['vo2max', 'VO₂máx', 'ml/kg/min', 30, 'Todo mês', 'Relógio, após corrida ao ar livre'],
  ['altura_cm', 'Altura', 'cm', 365, 'Uma vez por ano', 'Check-up']
];
function indicador(k) {
  if (k === 'altura_cm') return { v: S.m.alt, data: S.m.perfil.altura_atualizada_em || S.m.perfil.atualizado_em };
  const x = [...S.m.medicoes].reverse().find(m => m[k] != null);
  if (!x) return { v: null, data: null };
  return { v: k === 'pa_sistolica' ? `${x.pa_sistolica}/${x.pa_diastolica ?? '—'}` : x[k], data: x.data };
}
function renderSaude() {
  const m = S.m, p = m.perfil;
  const prox = m.exames.find(e => isDate(e.proximo));
  const rel = m.cintura && m.alt ? m.cintura / m.alt : null;
  const pa = indicador('pa_sistolica').v || '—';
  const tagSt = { vencido: 't-red', pendente: 't-orange', 'em breve': 't-orange', 'em dia': 't-green' };
  const idade = isDate(p.data_nascimento) ? Math.floor(daysBetween(p.data_nascimento, TODAY) / 365.25) : p.idade;
  const lista = s => String(s || '').split(';').map(x => x.trim()).filter(Boolean);
  view(`
  ${header('Saúde', 'Exames, consultas e indicadores.', '<button class="btn" id="btnAtu">+ Atualizar dados</button>')}
  <div class="grid g4">
    ${kpi('⚖', 'b-orange', 'IMC', `${num(m.imc)} <span>kg/m²</span>`, m.imc ? `<span class="tag ${m.imc < 25 ? 't-green' : 't-orange'}">${m.imc < 25 ? 'normal' : m.imc < 30 ? 'sobrepeso' : 'obesidade'} (OMS)</span>` : '')}
    ${kpi('📏', 'b-green', 'Cintura / altura', num(rel, 2), rel ? `<span class="tag ${rel < 0.5 ? 't-green' : 't-orange'}">${rel < 0.5 ? 'abaixo de 0,50' : 'acima de 0,50'}</span>` : '')}
    ${kpi('🩺', 'b-red', 'Pressão arterial', `${pa} <span>mmHg</span>`, pa === '—' ? '<span class="tag t-gray">ainda não registrada</span>' : '')}
    ${kpi('📅', 'b-blue', 'Próximo exame', `<span style="font-size:20px;color:var(--ink);font-weight:700">${H(prox?.nome || '—')}</span>`, prox ? `<span class="tag t-orange">${daysBetween(TODAY, prox.proximo) < 0 ? 'atrasado ' + -daysBetween(TODAY, prox.proximo) + ' dias' : 'em ' + daysBetween(TODAY, prox.proximo) + ' dias'}</span>` : '')}
  </div>
  <div class="card mt"><h3>Meus indicadores <small>quando atualizar cada um</small></h3><div class="tbl"><table>
    <thead><tr><th>Indicador</th><th>Último valor</th><th>Atualizado em</th><th>Atualizar</th><th>Como medir</th><th>Status</th></tr></thead>
    <tbody>${INDICADORES.map(([k, nome, un, dd, freq, como]) => { const x = indicador(k); const ok = x.data && daysBetween(x.data, TODAY) <= dd;
      return `<tr><td><b>${nome}</b></td><td>${x.v != null ? (typeof x.v === 'number' ? num(x.v) : x.v) + ' ' + un : '—'}</td><td>${fmtD(x.data)}</td><td>${freq}</td><td class="muted">${como}</td>
        <td><span class="tag ${x.v == null ? 't-gray' : ok ? 't-green' : 't-orange'}">${x.v == null ? 'sem registro' : ok ? 'em dia' : 'atualizar'}</span></td></tr>`; }).join('')}</tbody></table></div>
    ${NOTA_SYNC}
    <p class="note">⌚ Relógio Samsung: por enquanto, copie os valores do Samsung Health no botão <b>Atualizar dados</b>. A importação automática está nos próximos passos.</p></div>
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
      ${lista(p.fatores_risco).map(s => `<li><span class="dot" style="background:var(--red)"></span>${H(s)}<span class="when">risco</span></li>`).join('')}
      ${lista(p.fatores_protecao).map(s => `<li><span class="dot" style="background:var(--green)"></span>${H(s)}<span class="when">protetor</span></li>`).join('')}
    </ul></div>
  </div>`);
  $('#btnAtu').onclick = () => modal(`<h3>Atualizar dados de saúde</h3>${formMedidas(['peso_kg', 'cintura_cm', 'pa_sistolica', 'pa_diastolica', 'fc_repouso', 'gordura_pct', 'massa_muscular_kg', 'vo2max'], true)}${NOTA_SYNC}`,
    [['Cancelar'], ['Salvar', el => { act(null, () => salvarMedidas(el), 'Dados atualizados'); }]]);
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
    modal(`<h3>${H(e.nome)}</h3><label class="f">Data em que foi feito<input type="date" id="dEx" value="${TODAY}"></label>`, [['Cancelar'], ['Registrar', el => {
      const d = el.querySelector('#dEx').value; if (!isDate(d)) { toast('Data inválida'); return false; }
      const proximo = e.periodicidade_meses ? addMonths(d, e.periodicidade_meses) : '';
      act(null, () => save(e.path, setFm(S.files[e.path].text, { ultimo: d, proximo })), 'Exame registrado');
    }]]);
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
function opcoesExercicio(e) {
  const alt = e.alternativas || [];
  const ja = new Set([e.nome, ...alt]);
  const outros = [];
  Object.values(S.m.prog.sessoes).forEach(s => s.exercicios.forEach(x => { if (x.grupo === e.grupo) [x.nome, ...(x.alternativas || [])].forEach(n => { if (!ja.has(n)) { ja.add(n); outros.push(n); } }); }));
  return { alt, outros };
}

function treinoHoje() {
  const m = S.m, slot = slotFor(TODAY);
  if (!S.ui.semana) S.ui.semana = weekType(TODAY);
  if (!S.ui.sessao) S.ui.sessao = m.prog.sessoes[slot] ? slot : 'supA';
  const sess = m.prog.sessoes[S.ui.sessao];
  const semS = sessoesSemana(), series = semS.reduce((a, s) => a + s.sets.length, 0);
  let draft = {}; try { draft = JSON.parse(localStorage.getItem(draftKey(S.ui.sessao)) || '{}'); } catch { }
  draft.ex = draft.ex || {};
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
  <div class="card mt"><h3>Atualizar medidas <small>peso e bioimpedância do relógio</small></h3>
    <div id="fmQ">${formMedidas(['peso_kg', 'gordura_pct', 'massa_muscular_kg', 'cintura_cm'])}</div>
    <div class="chips mt"><button class="btn" id="salvarQ">Salvar</button><a class="btn ghost" href="#treino/medicoes">Todas as medidas →</a></div>${NOTA_SYNC}</div>
  <div class="card mt"><h3>Semana <span class="toggle"><a data-w="A" class="${S.ui.semana === 'A' ? 'on' : ''}">A · futebol seg</a><a data-w="B" class="${S.ui.semana === 'B' ? 'on' : ''}">B · futebol ter</a></span></h3>
    <div class="week">${m.prog.semanas[S.ui.semana].map((id, i) => `<div class="day ${id === 'futebol' ? 'fut' : ''} ${i === idx && S.ui.semana === weekType(TODAY) ? 'today' : ''} ${feitos.has(slotNome(id)) && S.ui.semana === weekType(TODAY) ? 'feito' : ''}"><b>${DIAS[i]}</b>${slotNome(id)}</div>`).join('')}</div>
    <p class="note">Esta semana é a <b>${weekType(TODAY)}</b>. Nunca há inferiores no dia seguinte ao futebol.</p></div>
  <div class="grid g21 mt">
    <div class="card"><h3>Registrar treino
      <select id="selS" style="width:auto">${Object.entries(m.prog.sessoes).map(([k, s]) => `<option value="${k}" ${k === S.ui.sessao ? 'selected' : ''}>${s.nome}${k === slot ? ' (hoje)' : ''}</option>`).join('')}</select></h3>
      <p class="note" style="margin:-6px 0 14px">Aparelho ocupado ou dificuldade com o exercício? Troque pela lista: as <b>alternativas</b> têm o mesmo objetivo. Os números em cinza são do último treino com aquele exercício.</p>
      <div id="reg">${sess.exercicios.map((e, ei) => { const nome = draft.ex[ei] || e.nome, ls = lastSets(nome), o = opcoesExercicio(e);
        return `<div class="ex"><div class="h"><select class="selx" data-ei="${ei}">
          <option value="${H(e.nome)}">${H(e.nome)} (principal)</option>
          ${o.alt.length ? `<optgroup label="Alternativas (mesmo objetivo)">${o.alt.map(n => `<option ${n === nome ? 'selected' : ''}>${H(n)}</option>`).join('')}</optgroup>` : ''}
          ${o.outros.length ? `<optgroup label="Outros de ${H(e.grupo)}">${o.outros.map(n => `<option ${n === nome ? 'selected' : ''}>${H(n)}</option>`).join('')}</optgroup>` : ''}
        </select><span class="tag ${nome === e.nome ? 't-blue' : 't-orange'}">${nome === e.nome ? '' : 'trocado · '}${e.series} × ${e.reps} · RIR ${e.rir}</span></div>
        <div class="set hd"><span>Série</span><span>kg</span><span>reps</span><span>RIR</span></div>
        ${Array.from({ length: e.series }, (_, si) => { const k = ei + '-' + si, dv = draft[k] || {}, l = ls[si] || ls[ls.length - 1] || {};
          return `<div class="set"><b>${si + 1}</b><input inputmode="decimal" data-k="${k}" data-f="kg" value="${H(dv.kg || '')}" placeholder="${l.kg ?? '—'}"><input inputmode="numeric" data-k="${k}" data-f="reps" value="${H(dv.reps || '')}" placeholder="${l.reps ?? '—'}"><input inputmode="numeric" data-k="${k}" data-f="rir" value="${H(dv.rir || '')}" placeholder="${H(e.rir)}"></div>`; }).join('')}</div>`; }).join('')}</div>
      <button class="btn" id="salvarT" style="width:100%">Concluir e salvar treino</button></div>
    <div class="card"><h3>Volume por grupo <small>séries na semana</small></h3><div class="ch" style="height:440px"><canvas id="cVol"></canvas></div></div>
  </div>`;
  const guardar = () => localStorage.setItem(draftKey(S.ui.sessao), JSON.stringify(draft));
  document.querySelectorAll('[data-w]').forEach(a => a.onclick = () => { S.ui.semana = a.dataset.w; treinoHoje(); });
  $('#selS').onchange = e => { S.ui.sessao = e.target.value; treinoHoje(); };
  $('#reg').oninput = e => { const t = e.target; if (!t.dataset.k) return; (draft[t.dataset.k] = draft[t.dataset.k] || {})[t.dataset.f] = t.value; guardar(); };
  document.querySelectorAll('.selx').forEach(s => s.onchange = () => { const e = sess.exercicios[+s.dataset.ei]; if (s.value === e.nome) delete draft.ex[s.dataset.ei]; else draft.ex[s.dataset.ei] = s.value; guardar(); treinoHoje(); });
  $('#salvarT').onclick = ev => salvarTreino(ev.target, sess, draft);
  $('#salvarQ').onclick = ev => act(ev.target, () => salvarMedidas($('#fmQ')), 'Medidas salvas');
  if (pesos.length) chart('sp', { type: 'line', data: { labels: pesos.map(x => x.data), datasets: [{ data: pesos.map(x => x.peso_kg), borderColor: C.pri, borderWidth: 2, pointRadius: 0, tension: .4 }] }, options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } } });
  const grupos = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Quadríceps', 'Posterior', 'Glúteos', 'Panturrilha', 'Abdômen'];
  const plan = Object.fromEntries(grupos.map(g => [g, 0])), feito = Object.fromEntries(grupos.map(g => [g, 0]));
  m.prog.semanas[weekType(TODAY)].forEach(id => m.prog.sessoes[id]?.exercicios.forEach(e => plan[e.grupo] += e.series));
  semS.forEach(s => s.sets.forEach(x => { const g = m.grupoDe[x.ex]; if (g) feito[g]++; }));
  chart('cVol', { type: 'bar', data: { labels: grupos, datasets: [{ label: 'Planejado', data: grupos.map(g => plan[g]), backgroundColor: C.soft, borderRadius: 5 }, { label: 'Feito', data: grupos.map(g => feito[g]), backgroundColor: C.green, borderRadius: 5 }] },
    options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: gridY, y: noGrid } } });
}

function salvarTreino(btn, sess, draft) {
  const rows = [];
  sess.exercicios.forEach((e, ei) => { const nome = (draft.ex && draft.ex[ei]) || e.nome;
    for (let si = 0; si < e.series; si++) { const d = draft[ei + '-' + si]; if (d && d.reps) rows.push({ ex: nome, s: si + 1, kg: String(d.kg || 0).replace(',', '.'), reps: d.reps, rir: d.rir || '' }); } });
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

function treinoMedicoes() {
  const meds = [...S.m.medicoes].reverse();
  $('#tb').innerHTML = `<div class="card"><h3>Nova medição <small>preencha só o que mediu</small></h3>
    <div id="fmM">${formMedidas(CAMPOS.map(c => c[0]), true)}</div>
    <button class="btn mt" id="salvarM">Salvar medição</button>${NOTA_SYNC}</div>
  <div class="card mt"><h3>Histórico</h3><div class="tbl"><table><thead><tr><th>Data</th>${CAMPOS.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
    <tbody>${meds.map(x => `<tr><td><b>${fmtD(x.data)}</b></td>${CAMPOS.map(([k]) => `<td>${num(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  $('#salvarM').onclick = ev => act(ev.target, () => salvarMedidas($('#fmM')), 'Medição salva');
}

function treinoPlano() {
  const p = S.m.prog;
  $('#tb').innerHTML = `<div class="grid g2">${Object.values(p.sessoes).map(s => `<div class="card"><h3>${s.nome} <small>${s.foco}</small></h3><div class="tbl"><table>
    <thead><tr><th>Exercício</th><th>Séries × reps</th><th>RIR</th><th>Alternativas</th></tr></thead>
    <tbody>${s.exercicios.map(e => `<tr><td><b>${H(e.nome)}</b><div class="small muted">${e.grupo}</div></td><td>${e.series} × ${e.reps}</td><td>${e.rir}</td><td class="small muted">${H((e.alternativas || []).join(' · '))}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>
    <p class="note">O plano fica em <code>20 Treino/programa.json</code>. A cada mesociclo, o Claude gera as novas variações a partir do seu histórico.</p>`;
}

// ---------- DIETA ----------
const SUG_SUPL = [
  { id: 'cafeina', nome: 'Cafeína 200–400 mg', nota: 'Pré-treino. Melhora o desempenho (ISSN 2021). Evite nas 8 h antes de dormir.' },
  { id: 'beta-alanina', nome: 'Beta-alanina 3,2–6,4 g', nota: 'Esforços intensos de 1 a 4 min, como no futebol (ISSN 2015).' },
  { id: 'omega-3', nome: 'Ômega-3 1–2 g (EPA+DHA)', nota: 'Se você come peixe menos de 2x por semana.' },
  { id: 'eletrolitos', nome: 'Eletrólitos', nota: 'Treinos longos ou calor intenso.' },
  { id: 'vitamina-d', nome: 'Vitamina D', nota: 'Só com exame baixo ou indicação médica.' },
  { id: 'multivitaminico', nome: 'Multivitamínico', nota: 'Só com deficiência comprovada.' }
];
async function salvarPlano(pl) { await save('30 Dieta/plano.json', JSON.stringify(pl, null, 2) + '\n'); }
function gerenciarSupl() {
  const pl = S.m.dplano, tem = new Set(pl.suplementos.map(s => s.id));
  const el = modal(`<h3>Suplementos</h3>
    <div class="small muted" style="margin-bottom:6px">Em uso</div>
    <ul class="list">${pl.suplementos.map(s => `<li>${H(s.nome)}<button class="btn sm ghost" style="margin-left:auto" data-rm="${H(s.id)}">Remover</button></li>`).join('') || '<li class="muted">Nenhum</li>'}</ul>
    <div class="small muted" style="margin:14px 0 6px">Sugestões com evidência</div>
    <ul class="list">${SUG_SUPL.filter(s => !tem.has(s.id)).map(s => `<li><div><b>${s.nome}</b><div class="small muted">${s.nota}</div></div><button class="btn sm" style="margin-left:auto" data-add="${s.id}">Adicionar</button></li>`).join('')}</ul>
    <div class="small muted" style="margin:14px 0 6px">Outro suplemento</div>
    <div style="display:flex;gap:8px"><input id="supNovo" placeholder="Nome e dose, ex.: Magnésio 300 mg"><button class="btn" id="supAdd">Adicionar</button></div>`, [['Fechar']]);
  const salvar = novo => act(null, async () => { pl.suplementos = novo; await salvarPlano(pl); gerenciarSupl(); }, 'Suplementos atualizados');
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => salvar(pl.suplementos.filter(s => s.id !== b.dataset.rm)));
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const s = SUG_SUPL.find(x => x.id === b.dataset.add); salvar([...pl.suplementos, { id: s.id, nome: s.nome }]); });
  el.querySelector('#supAdd').onclick = () => { const n = el.querySelector('#supNovo').value.trim(); if (!n) return;
    salvar([...pl.suplementos, { id: n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), nome: n }]); };
}

function renderDieta() {
  const m = S.m, pl = m.dplano, meta = pl.metas, D = dia(), t = totaisDia(D);
  const alim = json('30 Dieta/alimentos.json')?.alimentos || [];
  const bar = (v, tt, c) => `<div class="progress"><i style="width:${Math.min(100, v / tt * 100)}%;background:${c}"></i></div>`;
  const dias = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i - 13));
  const hist = dias.map(x => m.diario.find(d => d.data === x) || {});
  const ult7 = hist.slice(-7).filter(h => h.kcal), med = k => ult7.length ? ult7.reduce((a, h) => a + (h[k] || 0), 0) / ult7.length : null;
  const aberta = S.ui.refAberta;
  view(`${header('Dieta', 'Ganho de massa controlado · ajuste das calorias a cada 2 semanas pela média do peso.')}
  <div class="grid g4">
    ${kpi('🔥', 'b-orange', 'Calorias', `${num(t.kcal, 0)} <span>/ ${num(meta.kcal, 0)} kcal</span>`, bar(t.kcal, meta.kcal, C.orange))}
    ${kpi('🥩', 'b-blue', 'Proteína', `${num(t.p, 0)} <span>/ ${meta.proteina} g</span>`, bar(t.p, meta.proteina, C.pri))}
    ${kpi('🍚', 'b-green', 'Carboidrato', `${num(t.c, 0)} <span>/ ${meta.carboidrato} g</span>`, bar(t.c, meta.carboidrato, C.green))}
    ${kpi('🥑', 'b-purple', 'Gordura', `${num(t.g, 0)} <span>/ ${meta.gordura} g</span>`, bar(t.g, meta.gordura, C.purple))}
  </div>
  <div class="grid g2 mt">
    <div class="card kpi"><div class="lab"><div class="ico b-teal">💧</div>Água</div><div class="val">${num(D.agua_l, 2)} <span>/ ${num(meta.agua_l)} L</span></div>${bar(D.agua_l, meta.agua_l, C.teal)}
      <div class="chips" style="margin-top:12px"><button class="btn sm ghost" data-agua="0.25">+250 ml</button><button class="btn sm ghost" data-agua="0.5">+500 ml</button><button class="btn sm ghost" data-agua="-0.25">− 250 ml</button></div></div>
    <div class="card"><h3>Suplementos de hoje <button class="btn sm ghost" id="gerSup">Gerenciar</button></h3>
      <div class="chips">${pl.suplementos.map(s => `<button class="btn sm ${D.suplementos.includes(s.id) ? '' : 'ghost'}" data-sup="${H(s.id)}">${D.suplementos.includes(s.id) ? '✓ ' : ''}${H(s.nome)}</button>`).join('') || '<span class="muted">Nenhum cadastrado</span>'}</div></div>
  </div>
  <div class="grid g21 mt">
    <div class="card"><h3>Refeições de hoje <small>✓ = segui o plano · ou registre o que comeu</small></h3>
      <datalist id="dlAlim">${alim.map(a => `<option value="${H(a.nome)}">`).join('')}</datalist>
      ${pl.refeicoes.map(r => { const x = D.refeicoes[r.id], tr = totaisRef(r, D), livre = x && x.modo === 'livre';
        return `<div class="meal" style="flex-wrap:wrap"><span class="chk ${x && x.modo === 'plano' ? 'ok' : ''}" data-plano="${r.id}">${x && x.modo === 'plano' ? '✓' : ''}</span>
        <div class="info"><b>${r.nome}</b> ${livre ? '<span class="tag t-orange">registrado</span>' : ''}<small>${livre ? x.itens.map(i => `${H(i.nome)} ${i.gramas} g`).join(' · ') : 'Plano: ' + H(r.exemplo)}</small></div>
        <div class="mac">${tr ? `<b>${num(tr.kcal, 0)} kcal</b><br>P ${num(tr.p, 0)} · C ${num(tr.c, 0)} · G ${num(tr.g, 0)}` : `${r.kcal} kcal<br>P ${r.p} · C ${r.c} · G ${r.g}`}</div>
        <button class="btn sm ghost" data-abrir="${r.id}">${aberta === r.id ? 'Fechar' : 'O que comi'}</button>
        ${aberta === r.id ? `<div class="editor">
          ${(livre ? x.itens : []).map((i, ii) => `<div class="itm"><span>${H(i.nome)} · ${i.gramas} g</span><span class="muted small">${num(i.kcal, 0)} kcal · P ${num(i.p, 0)} · C ${num(i.c, 0)} · G ${num(i.gord, 0)}</span><button class="btn sm ghost" data-rmi="${ii}">✕</button></div>`).join('')}
          <div class="addi"><input list="dlAlim" id="iNome" placeholder="Alimento (digite para buscar)"><input id="iG" inputmode="decimal" placeholder="g ou ml"><button class="btn sm" id="iAdd">Adicionar</button></div>
          <details class="small muted"><summary>Não achou o alimento? Informe os valores da porção</summary>
            <div class="addi" style="margin-top:8px"><input id="iK" inputmode="decimal" placeholder="kcal"><input id="iP" inputmode="decimal" placeholder="P (g)"><input id="iC" inputmode="decimal" placeholder="C (g)"><input id="iGo" inputmode="decimal" placeholder="G (g)"></div></details>
          <p class="note">Valores aproximados por 100 g (Tabela TACO). Ao registrar, esta refeição passa a contar pelo que você comeu.</p></div>` : ''}
        </div>`; }).join('')}</div>
    <div class="card"><h3>Macros <small>consumido × meta</small></h3><div class="ch"><canvas id="cMac"></canvas></div></div>
  </div>
  <div class="grid g4 mt">
    ${kpi('📊', 'b-orange', 'Média 7 dias', `${num(med('kcal'), 0)} <span>kcal</span>`, `<span class="tag t-gray">${ult7.length} dias registrados</span>`)}
    ${kpi('📊', 'b-blue', 'Proteína média', `${num(med('proteina_g'), 0)} <span>g/dia</span>`, '')}
    ${kpi('📊', 'b-green', 'Carbo médio', `${num(med('carboidrato_g'), 0)} <span>g/dia</span>`, '')}
    ${kpi('📊', 'b-purple', 'Gordura média', `${num(med('gordura_g'), 0)} <span>g/dia</span>`, '')}
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>Calorias · 14 dias <small>consumido × meta</small></h3><div class="ch"><canvas id="cKcal"></canvas></div></div>
    <div class="card"><h3>Proteína · 14 dias <small>g/dia</small></h3><div class="ch"><canvas id="cProt"></canvas></div></div>
  </div>`);
  const lbl = dias.map(x => fmtD(x).slice(0, 5));
  chart('cMac', { type: 'bar', data: { labels: ['Proteína', 'Carboidrato', 'Gordura'], datasets: [{ label: 'Meta (g)', data: [meta.proteina, meta.carboidrato, meta.gordura], backgroundColor: C.soft, borderRadius: 6 }, { label: 'Consumido (g)', data: [t.p, t.c, t.g].map(Math.round), backgroundColor: [C.pri, C.green, C.purple], borderRadius: 6 }] }, options: { scales: { y: gridY, x: noGrid } } });
  chart('cKcal', { type: 'bar', data: { labels: lbl, datasets: [{ type: 'line', label: 'Meta', data: dias.map(() => meta.kcal), borderColor: C.red, borderDash: [5, 5], pointRadius: 0 }, { label: 'kcal', data: hist.map(h => h.kcal || 0), backgroundColor: hist.map(h => !h.kcal ? C.grid : Math.abs(h.kcal - meta.kcal) / meta.kcal <= .1 ? C.green : C.orange), borderRadius: 5 }] }, options: { scales: { y: gridY, x: noGrid } } });
  chart('cProt', { type: 'bar', data: { labels: lbl, datasets: [{ type: 'line', label: 'Meta', data: dias.map(() => meta.proteina), borderColor: C.red, borderDash: [5, 5], pointRadius: 0 }, { label: 'Proteína (g)', data: hist.map(h => h.proteina_g || 0), backgroundColor: hist.map(h => (h.proteina_g || 0) >= meta.proteina * .9 ? C.pri : C.soft), borderRadius: 5 }] }, options: { scales: { y: gridY, x: noGrid } } });
  const salvar = fn => act(null, async () => { const D2 = dia(); fn(D2); await salvarDia(D2); });
  document.querySelectorAll('[data-plano]').forEach(el => el.onclick = () => salvar(D2 => { const id = el.dataset.plano; if (D2.refeicoes[id]?.modo === 'plano') delete D2.refeicoes[id]; else D2.refeicoes[id] = { modo: 'plano' }; }));
  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { S.ui.refAberta = aberta === b.dataset.abrir ? null : b.dataset.abrir; renderDieta(); });
  document.querySelectorAll('[data-agua]').forEach(b => b.onclick = () => salvar(D2 => { D2.agua_l = Math.max(0, Math.round((D2.agua_l + Number(b.dataset.agua)) * 100) / 100); }));
  document.querySelectorAll('[data-sup]').forEach(b => b.onclick = () => act(b, () => toggleSupl(b.dataset.sup)));
  $('#gerSup').onclick = gerenciarSupl;
  document.querySelectorAll('[data-rmi]').forEach(b => b.onclick = () => salvar(D2 => { const x = D2.refeicoes[aberta]; x.itens.splice(+b.dataset.rmi, 1); if (!x.itens.length) delete D2.refeicoes[aberta]; }));
  const add = $('#iAdd');
  if (add) add.onclick = () => {
    const nome = $('#iNome').value.trim(), gramas = Number($('#iG').value.replace(',', '.'));
    if (!nome || !gramas) { toast('Informe o alimento e a quantidade.'); return; }
    const a = alim.find(x => x.nome.toLowerCase() === nome.toLowerCase());
    const v = id => Number(($('#' + id).value || '').replace(',', '.')) || 0;
    let it;
    if (a) { const f = gramas / 100; it = { nome: a.nome, gramas, kcal: a.kcal * f, p: a.p * f, c: a.c * f, gord: a.g * f }; }
    else if (v('iK')) it = { nome, gramas, kcal: v('iK'), p: v('iP'), c: v('iC'), gord: v('iGo') };
    else { $('details').open = true; toast('Alimento fora da lista: informe as kcal e os macros da porção.'); return; }
    const r1 = n => Math.round(n * 10) / 10;
    ['kcal', 'p', 'c', 'gord'].forEach(k => it[k] = r1(it[k]));
    salvar(D2 => { const x = D2.refeicoes[aberta]; if (x && x.modo === 'livre') x.itens.push(it); else D2.refeicoes[aberta] = { modo: 'livre', itens: [it] }; });
  };
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
