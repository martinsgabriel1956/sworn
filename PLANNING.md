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

| Camada         | Escolha                                                             | Por quê                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | **npm workspaces** (`cli`, `web`)                                   | Um `npm install` e um `npm run dev` na raiz                                                                                                                 |
| Servidor       | **Node 22 + TypeScript + Fastify** + `@fastify/static`              | Igual ao Patchbay                                                                                                                                           |
| Execução HTTP  | **`undici`**                                                        | Headers crus, redirect manual, sem descompressão automática. Dá para copiar o executor do Patchbay                                                          |
| Spec           | **`@apidevtools/json-schema-ref-parser`** (só `bundle`, já lê YAML) | Junta `$ref` externos num documento só, **sem** desreferenciar tudo (ver seção 4)                                                                           |
| Validação      | **Ajv** (`ajv/dist/2020`) + conversor 3.0 → JSON Schema próprio     | Padrão de mercado. A conversão (`nullable`, `exclusiveMinimum` booleano) é pequena; a lib pronta traz yargs, lodash e openapi-typescript                    |
| Live reload    | **`fs.watch`** + **SSE**                                            | Nativos do Node; sem chokidar nem WebSocket                                                                                                                 |
| Web            | **React + Vite + TypeScript**                                       | SPA, sem SSR                                                                                                                                                |
| UI             | **Tailwind** e `<dialog>` nativo (diálogos e o Cmd+K)               | O shadcn/ui ficou de fora: o que a V1 precisa (diálogo, abas, combobox da busca) coube em poucas linhas sobre o elemento nativo                             |
| Estado         | **Zustand**                                                         | Operação aberta, ambiente ativo, request em edição                                                                                                          |
| Editor de body | **CodeMirror 6** (só `lang-json` e `lint`, sem o `basicSetup`)      | Realce e erro de sintaxe. A validação contra o schema usa o mesmo Ajv da resposta (etapa 4): o `codemirror-json-schema` traz shiki e markdown-it, vários MB |
| Listas longas  | **`@tanstack/react-virtual`**                                       | Navegação com milhares de operações                                                                                                                         |
| Lint/format    | **Biome**                                                           | Igual ao Patchbay                                                                                                                                           |
| Testes         | **Vitest**                                                          | Idem                                                                                                                                                        |

**Escrito à mão em vez de lib:**
- **Gerador de exemplos** (~100 linhas): determinístico, para os snippets não mudarem a cada render. O `json-schema-faker` é pesado e aleatório.
- **Snippets** (curl, fetch, Python): três templates. Adotar `httpsnippet-lite` na V2, quando entrarem mais linguagens.
- **Executor HTTP** (`cli/src/proxy.ts`): o do Patchbay reduzido (redirect sem vazar credencial, descompressão, limite de 5 MB, timeout de 30s), sem cookie jar, proxy e certificados.

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

| Rota                         | O que faz                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /`                      | Serve a UI (`dist/web`) com o token de sessão embutido no HTML                                                   |
| `GET /__sworn/spec`          | Spec com os refs externos já juntados, mais metadados (caminho, versão OpenAPI, erro de parse)                   |
| `GET /__sworn/events`        | SSE: `spec-changed`, `spec-error`                                                                                |
| `POST /__sworn/send`         | Recebe `{method, url, headers, body}` já interpolados, executa e devolve `{status, headers, body, timing, size}` |
| `GET/PUT /__sworn/workspace` | Lê e grava ambientes, segredos, ambiente ativo e auth global                                                     |
| `GET/POST /__sworn/history`  | Lista e grava o histórico                                                                                        |

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

**Como o Ajv enxerga a spec:** o documento inteiro entra no Ajv como um schema só (`addSchema(doc, "doc")`), e cada validação compila o trecho pelo ponteiro (`doc#/paths/~1pets/get/responses/200/content/application~1json/schema`). Os `$ref` internos e a recursão funcionam sem reescrever nada. Specs 3.0 passam antes por um conversor próprio (`from30`: `nullable` e `exclusiveMinimum/Maximum` booleanos).

**Campo não documentado:** o schema da maioria das specs não declara `additionalProperties`, então o Ajv aceita campo extra calado. A ideia inicial (`unevaluatedProperties: false` numa cópia do schema) quebra a herança por `allOf` com `$ref`: o mesmo schema `NewPet` usado dentro de `Pet` passaria a recusar o `id` do outro membro. Por isso é um passeio próprio pelo dado junto com o schema, que entende `allOf`, discriminator e `$ref`. Sem discriminator, um `oneOf` aceita a união dos campos das variantes (menos falso positivo).

**oneOf/anyOf:** o Ajv reporta o erro de cada ramo, quase sempre ruído. Com discriminator, o Sworn valida só contra o ramo escolhido (erros precisos) ou aponta o valor que não casa com nenhum. "X ou null" (nullable) mostra os erros de X. Sem discriminator, fica uma mensagem só.

Os trechos compilados ficam em cache dentro de um validador por versão da spec (`WeakMap` pelo documento): a recarga troca o documento e o cache vai junto.

Na UI, as issues aparecem de duas formas: como marcação no body (linter do CodeMirror, com o `path` convertido em trecho pela árvore de sintaxe do JSON) e como uma lista acima do body. Uma resposta sem issues mostra um selo discreto de "Conforme a spec". O body da request é validado do mesmo jeito enquanto se digita.

A `Issue` já é o formato que o relatório de drift da V2 vai acumular: na V2 basta gravar a lista no histórico.

---

## 7. Arquivos do usuário: `.sworn/`

Fica na pasta da spec (com spec por URL, na pasta atual). Nada é criado só por abrir a doc: as pastas aparecem no primeiro save de ambiente, auth ou histórico.

```
.sworn/
  .gitignore          # contém "local/", criado pelo próprio Sworn
  env/
    dev.json          # { "baseUrl": "http://localhost:3000" } → versionado, compartilhado com o time
    staging.json
  local/              # nunca vai para o git
    secrets.json      # { "dev": { "token": "..." } }
    state.json        # ambiente ativo e auth global
    history.jsonl     # uma request por linha; mantém as últimas 500
```

- Variáveis no formato `{{nome}}`. Um segredo sobrescreve a variável de mesmo nome do ambiente.
- A URL base é a variável `baseUrl` do ambiente ativo; sem ela, o primeiro `servers[].url` da spec. Por isso funciona sem configuração e sem criar arquivo.
- Operação com `security: []` na spec é pública: vai sem a auth global.
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
