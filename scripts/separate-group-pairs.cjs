const fs=require('node:fs'),path=require('node:path'),D=require('../portal-data.js'),S=require('../portal-seed.js');
const root=path.resolve(__dirname,'..'),data=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8')),packed=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8')),original=D.createDraft(),schedule=[],moving=[],dayRows=new Map();
for(const row of original){const e=D.details(row),key=e.group+':'+row.date,prev=dayRows.get(key)||[];if(prev.some(p=>p.lesson===row.lesson||e.period.from<p.period.to&&p.period.from<e.period.to))moving.push(row);else{schedule.push(row);prev.push(e);dayRows.set(key,prev)}}
const byDate=new Map();for(const row of schedule){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(D.details(row))}
const changes=[];
for(const old of moving){
 const c=D.byId(old.courseId),range=D.groupMap.get(c.group).semesterDates[old.semester-1],dates=[];
 for(let date=range[0];date<=range[1];date=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10))if(D.pairCount(date))dates.push(date);
 dates.sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(old.date))-Math.abs(Date.parse(b)-Date.parse(old.date)));
 let next;
 for(const date of dates){if(next)break;const shift=date===old.date?(old.shift||c.shift):c.shift,others=byDate.get(date)||[];
  for(let lesson=0;lesson<D.pairCount(date);lesson++){
   const period=D.shifts[shift].periods[lesson];if(others.some(r=>r.group===c.group&&(r.lesson===lesson||period.from<r.period.to&&r.period.from<period.to)||period.from<r.period.to&&r.period.from<period.to&&r.teachers.some(t=>old.teachers.includes(t))))continue;
   const building=D.buildingFor(c),choices=D.roomCatalog.filter(r=>r.building===building).map(r=>r.key),room=choices.find(key=>!others.some(r=>D.roomKeys(r).includes(key)&&period.from<r.period.to&&r.period.from<period.to));if(!room)continue;
   next={...old,date,lesson,shift,room,reference:false,roomOrigin:'planned',building};break;
  }
 }
 if(!next)throw Error('No free pair for '+old.id);
 const saved=packed.find(r=>(typeof r[7]==='string'?r[7]:'seed-'+r[7])===old.id);data.migration.byRevision['sep2-photo30-buildings-v4'][old.id]??=structuredClone(saved);
 schedule.push(next);if(!byDate.has(next.date))byDate.set(next.date,[]);byDate.get(next.date).push(D.details(next));changes.push({id:old.id,fromDate:old.date,fromLesson:old.lesson,date:next.date,lesson:next.lesson});
}
if(D.conflicts(schedule).length)throw Error(D.conflicts(schedule).join('\n'));
const indices=new Map(D.teachers.map((t,i)=>[t.id,i])),out=schedule.map(r=>[r.courseId,r.semester,Math.round((Date.parse(r.date+'T12:00:00Z')-Date.parse(S.startDate+'T12:00:00Z'))/86400000),r.lesson,r.kind,r.teachers.map(t=>indices.get(t)),r.unassigned?1:0,r.id.startsWith('seed-')?Number(r.id.slice(5)):r.id,r.room,Object.fromEntries(['shift','additional','reference','sourceRows','referenceArea','roomOrigin','building','moduleNeedsReview'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))]);
data.separatedGroupPairs=changes;data.assumptions.push('Бір топтың бір жұбына екі сабақ қойылмайды. Қатар түскен сабақтар пән сағаттарын сақтап бос уақытқа көшірілді.');
const seed={...S,migration:data.migration,assumptions:data.assumptions,separatedGroupPairs:changes,schedule:out};
fs.writeFileSync(path.join(root,'data/curriculum.json'),JSON.stringify(data,null,2));fs.writeFileSync(path.join(root,'data/timetable.json'),JSON.stringify(out));fs.writeFileSync(path.join(root,'portal-seed.js'),'(function(){"use strict";const seed='+JSON.stringify(seed)+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n');console.log({separated:changes.length});
