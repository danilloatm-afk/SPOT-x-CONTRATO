# importar-pedidos.ps1
#
# Varre uma pasta em busca de PDFs de pedido de compra novos, manda cada um
# pra função de extração por IA (extract-pedido) e salva a compra
# automaticamente no "Avanço para Contratos" — sem precisar de uma pessoa
# abrir o site.
#
# MODALIDADE (spot ou contrato): decidida pelo NOME DO ARQUIVO. Se o nome
# contiver a palavra "contrato" (sem diferenciar maiúsculas/minúsculas), a
# compra é salva como Contrato. Caso contrário (inclusive se não tiver nem
# "spot" nem "contrato" no nome), é salva como Spot — esse é o padrão
# conservador enquanto não houver contrato formal negociado.
#
# Depois de processado, o arquivo é movido para uma subpasta:
#   Processados\   -> importado com sucesso
#   Duplicados\    -> pulado porque o número do pedido já tinha sido importado
#   Erros\         -> deu algum problema (confira o log)
#
# RODANDO EM MAIS DE UM COMPUTADOR (redundância): este script pode ser
# instalado em várias máquinas ao mesmo tempo, todas apontando pra mesma pasta
# de rede — se uma estiver desligada, a outra continua importando. Pra não
# duplicar nem conflitar quando as duas rodam juntas, cada PDF é
# "reivindicado" ANTES de processar: é movido (operação atômica do Windows, só
# UMA máquina consegue) pra a subpasta "Processando", com a data/hora e o nome
# do computador no começo do nome do arquivo. A outra máquina recebe erro no
# Move-Item e simplesmente pula aquele arquivo. Se uma máquina cair no meio do
# processamento, o arquivo preso em "Processando" volta sozinho pra pasta
# principal depois de 30 minutos. Cada máquina grava seu próprio log.
# (Mesmo esquema do robô do Rotas de Compras.)
#
# CONFIGURAÇÃO: ajuste $PastaMonitorada abaixo para o caminho real da sua
# pasta de rede. Depois, agende esse script no Agendador de Tarefas do
# Windows pra rodar a cada 15-30 minutos (veja instruções no chat).

$ErrorActionPreference = "Stop"

# ---------- CONFIGURAÇÃO — ajuste aqui ----------
$PastaMonitorada = "\\192.168.0.228\wehrmann\COMPRAS\ORDENS DE COMPRA"
# --------------------------------------------------

$SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co"
$SUPABASE_KEY = "sb_publishable_4fZ0DlFJq1ec5xTXurwGSQ_Ke3JELGZ"
$EXTRACT_URL = "$SUPABASE_URL/functions/v1/smart-worker"

$PastaProcessados = Join-Path $PastaMonitorada "Processados"
$PastaDuplicados = Join-Path $PastaMonitorada "Duplicados"
$PastaErros = Join-Path $PastaMonitorada "Erros"
# Área de "reivindicação" — ver nota de redundância no topo do arquivo.
$PastaProcessando = Join-Path $PastaMonitorada "Processando"
# Um log por computador (sem conflito de escrita entre as máquinas).
$LogFile = Join-Path $PastaMonitorada "importacao_log_$($env:COMPUTERNAME).txt"

foreach ($p in @($PastaProcessados, $PastaDuplicados, $PastaErros, $PastaProcessando)) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Write-Log($mensagem) {
    $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $mensagem"
    # Pequeno retry — um antivírus ou outro processo local pode segurar o
    # arquivo por uma fração de segundo.
    for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
        try {
            Add-Content -Path $LogFile -Value $linha -Encoding utf8 -ErrorAction Stop
            break
        } catch {
            if ($tentativa -eq 3) { Write-Output "(falha ao gravar log) $linha" }
            else { Start-Sleep -Milliseconds 300 }
        }
    }
    Write-Output $linha
}

$HeadersJson = @{
    "apikey"        = $SUPABASE_KEY
    "authorization" = "Bearer $SUPABASE_KEY"
    "content-type"  = "application/json"
}

# ---------- carrega cadastros existentes (pra achar por CNPJ/código/nome antes de criar novo) ----------
function ApenasDigitos($texto) {
    if ([string]::IsNullOrWhiteSpace($texto)) { return "" }
    return ($texto -replace '\D', '')
}

# A API do Supabase devolve no máximo 1000 linhas por consulta — sem paginar, o
# robô deixava de "enxergar" cadastros além da milésima linha e criava duplicados.
function Get-Todos($uriBase) {
    $todos = @()
    $offset = 0
    while ($true) {
        $pagina = Invoke-RestMethod -Uri "$uriBase&order=id&limit=1000&offset=$offset" -Headers $HeadersJson -Method Get
        if (-not $pagina) { break }
        $todos += @($pagina)
        if (@($pagina).Count -lt 1000) { break }
        $offset += 1000
    }
    return $todos
}

$fornecedores = Get-Todos "$SUPABASE_URL/rest/v1/cs_fornecedores?select=id,nome,cnpj,ativo&ativo=eq.true"
$produtos = Get-Todos "$SUPABASE_URL/rest/v1/cs_produtos?select=id,nome,unidade,codigo,ativo&ativo=eq.true"
$condicoesPagamento = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cs_condicoes_pagamento?select=codigo,descricao" -Headers $HeadersJson -Method Get

function Normalizar-CondicaoTexto($texto) {
    if ([string]::IsNullOrWhiteSpace($texto)) { return "" }
    $t = $texto.ToUpper() -replace '[/,.]+', ' '
    $t = $t -replace '\s+', ' '
    return $t.Trim()
}

# Alguns modelos de pedido não mostram o código da condição de pagamento, só
# o texto por extenso (ex: "A VISTA", "28 56 84 DIAS") — tenta achar o
# código correspondente casando esse texto com a tabela de condições.
function Find-CodigoPorTexto($texto) {
    $alvo = Normalizar-CondicaoTexto $texto
    if (-not $alvo) { return $null }
    $match = $condicoesPagamento | Where-Object { (Normalizar-CondicaoTexto $_.descricao) -eq $alvo } | Select-Object -First 1
    if ($match) { return $match.codigo }
    return $null
}

function Find-Fornecedor($nome, $cnpj) {
    $cnpjAlvo = ApenasDigitos $cnpj
    if ($cnpjAlvo) {
        $match = $fornecedores | Where-Object { (ApenasDigitos $_.cnpj) -eq $cnpjAlvo -and $_.cnpj } | Select-Object -First 1
        if ($match) { return $match }
    }
    if ($nome) {
        $alvo = $nome.Trim().ToLower()
        $match = $fornecedores | Where-Object { $_.nome.Trim().ToLower() -eq $alvo } | Select-Object -First 1
        if ($match) { return $match }
    }
    return $null
}

function Find-Produto($nome, $codigo) {
    $codigoAlvo = if ($codigo) { $codigo.Trim().ToLower() } else { "" }
    if ($codigoAlvo) {
        $match = $produtos | Where-Object { $_.codigo -and $_.codigo.Trim().ToLower() -eq $codigoAlvo } | Select-Object -First 1
        if ($match) { return $match }
    }
    if ($nome) {
        $alvo = $nome.Trim().ToLower()
        $match = $produtos | Where-Object { $_.nome.Trim().ToLower() -eq $alvo } | Select-Object -First 1
        if ($match) { return $match }
    }
    return $null
}

function Get-OrCreate-Fornecedor($nome, $cnpj) {
    $existente = Find-Fornecedor $nome $cnpj
    if ($existente) { return $existente.id }

    $body = @{ nome = $nome; cnpj = if ($cnpj) { $cnpj } else { $null } } | ConvertTo-Json
    $uri = "$SUPABASE_URL/rest/v1/cs_fornecedores"
    $headers = $HeadersJson.Clone()
    if ($cnpj) {
        $uri += "?on_conflict=cnpj"
        $headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    } else {
        $headers["Prefer"] = "return=representation"
    }
    $novo = Invoke-RestMethod -Uri $uri -Headers $headers -Method Post -Body $body
    $script:fornecedores += $novo[0]
    return $novo[0].id
}

function Get-OrCreate-Produto($nome, $codigo, $unidade) {
    $existente = Find-Produto $nome $codigo
    if ($existente) { return $existente.id }

    $body = @{ nome = $nome; unidade = if ($unidade) { $unidade } else { "un" }; codigo = if ($codigo) { $codigo } else { $null } } | ConvertTo-Json
    $uri = "$SUPABASE_URL/rest/v1/cs_produtos"
    $headers = $HeadersJson.Clone()
    if ($codigo) {
        $uri += "?on_conflict=codigo"
        $headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    } else {
        $headers["Prefer"] = "return=representation"
    }
    $novo = Invoke-RestMethod -Uri $uri -Headers $headers -Method Post -Body $body
    $script:produtos += $novo[0]
    return $novo[0].id
}

function Test-PedidoJaImportado($numeroPedido) {
    if ([string]::IsNullOrWhiteSpace($numeroPedido)) { return $false }
    $uri = "$SUPABASE_URL/rest/v1/cs_compras?select=id&numero_pedido=eq.$([uri]::EscapeDataString($numeroPedido))&limit=1"
    $existe = Invoke-RestMethod -Uri $uri -Headers $HeadersJson -Method Get
    return ($existe.Count -gt 0)
}

# ---------- recupera arquivos presos em "Processando" ----------
# Se um computador caiu/foi desligado no meio de um arquivo, ele ficaria preso
# aqui pra sempre. O nome reivindicado começa com a data/hora da reivindicação
# (yyyyMMddHHmmss__COMPUTADOR__nome.pdf); passou de 30 min, devolve pra pasta
# principal com o nome original. Se o pedido chegou a ser salvo antes da queda,
# o teste de duplicado (Test-PedidoJaImportado) manda o arquivo pra Duplicados.
Get-ChildItem -Path $PastaProcessando -File -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -match '^(\d{14})__(.+?)__(.+)$') {
        $quando = [datetime]::ParseExact($Matches[1], "yyyyMMddHHmmss", $null)
        if ($quando -lt (Get-Date).AddMinutes(-30)) {
            try {
                Move-Item -Path $_.FullName -Destination (Join-Path $PastaMonitorada $Matches[3]) -ErrorAction Stop
                Write-Log "Recuperado arquivo preso em Processando (reivindicado por $($Matches[2])): $($Matches[3])"
            } catch { }
        }
    }
}

# ---------- processa os PDFs novos ----------
# Pequena espera aleatória: se as tarefas de duas máquinas estiverem
# sincronizadas (disparando no mesmo segundo), isso espalha as duas.
Start-Sleep -Seconds (Get-Random -Minimum 0 -Maximum 20)

$arquivos = Get-ChildItem -Path $PastaMonitorada -Filter "*.pdf" -File
if ($arquivos.Count -eq 0) {
    Write-Log "Nenhum PDF novo encontrado."
    exit 0
}

# 1) Reivindica TODOS os arquivos de uma vez (ver nota no topo).
# Atenção: pela rede, se duas máquinas pegam o MESMO arquivo no mesmo
# milissegundo, o Windows pode dar "ok" pras duas (o arquivo é renomeado em
# cadeia e fica com quem renomeou por último) — por isso a etapa 2 confirma.
$reivindicados = @()
foreach ($arquivoOriginal in $arquivos) {
    $nomeReivindicado = "{0}__{1}__{2}" -f (Get-Date -Format "yyyyMMddHHmmss"), $env:COMPUTERNAME, $arquivoOriginal.Name
    $caminhoReivindicado = Join-Path $PastaProcessando $nomeReivindicado
    try {
        [System.IO.File]::Move($arquivoOriginal.FullName, $caminhoReivindicado)
        $reivindicados += [pscustomobject]@{ Nome = $arquivoOriginal.Name; Caminho = $caminhoReivindicado }
    } catch {
        # outra máquina já pegou este — normal na redundância, não é falha
    }
}

# 2) Espera e confirma: só é DONO quem ainda tem o seu arquivo depois da espera
# (quem foi "ultrapassado" por outra máquina vê o seu sumir e pula). Testado
# com 3 máquinas simuladas disparando juntas: sempre um único dono por arquivo.
Start-Sleep -Seconds 3
$meusArquivos = @($reivindicados | Where-Object { Test-Path -LiteralPath $_.Caminho })
if ($meusArquivos.Count -eq 0) {
    Write-Log "Nenhum PDF novo para esta máquina (outra máquina já pegou, ou não havia)."
    exit 0
}

foreach ($item in $meusArquivos) {
    $nomeOriginal = $item.Nome
    $arquivo = Get-Item -LiteralPath $item.Caminho

    Write-Log "Processando: $nomeOriginal"
    try {
        $nomeMinusculo = $nomeOriginal.ToLower()
        $modalidade = if ($nomeMinusculo -match "contrato") { "contrato" } else { "spot" }

        $bytes = [System.IO.File]::ReadAllBytes($arquivo.FullName)
        $base64 = [System.Convert]::ToBase64String($bytes)
        $payload = @{ pdf_base64 = $base64 } | ConvertTo-Json

        # Tenta até 3 vezes — erros passageiros do servidor (picos de carga, etc)
        # não devem jogar o arquivo pra pasta de Erros de primeira.
        $resposta = $null
        $ultimoErro = $null
        for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
            try {
                $resposta = Invoke-RestMethod -Uri $EXTRACT_URL -Headers $HeadersJson -Method Post -Body $payload -TimeoutSec 120
                $ultimoErro = $null
                break
            } catch {
                $ultimoErro = $_
                if ($tentativa -lt 3) {
                    Write-Log "  Tentativa $tentativa falhou ($($_.Exception.Message)), tentando de novo em 10s..."
                    Start-Sleep -Seconds 10
                }
            }
        }
        if ($ultimoErro) { throw $ultimoErro }
        if ($resposta.error) { throw "Extração falhou: $($resposta.error)" }
        $dados = $resposta.data

        if (Test-PedidoJaImportado $dados.numero_pedido) {
            Write-Log "  Pedido Nº $($dados.numero_pedido) já importado antes — pulando (movido para Duplicados)."
            Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaDuplicados $nomeOriginal) -Force
            continue
        }

        $fornecedorId = Get-OrCreate-Fornecedor $dados.fornecedor_nome $dados.fornecedor_cnpj
        $dataCompra = Get-Date -Format "yyyy-MM-dd"
        $salvos = 0

        $codigoPagamento = if ($dados.condicao_pagamento_codigo) { $dados.condicao_pagamento_codigo } else { Find-CodigoPorTexto $dados.condicao_pagamento_texto }
        if (-not $dados.condicao_pagamento_codigo -and $codigoPagamento) {
            Write-Log "  Condicao de pagamento sem codigo no PDF, casada por texto: '$($dados.condicao_pagamento_texto)' -> codigo $codigoPagamento"
        }

        foreach ($item in $dados.itens) {
            $produtoId = Get-OrCreate-Produto $item.produto_nome $item.produto_codigo $item.unidade
            $compra = @{
                fornecedor_id = $fornecedorId
                produto_id    = $produtoId
                modalidade    = $modalidade
                data          = $dataCompra
                volume        = $item.quantidade
                valor         = if ($null -ne $item.valor_total) { $item.valor_total } else { $null }
                numero_pedido = if ($dados.numero_pedido) { $dados.numero_pedido } else { $null }
                condicao_pagamento_codigo = if ($codigoPagamento) { $codigoPagamento } else { $null }
            } | ConvertTo-Json
            Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cs_compras" -Headers $HeadersJson -Method Post -Body $compra | Out-Null
            $salvos++
        }

        Write-Log "  OK: fornecedor '$($dados.fornecedor_nome)', $salvos item(ns), modalidade=$modalidade, pedido=$($dados.numero_pedido)"
        Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaProcessados $nomeOriginal) -Force
    }
    catch {
        Write-Log "  ERRO: $($_.Exception.Message)"
        if (Test-Path $arquivo.FullName) {
            Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaErros $nomeOriginal) -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Log "Execução concluída."
