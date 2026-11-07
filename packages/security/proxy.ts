import http from "node:http";
import net from "node:net";
import { resolveAllowed } from "./index";
/** Resolve once and connect directly to the validated address: avoids DNS-rebinding between check and connect. */
export async function startProxy(allow: string[]) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url!);
      if (u.protocol !== "http:" || u.username || u.password)
        throw Error("Blocked scheme");
      const port = Number(u.port || 80),
        address = await resolveAllowed(u.hostname, port, allow);
      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: u.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const out = http.request(
        {
          host: address,
          port,
          path: u.pathname + u.search,
          method: req.method,
          headers,
        },
        (up) => {
          res.writeHead(up.statusCode || 502, up.headers);
          up.pipe(res);
        },
      );
      out.setTimeout(30000, () => out.destroy());
      out.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(out);
    } catch {
      res.writeHead(403);
      res.end("Destination blocked by network policy");
    }
  });
  server.on("connect", async (req, client, head) => {
    try {
      const u = new URL("https://" + req.url);
      const port = Number(u.port || 443),
        address = await resolveAllowed(u.hostname, port, allow);
      const socket = net.connect(port, address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        socket.write(head);
        client.pipe(socket);
        socket.pipe(client);
      });
      socket.setTimeout(120000, () => socket.destroy());
      socket.on("error", () => client.destroy());
      client.on("error", () => socket.destroy());
      client.on("close", () => socket.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
