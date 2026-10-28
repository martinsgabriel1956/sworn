# Sworn — Planejamento da V1

Documentação OpenAPI local que valida cada resposta real contra o schema. Escopo e versões futuras em `ROADMAP.md`.
Princípio: **local-first, zero config, nenhum byte passa por servidor de terceiros.**

É um **CLI** que sobe um servidor local e abre a doc no browser:

```
npx sworn                      # procura openapi.{yaml,yml,json} na pasta atual
npx sworn api/openapi.yaml
npx sworn https://exemplo.com/openapi.json --port 4000
```

Dois pacotes em npm workspaces, publicados como **um** pacote npm:
- **`cli/`**: Node. Lê a spec, observa o arquivo, serve a UI e faz o proxy das requests. É o pacote publicado.
- **`web/`**: React. Renderiza a doc e o cliente. O build vai para dentro de `cli/dist/web/`.

---

## 1. Por que existe um servidor

A UI no browser sofre as mesmas limitações que tornam o try-it do Swagger UI frustrante:
- **CORS**: a API do usuário quase nunca libera a origem da doc.
- **Headers proibidos**: o browser não deixa definir `Cookie`, `Host`, `Origin` e outros.
- **Disco**: o browser não lê a spec nem grava ambientes e histórico em arquivo.

O servidor local resolve os três sem mandar tráfego para terceiros, que é o ponto fraco do proxy do Scalar.

**Regras:**
- O `cli/` só transporta bytes e mexe em arquivos. A lógica de produto fica no `web/`.
- Exceção: a lógica **pura** (validação da resposta, geração de exemplos, interpolação de variáveis, snippets) mora em `cli/src/core/`, sem React nem Node, e o `web/` importa de lá. Os middlewares da V2 e o `sworn check` da V3 reaproveitam esse código sem reescrever.

---

## 2. Stack

Mesma base do Patchbay (`../http-client`), para aproveitar costume e código.

| Camada         | Escolha                                                                                     | Por quê                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Monorepo       | **npm workspaces** (`cli`, `web`)                                                           | Um `npm install` e um `npm run dev` na raiz                                                        |
| Servidor       | **Node 22 + TypeScript + Fastify** + `@fastify/static`                                      | Igual ao Patchbay                                                                                  |
| Execução HTTP  | **`undici`**                                                                                | Headers crus, redirect manual, sem descompressão automática. Dá para copiar o executor do Patchbay |
| Spec           | **`@apidevtools/json-schema-ref-parser`** (só `bundle`, já lê YAML)                         | Junta `$ref` externos num documento só, **sem** desreferenciar tudo (ver seção 4)                  |
| Validação      | **Ajv** (`ajv/dist/2020`) + `@openapi-contrib/openapi-schema-to-json-schema` para specs 3.0 | Padrão de mercado. A conversão trata `nullable`, `exclusiveMinimum` booleano etc.                  |
| Live reload    | **`fs.watch`** + **SSE**                                                                    | Nativos do Node; sem chokidar nem WebSocket                                                        |
| Web            | **React + Vite + TypeScript**                                                               | SPA, sem SSR                                                                                       |
| UI             | **Tailwind + shadcn/ui** (o `Command` do shadcn faz o Cmd+K)                                | Igual aos outros projetos                                                                          |
| Estado         | **Zustand**                                                                                 | Operação aberta, ambiente ativo, request em edição                                                 |
| Editor de body | **CodeMirror 6** + `codemirror-json-schema`                                                 | Validação e autocomplete a partir do schema da operação                                            |
| Listas longas  | **`@tanstack/react-virtual`**                                                               | Navegação com milhares de operações                                                                |
| Lint/format    | **Biome**                                                                                   | Igual ao Patchbay                                                                                  |
| Testes         | **Vitest**                                                                                  | Idem                                                                                               |

**Escrito à mão em vez de lib:**
- **Gerador de exemplos** (~100 linhas): determinístico, para os snippets não mudarem a cada render. O `json-schema-faker` é pesado e aleatório.
- **Snippets** (curl, fetch, Python): três templates. Adotar `httpsnippet-lite` na V2, quando entrarem mais linguagens.

Sem banco, sem conta, sem Tauri: é um processo que vive enquanto o terminal está aberto.

---

## 3. Estrutura

```
sworn/
  package.json              # workspaces + scripts "dev", "build", "test"
  biome.json
  cli/
    package.json            # o pacote publicado; bin "sworn"
    src/
      main.ts               # argumentos, acha a spec, sobe o servidor, abre o browser
      server.ts             # rotas Fastify (seção 5)
      spec.ts               # carrega, faz bundle e observa a spec
      proxy.ts              # executa a request com undici
      store.ts              # lê e grava .sworn/ (ambientes, segredos, histórico, auth)
      core/                 # lógica pura, importada também pelo web/
        validate.ts         # resposta x schema → lista de issues
        examples.ts         # schema → exemplo realista
        interpolate.ts      # {{variavel}} → valor
        snippets.ts         # request → curl / fetch / Python
        refs.ts             # resolve $ref interno sob demanda, com detecção de ciclo
  web/
    src/
      features/
        nav/                # sidebar virtualizada, agrupada por tag
        operation/          # coluna central: descrição, parâmetros, schemas
        schema/             # visualizador de schema (oneOf como abas, colapsável)
        client/             # coluna direita: request editável + resposta + issues
        search/             # Cmd+K
        env/                # seletor e editor de ambientes, auth global
```

---

## 4. Fluxo da spec

1. O `cli/` lê o arquivo (ou baixa a URL) e faz o parse YAML/JSON.
2. `bundle()` junta os `$ref` **externos** num documento só. Os `$ref` **internos** (`#/components/...`) continuam como referência.
3. O documento vai inteiro para o `web/` uma vez. A cada mudança no arquivo, o `cli/` repete os passos 1 e 2 e avisa pelo SSE. O `web/` busca de novo e mantém a operação aberta.
4. O `web/` só resolve um `$ref` quando aquele trecho aparece na tela (`core/refs.ts`).

**Por que não desreferenciar tudo de uma vez:** schemas recursivos (árvore, comentário com respostas) viram um ciclo infinito, e specs grandes multiplicam de tamanho. Resolver sob demanda é o que segura a meta de 2 mil operações em menos de 1s.

**Spec por URL:** sem watch. A UI mostra um botão de recarregar.

**Erro na spec:** a UI continua de pé, mostra o erro com arquivo e linha, e volta sozinha quando o arquivo é corrigido. Nunca derruba o servidor.

---

## 5. Rotas do `cli/`

Todas sob `/__sworn/`, para não colidir com nada.

| Rota                        | O que faz                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /`                     | Serve a UI (`dist/web`) com o token de sessão embutido no HTML                                                   |
| `GET /__sworn/spec`         | Spec com os refs externos já juntados, mais metadados (caminho, versão OpenAPI, erro de parse)                   |
| `GET /__sworn/events`       | SSE: `spec-changed`, `spec-error`                                                                                |
| `POST /__sworn/send`        | Recebe `{method, url, headers, body}` já interpolados, executa e devolve `{status, headers, body, timing, size}` |
| `GET/PUT /__sworn/env`      | Lê e grava ambientes e segredos                                                                                  |
| `GET/POST /__sworn/history` | Lista e grava o histórico                                                                                        |

### Segurança do proxy (fronteira de confiança)

Um proxy local que aceita qualquer URL é um **relay aberto**: qualquer site aberto no browser poderia mandar `POST localhost:PORT/__sworn/send` e usar o Sworn para atacar a rede interna (CSRF → SSRF). Por isso:
- O servidor escuta **só em `127.0.0.1`**.
- Na subida, gera um **token aleatório**, embute no HTML servido e exige esse token no header `x-sworn-token` de toda rota `/__sworn/*`. Outros sites não conseguem ler o HTML (same-origin), então não têm o token.
- Recusa requests com header `Host` diferente de `127.0.0.1:PORT` ou `localhost:PORT`, o que bloqueia DNS rebinding.

---

## 6. Validação da resposta (o diferencial)

Fica em `core/validate.ts`. Recebe a operação, o status, os headers e o body, e devolve uma lista de issues:

```ts
type Issue = {
  level: "error" | "warning";
  kind: "schema" | "undocumented-field" | "undocumented-status" | "content-type";
  path: string; // JSON Pointer no body, ex: "/data/0/email"
  message: string; // "esperado string, veio null"
};
```

| Situação                                                    | Nível   |
| ----------------------------------------------------------- | ------- |
| Body viola o schema (tipo, `required`, `enum`, `format`...) | error   |
| Status code não documentado (e não há `default`)            | error   |
| `Content-Type` fora dos documentados                        | error   |
| Campo presente na resposta e ausente no schema              | warning |

**Campo não documentado:** o schema da maioria das specs não declara `additionalProperties`, então o Ajv aceita campo extra calado. A validação roda duas vezes: uma com o schema original (gera os errors) e outra com uma cópia que recebe `unevaluatedProperties: false` nos objetos que não declaram `additionalProperties` (os erros dessa passada viram warnings).

Os validadores compilados ficam em cache por operação e status, e o cache é invalidado no reload da spec.

Na UI, as issues aparecem de duas formas: como marcação nas linhas do body da resposta (decoração do CodeMirror, pelo `path`) e como uma lista acima do body. Uma resposta sem issues mostra um selo discreto de "conforme a spec".

A `Issue` já é o formato que o relatório de drift da V2 vai acumular: na V2 basta gravar a lista no histórico.

---

## 7. Arquivos do usuário: `.sworn/`

Criada na pasta da spec no primeiro uso:

```
.sworn/
  .gitignore          # contém "local/", criado pelo próprio Sworn
  env/
    dev.json          # { "baseUrl": "http://localhost:3000" } → versionado, compartilhado com o time
    staging.json
  local/              # nunca vai para o git
    secrets.json      # { "dev": { "token": "..." } }
    auth.json         # auth global ativa
    history.jsonl     # uma request por linha; mantém as últimas 500
```

- Variáveis no formato `{{nome}}`. Um segredo sobrescreve a variável de mesmo nome do ambiente.
- Sem `.sworn/env/`, o Sworn cria `default.json` a partir do primeiro `servers[].url` da spec. Por isso funciona sem configuração.
- A interpolação acontece no `web/` (`core/interpolate.ts`) antes do `send`. O histórico guarda a request **antes** da interpolação, para nunca gravar segredo em claro.

---

## 8. Ordem de implementação

Cada etapa termina com algo usável:

1. **Esqueleto**: `cli/` sobe o Fastify, carrega a spec, serve um `web/` que lista as operações. SSE de reload funcionando.
2. **Leitura**: layout em 3 colunas, navegação virtualizada, página da operação, visualizador de schema, deep link.
3. **Cliente**: proxy com token, formulário de parâmetros, editor de body, ambientes, auth global, histórico.
4. **Validação**: `core/validate.ts` com as issues na resposta. É aqui que a tese se prova, então deve chegar cedo.
5. **Acabamento**: exemplos realistas, snippets, Cmd+K, dark mode.
6. **Performance e publicação**: medir com a spec de 2 mil operações, empacotar `web/` dentro de `cli/` e publicar no npm.

---

## 9. Testes

- **`core/`** é onde estão os bugs que importam, então tem cobertura de verdade: `validate` (3.0 com `nullable`, 3.1 com `type: [..., "null"]`, `oneOf` com discriminator, campo extra, status não documentado), `refs` (schema recursivo), `examples` (determinismo, `enum`, `format`), `interpolate`, `snippets`.
- **Fixtures** em `cli/test/fixtures/`: Petstore 3.0 e 3.1, uma spec com schema recursivo, uma spec com `$ref` externo e uma de 2 mil operações gerada por script, usada para medir a meta de performance.
- **Servidor**: testes do token, do bloqueio de `Host` e do `send` contra um servidor HTTP local de teste.

---

## 10. Decisões em aberto

- **Nome no npm**: `sworn` está ocupado. As opções são `swornapi` (livre) ou `@sworn/cli` (exige criar a org no npm). O comando continua `sworn` nos dois casos.
- **Código compartilhado com o Patchbay**: o executor HTTP é praticamente o mesmo. Na V1 é cópia. Extrair um pacote comum só se os dois começarem a divergir com bugs repetidos.
