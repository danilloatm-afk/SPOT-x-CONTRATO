const SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2ZnlxdmVmem5rcGN2amFlcnRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTQ4NjgsImV4cCI6MjEwMTc5MDg2OH0.2Ef6LpZ61WM8myHBYeQGo3TuGqk5C3x36ER_sWRNPS4";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MODALIDADE_LABEL = { spot: "Spot", contrato: "Contrato" };

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
let fornecedoresCache = [];
let comprasCache = []; // resultado filtrado da aba Compras
let todasComprasCache = []; // todas as compras, usado pelo painel

function nomePor(cache, id) {
  const item = cache.find((x) => String(x.id) === String(id));
  return item ? item.nome : "—";
}

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
  preencherSelect("cp-produto", produtosCache, "Selecione um produto");
  preencherSelect("fil-produto", produtosCache, "Todos os produtos", true);
  renderCadastroLista("lista-produtos", produtosCache, "cs_produtos");
}

async function loadFornecedores() {
  const { data, error } = await comTimeout(db.from("cs_fornecedores").select("*").order("ativo", { ascending: false }).order("nome"));
  fornecedoresCache = error ? fornecedoresCache : data;
  preencherSelect("cp-fornecedor", fornecedoresCache, "Selecione um fornecedor");
  preencherSelect("fil-fornecedor", fornecedoresCache, "Todos os fornecedores", true);
  renderCadastroLista("lista-fornecedores", fornecedoresCache, "cs_fornecedores");
}

function preencherSelect(id, itens, placeholder, comTodos = false) {
  const sel = document.getElementById(id);
  const valorAtual = sel.value;
  const ativos = itens.filter((i) => i.ativo);
  sel.innerHTML =
    `<option value="">${placeholder}</option>` +
    ativos.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)}${i.cnpj ? ` — ${escapeHtml(i.cnpj)}` : ""}</option>`).join("");
  if (valorAtual) sel.value = valorAtual;
}

const FK_POR_TABELA = { cs_fornecedores: "fornecedor_id", cs_produtos: "produto_id" };

function renderCadastroLista(id, itens, tabela) {
  const ul = document.getElementById(id);
  if (!itens.length) {
    ul.innerHTML = '<li class="muted">Nenhum cadastro ainda.</li>';
    return;
  }
  ul.innerHTML = itens
    .map((i) => {
      const detalhe = i.unidade ? `${i.unidade}${i.codigo ? ` · cód. ${i.codigo}` : ""}` : i.cnpj || "";
      const outros = itens.filter((o) => o.id !== i.id);
      const opcoesAlvo = outros.map((o) => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join("");
      return `
    <li class="${i.ativo ? "" : "inativo"}" data-item-id="${i.id}">
      <div class="cadastro-linha">
        <span>${escapeHtml(i.nome)}${detalhe ? ` <span class="muted">(${escapeHtml(detalhe)})</span>` : ""}</span>
        <span>
          <button class="link-btn" data-acao="toggle" data-tabela="${tabela}" data-id="${i.id}" data-ativo="${i.ativo}">${i.ativo ? "Desativar" : "Ativar"}</button>
          <button class="link-btn" data-acao="mesclar" data-id="${i.id}">Mesclar</button>
          <button class="link-btn danger" data-acao="excluir" data-tabela="${tabela}" data-id="${i.id}">Excluir</button>
        </span>
      </div>
      <div class="cadastro-mesclar-form hidden">
        <span class="muted">Mesclar "${escapeHtml(i.nome)}" em:</span>
        <select class="cadastro-mesclar-alvo">${opcoesAlvo}</select>
        <button class="btn small primary" data-acao="confirmar-mesclagem" data-tabela="${tabela}" data-id="${i.id}">Confirmar</button>
        <button class="btn small secondary" data-acao="cancelar-mesclagem">Cancelar</button>
      </div>
    </li>`;
    })
    .join("");
}

document.querySelectorAll(".cadastro-lista").forEach((ul) => {
  ul.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    const { acao, tabela, id, ativo } = btn.dataset;

    if (acao === "toggle") {
      await db.from(tabela).update({ ativo: ativo !== "true" }).eq("id", id);
      await recarregarApoio();
    } else if (acao === "excluir") {
      if (!confirm("Excluir este cadastro?")) return;
      await db.from(tabela).delete().eq("id", id);
      await recarregarApoio();
    } else if (acao === "mesclar") {
      ul.querySelectorAll(".cadastro-mesclar-form").forEach((f) => f.classList.add("hidden"));
      btn.closest("li").querySelector(".cadastro-mesclar-form").classList.remove("hidden");
    } else if (acao === "cancelar-mesclagem") {
      btn.closest(".cadastro-mesclar-form").classList.add("hidden");
    } else if (acao === "confirmar-mesclagem") {
      const li = btn.closest("li");
      const alvoId = li.querySelector(".cadastro-mesclar-alvo").value;
      const nomeOrigem = li.querySelector(".cadastro-linha span").textContent.trim();
      if (!alvoId) return;
      if (!confirm(`Mesclar "${nomeOrigem}" no cadastro selecionado? Todas as compras registradas serão movidas pro cadastro de destino, e "${nomeOrigem}" será excluído. Essa ação não pode ser desfeita.`)) return;
      const fk = FK_POR_TABELA[tabela];
      await db.from("cs_compras").update({ [fk]: alvoId }).eq(fk, id);
      await db.from(tabela).delete().eq("id", id);
      await recarregarApoio();
      await loadPainel();
      await loadLista();
    }
  });
});

async function recarregarApoio() {
  await Promise.all([loadProdutos(), loadFornecedores()]);
}

// ---------- formulários de cadastro ----------
document.getElementById("form-fornecedor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("fornecedor-nome").value.trim();
  const cnpj = document.getElementById("fornecedor-cnpj").value.trim();
  if (!nome) return;
  await db.from("cs_fornecedores").insert({ nome, cnpj: cnpj || null });
  document.getElementById("fornecedor-nome").value = "";
  document.getElementById("fornecedor-cnpj").value = "";
  await loadFornecedores();
});

document.getElementById("form-produto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("produto-nome").value.trim();
  const unidade = document.getElementById("produto-unidade").value.trim();
  const codigo = document.getElementById("produto-codigo").value.trim();
  if (!nome || !unidade) return;
  await db.from("cs_produtos").insert({ nome, unidade, codigo: codigo || null });
  document.getElementById("produto-nome").value = "";
  document.getElementById("produto-unidade").value = "";
  document.getElementById("produto-codigo").value = "";
  await loadProdutos();
});

// ---------- nova compra ----------
document.getElementById("cp-data").value = new Date().toISOString().slice(0, 10);

document.getElementById("form-compra").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("cp-feedback");
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  try {
    const volume = document.getElementById("cp-volume").value;
    const valor = document.getElementById("cp-valor").value;
    const payload = {
      fornecedor_id: document.getElementById("cp-fornecedor").value || null,
      produto_id: document.getElementById("cp-produto").value || null,
      modalidade: document.getElementById("cp-modalidade").value,
      data: document.getElementById("cp-data").value,
      volume: volume ? Number(volume) : null,
      valor: valor ? Number(valor) : null,
      observacao: document.getElementById("cp-obs").value.trim(),
    };
    const { error } = await db.from("cs_compras").insert(payload);
    if (error) throw error;
    feedback.textContent = "Compra registrada com sucesso.";
    feedback.className = "feedback success";
    e.target.reset();
    document.getElementById("cp-data").value = new Date().toISOString().slice(0, 10);
  } catch (err) {
    feedback.textContent = "Erro ao salvar: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- lista / filtros ----------
async function loadLista() {
  let query = db.from("cs_compras").select("*").order("data", { ascending: false });
  const modalidade = document.getElementById("fil-modalidade").value;
  const fornecedor = document.getElementById("fil-fornecedor").value;
  const produto = document.getElementById("fil-produto").value;
  if (modalidade) query = query.eq("modalidade", modalidade);
  if (fornecedor) query = query.eq("fornecedor_id", fornecedor);
  if (produto) query = query.eq("produto_id", produto);
  const { data, error } = await comTimeout(query);
  comprasCache = error ? [] : data;
  renderLista();
}

function renderLista() {
  const tbody = document.querySelector("#tbl-lista tbody");
  document.getElementById("lista-marcar-todas").checked = false;
  if (!comprasCache.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma compra encontrada.</td></tr>';
    atualizarSelecaoLista();
    return;
  }
  tbody.innerHTML = comprasCache
    .map(
      (c) => `
    <tr>
      <td><input type="checkbox" class="lista-marcar" data-id="${c.id}"></td>
      <td>${formatarData(c.data)}</td>
      <td>${escapeHtml(c.numero_pedido || "—")}</td>
      <td>${escapeHtml(nomePor(fornecedoresCache, c.fornecedor_id))}</td>
      <td>${escapeHtml(nomePor(produtosCache, c.produto_id))}</td>
      <td><span class="badge modalidade-${c.modalidade}">${MODALIDADE_LABEL[c.modalidade]}</span></td>
      <td>${c.volume != null ? formatarNumero(c.volume, 0) : "—"}</td>
      <td>${c.valor != null ? "R$ " + formatarNumero(c.valor) : "—"}</td>
      <td class="acoes"><button class="link-btn danger" data-excluir="${c.id}">Excluir</button></td>
    </tr>`
    )
    .join("");
  atualizarSelecaoLista();
}

document.getElementById("btn-filtrar-lista").addEventListener("click", loadLista);

document.querySelector("#tbl-lista tbody").addEventListener("click", async (e) => {
  const marcar = e.target.closest(".lista-marcar");
  if (marcar) {
    atualizarSelecaoLista();
    return;
  }
  const btn = e.target.closest("button[data-excluir]");
  if (!btn) return;
  if (!confirm("Excluir esta compra?")) return;
  await db.from("cs_compras").delete().eq("id", btn.dataset.excluir);
  await loadLista();
});

function atualizarSelecaoLista() {
  const marcadas = document.querySelectorAll(".lista-marcar:checked");
  const btnExcluir = document.getElementById("btn-excluir-selecionadas");
  const info = document.getElementById("lista-selecionadas-info");
  if (marcadas.length > 0) {
    btnExcluir.classList.remove("hidden");
    info.textContent = `${marcadas.length} selecionada(s)`;
  } else {
    btnExcluir.classList.add("hidden");
    info.textContent = "";
  }
}

document.getElementById("lista-marcar-todas").addEventListener("change", (e) => {
  document.querySelectorAll(".lista-marcar").forEach((cb) => (cb.checked = e.target.checked));
  atualizarSelecaoLista();
});

document.getElementById("btn-excluir-selecionadas").addEventListener("click", async () => {
  const ids = Array.from(document.querySelectorAll(".lista-marcar:checked")).map((cb) => cb.dataset.id);
  if (!ids.length) return;
  if (!confirm(`Excluir ${ids.length} compra(s) selecionada(s)? Essa ação não pode ser desfeita.`)) return;
  await db.from("cs_compras").delete().in("id", ids);
  await loadLista();
});

// ---------- indicador: avanço de spot para contrato ----------
// Uma relação fornecedor+produto é considerada "migrada" quando a compra
// mais recente registrada para ela foi via contrato.
function relacoesFornecedorProduto(compras) {
  const grupos = {};
  compras.forEach((c) => {
    const chave = `${c.fornecedor_id}|${c.produto_id}`;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(c);
  });
  return Object.entries(grupos).map(([chave, doGrupo]) => {
    const [fornecedor_id, produto_id] = chave.split("|");
    const ordenadas = [...doGrupo].sort((a, b) => (a.data < b.data ? 1 : -1));
    const maisRecente = ordenadas[0];
    return {
      fornecedor_id,
      produto_id,
      modalidade_atual: maisRecente.modalidade,
      data_ultima_compra: maisRecente.data,
      compras: ordenadas,
    };
  });
}

function calcularAvanco(relacoes) {
  const total = relacoes.length;
  const migradas = relacoes.filter((r) => r.modalidade_atual === "contrato").length;
  const pct = total > 0 ? (migradas / total) * 100 : 0;
  return { total, migradas, aindaSpot: total - migradas, pct };
}

// % migrado ao final de cada um dos últimos N meses (visão cumulativa: para
// cada relação fornecedor+produto, qual era a modalidade da compra mais
// recente até aquele mês).
function evolucaoMensal(compras, meses = 6) {
  const hoje = new Date();
  const pontos = [];
  for (let i = meses - 1; i >= 0; i--) {
    const refDate = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 0); // último dia do mês
    const refIso = refDate.toISOString().slice(0, 10);
    const comprasAteMes = compras.filter((c) => c.data <= refIso);
    const relacoes = relacoesFornecedorProduto(comprasAteMes);
    const { pct, total } = calcularAvanco(relacoes);
    pontos.push({
      label: refDate.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      pct: total > 0 ? pct : null,
    });
  }
  return pontos;
}

// % de fornecedores totalmente migrados (todos os produtos dele em contrato)
// ao final de cada um dos últimos N meses — mesma visão cumulativa acima,
// só que agrupada por fornecedor em vez de por relação fornecedor+produto.
function evolucaoMensalFornecedores(compras, meses = 6) {
  const hoje = new Date();
  const pontos = [];
  for (let i = meses - 1; i >= 0; i--) {
    const refDate = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 0); // último dia do mês
    const refIso = refDate.toISOString().slice(0, 10);
    const comprasAteMes = compras.filter((c) => c.data <= refIso);
    const relacoes = relacoesFornecedorProduto(comprasAteMes);
    const porFornecedor = {};
    relacoes.forEach((r) => {
      if (!porFornecedor[r.fornecedor_id]) porFornecedor[r.fornecedor_id] = [];
      porFornecedor[r.fornecedor_id].push(r);
    });
    const fornecedoresIds = Object.keys(porFornecedor);
    const migrados = fornecedoresIds.filter((id) => porFornecedor[id].every((r) => r.modalidade_atual === "contrato")).length;
    const pct = fornecedoresIds.length > 0 ? (migrados / fornecedoresIds.length) * 100 : null;
    pontos.push({
      label: refDate.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      pct,
    });
  }
  return pontos;
}

function renderGraficoEvolucao(pontos, containerId = "grafico-evolucao", mostrarMeta = true) {
  const wrap = document.getElementById(containerId);
  if (!pontos.some((p) => p.pct !== null)) {
    wrap.innerHTML = '<div class="empty-state">Sem compras registradas ainda para calcular a evolução.</div>';
    return;
  }
  const tracks = pontos
    .map((p) => {
      const altura = p.pct === null ? 0 : Math.max(2, p.pct);
      return `
      <div class="chart-track-col">
        <div class="chart-col-bar-track"><div class="chart-col-bar" style="height:${altura}%"></div></div>
      </div>`;
    })
    .join("");
  const labels = pontos
    .map(
      (p) => `
      <div class="chart-label-col">
        <div class="chart-col-value">${p.pct === null ? "—" : Math.round(p.pct) + "%"}</div>
        <div class="chart-col-label">${escapeHtml(p.label)}</div>
      </div>`
    )
    .join("");
  const metaLinha =
    mostrarMeta && metaCache && metaCache.percentual != null
      ? `<div class="meta-linha" style="bottom:${Math.min(100, Math.max(0, metaCache.percentual))}%"><span class="meta-linha-label">Meta ${metaCache.percentual}%</span></div>`
      : "";
  wrap.innerHTML = `<div class="chart-bars">
    <div class="chart-tracks-wrap">${tracks}${metaLinha}</div>
    <div class="chart-labels-row">${labels}</div>
  </div>`;
}

function progressoHtml(pct) {
  const arredondado = Math.round(pct * 10) / 10;
  const completo = pct >= 100 ? "completo" : "";
  return `
    <div class="progress-cell">
      <div class="progress-bar"><div class="progress-fill ${completo}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="progress-label">${arredondado}%</div>
    </div>`;
}

// ---------- meta de avanço ----------
let metaCache = null; // { percentual, data }

async function loadMeta() {
  const { data, error } = await comTimeout(db.from("cs_config").select("*").eq("id", true).maybeSingle());
  metaCache = error || !data ? null : { percentual: data.meta_percentual, data: data.meta_data };
  if (metaCache) {
    document.getElementById("meta-percentual").value = metaCache.percentual ?? "";
    document.getElementById("meta-data").value = metaCache.data ?? "";
  }
}

document.getElementById("form-meta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const feedback = document.getElementById("meta-feedback");
  const percentual = document.getElementById("meta-percentual").value;
  const data_meta = document.getElementById("meta-data").value;
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  const { error } = await db.from("cs_config").upsert({
    id: true,
    meta_percentual: percentual ? Number(percentual) : null,
    meta_data: data_meta || null,
  });
  if (error) {
    feedback.textContent = "Erro ao salvar: " + error.message;
    feedback.className = "feedback error";
    return;
  }
  feedback.textContent = "Meta salva.";
  feedback.className = "feedback success";
  await loadMeta();
  await loadPainel();
});

// ---------- painel ----------
async function loadPainel() {
  const { data, error } = await comTimeout(db.from("cs_compras").select("*"));
  todasComprasCache = error ? [] : data;

  const relacoes = relacoesFornecedorProduto(todasComprasCache);
  renderResumoCards(relacoes);
  renderTabelaSugestoes(relacoes);
  renderGraficoEvolucao(evolucaoMensal(todasComprasCache), "grafico-evolucao");
  renderGraficoEvolucao(evolucaoMensalFornecedores(todasComprasCache), "grafico-evolucao-fornecedor", false);
  renderTabelaFornecedor(relacoes);
  renderTabelaProduto(relacoes);
}

function renderResumoCards(relacoes) {
  const { total, migradas, aindaSpot, pct } = calcularAvanco(relacoes);

  const cards = [
    { label: "Relações fornecedor + produto", valor: total, cls: "" },
    { label: "Já migradas para contrato", valor: migradas, cls: "ok" },
    { label: "Ainda em cotação spot", valor: aindaSpot, cls: aindaSpot > 0 ? "atrasado" : "" },
    { label: "Avanço geral da migração", valor: `${Math.round(pct * 10) / 10}%`, cls: pct >= 70 ? "ok" : "" },
  ];

  if (metaCache && metaCache.percentual != null) {
    const faltam = Math.max(0, Math.round((metaCache.percentual - pct) * 10) / 10);
    const bateu = pct >= metaCache.percentual;
    const prazo = metaCache.data ? ` até ${formatarData(metaCache.data)}` : "";
    cards.push({
      label: `Meta: ${metaCache.percentual}%${prazo}`,
      valor: bateu ? "Atingida ✓" : `Faltam ${faltam} p.p.`,
      cls: bateu ? "ok" : "atrasado",
    });
  }

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

function diasDesde(dataIso) {
  return Math.max(0, Math.round((Date.now() - new Date(dataIso + "T00:00:00")) / 86400000));
}

// Candidatos a migração: relações ainda em spot, rankeadas por número de
// compras spot registradas (recorrência) — quanto mais vezes comprou pontual,
// mais forte o sinal de que vale a pena negociar um contrato.
const MIN_COMPRAS_SUGESTAO = 2;
let linhasSugestaoFull = [];

function calcularSugestoesMigracao(relacoes) {
  return relacoes
    .filter((r) => r.modalidade_atual === "spot")
    .map((r) => {
      const comprasSpot = todasComprasCache.filter(
        (c) => String(c.fornecedor_id) === String(r.fornecedor_id) && String(c.produto_id) === String(r.produto_id) && c.modalidade === "spot"
      );
      const numeroComprasSpot = comprasSpot.length;
      const volumeTotalSpot = comprasSpot.reduce((soma, c) => soma + Number(c.volume || 0), 0);
      const primeiraCompraSpot = comprasSpot.reduce((min, c) => (c.data < min ? c.data : min), comprasSpot[0]?.data);
      const temValor = comprasSpot.some((c) => c.valor != null);
      const valorTotalSpot = comprasSpot.reduce((soma, c) => soma + Number(c.valor || 0), 0);
      return {
        fornecedorNome: nomePor(fornecedoresCache, r.fornecedor_id),
        produtoNome: nomePor(produtosCache, r.produto_id),
        numeroComprasSpot,
        volumeTotalSpot,
        primeiraCompraSpot,
        temValor,
        valorTotalSpot,
      };
    })
    .filter((s) => s.numeroComprasSpot >= MIN_COMPRAS_SUGESTAO)
    .sort((a, b) => b.numeroComprasSpot - a.numeroComprasSpot || b.volumeTotalSpot - a.volumeTotalSpot);
}

function renderTabelaSugestoes(relacoes) {
  linhasSugestaoFull = calcularSugestoesMigracao(relacoes);
  renderLinhasSugestaoVisiveis();
}

function renderLinhasSugestaoVisiveis() {
  const tbody = document.querySelector("#tbl-sugestao tbody");
  const filtro = document.getElementById("filtro-sugestao-painel").value.trim().toLowerCase();
  const filtradas = filtro
    ? linhasSugestaoFull.filter((s) => s.fornecedorNome.toLowerCase().includes(filtro) || s.produtoNome.toLowerCase().includes(filtro))
    : linhasSugestaoFull;

  if (!filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${
      linhasSugestaoFull.length ? "Nenhum item encontrado." : `Nenhum item com ${MIN_COMPRAS_SUGESTAO}+ compras repetidas em spot ainda.`
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.fornecedorNome)}</td>
      <td>${escapeHtml(s.produtoNome)}</td>
      <td>${s.numeroComprasSpot}</td>
      <td>${formatarNumero(s.volumeTotalSpot, 0)}</td>
      <td>${s.temValor ? "R$ " + formatarNumero(s.valorTotalSpot) : "—"}</td>
      <td>${formatarData(s.primeiraCompraSpot)}</td>
    </tr>`
    )
    .join("");
}

document.getElementById("filtro-sugestao-painel").addEventListener("input", renderLinhasSugestaoVisiveis);

let linhasFornecedorFull = [];
let linhasProdutoFull = [];

function renderTabelaFornecedor(relacoes) {
  const porFornecedor = {};
  relacoes.forEach((r) => {
    if (!porFornecedor[r.fornecedor_id]) porFornecedor[r.fornecedor_id] = [];
    porFornecedor[r.fornecedor_id].push(r);
  });
  let linhas = Object.entries(porFornecedor).map(([fornecedorId, doFornecedor]) => {
    const produtos = doFornecedor.map((r) => nomePor(produtosCache, r.produto_id)).join(", ");
    const todasContrato = doFornecedor.every((r) => r.modalidade_atual === "contrato");
    const todasSpot = doFornecedor.every((r) => r.modalidade_atual === "spot");
    const statusLabel = todasContrato ? "Contrato" : todasSpot ? "Spot" : "Parcial";
    const statusClasse = todasContrato ? "modalidade-contrato" : "modalidade-spot";
    const ultimaCompra = doFornecedor.reduce((max, r) => (r.data_ultima_compra > max ? r.data_ultima_compra : max), doFornecedor[0].data_ultima_compra);
    const comprasFornecedor = todasComprasCache.filter((c) => String(c.fornecedor_id) === String(fornecedorId));
    const primeiraCompra = comprasFornecedor.reduce((min, c) => (c.data < min ? c.data : min), comprasFornecedor[0]?.data || ultimaCompra);
    const diasEmSpot = todasContrato ? null : diasDesde(primeiraCompra);
    const nome = nomePor(fornecedoresCache, fornecedorId);
    return { fornecedorId, nome, produtos, statusLabel, statusClasse, ultimaCompra, diasEmSpot };
  });
  linhas.sort((a, b) => {
    const aContrato = a.statusLabel === "Contrato" ? 1 : 0;
    const bContrato = b.statusLabel === "Contrato" ? 1 : 0;
    if (aContrato !== bContrato) return aContrato - bContrato;
    if (aContrato === 0) return (b.diasEmSpot || 0) - (a.diasEmSpot || 0);
    return 0;
  });
  linhasFornecedorFull = linhas;
  renderLinhasFornecedorVisiveis();
}

function renderLinhasFornecedorVisiveis() {
  const tbody = document.querySelector("#tbl-fornecedor tbody");
  const filtro = document.getElementById("filtro-fornecedor-painel").value.trim().toLowerCase();
  const filtradas = filtro ? linhasFornecedorFull.filter((l) => l.nome.toLowerCase().includes(filtro)) : linhasFornecedorFull;

  if (!filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${linhasFornecedorFull.length ? "Nenhum fornecedor encontrado." : "Sem dados ainda."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas
    .map(
      (l) => `
    <tr>
      <td>${escapeHtml(l.nome)}</td>
      <td>${escapeHtml(l.produtos)}</td>
      <td><span class="badge ${l.statusClasse}">${l.statusLabel}</span></td>
      <td>${l.diasEmSpot === null ? "—" : `${l.diasEmSpot} dias`}</td>
      <td>${formatarData(l.ultimaCompra)}</td>
    </tr>`
    )
    .join("");
}

document.getElementById("filtro-fornecedor-painel").addEventListener("input", renderLinhasFornecedorVisiveis);

function renderTabelaProduto(relacoes) {
  const porProduto = {};
  relacoes.forEach((r) => {
    if (!porProduto[r.produto_id]) porProduto[r.produto_id] = [];
    porProduto[r.produto_id].push(r);
  });
  let linhas = Object.entries(porProduto).map(([produtoId, doProduto]) => {
    const { migradas, aindaSpot, pct } = calcularAvanco(doProduto);
    const nome = nomePor(produtosCache, produtoId);
    return { produtoId, nome, migradas, aindaSpot, pct };
  });
  linhas.sort((a, b) => {
    const aSpot = a.aindaSpot > 0 ? 0 : 1;
    const bSpot = b.aindaSpot > 0 ? 0 : 1;
    if (aSpot !== bSpot) return aSpot - bSpot;
    return a.pct - b.pct;
  });
  linhasProdutoFull = linhas;
  renderLinhasProdutoVisiveis();
}

function renderLinhasProdutoVisiveis() {
  const tbody = document.querySelector("#tbl-produto tbody");
  const filtro = document.getElementById("filtro-produto-painel").value.trim().toLowerCase();
  const filtradas = filtro ? linhasProdutoFull.filter((l) => l.nome.toLowerCase().includes(filtro)) : linhasProdutoFull;

  if (!filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${linhasProdutoFull.length ? "Nenhum produto encontrado." : "Sem dados ainda."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas
    .map(
      (l) => `
    <tr>
      <td>${escapeHtml(l.nome)}</td>
      <td>${l.migradas}</td>
      <td>${l.aindaSpot}</td>
      <td>${progressoHtml(l.pct)}</td>
    </tr>`
    )
    .join("");
}

document.getElementById("filtro-produto-painel").addEventListener("input", renderLinhasProdutoVisiveis);

document.getElementById("btn-refresh-painel").addEventListener("click", loadPainel);

// ---------- importar pedido de compra (PDF) ----------
const EXTRACT_PDF_URL = `${SUPABASE_URL}/functions/v1/rapid-action`;
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4fZ0DlFJq1ec5xTXurwGSQ_Ke3JELGZ";
let pdfExtraido = null; // { fornecedor_nome, itens: [{produto_nome, quantidade, unidade}] }
let pedidoDuplicadoDetectado = false;

async function checarPedidoDuplicado(numeroPedido) {
  const aviso = document.getElementById("pdf-pedido-duplicado-aviso");
  pedidoDuplicadoDetectado = false;
  if (!numeroPedido) {
    aviso.classList.add("hidden");
    return;
  }
  const { data } = await comTimeout(db.from("cs_compras").select("data").eq("numero_pedido", numeroPedido).limit(1));
  if (data && data.length) {
    pedidoDuplicadoDetectado = true;
    aviso.textContent = `⚠️ O pedido Nº ${numeroPedido} já foi importado antes (compra registrada em ${formatarData(data[0].data)}). Confira se não é duplicado antes de salvar.`;
    aviso.classList.remove("hidden");
  } else {
    aviso.classList.add("hidden");
  }
}

document.getElementById("pdf-numero-pedido").addEventListener("change", (e) => {
  checarPedidoDuplicado(e.target.value.trim());
});

function arquivoParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}

function encontrarPorNome(nome, cache) {
  const alvo = String(nome || "").trim().toLowerCase();
  if (!alvo) return null;
  return cache.find((i) => i.nome.trim().toLowerCase() === alvo) || null;
}

function apenasDigitos(str) {
  return String(str || "").replace(/\D/g, "");
}

// CNPJ é um identificador único de verdade — prioriza ele sobre o nome
// (que pode variar de um pedido pra outro) pra evitar cadastro duplicado.
function encontrarFornecedor(nomeExtraido, cnpjExtraido, cache) {
  const cnpjAlvo = apenasDigitos(cnpjExtraido);
  if (cnpjAlvo) {
    const porCnpj = cache.find((f) => f.cnpj && apenasDigitos(f.cnpj) === cnpjAlvo);
    if (porCnpj) return porCnpj;
  }
  return encontrarPorNome(nomeExtraido, cache);
}

// Mesma lógica pro código do produto (SKU/referência).
function encontrarProduto(nomeExtraido, codigoExtraido, cache) {
  const codigoAlvo = String(codigoExtraido || "").trim().toLowerCase();
  if (codigoAlvo) {
    const porCodigo = cache.find((p) => p.codigo && p.codigo.trim().toLowerCase() === codigoAlvo);
    if (porCodigo) return porCodigo;
  }
  return encontrarPorNome(nomeExtraido, cache);
}

function preencherSelectComNovo(id, cache, nomeExtraido, cnpjExtraido) {
  const sel = document.getElementById(id);
  const match = encontrarFornecedor(nomeExtraido, cnpjExtraido, cache);
  const ativos = cache.filter((i) => i.ativo);
  const opcoes = ativos.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)}${i.cnpj ? ` — ${escapeHtml(i.cnpj)}` : ""}</option>`).join("");
  sel.innerHTML = `<option value="novo">+ Novo: "${escapeHtml(nomeExtraido)}"</option>${opcoes}`;
  if (match) sel.value = String(match.id);
}

document.getElementById("btn-ler-pdf").addEventListener("click", async () => {
  const input = document.getElementById("pdf-arquivo");
  const feedback = document.getElementById("pdf-feedback");
  const file = input.files && input.files[0];
  if (!file) {
    feedback.textContent = "Selecione um arquivo PDF primeiro.";
    feedback.className = "feedback error";
    return;
  }
  feedback.textContent = "Lendo PDF (pode levar alguns segundos)...";
  feedback.className = "feedback";
  document.getElementById("pdf-revisao").classList.add("hidden");
  try {
    const pdfBase64 = await arquivoParaBase64(file);
    const resp = await fetch(EXTRACT_PDF_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ pdf_base64: pdfBase64 }),
    });
    const resultado = await resp.json();
    if (!resp.ok || resultado.error) throw new Error(resultado.error || "Falha ao ler o PDF.");

    pdfExtraido = resultado.data;
    feedback.textContent = `Lido com sucesso: ${pdfExtraido.itens.length} item(ns) encontrado(s). Confira abaixo.`;
    feedback.className = "feedback success";

    preencherSelectComNovo("pdf-fornecedor", fornecedoresCache, pdfExtraido.fornecedor_nome, pdfExtraido.fornecedor_cnpj);
    document.getElementById("pdf-fornecedor-cnpj-info").textContent = pdfExtraido.fornecedor_cnpj
      ? `CNPJ lido do documento: ${pdfExtraido.fornecedor_cnpj}`
      : "";
    document.getElementById("pdf-data").value = new Date().toISOString().slice(0, 10);
    document.getElementById("pdf-numero-pedido").value = pdfExtraido.numero_pedido || "";
    await checarPedidoDuplicado(pdfExtraido.numero_pedido);
    renderTabelaPdfItens();
    document.getElementById("pdf-revisao").classList.remove("hidden");
  } catch (err) {
    feedback.textContent = "Erro: " + err.message;
    feedback.className = "feedback error";
  }
});

function renderTabelaPdfItens() {
  const tbody = document.querySelector("#tbl-pdf-itens tbody");
  const ativos = produtosCache.filter((p) => p.ativo);
  const opcoesBase = ativos.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}${p.codigo ? ` — ${escapeHtml(p.codigo)}` : ""}</option>`).join("");
  tbody.innerHTML = pdfExtraido.itens
    .map(
      (item, idx) => `
    <tr data-idx="${idx}">
      <td><input type="checkbox" class="pdf-item-incluir" checked></td>
      <td>
        <select class="pdf-item-produto">
          <option value="novo">+ Novo: "${escapeHtml(item.produto_nome)}"</option>
          ${opcoesBase}
        </select>
      </td>
      <td>${escapeHtml(item.produto_codigo || "—")}</td>
      <td><input type="number" class="pdf-item-quantidade" step="0.01" min="0" value="${item.quantidade}"></td>
      <td>${escapeHtml(item.unidade || "—")}</td>
    </tr>`
    )
    .join("");
  document.querySelectorAll("#tbl-pdf-itens tbody tr").forEach((tr) => {
    const idx = Number(tr.dataset.idx);
    const item = pdfExtraido.itens[idx];
    const match = encontrarProduto(item.produto_nome, item.produto_codigo, produtosCache);
    if (match) tr.querySelector(".pdf-item-produto").value = String(match.id);
  });
}

document.getElementById("btn-salvar-pdf").addEventListener("click", async () => {
  const feedback = document.getElementById("pdf-salvar-feedback");
  if (pedidoDuplicadoDetectado) {
    const numeroPedido = document.getElementById("pdf-numero-pedido").value.trim();
    if (!confirm(`O pedido Nº ${numeroPedido} já foi importado antes. Tem certeza que quer importar de novo mesmo assim?`)) return;
  }
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  try {
    let fornecedorId = document.getElementById("pdf-fornecedor").value;
    if (fornecedorId === "novo") {
      const cnpj = pdfExtraido.fornecedor_cnpj || null;
      const payload = { nome: pdfExtraido.fornecedor_nome, cnpj };
      // Com CNPJ: upsert — se um fornecedor com esse CNPJ já existir (de uma
      // importação anterior), reaproveita o cadastro em vez de duplicar.
      const query = cnpj
        ? db.from("cs_fornecedores").upsert(payload, { onConflict: "cnpj" })
        : db.from("cs_fornecedores").insert(payload);
      const { data, error } = await query.select().single();
      if (error) throw error;
      fornecedorId = data.id;
    }

    const modalidade = document.getElementById("pdf-modalidade").value;
    const data_compra = document.getElementById("pdf-data").value;
    const numeroPedido = document.getElementById("pdf-numero-pedido").value.trim() || null;
    const linhas = Array.from(document.querySelectorAll("#tbl-pdf-itens tbody tr"));

    let salvos = 0;
    for (const tr of linhas) {
      const incluir = tr.querySelector(".pdf-item-incluir").checked;
      if (!incluir) continue;
      const idx = Number(tr.dataset.idx);
      const item = pdfExtraido.itens[idx];
      let produtoId = tr.querySelector(".pdf-item-produto").value;
      if (produtoId === "novo") {
        const codigo = item.produto_codigo || null;
        const payload = { nome: item.produto_nome, unidade: item.unidade || "un", codigo };
        // Com código: upsert — se um produto com esse código já existir, reaproveita
        // o cadastro em vez de duplicar (mesmo que o nome extraído varie um pouco).
        const query = codigo
          ? db.from("cs_produtos").upsert(payload, { onConflict: "codigo" })
          : db.from("cs_produtos").insert(payload);
        const { data: novoProduto, error: erroProduto } = await query.select().single();
        if (erroProduto) throw erroProduto;
        produtoId = novoProduto.id;
      }
      const quantidade = Number(tr.querySelector(".pdf-item-quantidade").value);
      const { error: erroCompra } = await db.from("cs_compras").insert({
        fornecedor_id: fornecedorId,
        produto_id: produtoId,
        modalidade,
        data: data_compra,
        volume: quantidade,
        valor: item.valor_total != null ? Number(item.valor_total) : null,
        numero_pedido: numeroPedido,
      });
      if (erroCompra) throw erroCompra;
      salvos++;
    }

    feedback.textContent = `${salvos} compra(s) salva(s) com sucesso.`;
    feedback.className = "feedback success";
    document.getElementById("pdf-revisao").classList.add("hidden");
    document.getElementById("pdf-arquivo").value = "";
    document.getElementById("pdf-feedback").textContent = "";
    document.getElementById("pdf-pedido-duplicado-aviso").classList.add("hidden");
    pdfExtraido = null;
    pedidoDuplicadoDetectado = false;
    await recarregarApoio();
  } catch (err) {
    feedback.textContent = "Erro ao salvar: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- inicialização ----------
(async function init() {
  await recarregarApoio();
  await loadMeta();
  await loadPainel();
})();
