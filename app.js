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
  await Promise.all([loadProdutos(), loadFornecedores()]);
}

// ---------- formulários de cadastro ----------
document.getElementById("form-fornecedor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("fornecedor-nome").value.trim();
  if (!nome) return;
  await db.from("cs_fornecedores").insert({ nome });
  document.getElementById("fornecedor-nome").value = "";
  await loadFornecedores();
});

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
  if (!comprasCache.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhuma compra encontrada.</td></tr>';
    return;
  }
  tbody.innerHTML = comprasCache
    .map(
      (c) => `
    <tr>
      <td>${formatarData(c.data)}</td>
      <td>${escapeHtml(nomePor(fornecedoresCache, c.fornecedor_id))}</td>
      <td>${escapeHtml(nomePor(produtosCache, c.produto_id))}</td>
      <td><span class="badge modalidade-${c.modalidade}">${MODALIDADE_LABEL[c.modalidade]}</span></td>
      <td>${c.volume != null ? formatarNumero(c.volume, 0) : "—"}</td>
      <td>${c.valor != null ? "R$ " + formatarNumero(c.valor) : "—"}</td>
      <td class="acoes"><button class="link-btn danger" data-excluir="${c.id}">Excluir</button></td>
    </tr>`
    )
    .join("");
}

document.getElementById("btn-filtrar-lista").addEventListener("click", loadLista);

document.querySelector("#tbl-lista tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-excluir]");
  if (!btn) return;
  if (!confirm("Excluir esta compra?")) return;
  await db.from("cs_compras").delete().eq("id", btn.dataset.excluir);
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

function renderGraficoEvolucao(pontos) {
  const wrap = document.getElementById("grafico-evolucao");
  if (!pontos.some((p) => p.pct !== null)) {
    wrap.innerHTML = '<div class="empty-state">Sem compras registradas ainda para calcular a evolução.</div>';
    return;
  }
  wrap.innerHTML = `<div class="chart-bars">${pontos
    .map((p) => {
      const altura = p.pct === null ? 0 : Math.max(2, p.pct);
      return `
      <div class="chart-col">
        <div class="chart-col-value">${p.pct === null ? "—" : Math.round(p.pct) + "%"}</div>
        <div class="chart-col-bar-track"><div class="chart-col-bar" style="height:${altura}%"></div></div>
        <div class="chart-col-label">${escapeHtml(p.label)}</div>
      </div>`;
    })
    .join("")}</div>`;
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

// ---------- painel ----------
async function loadPainel() {
  const { data, error } = await comTimeout(db.from("cs_compras").select("*"));
  todasComprasCache = error ? [] : data;

  const relacoes = relacoesFornecedorProduto(todasComprasCache);
  renderResumoCards(relacoes);
  renderGraficoEvolucao(evolucaoMensal(todasComprasCache));
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

function renderTabelaFornecedor(relacoes) {
  const tbody = document.querySelector("#tbl-fornecedor tbody");
  const porFornecedor = {};
  relacoes.forEach((r) => {
    if (!porFornecedor[r.fornecedor_id]) porFornecedor[r.fornecedor_id] = [];
    porFornecedor[r.fornecedor_id].push(r);
  });
  const linhas = Object.entries(porFornecedor);
  if (!linhas.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Sem dados ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = linhas
    .map(([fornecedorId, doFornecedor]) => {
      const produtos = doFornecedor.map((r) => nomePor(produtosCache, r.produto_id)).join(", ");
      const todasContrato = doFornecedor.every((r) => r.modalidade_atual === "contrato");
      const todasSpot = doFornecedor.every((r) => r.modalidade_atual === "spot");
      const statusLabel = todasContrato ? "Contrato" : todasSpot ? "Spot" : "Parcial";
      const statusClasse = todasContrato ? "modalidade-contrato" : todasSpot ? "modalidade-spot" : "modalidade-spot";
      const ultimaCompra = doFornecedor.reduce((max, r) => (r.data_ultima_compra > max ? r.data_ultima_compra : max), doFornecedor[0].data_ultima_compra);
      return `
    <tr>
      <td>${escapeHtml(nomePor(fornecedoresCache, fornecedorId))}</td>
      <td>${escapeHtml(produtos)}</td>
      <td><span class="badge ${statusClasse}">${statusLabel}</span></td>
      <td>${formatarData(ultimaCompra)}</td>
    </tr>`;
    })
    .join("");
}

function renderTabelaProduto(relacoes) {
  const tbody = document.querySelector("#tbl-produto tbody");
  const porProduto = {};
  relacoes.forEach((r) => {
    if (!porProduto[r.produto_id]) porProduto[r.produto_id] = [];
    porProduto[r.produto_id].push(r);
  });
  const linhas = Object.entries(porProduto);
  if (!linhas.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Sem dados ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = linhas
    .map(([produtoId, doProduto]) => {
      const { migradas, aindaSpot, pct } = calcularAvanco(doProduto);
      return `
    <tr>
      <td>${escapeHtml(nomePor(produtosCache, produtoId))}</td>
      <td>${migradas}</td>
      <td>${aindaSpot}</td>
      <td>${progressoHtml(pct)}</td>
    </tr>`;
    })
    .join("");
}

document.getElementById("btn-refresh-painel").addEventListener("click", loadPainel);

// ---------- importar pedido de compra (PDF) ----------
const EXTRACT_PDF_URL = `${SUPABASE_URL}/functions/v1/extract-pedido`;
let pdfExtraido = null; // { fornecedor_nome, itens: [{produto_nome, quantidade, unidade}] }

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

function preencherSelectComNovo(id, cache, nomeExtraido) {
  const sel = document.getElementById(id);
  const match = encontrarPorNome(nomeExtraido, cache);
  const ativos = cache.filter((i) => i.ativo);
  const opcoes = ativos.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)}</option>`).join("");
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
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ pdf_base64: pdfBase64 }),
    });
    const resultado = await resp.json();
    if (!resp.ok || resultado.error) throw new Error(resultado.error || "Falha ao ler o PDF.");

    pdfExtraido = resultado.data;
    feedback.textContent = `Lido com sucesso: ${pdfExtraido.itens.length} item(ns) encontrado(s). Confira abaixo.`;
    feedback.className = "feedback success";

    preencherSelectComNovo("pdf-fornecedor", fornecedoresCache, pdfExtraido.fornecedor_nome);
    document.getElementById("pdf-data").value = new Date().toISOString().slice(0, 10);
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
  const opcoesBase = ativos.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join("");
  tbody.innerHTML = pdfExtraido.itens
    .map((item, idx) => {
      const match = encontrarPorNome(item.produto_nome, produtosCache);
      return `
    <tr data-idx="${idx}">
      <td><input type="checkbox" class="pdf-item-incluir" checked></td>
      <td>
        <select class="pdf-item-produto">
          <option value="novo">+ Novo: "${escapeHtml(item.produto_nome)}"</option>
          ${opcoesBase}
        </select>
      </td>
      <td><input type="number" class="pdf-item-quantidade" step="0.01" min="0" value="${item.quantidade}"></td>
      <td>${escapeHtml(item.unidade || "—")}</td>
    </tr>`;
    })
    .join("");
  document.querySelectorAll("#tbl-pdf-itens tbody tr").forEach((tr) => {
    const idx = Number(tr.dataset.idx);
    const match = encontrarPorNome(pdfExtraido.itens[idx].produto_nome, produtosCache);
    if (match) tr.querySelector(".pdf-item-produto").value = String(match.id);
  });
}

document.getElementById("btn-salvar-pdf").addEventListener("click", async () => {
  const feedback = document.getElementById("pdf-salvar-feedback");
  feedback.textContent = "Salvando...";
  feedback.className = "feedback";
  try {
    let fornecedorId = document.getElementById("pdf-fornecedor").value;
    if (fornecedorId === "novo") {
      const { data, error } = await db.from("cs_fornecedores").insert({ nome: pdfExtraido.fornecedor_nome }).select().single();
      if (error) throw error;
      fornecedorId = data.id;
    }

    const modalidade = document.getElementById("pdf-modalidade").value;
    const data_compra = document.getElementById("pdf-data").value;
    const linhas = Array.from(document.querySelectorAll("#tbl-pdf-itens tbody tr"));

    let salvos = 0;
    for (const tr of linhas) {
      const incluir = tr.querySelector(".pdf-item-incluir").checked;
      if (!incluir) continue;
      const idx = Number(tr.dataset.idx);
      const item = pdfExtraido.itens[idx];
      let produtoId = tr.querySelector(".pdf-item-produto").value;
      if (produtoId === "novo") {
        const { data: novoProduto, error: erroProduto } = await db
          .from("cs_produtos")
          .insert({ nome: item.produto_nome, unidade: item.unidade || "un" })
          .select()
          .single();
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
      });
      if (erroCompra) throw erroCompra;
      salvos++;
    }

    feedback.textContent = `${salvos} compra(s) salva(s) com sucesso.`;
    feedback.className = "feedback success";
    document.getElementById("pdf-revisao").classList.add("hidden");
    document.getElementById("pdf-arquivo").value = "";
    document.getElementById("pdf-feedback").textContent = "";
    pdfExtraido = null;
    await recarregarApoio();
  } catch (err) {
    feedback.textContent = "Erro ao salvar: " + err.message;
    feedback.className = "feedback error";
  }
});

// ---------- inicialização ----------
(async function init() {
  await recarregarApoio();
  await loadPainel();
})();
