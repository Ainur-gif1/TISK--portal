/* Fit draft classroom assignments into photographed room inventory. */
const fs=require('node:fs'),path=require('node:path'),D=require('../portal-data.js'),S=require('../portal-seed.js');
const root=path.resolve(__dirname,'..'),data=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8')),packed=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8'));
const schedule=D.createDraft(),index=new Map(D.teachers.map((t,i)=>[t.id,i])),busy=new Map(),snapshot=new Map(packed.map(r=>[typeof r[7]==='string'?r[7]:'seed-'+r[7],r]));
const period=row=>D.shifts[row.shift||D.byId(row.courseId).shift].periods[row.lesson];
const resources=row=>['group:'+D.byId(row.courseId).group,...row.teachers.map(t=>'teacher:'+t),...D.roomKeys(row).map(key=>'room:'+key)];
function put(row){const p=period(row);for(const resource of resources(row)){const key=row.date+':'+resource;if(!busy.has(key))busy.set(key,[]);busy.get(key).push({id:row.id,...p})}}
function release(row){for(const resource of resources(row)){const key=row.date+':'+resource;busy.set(key,(busy.get(key)||[]).filter(r=>r.id!==row.id))}}
function free(row,resource){const p=period(row);return !(busy.get(row.date+':'+resource)||[]).some(prev=>p.from<prev.to&&prev.from<p.to)}
function findRooms(row,count){const keys=D.roomCatalog.filter(r=>r.building===D.buildingFor(D.byId(row.courseId))).map(r=>r.key).filter(key=>free(row,'room:'+key));return keys.length>=count?keys.slice(0,count):null}
for(const row of schedule)put(row);
const missing=schedule.filter(row=>!row.reference&&!/Спорт алаңы/u.test(row.room)&&D.roomKeys(row).length<Math.max(1,D.byId(row.courseId).subgroups));
let moved=0;const pending=[];
for(const row of missing){
 const old=structuredClone(row),course=D.byId(row.courseId),range=D.groupMap.get(course.group).semesterDates[row.semester-1],count=Math.max(1,course.subgroups),choices=[];
 release(row);let rooms=findRooms(row,count),found=rooms?{...row,room:rooms.join(' / ')}:null;
 if(!found){
  for(let date=range[0];date<=range[1];date=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10))if(date!=='2026-09-30')for(let lesson=0;lesson<D.pairCount(date);lesson++)choices.push({...row,date,lesson});
  choices.sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(old.date))-Math.abs(Date.parse(b.date)-Date.parse(old.date))||Math.abs(a.lesson-old.lesson)-Math.abs(b.lesson-old.lesson));
  for(const candidate of choices){if(!['group:'+course.group,...candidate.teachers.map(t=>'teacher:'+t)].every(key=>free(candidate,key)))continue;rooms=findRooms(candidate,count);if(rooms){found={...candidate,room:rooms.join(' / ')};break}}
 }
 if(found){Object.assign(row,found);row.roomOrigin='planned';put(row);if(row.date!==old.date||row.lesson!==old.lesson){moved++;data.migration.byRevision['weekday19-nvp-v3'][row.id]??=snapshot.get(row.id).slice(0,8)}}else{put(row);pending.push({id:row.id,date:row.date,group:course.group,building:D.buildingFor(course)})}
}
const errors=D.conflicts(schedule);if(errors.length)throw Error(errors.slice(0,10).join('\n'));
data.roomsPending=pending;data.referenceSchedule.missingRooms=schedule.filter(row=>row.reference&&!row.room).map(row=>({id:row.id,date:row.date,group:D.byId(row.courseId).group,building:D.buildingFor(D.byId(row.courseId))}));
const offset=date=>Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(S.startDate+'T12:00:00Z'))/86400000);
const out=schedule.map(row=>[row.courseId,row.semester,offset(row.date),row.lesson,row.kind,row.teachers.map(t=>index.get(t)),row.unassigned?1:0,row.id.startsWith('seed-')?Number(row.id.slice(5)):row.id,row.room,Object.fromEntries(['shift','additional','reference','sourceRows','referenceArea','roomOrigin','building','moduleNeedsReview'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))]);
const seed={...S,groups:data.groups,migration:data.migration,referenceSchedule:data.referenceSchedule,roomsPending:pending,schedule:out};
fs.writeFileSync(path.join(root,'data/curriculum.json'),JSON.stringify(data,null,2));fs.writeFileSync(path.join(root,'data/timetable.json'),JSON.stringify(out));fs.writeFileSync(path.join(root,'portal-seed.js'),'(function(){"use strict";const seed='+JSON.stringify(seed)+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n');
console.log(JSON.stringify({needed:missing.length,moved,pending:pending.length,referenceRoomsPending:data.referenceSchedule.missingRooms.length}));
