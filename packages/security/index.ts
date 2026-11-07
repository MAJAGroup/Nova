import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export const id = () => randomBytes(18).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(key, "hex"),
    scryptSync(password, salt, 64),
  );
}
export function destination(input: string) {
  let s = input.trim();
  if (s === "about:blank") return s;
  if (!/^https?:\/\//i.test(s)) {
    s = /^[\w.-]+\.[a-z]{2,}([/:?].*)?$/i.test(s)
      ? "https://" + s
      : "https://www.google.com/search?q=" + encodeURIComponent(s);
  }
  const u = new URL(s);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error(
      "Only HTTP(S) destinations without credentials are allowed",
    );
  return u.href;
}
export function publicAddress(address: string) {
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  return ip.range() === "unicast";
}
export async function resolveAllowed(
  host: string,
  port: number,
  allow: string[] = [],
) {
  host = host.replace(/^\[|\]$/g, "");
  if (allow.includes(`${host}:${port}`)) return (await lookup(host)).address;
  if (![80, 443].includes(port)) throw new Error("Destination port blocked");
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((x) => !publicAddress(x.address)))
    throw new Error("Private, reserved and metadata networks are blocked");
  return records[0].address;
}
