import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
const base = process.env.COSMIC_URL || "http://127.0.0.1:3000";
if (
  !base.startsWith("https:") &&
  !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)
)
  throw Error("Use HTTPS for remote authentication");
const terminal = createInterface({ input: stdin, output: stdout });
let cookie = "";
async function request(path: string, body?: unknown) {
  const res = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      "Content-Type": "application/json",
      "X-Cosmic-Client": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json();
  if (!res.ok) throw Error(data.error);
  return data;
}
async function main() {
  const email = await terminal.question("Email: ");
  let password = process.env.COSMIC_PASSWORD;
  if (!password) {
    stdout.write("Password (hidden): ");
    terminal.close();
    stdin.setRawMode(true);
    stdin.resume();
    password = await new Promise<string>((resolve) => {
      let text = "";
      function onData(buffer: Buffer) {
        for (const ch of buffer.toString()) {
          if (ch === "\r" || ch === "\n") {
            stdin.off("data", onData);
            stdin.setRawMode(false);
            stdout.write("\n");
            resolve(text);
            return;
          }
          if (ch === "\u0003") process.exit(0);
          if (ch === "\u007f") text = text.slice(0, -1);
          else text += ch;
        }
      }
      stdin.on("data", onData);
    });
  }
  terminal.close();
  await request("/auth/login", { email, password });
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(
    "Commands: state | read TAB | go TAB URL | click TAB ELEMENT | fill TAB ELEMENT TEXT | command WORKSPACE TEXT | tasks | approve ID | reject ID | pause ID | resume ID | quit",
  );
  while (true) {
    const line = await rl.question("cosmic> ");
    const [cmd, tab, ...rest] = line.trim().split(/\s+/);
    try {
      if (cmd === "quit") break;
      if (cmd === "state")
        console.log(JSON.stringify(await request("/state"), null, 2));
      else if (cmd === "read")
        console.log(
          JSON.stringify(await request("/tabs/" + tab + "/structure"), null, 2),
        );
      else if (cmd === "tasks") console.log((await request("/state")).tasks);
      else if (cmd === "go")
        console.log(
          await request("/tabs/" + tab + "/action", {
            type: "navigate",
            url: rest.join(" "),
          }),
        );
      else if (cmd === "click")
        console.log(
          await request("/tabs/" + tab + "/action", {
            type: "click",
            element: rest[0],
          }),
        );
      else if (cmd === "fill")
        console.log(
          await request("/tabs/" + tab + "/action", {
            type: "fill",
            element: rest[0],
            text: rest.slice(1).join(" "),
          }),
        );
      else if (cmd === "command")
        console.log(
          await request("/command", {
            workspace: tab,
            command: rest.join(" "),
          }),
        );
      else if (["approve", "reject"].includes(cmd))
        console.log(
          await request("/approvals/" + tab, { approve: cmd === "approve" }),
        );
      else if (["pause", "resume"].includes(cmd))
        console.log(await request("/tasks/" + tab + "/" + cmd, {}));
      else console.log("Unknown command");
    } catch (e) {
      console.error(String(e));
    }
  }
  await request("/auth/logout", {});
  rl.close();
}
void main()
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => terminal.close());
