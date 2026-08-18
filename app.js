// Edge Function: extract-pedido
//
// Recebe um PDF de pedido de compra (base64) e usa a API da Anthropic
// (Claude Sonnet 5) para extrair o fornecedor e os itens (produto,
// quantidade, unidade, valor). Roda no servidor para manter a chave da API
// da Anthropic secreta — nunca é exposta ao navegador.
//
// Configuração necessária antes de usar:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (ou via Supabase Dashboard → Edge Functions → extract-pedido → Secrets)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    fornecedor_nome: {
      type: "string",
      description:
        "APENAS o nome/razão social do FORNECEDOR/VENDEDOR — a empresa que está VENDENDO/FORNECENDO os produtos ou serviços listados. " +
        "NUNCA é a empresa que emitiu o pedido de compra (a compradora) — essa deve ser ignorada. " +
        "O fornecedor costuma aparecer perto de rótulos como 'Fornecedor', 'Vendedor', 'Razão Social do Fornecedor' ou 'Favorecido'. " +
        "IMPORTANTE: não inclua o rótulo do campo no valor (ex: se o documento diz 'Razão Social: XPTO LTDA', o valor deve ser apenas 'XPTO LTDA', sem o prefixo 'Razão Social:').",
    },
    fornecedor_cnpj: {
      type: "string",
      description:
        "CNPJ do FORNECEDOR/VENDEDOR — NUNCA o CNPJ da empresa compradora/emissora do pedido. " +
        "ATENÇÃO: o documento normalmente tem DOIS números de CNPJ, um pra cada empresa (comprador e vendedor), às vezes em posições " +
        "que confundem (um deles pode aparecer sozinho numa linha, longe do nome da empresa a que pertence). Antes de escolher, " +
        "confirme a qual das duas empresas cada CNPJ pertence pelo contexto ao redor (endereço, IE, bairro), não apenas pela posição " +
        "na página. Se houver dúvida real sobre qual CNPJ é do fornecedor, prefira omitir a preencher com o CNPJ errado.",
    },
    numero_pedido: {
      type: "string",
      description:
        "Número/código identificador deste pedido de compra específico (não é o código de um produto). Costuma aparecer perto de " +
        "rótulos como 'Pedido de Compras Nº', 'Nº do Pedido', 'Pedido Nº', 'N° Pedido' ou similar, geralmente no topo do documento. " +
        "Omita se não encontrar um número que identifique claramente o pedido como um todo.",
    },
    itens: {
      type: "array",
      description: "Cada linha de item/produto do pedido — inclua TODAS as linhas da tabela de itens, mesmo que sejam muitas.",
      items: {
        type: "object",
        properties: {
          produto_nome: { type: "string", description: "Nome do produto ou item" },
          produto_codigo: {
            type: "string",
            description:
              "Código/SKU/referência/item do produto. Procure com atenção uma coluna como 'Código', 'Cód.', 'Ref.', 'SKU' ou 'Item' " +
              "na tabela de itens — costuma existir mesmo em pedidos com muitas linhas. Omita apenas se realmente não houver essa coluna no documento.",
          },
          quantidade: { type: "number", description: "Quantidade numérica do item" },
          unidade: { type: "string", description: "Unidade de medida (ex: saca, kg, ton, un)" },
          valor_total: {
            type: "number",
            description:
              "Valor total em R$ desta linha (coluna 'Valor Total', ou 'Valor Unitário' × quantidade se só houver o unitário). " +
              "Use apenas números (sem 'R$', sem separador de milhar) — ex: 45390.00, não '45.390,00'. Omita se não encontrar valor pra essa linha.",
          },
        },
        required: ["produto_nome", "quantidade", "unidade"],
        additionalProperties: false,
      },
    },
  },
  required: ["fornecedor_nome", "itens"],
  additionalProperties: false,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { pdf_base64 } = await req.json();
    if (!pdf_base64 || typeof pdf_base64 !== "string") {
      return jsonResponse({ error: "Campo pdf_base64 ausente ou inválido." }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY não configurada no servidor." }, 500);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdf_base64 },
              },
              {
                type: "text",
                text:
                  "Extraia os dados deste pedido de compra. Atenção a dois pontos importantes:\n\n" +
                  "1) FORNECEDOR: este documento tem DUAS empresas — a que EMITE o pedido (compradora, é a dona do sistema/pedido, " +
                  "costuma aparecer como 'Empresa:') e a que vai VENDER/ENTREGAR a mercadoria (a fornecedora de verdade, costuma " +
                  "aparecer como 'Razão Social:', 'Fornecedor:' ou 'Favorecido:'). Extraia sempre a fornecedora/vendedora, NUNCA a " +
                  "empresa que emitiu/está comprando. Isso vale tanto pro NOME quanto pro CNPJ — o documento tem dois CNPJs (um de " +
                  "cada empresa), às vezes um deles aparece sozinho numa linha sem o nome da empresa do lado. Confirme pelo endereço/IE " +
                  "ao redor a qual empresa cada CNPJ pertence antes de escolher o do fornecedor.\n\n" +
                  "2) CÓDIGO DO PRODUTO: a tabela de itens muitas vezes tem uma coluna chamada 'Produto' (ou 'Item', 'Cód. Produto') que " +
                  "na verdade contém um CÓDIGO NUMÉRICO, e uma coluna separada 'Descrição' com o nome real do item. Nesse caso, use o " +
                  "valor da coluna numérica como produto_codigo e o texto da coluna 'Descrição' como produto_nome — não deixe de extrair " +
                  "o código só porque a coluna não se chama literalmente 'Código'.\n\n" +
                  "3) PRECISÃO: este documento pode ter fonte pequena/densa. Leia cada código numérico e cada linha da tabela com " +
                  "muito cuidado, dígito por dígito — não invente nem aproxime números. Cada linha da tabela é um item diferente; " +
                  "não misture o texto ou o código de uma linha com o de outra. Se não conseguir ler algum dígito com certeza, é " +
                  "melhor omitir o produto_codigo daquele item do que arriscar um valor errado.\n\n" +
                  "4) VALOR: se a tabela tiver uma coluna de valor (ex: 'Valor Total', 'Total', 'Vl. Total'), extraia o valor_total " +
                  "de cada linha. Se só houver 'Valor Unitário', multiplique pela quantidade da linha. Sempre em números puros, sem " +
                  "'R$' e sem separador de milhar (ex: 45390.00). Se a linha realmente não tiver nenhum valor no documento, omita o campo.",
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return jsonResponse({ error: data?.error?.message || "Erro ao chamar a API da Anthropic." }, 502);
    }

    if (data.stop_reason === "refusal") {
      return jsonResponse({ error: "O modelo recusou processar este documento." }, 422);
    }

    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) {
      return jsonResponse({ error: "Resposta inesperada do modelo (sem texto)." }, 502);
    }

    const extraido = JSON.parse(textBlock.text);
    return jsonResponse({ data: extraido }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro desconhecido." }, 500);
  }
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
