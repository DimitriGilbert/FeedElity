import { hashPassword, verifyPassword } from "better-auth/crypto";

export function hashCredentialPassword(password: string): Promise<string> {
  return hashPassword(password);
}

export function verifyCredentialPassword(hash: string, password: string): Promise<boolean> {
  return verifyPassword({ hash, password });
}
