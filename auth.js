"use strict";

/**
 * Accounts and sessions.
 *
 * Passwords are hashed with scrypt from node:crypto — deliberately slow, salted
 * per user, and available without a dependency. Sessions are opaque random
 * tokens stored server-side and handed out in an httpOnly cookie, so a stolen
 * token can be revoked and page scripts can never read it.
 */

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const COOKIE_NAME = "civic_session";
const ROLES = ["citizen", "authority", "admin"];

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, "hex");
  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (expectedBuffer.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuffer);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateRegistration(payload, authorityIds) {
  const errors = [];
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const role = ROLES.includes(payload.role) ? payload.role : "citizen";
  const authorityId = String(payload.authorityId || "").trim() || null;

  if (name.length < 2) errors.push("Enter your full name.");
  if (!EMAIL_RE.test(email)) errors.push("Enter a valid email address.");
  if (password.length < 8) errors.push("Use a password of at least 8 characters.");

  // Authority staff must belong to a real authority, or their queue is empty.
  if (role === "authority" && !authorityIds.includes(authorityId)) {
    errors.push("Choose which authority you work for.");
  }

  return {
    errors,
    value: {
      name: name.slice(0, 120),
      email: email.slice(0, 200),
      password,
      role,
      authorityId: role === "authority" ? authorityId : null,
      jobTitle: String(payload.jobTitle || "").trim().slice(0, 120) || null,
      phone: String(payload.phone || "").trim().slice(0, 40) || null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

function readCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

const sessionCookie = (token, expiresAt) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;

const clearedCookie = () =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

module.exports = {
  COOKIE_NAME, ROLES,
  hashPassword, verifyPassword,
  validateRegistration,
  readCookies, sessionCookie, clearedCookie,
};
