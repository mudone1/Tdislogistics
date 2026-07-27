import "dotenv/config";

export const MAIN_APP_URL = (process.env.MAIN_APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const PORT = Number(process.env.PORT) || 4200;
export const BOT_MENTION_TRIGGER = (process.env.BOT_MENTION_TRIGGER || "@tdisbot").toLowerCase();
