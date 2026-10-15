const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),S=require('../portal-seed.js'),data=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8')),rows=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8'));
const previousRevision=S.scheduleRevision,counts=new Map(),changes=[];
const key=(r,t)=>r[0]+':'+r[1]+':'+t;
for(const row of rows)if(row[5].length===1)counts.set(key(row,row[5][0]),(counts.get(key(row,row[5][0]))||0)+1);
data.migration.byRevision??={};data.migration.byRevision[previousRevision]??={};
const ordered=rows.slice().sort((a,b)=>a[2]-b[2]||a[3]-b[3]||a[0]-b[0]);
for(const row of ordered)if(row[5].length>1){
 const old=structuredClone(row),id=typeof row[7]==='string'?row[7]:'seed-'+row[7];
 const selected=row[5].reduce((best,t)=>(counts.get(key(row,t))||0)<(counts.get(key(row,best))||0)?t:best,row[5][0]),teacherId=S.teachers[selected].id;
 const rooms=String(row[8]||'').split(' / ').filter(Boolean),index=row[5].indexOf(selected);
 const photoRoom=(S.referenceSchedule?.sourceRows||[]).find(r=>row[9]?.sourceRows?.includes(r.id)&&r.teacher===teacherId&&r.room)?.room;
 row[5]=[selected];row[8]=photoRoom&&rooms.includes(photoRoom)?photoRoom:rooms[index]||rooms[0]||'';
 counts.set(key(row,selected),(counts.get(key(row,selected))||0)+1);data.migration.byRevision[previousRevision][id]=old;
 changes.push({id,courseId:row[0],semester:row[1],fromTeachers:old[5].map(i=>S.teachers[i].id),teacher:teacherId,fromRoom:old[8],room:row[8]});
}
data.scheduleRevision='single-teacher-v5';data.singleTeacherChanges=changes;
data.assumptions.push('Әр жұпқа бір ғана мұғалім тағайындалды. Бұрын қатар көрсетілген мұғалімдер пәннің әр түрлі жұптарына кезектесіп бөлінді.');
const byId=new Map(rows.map(r=>[typeof r[7]==='string'?r[7]:'seed-'+r[7],r]));
data.referenceSchedule.lessons=data.referenceSchedule.lessons.map(r=>{const row=byId.get(r.id);return {...r,teachers:row[5].map(i=>S.teachers[i].id),room:row[8]}});
const seed={...S,migration:data.migration,scheduleRevision:data.scheduleRevision,assumptions:data.assumptions,referenceSchedule:data.referenceSchedule,singleTeacherChanges:changes,schedule:rows};
fs.writeFileSync(path.join(root,'data/curriculum.json'),JSON.stringify(data,null,2));fs.writeFileSync(path.join(root,'data/timetable.json'),JSON.stringify(rows));fs.writeFileSync(path.join(root,'portal-seed.js'),'(function(){"use strict";const seed='+JSON.stringify(seed)+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n');
console.log(JSON.stringify({changed:changes.length,multiTeacherRows:rows.filter(r=>r[5].length>1).length}));
