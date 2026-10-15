import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=['index.html','portal-server-config.js','portal-seed.js','portal-curators.js','portal-data.js','portal-admin.js','portal-calendar.js','portal.js'];
await fs.mkdir(path.join(root,'dist'),{recursive:true});
for(const file of assets)await fs.copyFile(path.join(root,file),path.join(root,'dist',file));
for(const file of await fs.readdir(path.join(root,'dist')))if(!assets.includes(file))await fs.rm(path.join(root,'dist',file),{recursive:true});
console.log('Built '+assets.length+' static assets.');
