import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';
import { bootstrapAccounts } from '../scripts/bootstrap-accounts.mjs';
const require=createRequire(import.meta.url);
test('Creates all group logins; preserves passwords and rolls back output failures and collisions',async()=>{
 assert.ok(process.env.TEST_DATABASE_URL,'Set TEST_DATABASE_URL to local/disposable PostgreSQL');
 const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
 const schema='test_accounts_'+randomUUID().replaceAll('-','');
 const folder=await mkdtemp(path.join(tmpdir(),'tik-accounts-')),output=path.join(folder,'credentials.json');
 await client.connect();
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);await client.query(`SET search_path TO "${schema}"`);
  await client.query(await readFile(new URL('../prisma/migrations/20261015100000_init/migration.sql',import.meta.url),'utf8'));
  await assert.rejects(bootstrapAccounts(client,output),/No groups found/);
  const groups=require('../../portal-data.js').groupRecords;
  for(const g of groups)await client.query('INSERT INTO "CollegeGroup" (id,name,year,shift,language,"semesterDates","sourceData") VALUES ($1,$2,$3,$4,$5,$6,$7)',[g.id,g.name,g.year,g.shift,g.language,{},{}]);
  const result=await bootstrapAccounts(client,output);assert.equal(result.created,80);assert.equal(result.groups,79);
  const credentials=JSON.parse(await readFile(output,'utf8'));
  assert.equal(new Set(credentials.map(row=>row.password)).size,80);assert.equal((await stat(output)).mode&0o777,0o600);
  const {rows:users}=await client.query('SELECT * FROM "User"');assert.equal(users.length,80);
  for(const g of groups){const u=users.find(row=>row.groupId===g.id);assert.equal(u.role,'STUDENT');assert.equal(u.active,true);assert.equal(u.username,`group-${g.id.toLocaleLowerCase('en-US')}`);assert.ok(u.passwordHash.startsWith('$2'));assert.equal(u.studentNumber,null);}
  const admin=users.find(u=>u.role==='ADMIN'),first=users.find(u=>u.role==='STUDENT');
  for(const u of [admin,first]){const password=credentials.find(c=>c.username===u.username).password;assert.equal(await bcrypt.compare(password,u.passwordHash),true);assert.equal(await bcrypt.compare('incorrect',u.passwordHash),false);}
  assert.equal((await bootstrapAccounts(client,output)).created,0);assert.deepEqual(JSON.parse(await readFile(output,'utf8')),credentials);
  await client.query('DELETE FROM "User" WHERE id=$1',[first.id]);
  await assert.rejects(bootstrapAccounts(client,output),{code:'EEXIST'});
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "User"')).rows[0].count,79);
  await client.query('INSERT INTO "User" (id,username,"displayName",role,"updatedAt") VALUES ($1,$2,$3,\'TEACHER\',NOW())',[randomUUID(),first.username,'Existing teacher']);
  await assert.rejects(bootstrapAccounts(client,path.join(folder,'another.json')),/Login collision/);
  assert.equal((await client.query('SELECT role FROM "User" WHERE username=$1',[first.username])).rows[0].role,'TEACHER');
 }finally{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA "${schema}" CASCADE`);await client.end();await rm(folder,{recursive:true,force:true});}
});
