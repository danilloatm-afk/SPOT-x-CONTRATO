# backfill-condicao-pagamento.ps1
#
# Reprocessa os PDFs já importados (pasta Processados) só pra extrair o
# código da condição de pagamento e o número do pedido, e atualiza as
# compras já existentes (por numero_pedido) sem duplicar nada. Não mexe em
# fornecedor/produto/itens/valor — esses já estão certos.

$ErrorActionPreference = "Continue"

$PastaProcessados = "\\192.168.0.228\wehrmann\COMPRAS\ORDENS DE COMPRA\Processados"
$SUPABASE_URL = "https://jvfyqvefznkpcvjaerta.supabase.co"
$SUPABASE_KEY = "sb_publishable_4fZ0DlFJq1ec5xTXurwGSQ_Ke3JELGZ"
$EXTRACT_URL = "$SUPABASE_URL/functions/v1/cs-extract-pedido"
$LogFile = Join-Path $PastaProcessados "..\backfill_condicao_pagamento_log.txt"

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

$arquivos = Get-ChildItem -Path $PastaProcessados -Filter "*.pdf" -File
Write-Log "Iniciando backfill de condicao de pagamento em $($arquivos.Count) PDFs."

$ok = 0
$semPedido = 0
$semCodigo = 0
$erros = 0

foreach ($arquivo in $arquivos) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($arquivo.FullName)
        $base64 = [System.Convert]::ToBase64String($bytes)
        $payload = @{ pdf_base64 = $base64 } | ConvertTo-Json

        $resposta = $null
        $ultimoErro = $null
        for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
            try {
                $resposta = Invoke-RestMethod -Uri $EXTRACT_URL -Headers $HeadersJson -Method Post -Body $payload -TimeoutSec 150
                $ultimoErro = $null
                break
            } catch {
                $ultimoErro = $_
                if ($tentativa -lt 3) { Start-Sleep -Seconds 10 }
            }
        }
        if ($ultimoErro) { throw $ultimoErro }
        if ($resposta.error) { throw "Extracao falhou: $($resposta.error)" }
        $dados = $resposta.data

        if (-not $dados.numero_pedido) {
            Write-Log "  SEM NUMERO DE PEDIDO: $($arquivo.Name) - pulando (nao da pra saber qual compra atualizar)"
            $semPedido++
            continue
        }
        if (-not $dados.condicao_pagamento_codigo) {
            Write-Log "  SEM CODIGO: $($arquivo.Name) (pedido $($dados.numero_pedido)) - PDF nao tem condicao de pagamento identificavel"
            $semCodigo++
            continue
        }

        $uriUpdate = "$SUPABASE_URL/rest/v1/cs_compras?numero_pedido=eq.$([uri]::EscapeDataString($dados.numero_pedido))"
        $body = @{ condicao_pagamento_codigo = $dados.condicao_pagamento_codigo } | ConvertTo-Json
        Invoke-RestMethod -Uri $uriUpdate -Headers $HeadersJson -Method Patch -Body $body | Out-Null
        Write-Log "  OK: $($arquivo.Name) - pedido $($dados.numero_pedido) -> codigo $($dados.condicao_pagamento_codigo)"
        $ok++
    }
    catch {
        Write-Log "  ERRO: $($arquivo.Name) - $($_.Exception.Message)"
        $erros++
    }
}

Write-Log "Backfill concluido. OK=$ok, sem pedido=$semPedido, sem codigo=$semCodigo, erros=$erros, total=$($arquivos.Count)"
