import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const key = createHash("sha256")
  .update(process.env.SESSION_SECRET ?? "swamp-development-secret")
  .digest();

export function encryptMessage(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptMessage(value: string) {
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Invalid encrypted message.");
  }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}