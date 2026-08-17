const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUS_LABEL = { aberto: "Aberto", encerrado: "Encerrado" };
const TIPO_LABEL = { compra: "Compra", venda: "Venda" };

// ---------- tema claro/escuro ----------
const LS_TEMA = "cs_tema";

function temaEfetivoEscuro(tema) {
  if (tema === "dark") return true;
  if (tema === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function aplicarTema(tema) {
  if (tema === "light" || tema === "dark") {
    document.documentElement.setAttribute("data-theme", tema);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.getElementById("btn-theme-toggle").textContent = temaEfetivoEscuro(tema) ? "☀️" : "🌙";
}

let temaAtual = localStorage.getItem(LS_TEMA) || "auto";
aplicarTema(temaAtual);

document.getElementById("btn-theme-toggle").addEventListener("click", () => {
  temaAtual = temaEfetivoEscuro(temaAtual) ? "light" : "dark";
  localStorage.setItem(LS_TEMA, temaAtual);
  aplicarTema(temaAtual);
});

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function comTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms)),
  ]);
}

function formatarNumero(n, casas = 2) {
  return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function formatarData(iso) {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------- caches ----------
let produtosCache = [];
let contrapartesCache = [];
let contratosCache = [];
let fixacoesCache = []; // fixações do contrato aberto no modal
let contratoSelecionadoId = null;

function nomePor(cache, id) {
  const item = cache.find((x) => String(x.id) === String(id));
  return item ? item.nome : "—";
}

// ---------- indicador: avanço na cotação spot ----------
// avanço (%) = volume já fixado via cotação spot / volume total contratado
function volumeFixado(contratoId) {
  return fixacoesDoContrato(contratoId).reduce((soma, f) => soma + Number(f.volume), 0);
}

function fixacoesDoContrato(contratoId) {
  return todasFixacoesCache.filter((f) => String(f.contrato_id) === String(contratoId));
}

function avancoPct(contrato) {
  const fixado = volumeFixado(contrato.id);
  const pct = contrato.volume_total > 0 ? (fixado / contrato.volume_total) * 100 : 0;
  return Math.min(100, pct);
}

function progressoHtml(pct, largura = "") {
  const arredondado = Math.round(pct * 10) / 10;
  const completo = pct >= 100 ? "completo" : "";
  return `
    <div class="progress-cell">
      <div class="progress-bar mini ${largura}"><div class="progress-fill ${completo}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="progress-label">${arredondado}%</div>
    </div>`;
}

let todasFixacoesCache = [];

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "painel") loadPainel();
    if (btn.dataset.tab === "lista") loadLista();
  });
});

// ---------- carregar dados de apoio ----------
async function loadProdutos() {
  const { data, error } = await comTimeout(db.from("cs_produtos").select("*").order("ativo", { ascending: false }).order("nome"));
  produtosCache = error ? produtosCache : data;
  preencherSelect("ct-produto", produtosCache, "Selecione um produto");
  preencherSelect("fil-produto", produtosCache, "Todos os produtos", true);
  renderCadastroLista("lista-produtos", produtosCache, "cs_produtos");
}

async function loadContrapartes() {
  const { data, error } = await comTimeout(db.from("cs_contrapartes").select("*").order("ativo", { ascending: false }).order("nome"));
  contrapartesCache = error ? contrapartesCache : data;
  preencherSelect("ct-contraparte", contrapartesCache, "Selecione uma contraparte");
  renderCadastroLista("lista-contrapartes", contrapartesCache, "cs_contrapartes");
}

function preencherSelect(id, itens, placeholder, comTodos = false) {
  const sel = document.getElementById(id);
  const valorAtual = sel.value;
  const ativos = itens.filter((i) => i.ativo);
  sel.innerHTML = `<option value="">${placeholder}</option>` + ativos.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)}</option>`).join("");
  if (valorAtual) sel.value = valorAtual;
}

function renderCadastroLista(id, itens, tabela) {
  const ul = document.getElementById(id);
  if (!itens.length) {
    ul.innerHTML = '<li class="muted">Nenhum cadastro ainda.</li>';
    return;
  }
  ul.innerHTML = itens
    .map(
      (i) => `
    <li class="${i.ativo ? "" : "inativo"}">
      <span>${escapeHtml(i.nome)}${i.unidade ? ` <span class="muted">(${escapeHtml(i.unidade)})</span>` : ""}</span>
      <span>
        <button class="link-btn" data-acao="toggle" data-tabela="${tabela}" data-id="${i.id}" data-ativo="${i.ativo}">${i.ativo ? "Desativar" : "Ativar"}</button>
        <button class="link-btn danger" data-acao="excluir" data-tabela="${tabela}" data-id="${i.id}">Excluir</button>
      </span>
    </li>`
    )
    .join("");
}

document.querySelectorAll(".cadastro-lista").forEach((ul) => {
  ul.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    const { acao, tabela, id, ativo } = btn.dataset;
    if (acao === "toggle") {
      await db.from(tabela).update({ ativo: ativo !== "true" }).eq("id", id);
    } else if (acao === "excluir") {
      if (!confirm("Excluir este cadastro?")) return;
      await db.from(tabela).delete().eq("id", id);
    }
    await recarregarApoio();
  });
});

async function recarregarApoio() {
  await Promise.all([loadProdutos(), loadContrapartes()]);
}

// ---------- formulários de cadastro ----------
document.getElementById("form-produto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("produto-nome").value.trim();
  const unidade = document.getElementById("produto-unidade").value.trim();
  if (!nome || !unidade) return;
  await db.from("cs_produtos").insert({ nome, unidade });
  document.getElementById("produto-nome").value = "";
  document.getElementById("produto-unidade").value = "";
  await loadProdutos();
});

document.getElementById("form-contraparte").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("contraparte-nome").value.trim();
  if (!nome) return;
  await db.from("cs_contrapartes").insert({ nome });
  document.getElementById("contraparte-nome").value = "";
  await loadContrapartes();
});

// ---------- novo contrato ----------
document.getElementById("ct-data").value = new Date().toISOString().slice(0, 10);

document.getElementById("form-contrato").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("ct-feedback");
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  try {
    const produtoId = document.getElementById("ct-produto").value || null;
    const produto = produtosCache.find((p) => String(p.id) === String(produtoId));
    const precoRef = document.getElementById("ct-preco-ref").value;
    const payload = {
      numero: document.getElementById("ct-numero").value.trim(),
      tipo: document.getElementById("ct-tipo").value,
      contraparte_id: document.getElementById("ct-contraparte").value || null,
      produto_id: produtoId,
      unidade: produto ? produto.unidade : "saca",
      volume_total: Number(document.getElementById("ct-volume").value),
      data_contrato: document.getElementById("ct-data").value,
      preco_referencia: precoRef ? Number(precoRef) : null,
      observacoes: document.getElementById("ct-observacoes").value.trim(),
    };
    const { error } = await db.from("cs_contratos").insert(payload);
    if (error) throw error;
    feedback.textContent = "Contrato registrado com sucesso.";
    feedback.className = "feedback success";
    e.target.reset();
    document.getElementById("ct-data").value = new Date().toISOString().slice(0, 10);
  } catch (err) {
    feedback.textContent = "Erro ao salvar: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- lista / filtros ----------
async function loadLista() {
  let query = db.from("cs_contratos").select("*").order("data_contrato", { ascending: false });
  const status = document.getElementById("fil-status").value;
  const produto = document.getElementById("fil-produto").value;
  if (status) query = query.eq("status", status);
  if (produto) query = query.eq("produto_id", produto);
  const [{ data, error }, { data: fixData }] = await Promise.all([
    comTimeout(query),
    comTimeout(db.from("cs_fixacoes").select("*")),
  ]);
  contratosCache = error ? [] : data;
  todasFixacoesCache = fixData || [];
  renderLista();
}

function renderLista() {
  const tbody = document.querySelector("#tbl-lista tbody");
  if (!contratosCache.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum contrato encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = contratosCache
    .map((c) => {
      const produto = produtosCache.find((p) => String(p.id) === String(c.produto_id));
      return `
    <tr>
      <td>${escapeHtml(c.numero)}</td>
      <td>${TIPO_LABEL[c.tipo] || c.tipo}</td>
      <td>${escapeHtml(nomePor(contrapartesCache, c.contraparte_id))}</td>
      <td>${escapeHtml(produto ? produto.nome : "—")}</td>
      <td>${formatarNumero(c.volume_total, 0)} ${escapeHtml(c.unidade || "")}</td>
      <td>${progressoHtml(avancoPct(c))}</td>
      <td><span class="badge status-${c.status}">${STATUS_LABEL[c.status]}</span></td>
      <td class="acoes"><button class="link-btn" data-abrir="${c.id}">Detalhes</button></td>
    </tr>`;
    })
    .join("");
}

document.getElementById("btn-filtrar-lista").addEventListener("click", loadLista);

document.querySelector("#tbl-lista tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-abrir]");
  if (!btn) return;
  abrirModal(btn.dataset.abrir);
});

// ---------- modal detalhes do contrato ----------
async function abrirModal(id) {
  const contrato = contratosCache.find((x) => String(x.id) === String(id));
  if (!contrato) return;
  contratoSelecionadoId = id;

  const { data } = await comTimeout(db.from("cs_fixacoes").select("*").eq("contrato_id", id).order("data", { ascending: false }));
  fixacoesCache = data || [];
  todasFixacoesCache = todasFixacoesCache.filter((f) => String(f.contrato_id) !== String(id)).concat(fixacoesCache);

  const produto = produtosCache.find((p) => String(p.id) === String(contrato.produto_id));
  document.getElementById("modal-titulo").textContent = `Contrato ${contrato.numero}`;
  document.getElementById("modal-resumo").innerHTML = `
    <div><strong>${TIPO_LABEL[contrato.tipo] || contrato.tipo}</strong> de <strong>${escapeHtml(produto ? produto.nome : "—")}</strong> com ${escapeHtml(nomePor(contrapartesCache, contrato.contraparte_id))}</div>
    <div>Volume total: <strong>${formatarNumero(contrato.volume_total, 0)} ${escapeHtml(contrato.unidade || "")}</strong> — contrato de ${formatarData(contrato.data_contrato)}</div>
    ${contrato.preco_referencia ? `<div>Preço de referência: <strong>${formatarNumero(contrato.preco_referencia)}</strong></div>` : ""}
    ${contrato.observacoes ? `<div>${escapeHtml(contrato.observacoes)}</div>` : ""}
  `;

  atualizarProgressoModal(contrato);
  renderFixacoes();

  document.getElementById("fx-data").value = new Date().toISOString().slice(0, 10);
  document.getElementById("fx-feedback").textContent = "";

  const btnToggle = document.getElementById("btn-modal-toggle-status");
  btnToggle.textContent = contrato.status === "aberto" ? "Encerrar contrato" : "Reabrir contrato";

  document.getElementById("modal-overlay").classList.remove("hidden");
}

function atualizarProgressoModal(contrato) {
  const pct = avancoPct(contrato);
  const fixado = volumeFixado(contrato.id);
  document.getElementById("modal-progress-fill").style.width = `${Math.min(100, pct)}%`;
  document.getElementById("modal-progress-fill").classList.toggle("completo", pct >= 100);
  document.getElementById("modal-progress-label").textContent = `${formatarNumero(fixado, 0)} / ${formatarNumero(contrato.volume_total, 0)} ${contrato.unidade || ""} fixados (${Math.round(pct * 10) / 10}%)`;
}

function renderFixacoes() {
  const tbody = document.querySelector("#tbl-fixacoes tbody");
  if (!fixacoesCache.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma fixação registrada ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = fixacoesCache
    .map(
      (f) => `
    <tr>
      <td>${formatarData(f.data)}</td>
      <td>${formatarNumero(f.volume, 0)}</td>
      <td>${formatarNumero(f.preco_spot)}</td>
      <td>${escapeHtml(f.observacao || "—")}</td>
      <td class="acoes"><button class="link-btn danger" data-excluir-fixacao="${f.id}">Excluir</button></td>
    </tr>`
    )
    .join("");
}

function fecharModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  contratoSelecionadoId = null;
}

document.getElementById("btn-modal-fechar").addEventListener("click", fecharModal);
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") fecharModal();
});

document.getElementById("form-fixacao").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!contratoSelecionadoId) return;
  const feedback = document.getElementById("fx-feedback");
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  try {
    const payload = {
      contrato_id: contratoSelecionadoId,
      data: document.getElementById("fx-data").value,
      volume: Number(document.getElementById("fx-volume").value),
      preco_spot: Number(document.getElementById("fx-preco").value),
      observacao: document.getElementById("fx-obs").value.trim(),
    };
    const { error } = await db.from("cs_fixacoes").insert(payload);
    if (error) throw error;
    feedback.textContent = "Fixação registrada.";
    feedback.className = "feedback success";
    e.target.reset();
    document.getElementById("fx-data").value = new Date().toISOString().slice(0, 10);

    const { data } = await comTimeout(db.from("cs_fixacoes").select("*").eq("contrato_id", contratoSelecionadoId).order("data", { ascending: false }));
    fixacoesCache = data || [];
    todasFixacoesCache = todasFixacoesCache.filter((f) => String(f.contrato_id) !== String(contratoSelecionadoId)).concat(fixacoesCache);
    const contrato = contratosCache.find((x) => String(x.id) === String(contratoSelecionadoId));
    atualizarProgressoModal(contrato);
    renderFixacoes();
    renderLista();
  } catch (err) {
    feedback.textContent = "Erro ao salvar: " + err.message;
    feedback.className = "feedback error";
  }
});

document.querySelector("#tbl-fixacoes tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-excluir-fixacao]");
  if (!btn) return;
  if (!confirm("Excluir esta fixação?")) return;
  await db.from("cs_fixacoes").delete().eq("id", btn.dataset.excluirFixacao);
  fixacoesCache = fixacoesCache.filter((f) => String(f.id) !== btn.dataset.excluirFixacao);
  todasFixacoesCache = todasFixacoesCache.filter((f) => String(f.id) !== btn.dataset.excluirFixacao);
  const contrato = contratosCache.find((x) => String(x.id) === String(contratoSelecionadoId));
  atualizarProgressoModal(contrato);
  renderFixacoes();
  renderLista();
});

document.getElementById("btn-modal-toggle-status").addEventListener("click", async () => {
  const contrato = contratosCache.find((x) => String(x.id) === String(contratoSelecionadoId));
  if (!contrato) return;
  const novoStatus = contrato.status === "aberto" ? "encerrado" : "aberto";
  await db.from("cs_contratos").update({ status: novoStatus }).eq("id", contrato.id);
  contrato.status = novoStatus;
  document.getElementById("btn-modal-toggle-status").textContent = novoStatus === "aberto" ? "Encerrar contrato" : "Reabrir contrato";
  renderLista();
});

document.getElementById("btn-modal-excluir").addEventListener("click", async () => {
  if (!contratoSelecionadoId) return;
  if (!confirm("Excluir este contrato e todas as suas fixações? Essa ação não pode ser desfeita.")) return;
  await db.from("cs_contratos").delete().eq("id", contratoSelecionadoId);
  contratosCache = contratosCache.filter((c) => String(c.id) !== String(contratoSelecionadoId));
  fecharModal();
  renderLista();
});

// ---------- painel / indicadores ----------
async function loadPainel() {
  const [{ data: contratos, error: erroContratos }, { data: fixacoes, error: erroFixacoes }] = await Promise.all([
    comTimeout(db.from("cs_contratos").select("*")),
    comTimeout(db.from("cs_fixacoes").select("*")),
  ]);
  contratosCache = erroContratos ? [] : contratos;
  todasFixacoesCache = erroFixacoes ? [] : fixacoes;

  renderResumoCards();
  renderTabelaAvanco();
  renderTabelaProduto();
}

function renderResumoCards() {
  const abertos = contratosCache.filter((c) => c.status === "aberto");
  const volumeTotal = abertos.reduce((s, c) => s + Number(c.volume_total), 0);
  const volumeFixadoTotal = abertos.reduce((s, c) => s + volumeFixado(c.id), 0);
  const avancoGlobal = volumeTotal > 0 ? Math.min(100, (volumeFixadoTotal / volumeTotal) * 100) : 0;
  const concluidos = abertos.filter((c) => avancoPct(c) >= 100).length;
  const semFixacao = abertos.filter((c) => volumeFixado(c.id) === 0).length;

  const cards = [
    { label: "Contratos em aberto", valor: abertos.length, cls: "" },
    { label: "Volume total contratado", valor: formatarNumero(volumeTotal, 0), cls: "" },
    { label: "Volume fixado (spot)", valor: formatarNumero(volumeFixadoTotal, 0), cls: "" },
    { label: "Avanço global na cotação", valor: `${Math.round(avancoGlobal * 10) / 10}%`, cls: avancoGlobal >= 70 ? "ok" : "" },
    { label: "Contratos 100% fixados", valor: concluidos, cls: "ok" },
    { label: "Sem nenhuma fixação ainda", valor: semFixacao, cls: semFixacao > 0 ? "atrasado" : "" },
  ];

  document.getElementById("resumo-cards").innerHTML = cards
    .map(
      (c) => `
    <div class="resumo-card ${c.cls}">
      <div class="resumo-num">${c.valor}</div>
      <div class="resumo-label">${c.label}</div>
    </div>`
    )
    .join("");
}

function renderTabelaAvanco() {
  const tbody = document.querySelector("#tbl-avanco tbody");
  const abertos = contratosCache.filter((c) => c.status === "aberto").sort((a, b) => avancoPct(a) - avancoPct(b));
  if (!abertos.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum contrato em aberto.</td></tr>';
    return;
  }
  tbody.innerHTML = abertos
    .map((c) => {
      const produto = produtosCache.find((p) => String(p.id) === String(c.produto_id));
      return `
    <tr>
      <td>${escapeHtml(c.numero)}</td>
      <td>${escapeHtml(nomePor(contrapartesCache, c.contraparte_id))}</td>
      <td>${escapeHtml(produto ? produto.nome : "—")}</td>
      <td>${formatarNumero(c.volume_total, 0)} ${escapeHtml(c.unidade || "")}</td>
      <td>${formatarNumero(volumeFixado(c.id), 0)} ${escapeHtml(c.unidade || "")}</td>
      <td>${progressoHtml(avancoPct(c))}</td>
    </tr>`;
    })
    .join("");
}

function renderTabelaProduto() {
  const tbody = document.querySelector("#tbl-produto tbody");
  const abertos = contratosCache.filter((c) => c.status === "aberto");
  const produtosComContrato = produtosCache.filter((p) => abertos.some((c) => String(c.produto_id) === String(p.id)));
  if (!produtosComContrato.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Sem dados ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = produtosComContrato
    .map((p) => {
      const doProduto = abertos.filter((c) => String(c.produto_id) === String(p.id));
      const volumeTotal = doProduto.reduce((s, c) => s + Number(c.volume_total), 0);
      const fixado = doProduto.reduce((s, c) => s + volumeFixado(c.id), 0);
      const pct = volumeTotal > 0 ? Math.min(100, (fixado / volumeTotal) * 100) : 0;
      return `
    <tr>
      <td>${escapeHtml(p.nome)}</td>
      <td>${formatarNumero(volumeTotal, 0)} ${escapeHtml(p.unidade || "")}</td>
      <td>${formatarNumero(fixado, 0)} ${escapeHtml(p.unidade || "")}</td>
      <td>${progressoHtml(pct)}</td>
    </tr>`;
    })
    .join("");
}

document.getElementById("btn-refresh-painel").addEventListener("click", loadPainel);

// ---------- inicialização ----------
(async function init() {
  await recarregarApoio();
  await loadPainel();
})();
