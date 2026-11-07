import { createApp } from "./app";
async function main() {
  const { app } = await createApp();
  await app.listen({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3000),
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => void app.close().then(() => process.exit(0)));
}
void main();
