import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['server.mjs','vite.sites.config.mjs'];
for(const dir of ['js','lib','scripts','tests','worker'])for(const name of await readdir(path.join(root,dir)))if(name.endsWith('.mjs'))files.push(`${dir}/${name}`);
for(const file of files){const r=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
console.log(`${files.length}개 JavaScript 파일 문법 검사 통과`);
