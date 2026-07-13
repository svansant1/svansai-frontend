import crypto from "node:crypto";

const key = `svans_live_${crypto.randomBytes(32).toString("base64url")}`;

console.log(key);
