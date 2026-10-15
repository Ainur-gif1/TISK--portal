import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "../src/lib/prisma";

const username = process.argv[2]?.trim().toLocaleLowerCase("en-US");
if (!username) throw new Error("Usage: npm run user:set-password -- <username>");
const prompt = createInterface({ input, output });
try {
  const first = await prompt.question("New password (12+ characters): ");
  const second = await prompt.question("Repeat password: ");
  if (first.length < 12 || first !== second) throw new Error("Passwords must match and contain at least 12 characters.");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error("No such account. Seed the teacher directory or create the student account first.");
  const passwordHash = await bcrypt.hash(first, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, active: true } });
  console.log(`Password set and account activated for ${username}.`);
} finally {
  prompt.close();
  await prisma.$disconnect();
}
