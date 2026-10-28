# Sworn — Roadmap

Documentação de API (OpenAPI) que roda local, sem CORS, e **avisa quando a API diverge da própria spec**.

A V1 existe para provar uma tese só: uma doc que valida cada resposta real contra o schema é mais útil que uma doc bonita. Todo o resto entra no nível necessário para alguém trocar o Swagger UI ou o Scalar pelo Sworn.

Legenda: 🟢 copiado do que funciona nos concorrentes · 🔧 ataca um ponto fraco deles · ⭐ diferencial

---

## V1 — MVP

Formato: CLI (`npx sworn openapi.yaml`) que sobe um servidor local com a UI e um proxy próprio.

| #   | Funcionalidade                                                                                                                                      | Tipo            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Carrega OpenAPI **3.0/3.1** de arquivo ou URL, resolve `$ref` e faz **hot reload** quando o arquivo muda                                            | 🟢 + 🔧         |
| 2   | Layout em 3 colunas (navegação, descrição, request/resposta) + dark mode                                                                            | 🟢 Scalar       |
| 3   | Busca **Cmd+K** em paths, operationId, summary e campos de schema                                                                                   | 🟢 Scalar       |
| 4   | Deep link por operação                                                                                                                              | 🟢 Swagger      |
| 5   | Schema legível: aninhamento colapsável, `oneOf`/`anyOf`/discriminator como abas, `required`/`nullable` visíveis, schema e exemplo lado a lado       | 🔧 Swagger      |
| 6   | Try it **direto, sem clique extra**: parâmetros como formulário, body em editor JSON validado contra o schema, com autocomplete                     | 🔧 Swagger      |
| 7   | Auth global (Bearer, API Key, Basic) que **persiste** entre reloads                                                                                 | 🟢 Swagger + 🔧 |
| 8   | Snippets em curl, fetch e Python                                                                                                                    | 🟢 Scalar       |
| 9   | **Proxy local**: sem CORS e sem servidor de terceiros                                                                                               | 🔧 os dois      |
| 10  | Ambientes e variáveis **em arquivo no repo**, com segredos num arquivo separado e ignorado pelo git                                                 | 🔧 Scalar       |
| 11  | Histórico local de requests                                                                                                                         | 🟢 Scalar       |
| 12  | Performance: lista virtualizada e schema resolvido sob demanda                                                                                      | 🔧 os dois      |
| 13  | **Validação inline da resposta contra o schema**: tipo errado, obrigatório ausente, campo não documentado, status code ou content-type fora da spec | ⭐              |
| 14  | **Exemplos realistas** gerados do schema (`format`, `enum`, `min`/`max`), usados também para pré-preencher o body                                   | ⭐              |

**Fora da V1 de propósito:** OAuth2, Swagger 2.0, build estático, middlewares de framework, plugins, sincronização de time. Cada um atrasa o lançamento sem ajudar a provar a tese.

**A V1 está pronta quando:**
- `npx sworn` numa pasta com `openapi.yaml` abre a doc sem nenhuma configuração.
- Uma spec com 2 mil operações abre em menos de 1s.
- Uma resposta que viola o schema aparece destacada no primeiro uso, sem o usuário ter ligado nada.
- O autor usa o Sworn no lugar do Swagger UI nos próprios projetos.

---

## V2 — Adoção e confiança

| Funcionalidade                                                                                                                              | Tipo       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Relatório de drift acumulado**: junta as validações do uso diário ("`GET /users` divergiu 12 vezes, campo `email` veio `null`") e exporta | ⭐         |
| **Changelog na doc**: compara com um ref do git (`--since main`) e marca endpoints como novo, alterado ou breaking                          | ⭐         |
| OAuth2 (Authorization Code + PKCE, Client Credentials)                                                                                      | 🔧 Swagger |
| **Middlewares zero-config** (Express, Fastify, NestJS, FastAPI), com o proxy como rota do próprio app                                       | 🟢 Swagger |
| Swagger 2.0 via conversão automática                                                                                                        | 🟢         |
| Build estático (`sworn build` → HTML hospedável). Trade-off: sem o proxy, o try-it volta a depender de CORS                                 | 🟢         |
| Mais linguagens de snippet                                                                                                                  | 🟢 Scalar  |

---

## V3 — Plataforma de contrato

| Funcionalidade                                                                                    | Tipo       |
| ------------------------------------------------------------------------------------------------- | ---------- |
| **Fluxos Arazzo**: encadear requests (login → token → criar → usar o `id`), com editor e execução | ⭐         |
| `sworn check` no CI: roda os fluxos contra staging e falha quando há drift                        | ⭐         |
| **Modo captura**: o proxy grava o tráfego real do app em dev e **sugere o patch na spec**         | ⭐         |
| Mock server a partir da spec, usando os exemplos realistas                                        | 🟢 Prism   |
| Temas e plugins com API simples                                                                   | 🔧 Swagger |
| AsyncAPI                                                                                          | 🟢         |

---

## Referência: o que aprendemos dos concorrentes

**Swagger UI.** Copiar: zero config, auth global, deep link. Corrigir: try-it com textarea crua e clique extra, nada persiste entre reloads, só curl, busca fraca, schemas compostos ilegíveis, lento em specs grandes, CORS sem explicação.

**Scalar.** Copiar: 3 colunas, cliente embutido, Cmd+K, snippets, temas. Corrigir: proxy padrão passa por servidor de terceiros, bundle pesado, estado preso no localStorage (não versionável nem compartilhável).

**O que nenhum dos dois faz:** conferir se a API cumpre a spec, encadear requests, mostrar o que mudou entre versões.
