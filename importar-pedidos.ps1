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
# CONFIGURAÇÃO: ajuste $PastaMonitorada abaixo para o caminho real da sua
# pasta de rede. Depois, agende esse script no Agendador de Tarefas do
# Windows pra rodar a cada 15-30 minutos (veja instruções no chat).

$ErrorActionPreference = "Stop"

# ---------- CONFIGURAÇÃO — ajuste aqui ----------
$PastaMonitorada = "\\192.168.0.228\wehrmann\COMPRAS\ORDENS DE COMPRA"
# --------------------------------------------------

$SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co"
$SUPABASE_KEY = "sb_publishable_4fZ0DlFJq1ec5xTXurwGSQ_Ke3JELGZ"
$EXTRACT_URL = "$SUPABASE_URL/functions/v1/rapid-action"

$PastaProcessados = Join-Path $PastaMonitorada "Processados"
$PastaDuplicados = Join-Path $PastaMonitorada "Duplicados"
$PastaErros = Join-Path $PastaMonitorada "Erros"
$LogFile = Join-Path $PastaMonitorada "importacao_log.txt"

foreach ($p in @($PastaProcessados, $PastaDuplicados, $PastaErros)) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Write-Log($mensagem) {
    $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $mensagem"
    Add-Content -Path $LogFile -Value $linha -Encoding utf8
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

$fornecedores = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cs_fornecedores?select=id,nome,cnpj,ativo&ativo=eq.true" -Headers $HeadersJson -Method Get
$produtos = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cs_produtos?select=id,nome,unidade,codigo,ativo&ativo=eq.true" -Headers $HeadersJson -Method Get

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

# ---------- processa os PDFs novos ----------
$arquivos = Get-ChildItem -Path $PastaMonitorada -Filter "*.pdf" -File
if ($arquivos.Count -eq 0) {
    Write-Log "Nenhum PDF novo encontrado."
    exit 0
}

foreach ($arquivo in $arquivos) {
    Write-Log "Processando: $($arquivo.Name)"
    try {
        $nomeMinusculo = $arquivo.Name.ToLower()
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
            Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaDuplicados $arquivo.Name) -Force
            continue
        }

        $fornecedorId = Get-OrCreate-Fornecedor $dados.fornecedor_nome $dados.fornecedor_cnpj
        $dataCompra = Get-Date -Format "yyyy-MM-dd"
        $salvos = 0

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
                condicao_pagamento_codigo = if ($dados.condicao_pagamento_codigo) { $dados.condicao_pagamento_codigo } else { $null }
            } | ConvertTo-Json
            Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/cs_compras" -Headers $HeadersJson -Method Post -Body $compra | Out-Null
            $salvos++
        }

        Write-Log "  OK: fornecedor '$($dados.fornecedor_nome)', $salvos item(ns), modalidade=$modalidade, pedido=$($dados.numero_pedido)"
        Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaProcessados $arquivo.Name) -Force
    }
    catch {
        Write-Log "  ERRO: $($_.Exception.Message)"
        Move-Item -Path $arquivo.FullName -Destination (Join-Path $PastaErros $arquivo.Name) -Force
    }
}

Write-Log "Execução concluída."
