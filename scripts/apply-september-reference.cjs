/* Transcribe the supplied September 30 photographs and preserve source budgets. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),D=require('../portal-data.js'),S=require('../portal-seed.js');
if(S.scheduleRevision==='sep2-photo30-buildings-v4'){console.log('September reference is already applied.');process.exit(0)}
const curriculum=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8'));
const packed=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8'));
const date='2026-09-30',oldRevision=S.scheduleRevision;
const offset=value=>Math.round((Date.parse(value+'T12:00:00Z')-Date.parse(S.startDate+'T12:00:00Z'))/86400000);
const teacherIndex=new Map(D.teachers.map((t,i)=>[t.id,i]));
const areas={foreign:/Шетел|Иностран/iu,kazakh:/Қазақ тілі|Казахский язык/iu,'kazakh-literature':/Қазақ әдебиеті|Казахская литература/iu,russian:/Орыс тілі|Русский язык|Русская литература/iu,history:/Қазақстан тарихы|История Казахстана/iu,geography:/География/iu,biology:/Биология/iu,math:/Математика/iu,chemistry:/Химия/iu,physics:/Физика/iu,informatics:/Информатика|цифров|Сандық технология/iu,digital:/цифров|Сандық технология/iu,physical:/Дене тәрбиесі|Физическая культура|Дене қасиеттер|физических свойств|физических качеств/iu,defense:/^(АӘД|НВП)$/u,economics:/Экономик/iu,graphics:/Графика/iu};
const vocational=new Set(['furniture','welding','design','construction','computer','electric','auto','sewing']);
const sourceRows=fs.readFileSync(path.join(root,'data/september30-photo-rows.csv'),'utf8').trim().split('\n').slice(1).map(line=>{
 const cells=line.split('|');if(cells.length!==12)throw Error(cells[0]+' has '+cells.length+' columns');
 const [id,name,area,room,...slots]=cells,teacher=D.teachers.find(t=>t.name===name);
 if(!teacher&&slots.some(Boolean))throw Error('Unknown teacher '+name);
 return {id,name,teacher:teacher?.id||null,area,room,slots};
});
const photoCells=[],combined=new Map();
for(const row of sourceRows)for(let index=0;index<8;index++)if(row.slots[index]){
 const [number,override]=row.slots[index].split(':'),matches=D.groupRecords.filter(g=>g.id.includes(number));
 if(matches.length!==1)throw Error('Group number not unique: '+number);
 const group=matches[0],shift=index<4?1:2,lesson=index%4,area=override||row.area;
 photoCells.push({sourceRow:row.id,group:group.id,number,shift,lesson,area,teacher:row.teacher,room:row.room});
 const combinedArea=area==='kazakh-literature'&&group.language==='ru'?'kazakh':area,key=group.id+':'+lesson+':'+combinedArea;
 if(!combined.has(key))combined.set(key,{group:group.id,shift,lesson,area:combinedArea,teachers:[],rooms:[],sourceRows:[]});
 const entry=combined.get(key);entry.teachers.push(row.teacher);if(row.room)entry.rooms.push(row.room);entry.sourceRows.push(row.id);
}
const original=D.createDraft(),available=new Map(D.sourceCourses.map(c=>[c.id,original.filter(r=>r.courseId===c.id&&r.semester===1)]));
const selectedIds=new Set(),snapshots=[],ambiguous=[],unknown=[],referenceCourses=[];
for(const entry of combined.values()){
 entry.teachers=[...new Set(entry.teachers)];entry.rooms=[...new Set(entry.rooms)];
 let candidates=D.sourceCourses.filter(c=>c.group===entry.group&&c.semesters.includes(1)&&(vocational.has(entry.area)?!!D.compactModule(c):areas[entry.area]?.test(c.subject)));
 if(entry.area==='graphics'&&!candidates.length)candidates=D.sourceCourses.filter(c=>c.group===entry.group&&c.semesters.includes(1)&&D.compactModule(c));
 if(!candidates.length&&['history','digital'].includes(entry.area))candidates=D.sourceCourses.filter(c=>c.group===entry.group&&c.semesters.includes(1)&&entry.teachers.some(id=>c.teacherIds.includes(id)));
 const taught=candidates.filter(c=>entry.teachers.some(id=>c.teacherIds.includes(id)));if(taught.length)candidates=taught;
 candidates=candidates.filter(c=>available.get(c.id).some(r=>!selectedIds.has(r.id)));
 const existing=original.find(r=>r.date===date&&r.lesson===entry.lesson&&D.byId(r.courseId).group===entry.group&&candidates.some(c=>c.id===r.courseId));
 candidates.sort((a,b)=>(b.id===existing?.courseId)-(a.id===existing?.courseId)||(available.get(b.id).filter(r=>!selectedIds.has(r.id)).length-available.get(a.id).filter(r=>!selectedIds.has(r.id)).length)||a.id-b.id);
 if(!candidates.length){
  const titles={'kazakh-literature':'Қазақ әдебиеті',electric:'Электр'};if(!titles[entry.area]){unknown.push(entry);continue}
  let extra=referenceCourses.find(c=>c.group===entry.group&&c.subject===titles[entry.area]);
  if(!extra){extra={id:200000+referenceCourses.length,group:entry.group,shift:entry.shift,module:'',subject:titles[entry.area],short:titles[entry.area],referenceOnly:true,additional:true,teacherIds:entry.teachers,subgroups:1,semesters:[1],semesterHours:[0,0],theoryBySemester:[0,0],practicalBySemester:[0,0],tracks:[[]],sources:[{file:'Архив.zip',row:entry.sourceRows.join(', '),sheet:'30.09.2026'}]};referenceCourses.push(extra)}
  snapshots.push({id:'photo-'+entry.sourceRows.join('-')+'-'+entry.lesson,courseId:extra.id,semester:1,date,shift:entry.shift,lesson:entry.lesson,kind:0,teachers:entry.teachers,unassigned:false,room:entry.rooms.join(' / '),additional:true,reference:true,sourceRows:entry.sourceRows,referenceArea:entry.area,roomOrigin:entry.rooms.length?'photo':'planned',status:'draft',moduleNeedsReview:entry.area==='electric'});continue;
 }
 const course=candidates[0];if(candidates.length>1)ambiguous.push({group:entry.group,lesson:entry.lesson,area:entry.area,courseId:course.id,candidates:candidates.map(c=>c.id),sourceRows:entry.sourceRows});
 const matching=available.get(course.id).filter(r=>!selectedIds.has(r.id));matching.sort((a,b)=>(a.date===date?0:1)-(b.date===date?0:1)||Math.abs(offset(a.date)-offset(date))-Math.abs(offset(b.date)-offset(date))||a.lesson-b.lesson);
 const selected=matching[0];selectedIds.add(selected.id);
 snapshots.push({...selected,date,shift:entry.shift,lesson:entry.lesson,teachers:entry.teachers,unassigned:false,room:entry.rooms.join(' / '),reference:true,sourceRows:entry.sourceRows,referenceArea:entry.area,roomOrigin:entry.rooms.length?'photo':'planned',moduleNeedsReview:candidates.length>1});
}
const courses=new Map([...D.sourceCourses,...referenceCourses].map(c=>[c.id,c]));
console.log(JSON.stringify({sourceRows:sourceRows.length,photoCells:photoCells.length,snapshotPairs:snapshots.length,groups:new Set(snapshots.map(r=>courses.get(r.courseId).group)).size,unmatched:unknown,ambiguousModules:ambiguous.length,referenceOnlyPairs:snapshots.filter(r=>r.additional).length,shiftOverrides:snapshots.filter(r=>r.shift!==courses.get(r.courseId).shift).length}));
if(unknown.length)throw Error('Unmatched photograph lessons');if(process.argv.includes('--report'))process.exit(0);
const copy=row=>structuredClone(row),calendarSubstitutions=[];
const schedule=original.filter(row=>!selectedIds.has(row.id)&&row.date!=='2026-09-01'&&row.date!==date).map(copy);
const moving=original.filter(row=>!selectedIds.has(row.id)&&(row.date==='2026-09-01'||row.date===date)).map(copy);
const busy=new Map(),rowMap=new Map();
const period=row=>D.shifts[row.shift||courses.get(row.courseId).shift].periods[row.lesson];
const resources=row=>['group:'+courses.get(row.courseId).group,...row.teachers.map(t=>'teacher:'+t)];
function put(row){rowMap.set(row.id,row);const p=period(row);for(const resource of resources(row)){const key=row.date+':'+resource;if(!busy.has(key))busy.set(key,[]);busy.get(key).push({id:row.id,from:p.from,to:p.to})}}
function remove(row){rowMap.delete(row.id);for(const resource of resources(row)){const key=row.date+':'+resource;busy.set(key,(busy.get(key)||[]).filter(r=>r.id!==row.id))}}
function blockers(row){const p=period(row),ids=new Set();for(const resource of resources(row))for(const prev of busy.get(row.date+':'+resource)||[])if(p.from<prev.to&&prev.from<p.to)ids.add(prev.id);return ids}
for(const row of schedule)put(row);for(const row of snapshots)put(row);
const groupDates=new Map();for(const g of D.groupRecords)for(const semester of [1,2]){const [first,last]=g.semesterDates[semester-1],dates=[];for(let day=first;day<=last;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10))if(day!=='2026-09-01'&&day!==date&&D.pairCount(day))dates.push(day);groupDates.set(g.id+':'+semester,dates)}
function candidates(row){const result=[],course=courses.get(row.courseId);for(const day of groupDates.get(course.group+':'+row.semester))for(let lesson=0;lesson<D.pairCount(day);lesson++)result.push({...row,date:day,lesson});return result.sort((a,b)=>Math.abs(offset(a.date)-offset(row.date))-Math.abs(offset(b.date)-offset(row.date))||Math.abs(a.lesson-row.lesson)-Math.abs(b.lesson-row.lesson)||a.date.localeCompare(b.date))}
function moveAside(id,forbidden,depth,visited=new Set()){
 const old=rowMap.get(id);if(!old||old.reference||visited.has(id))return false;visited=new Set([...visited,id]);remove(old);
 for(const candidate of candidates(old)){const p=period(candidate);if(forbidden.some(f=>f.date===candidate.date&&p.from<f.to&&f.from<p.to))continue;if(!blockers(candidate).size){Object.assign(old,candidate);put(old);return true}}
 if(depth)for(const candidate of candidates(old)){const p=period(candidate);if(forbidden.some(f=>f.date===candidate.date&&p.from<f.to&&f.from<p.to))continue;const blocked=blockers(candidate);if(blocked.size!==1)continue;if(moveAside([...blocked][0],forbidden.concat({date:candidate.date,...p}),depth-1,visited)){Object.assign(old,candidate);put(old);return true}}
 put(old);return false;
}
moving.sort((a,b)=>b.teachers.length-a.teachers.length||a.courseId-b.courseId);
for(const row of moving){
 const options=candidates(row);let found=options.find(candidate=>!blockers(candidate).size);
 const teacherHasTime=options.some(candidate=>{const p=period(candidate);return row.teachers.every(id=>!(busy.get(candidate.date+':teacher:'+id)||[]).some(prev=>p.from<prev.to&&prev.from<p.to))});
 if(!found&&teacherHasTime)for(const candidate of options){const blocked=blockers(candidate);if(blocked.size===1&&moveAside([...blocked][0],[{date:candidate.date,...period(candidate)}],1)){found=candidate;break}}
 if(!found){
  const course=courses.get(row.courseId),language=D.groupMap.get(course.group).language,defense=new Set(['АӘД','НВП','Дала жиыны','Полевой сбор']);
  const compatible=[...new Set(D.sourceCourses.filter(c=>D.groupMap.get(c.group).language===language&&(c.subject===course.subject||defense.has(course.subject)&&defense.has(c.subject)||areas.physical.test(course.subject)&&areas.physical.test(c.subject))).flatMap(c=>c.teacherIds))];
  for(const candidate of options){
   const p=period(candidate),groupBusy=busy.get(candidate.date+':group:'+course.group)||[];if(groupBusy.some(prev=>p.from<prev.to&&prev.from<p.to))continue;
   const free=compatible.filter(id=>!(busy.get(candidate.date+':teacher:'+id)||[]).some(prev=>p.from<prev.to&&prev.from<p.to));
   const teachers=[...row.teachers.filter(id=>free.includes(id)),...free.filter(id=>!row.teachers.includes(id))].slice(0,Math.max(1,row.teachers.length));if(teachers.length<row.teachers.length)continue;
   found={...candidate,teachers,unassigned:false};calendarSubstitutions.push({id:row.id,courseId:row.courseId,originalTeachers:row.teachers,teachers,date:candidate.date,lesson:candidate.lesson,reason:'2 қыркүйектен басталатын күнтізбе бойынша бос уақытқа орналастыру'});break;
  }
 }
 if(!found){found=options.map(candidate=>({...candidate,teachers:[],unassigned:true})).find(candidate=>!blockers(candidate).size);if(found)calendarSubstitutions.push({id:row.id,courseId:row.courseId,originalTeachers:row.teachers,teachers:[],date:found.date,lesson:found.lesson,reason:'Мұғалім уақыты жетпейді: оқытушыны студбөлім бекітеді'})}
 if(!found)throw Error('Unable to retime '+row.id+' '+courses.get(row.courseId).group);
 Object.assign(row,found);schedule.push(row);put(row);
}
schedule.push(...snapshots);
// Only photographed room numbers are used; subsequent allocations are drafts.
const roomCatalog=[...new Set(sourceRows.map(r=>r.room).filter(Boolean))].map(key=>({key,number:key.slice(0,-1),building:key.slice(-1)}));
const roomBusy=new Map(),teacherRooms=new Map(sourceRows.filter(r=>r.teacher&&r.room).map(r=>[r.teacher,r.room]));
const roomKeys=row=>(row.room||'').split(' / ').filter(key=>/^\d+[АБ]$/u.test(key));
function reserveRoom(row){const p=period(row);for(const key of roomKeys(row)){const resource=row.date+':'+key;if(!roomBusy.has(resource))roomBusy.set(resource,[]);roomBusy.get(resource).push({id:row.id,from:p.from,to:p.to})}}
function freeRoom(row,key){const p=period(row);return !(roomBusy.get(row.date+':'+key)||[]).some(prev=>p.from<prev.to&&prev.from<p.to)}
const buildingFor=course=>D.compactModule(course)||course.referenceOnly&&course.subject==='Электр'?'Б':'А';
const missingRooms=[];
for(const row of snapshots.filter(r=>r.roomOrigin==='photo'))reserveRoom(row);
const sorted=schedule.filter(r=>r.roomOrigin!=='photo').sort((a,b)=>a.date.localeCompare(b.date)||period(a).from-period(b).from||a.courseId-b.courseId);
for(const row of sorted){
 const course=courses.get(row.courseId),building=buildingFor(course);
 if(areas.physical.test(course.subject)){row.room='Спорт алаңы · '+building;row.roomOrigin='planned';row.building=building;continue}
 const preferred=row.teachers.map(t=>teacherRooms.get(t)).filter(key=>key?.endsWith(building)),choices=[...new Set([...preferred,...roomCatalog.filter(r=>r.building===building).map(r=>r.key)])],picked=[];
 for(let i=0;i<Math.max(1,course.subgroups||1);i++){const key=choices.find(key=>!picked.includes(key)&&freeRoom(row,key));if(!key)break;picked.push(key)}
 row.room=picked.join(' / ');row.roomOrigin='planned';row.building=building;reserveRoom(row);
 if(picked.length<Math.max(1,course.subgroups||1))missingRooms.push({id:row.id,date:row.date,group:course.group,building});
}
const referenceIssues=[],issueKeys=new Set();
for(const row of snapshots)for(const other of snapshots){
 if(row.id>=other.id)continue;const a=period(row),b=period(other);if(a.from>=b.to||b.from>=a.to)continue;
 const types=[];if(courses.get(row.courseId).group===courses.get(other.courseId).group)types.push(['group',courses.get(row.courseId).group]);
 for(const t of row.teachers)if(other.teachers.includes(t))types.push(['teacher',t]);for(const room of roomKeys(row))if(roomKeys(other).includes(room))types.push(['room',room]);
 for(const [type,resource] of types){const key=type+resource+row.id+other.id;if(issueKeys.has(key))continue;issueKeys.add(key);referenceIssues.push({type,resource,date,rowIds:[row.id,other.id],groups:[courses.get(row.courseId).group,courses.get(other.courseId).group],sourceRows:[...row.sourceRows,...other.sourceRows]})}
}
const signature=row=>JSON.stringify([row.courseId,row.date,row.lesson,row.shift||courses.get(row.courseId).shift,row.teachers.slice().sort(),row.room]);
for(const issue of referenceIssues)issue.signatures=issue.rowIds.map(id=>signature(rowMap.get(id)));
const revision='sep2-photo30-buildings-v4',oldMap=new Map(original.map(r=>[r.id,r]));
curriculum.migration.byRevision??={};curriculum.migration.byRevision[oldRevision]={};
for(const row of schedule){const old=oldMap.get(row.id);if(old&&(old.date!==row.date||old.lesson!==row.lesson||JSON.stringify(old.teachers)!==JSON.stringify(row.teachers)))curriculum.migration.byRevision[oldRevision][row.id]=packed.find(r=>(typeof r[7]==='string'?r[7]:'seed-'+r[7])===row.id)}
for(const group of curriculum.groups)group.semesterDates[0][0]='2026-09-02';
curriculum.lessonStartDate='2026-09-02';curriculum.scheduleRevision=revision;curriculum.calendarSubstitutions=calendarSubstitutions;
curriculum.referenceCourses=referenceCourses;curriculum.roomCatalog=roomCatalog;
curriculum.referenceSchedule={date,sourceFile:'Архив.zip',sourceRows,photoCells,lessons:snapshots.map(copy),ambiguousModules:ambiguous,issues:referenceIssues,missingRooms:missingRooms.filter(r=>r.date===date)};
curriculum.statistics.scheduledPairs=schedule.filter(r=>!r.additional).length;curriculum.statistics.referenceOnlyPairs=snapshots.filter(r=>r.additional).length;
curriculum.assumptions=curriculum.assumptions.filter(note=>!note.includes('қыркүйектің 1')&&!note.includes('кабинет')&&!note.includes('Кабинет'));
curriculum.assumptions.push('Сабақтар 2026 жылғы 2 қыркүйектен басталады. 1 қыркүйекте сабақ өткізілмейді. Бастапқы пән сағаттары сақталып, сол күнгі сабақтар бос уақытқа көшірілді.');
curriculum.assumptions.push('30 қыркүйек кестесі Архив.zip ішіндегі үш фотосуреттен енгізілді. Осы күннің ауысымы мен көрсетілген кабинет нөмірлері сурет бойынша сақталды. Суретте қатар түскен пәндер мен кабинеттер нақтылауға белгіленеді.');
curriculum.assumptions.push('Басқа күндерге жалпы пәндер А корпусына, КМ/ПМ арнайы пәндері Б корпусына жоба ретінде орналастырылды. Көрсетілген кабинет нөмірлерінің тізімі фотосуреттерден алынды. Бос қосымша жұптардың кабинетін студбөлім бекітеді.');
curriculum.assumptions.push('Фотосуретте арнайы пәннің тек бағыты көрсетілген жағдайда, КМ/ПМ нөмірі топтың оқу жоспары мен сол мұғалімнің пәніне сәйкестендірілді; мұндай нөмірлерді студбөлім нақтылайды. Жоспарда осы семестрге жоқ, бірақ фотосуретте көрсетілген сабақтар жеке белгіленіп, жоспар сағаттарына қосылмайды.');
const out=schedule.map(row=>{const meta=Object.fromEntries(['shift','additional','reference','sourceRows','referenceArea','roomOrigin','building','moduleNeedsReview'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));return [row.courseId,row.semester,offset(row.date),row.lesson,row.kind,row.teachers.map(t=>teacherIndex.get(t)),row.unassigned?1:0,row.id.startsWith('seed-')?Number(row.id.slice(5)):row.id,row.room,meta]});
const keys=['importId','year','startDate','lessonStartDate','teachingDays','groups','teachers','courses','referenceCourses','roomCatalog','referenceSchedule','issues','pending','assumptions','statistics','excludedPracticeRows','weekdayPairs','scheduleRevision','migration','substitutions','calendarSubstitutions'];
const seed=Object.fromEntries(keys.map(key=>[key,curriculum[key]]));seed.schedule=out;
fs.writeFileSync(path.join(root,'data/curriculum.json'),JSON.stringify(curriculum,null,2));fs.writeFileSync(path.join(root,'data/timetable.json'),JSON.stringify(out));fs.writeFileSync(path.join(root,'portal-seed.js'),'(function(){"use strict";const seed='+JSON.stringify(seed)+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n');
console.log(JSON.stringify({retimed:moving.length,sourcePairs:curriculum.statistics.scheduledPairs,referencePairs:curriculum.statistics.referenceOnlyPairs,referenceIssues:referenceIssues.length,roomsPending:missingRooms.length}));
