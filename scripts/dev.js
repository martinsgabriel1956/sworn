// dev: cli numa porta fixa + Vite no browser. O proxy do Vite injeta o token, então a página não precisa dele.
// Uso: npm run dev [caminho/da/spec]  (padrão: a fixture Petstore)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const spec = resolve(process.argv[2] ?? "cli/test/fixtures/petstore.yaml");
const env = {
  ...process.env,
  PORT: process.env.PORT ?? "47616",
  SWORN_TOKEN: randomBytes(32).toString("base64url"),
};
const kids = [
  spawn("npm", ["run", "dev", "-w", "cli", "--", spec, "--no-open"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev", "-w", "web"], { stdio: "inherit", env }),
];
for (const kid of kids) {
  kid.on("exit", (code) => {
    for (const k of kids) k.kill();
    process.exit(code ?? 0);
  });
}
