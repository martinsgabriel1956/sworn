// Spec grande e determinística para medir performance (meta da V1: 2 mil operações abrindo em
// menos de 1s). Uso: node cli/scripts/big-spec.ts [saída.json] [operações]
import { writeFileSync } from "node:fs";

export function bigSpec(operations = 2000) {
  const resources = Math.ceil(operations / 5); // 5 operações por recurso (CRUD + list)
  const schemas: Record<string, unknown> = {
    Error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "integer" }, message: { type: "string" } },
    },
    Audit: {
      type: "object",
      properties: {
        createdAt: { type: "string", format: "date-time", readOnly: true },
        updatedAt: { type: "string", format: "date-time", readOnly: true },
      },
    },
  };
  const paths: Record<string, unknown> = {};
  const tags: { name: string; description: string }[] = [];
  for (let r = 0; r < resources; r++) {
    const name = `Resource${r}`;
    const tag = `grupo-${Math.floor(r / 4)}`;
    if (r % 4 === 0) tags.push({ name: tag, description: `Recursos do ${tag}.` });
    schemas[name] = {
      allOf: [
        { $ref: "#/components/schemas/Audit" },
        {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "integer", format: "int64", readOnly: true },
            name: { type: "string", minLength: 1, maxLength: 120 },
            email: { type: "string", format: "email" },
            status: { type: "string", enum: ["ativo", "inativo"] },
            tags: { type: "array", items: { type: "string" } },
            // Cada recurso aponta para o anterior: grafo de $ref como em spec real.
            ...(r > 0 ? { related: { $ref: `#/components/schemas/Resource${r - 1}` } } : {}),
          },
        },
      ],
    };
    const ref = { $ref: `#/components/schemas/${name}` };
    const json = (schema: unknown) => ({ "application/json": { schema } });
    const errors = {
      default: { description: "Erro", content: json({ $ref: "#/components/schemas/Error" }) },
    };
    const base = `/v1/resource-${r}`;
    paths[base] = {
      get: {
        operationId: `list${name}`,
        tags: [tag],
        summary: `Lista ${name}`,
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "OK", content: json({ type: "array", items: ref }) },
          ...errors,
        },
      },
      post: {
        operationId: `create${name}`,
        tags: [tag],
        summary: `Cria ${name}`,
        requestBody: { required: true, content: json(ref) },
        responses: { 201: { description: "Criado", content: json(ref) }, ...errors },
      },
    };
    paths[`${base}/{id}`] = {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      get: {
        operationId: `get${name}`,
        tags: [tag],
        summary: `Busca ${name}`,
        responses: { 200: { description: "OK", content: json(ref) }, ...errors },
      },
      put: {
        operationId: `update${name}`,
        tags: [tag],
        summary: `Atualiza ${name}`,
        requestBody: { content: json(ref) },
        responses: { 200: { description: "OK", content: json(ref) }, ...errors },
      },
      delete: {
        operationId: `delete${name}`,
        tags: [tag],
        summary: `Remove ${name}`,
        responses: { 204: { description: "Removido" }, ...errors },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "API grande",
      version: "1.0.0",
      description: `${operations} operações geradas.`,
    },
    servers: [{ url: "http://localhost:3000" }],
    tags,
    paths,
    components: { schemas },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out = "big-spec.json", count = "2000"] = process.argv.slice(2);
  writeFileSync(out, JSON.stringify(bigSpec(Number(count)), null, 2));
  console.log(`${out}: ${count} operações`);
}
