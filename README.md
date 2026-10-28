# Sworn

Documentação OpenAPI que roda local e **confere cada resposta real contra a spec**.

Você abre a doc, envia uma request, e o Sworn diz se a API cumpriu o que a spec promete: tipo errado, campo obrigatório faltando, campo que não está documentado, status ou Content-Type fora da spec. Cada problema aparece marcado no lugar exato do body.

```bash
npx @sworn/cli                       # procura openapi.yaml, openapi.yml ou openapi.json na pasta atual
npx @sworn/cli api/openapi.yaml
npx @sworn/cli http://localhost:3000/openapi.json
```

Ou instalado, para usar o comando `sworn` direto:

```bash
npm install -g @sworn/cli
sworn api/openapi.yaml
```

Requer Node 22 ou mais novo. Aceita OpenAPI 3.0 e 3.1.

## O que tem

- **Validação da resposta** contra o schema, com mensagens em português e marcações no body. O body da request também é validado enquanto você digita.
- **Drift acumulado** (`#/drift`): onde as respostas reais divergiram da spec nas últimas 500 requests, por operação e campo, exportável em Markdown.
- **Cliente embutido**: formulário de parâmetros, editor de body, auth global (Bearer, Basic, API key) e histórico por operação.
- **Sem CORS e sem servidor de terceiros**: as requests passam por um proxy que roda na sua máquina.
- **Ambientes versionáveis**: variáveis em arquivo no repositório, segredos fora do git.
- **Exemplos realistas** gerados do schema quando a spec não traz exemplo.
- **Snippets** em curl, fetch e Python. Os segredos ficam como `{{nome}}`.
- **Busca Ctrl+K** por método, path, resumo e nome de campo.
- **Recarrega sozinho** quando a spec muda no disco, inclusive arquivos referenciados por `$ref`.
- **Rápido com specs grandes**: 2 mil operações prontas em cerca de 150 ms.

## Opções

```
sworn [spec] [opções]

  -p, --port      porta do servidor (padrão: 4000, ou outra livre se ocupada)
      --no-open   não abre o browser
  -h, --help      mostra a ajuda
```

## Arquivos em `.sworn/`

Ficam ao lado da spec e só são criados no primeiro save.

```
.sworn/
  .gitignore          # "local/"
  env/dev.json        # variáveis do ambiente, versionadas: { "baseUrl": "http://localhost:3000" }
  local/              # só nesta máquina
    secrets.json      # segredos por ambiente
    state.json        # ambiente ativo e auth
    history.jsonl     # últimas 500 requests, com a conferência de cada uma (drift)
```

Use `{{nome}}` em parâmetros, body e auth. A variável `baseUrl` substitui o server da spec. O histórico guarda a request antes de trocar as variáveis, então nenhum segredo vai para o arquivo.

## Segurança

O servidor escuta só em `127.0.0.1`, exige um token gerado a cada execução e recusa requests com `Host` externo. Sem isso, qualquer site aberto no browser poderia usar o proxy do Sworn para alcançar a sua rede interna.

## Desenvolvimento

```bash
npm install
npm run dev               # cli + Vite com a spec de exemplo (cli/test/fixtures/petstore.yaml)
npm run dev caminho.yaml  # com outra spec
npm test
npm run build             # web/dist + cli/dist
```

`ROADMAP.md` tem as versões planejadas e `PLANNING.md` a arquitetura.
