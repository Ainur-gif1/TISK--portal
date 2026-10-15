import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Accounts are created only in an initialized database. Existing accounts/passwords are preserved.
export async function bootstrapAccounts(client, outputFile) {
  const credentials = [];
  let outputCreated = false;
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tik-bootstrap-accounts'))");
    const { rows: groups } = await client.query('SELECT id, name FROM "CollegeGroup" ORDER BY id');
    if (!groups.length) throw new Error('No groups found. Run the database migrations and curriculum seed first.');
    const { rows: admins } = await client.query('SELECT id FROM "User" WHERE role=\'ADMIN\' AND active=true AND "passwordHash" IS NOT NULL');
    const accounts = [
      ...(!admins.length ? [{ username: 'admin', displayName: 'Әкімші', role: 'ADMIN', groupId: null }] : []),
      ...groups.map(group => ({ username: `group-${group.id.toLocaleLowerCase('en-US')}`, displayName: `Топ: ${group.name}`, role: 'STUDENT', groupId: group.id })),
    ];
    for (const account of accounts) {
      const { rows: existing } = await client.query('SELECT role, "groupId" FROM "User" WHERE username=$1', [account.username]);
      if (existing.length) {
        if (existing[0].role !== account.role || existing[0].groupId !== account.groupId) throw new Error(`Login collision: ${account.username}. No accounts were changed.`);
        if (account.role === 'ADMIN') throw new Error('The admin login exists but is disabled or has no password. Use user:set-password to recover it.');
        continue;
      }
      const password = randomBytes(15).toString('base64url');
      const hash = await bcrypt.hash(password, 12);
      await client.query('INSERT INTO "User" (id,username,"displayName",role,"passwordHash",active,"groupId","updatedAt") VALUES ($1,$2,$3,$4,$5,true,$6,NOW())',
        [randomUUID(), account.username, account.displayName, account.role, hash, account.groupId]);
      credentials.push({ ...account, password });
    }
    if (credentials.length) {
      // Never write passwords to a public asset directory or overwrite an existing credentials file.
      const output = path.resolve(outputFile);
      const checkout = path.dirname(serverRoot);
      for (const publicRoot of [path.join(serverRoot, 'public'), path.join(serverRoot, '.next'), path.join(checkout, 'dist')]) {
        if (output === publicRoot || output.startsWith(publicRoot + path.sep)) throw new Error('Credentials must be stored outside public assets.');
      }
      await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      const file = await open(output, 'wx', 0o600);
      outputCreated = true;
      try { await file.writeFile(JSON.stringify(credentials, null, 2) + '\n'); } finally { await file.close(); }
    }
    await client.query('COMMIT');
    return { created: credentials.length, groups: groups.length };
  } catch (error) {
    await client.query('ROLLBACK');
    if (outputCreated) await unlink(outputFile);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.join(serverRoot, '.private', 'initial-accounts.json');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in server-only environment settings.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await bootstrapAccounts(client, output);
    console.log(`Created ${result.created} accounts; ${result.groups} groups checked. Existing passwords were preserved.`);
    if (result.created) console.log(`Credentials were saved privately to ${output}. Do not commit or publish this file.`);
  } finally { await client.end(); }
}
