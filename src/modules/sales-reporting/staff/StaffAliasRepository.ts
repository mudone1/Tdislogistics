import { prisma } from "../../airline-connectors/storage/prismaClient";
import { normalizeRawCode } from "./resolveStaffName";

// The five mappings called out explicitly in the reporting spec — seeded
// once so the very first report doesn't ask the user to re-confirm facts
// they already stated. Everything learned after this comes from the
// verification flow (see StaffAliasRepository.learn).
const SEED_ALIASES: ReadonlyArray<{ rawCode: string; displayName: string }> = [
  { rawCode: "TDISLOGIST-FLORENCE AINA", displayName: "FLORENCE" },
  { rawCode: "TDISLOGIST-OLABISI AKANBI", displayName: "OLABISI" },
  { rawCode: "TDISLOGIST-KATE AROKE", displayName: "KATE" },
  { rawCode: "TRTL0003-OMOLALA AINA", displayName: "OMO" },
  { rawCode: "Hitit Admin-SYSTEM", displayName: "SYSTEM" },
];

export const StaffAliasRepository = {
  async ensureSeeded(): Promise<void> {
    for (const alias of SEED_ALIASES) {
      await prisma.staffAlias.upsert({
        where: { rawCode: alias.rawCode },
        update: {},
        create: alias,
      });
    }
  },

  async listAll(): Promise<Map<string, string>> {
    const rows = await prisma.staffAlias.findMany();
    return new Map(rows.map((r) => [r.rawCode, r.displayName]));
  },

  // Called once a human confirms an unknown code's display name during
  // report verification — never inferred/auto-learned silently.
  async learn(rawCode: string, displayName: string): Promise<void> {
    const normalized = normalizeRawCode(rawCode);
    await prisma.staffAlias.upsert({
      where: { rawCode: normalized },
      update: { displayName },
      create: { rawCode: normalized, displayName },
    });
  },
};
