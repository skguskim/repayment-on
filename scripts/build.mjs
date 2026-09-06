import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_FILES, HEADERS } from '../server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'out');
const allowed=new Set([...CLIENT_FILES,'_headers']);
async function inspect(dir,prefix='') {
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    const rel=prefix+entry.name;
    if(entry.isDirectory())await inspect(path.join(dir,entry.name),`${rel}/`);
    else if(!allowed.has(rel))throw new Error(`배포 폴더에 알 수 없는 파일이 있습니다. 직접 확인하세요: ${rel}`);
  }
}
await inspect(dist);
for(const file of CLIENT_FILES){await mkdir(path.dirname(path.join(dist,file)),{recursive:true});await copyFile(path.join(root,file),path.join(dist,file));}
await writeFile(path.join(dist,'_headers'),'/*\n'+Object.entries(HEADERS).map(([k,v])=>`  ${k}: ${v}`).join('\n')+'\n');
console.log('out/ 생성 완료 · 정적 배포는 계산 기능만 제공하며 AI 대화에는 서버가 필요합니다.');
