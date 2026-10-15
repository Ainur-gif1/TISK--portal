const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),D=require('../portal-data.js');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8'));
const packed=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8'));
const schedule=D.createDraft(),teacherIndex=new Map(D.teachers.map((t,i)=>[t.id,i]));
const defenseSubjects=new Set(['АӘД','НВП','Дала жиыны','Полевой сбор']);
const substitutions=[];
for(const item of D.pending(schedule)){
  const course=D.byId(item.courseId),language=D.groupMap.get(course.group).language;
  const related=D.sourceCourses.filter(c=>defenseSubjects.has(course.subject)?defenseSubjects.has(c.subject):c.subject===course.subject||course.subject.includes('Сандық технологиялар')&&c.subject==='Информатика');
  const compatible=new Set(related.filter(c=>D.groupMap.get(c.group).language===language).flatMap(c=>c.teacherIds));
  const candidates=[...compatible].sort((a,b)=>schedule.filter(r=>r.teachers.includes(a)).length-schedule.filter(r=>r.teachers.includes(b)).length);
  let remaining=item.pairs;
  for(const teacher of candidates){
    if(!remaining)break;
    const added=D.allocate(schedule,{...item,pairs:remaining},teacher);
    for(const row of added){
      row.id='pending-'+row.courseId+'-s'+row.semester+'-'+row.date+'-p'+row.lesson;
      const offset=Math.round((Date.parse(row.date+'T12:00:00Z')-Date.parse(data.startDate+'T12:00:00Z'))/86400000);
      packed.push([row.courseId,row.semester,offset,row.lesson,row.kind,row.teachers.map(id=>teacherIndex.get(id)),0,row.id]);
      schedule.push(row);
      substitutions.push({id:row.id,courseId:course.id,group:course.group,semester:row.semester,date:row.date,lesson:row.lesson,teacher,originalTeachers:course.teacherIds});
    }
    remaining-=added.length;
  }
}
// A pending class can be blocked by a single movable lesson of a qualified teacher.
for(const item of D.pending(schedule)){
  const course=D.byId(item.courseId),group=D.groupMap.get(course.group),language=group.language;
  const candidates=new Set(D.sourceCourses.filter(c=>(defenseSubjects.has(course.subject)?defenseSubjects.has(c.subject):c.subject===course.subject)&&D.groupMap.get(c.group).language===language).flatMap(c=>c.teacherIds));
  const occupied=new Set(schedule.filter(r=>D.byId(r.courseId).group===course.group).map(r=>r.date+':'+r.lesson));
  const bounds=group.semesterDates[item.semester-1];let done=false;
  for(const teacher of candidates){
    if(done)break;
    const movable=schedule.filter(r=>r.teachers.length===1&&r.teachers[0]===teacher&&r.date>=bounds[0]&&r.date<=bounds[1]&&D.byId(r.courseId).group!==course.group);
    for(const old of movable){
      const oldDetail=D.details(old),overlap=D.shifts[course.shift].periods.some(period=>period.index<D.pairCount(old.date)&&!occupied.has(old.date+':'+period.index)&&period.from<oldDetail.period.to&&oldDetail.period.from<period.to);if(!overlap)continue;
      const working=schedule.filter(r=>r.id!==old.id),added=D.allocate(working,item,teacher);if(added.length!==item.pairs)continue;
      const relocated=D.allocate(working.concat(added),{courseId:old.courseId,semester:old.semester,pairs:1},teacher);if(!relocated.length)continue;
      const moved={...old,date:relocated[0].date,lesson:relocated[0].lesson};if(D.conflicts(working.concat(added,[moved])).length)continue;
      const packedOld=packed.find(r=>(typeof r[7]==='string'?r[7]:'seed-'+r[7])===old.id);
      data.migration.byRevision??={};data.migration.byRevision['weekday19-v2']??={};data.migration.byRevision['weekday19-v2'][old.id]=packedOld.slice();
      packedOld[2]=Math.round((Date.parse(moved.date+'T12:00:00Z')-Date.parse(data.startDate+'T12:00:00Z'))/86400000);packedOld[3]=moved.lesson;
      Object.assign(old,moved);
      for(const row of added){row.id='pending-'+row.courseId+'-s'+row.semester+'-'+row.date+'-p'+row.lesson;const offset=Math.round((Date.parse(row.date+'T12:00:00Z')-Date.parse(data.startDate+'T12:00:00Z'))/86400000);packed.push([row.courseId,row.semester,offset,row.lesson,row.kind,row.teachers.map(id=>teacherIndex.get(id)),0,row.id]);schedule.push(row);substitutions.push({id:row.id,courseId:course.id,group:course.group,semester:row.semester,date:row.date,lesson:row.lesson,teacher,originalTeachers:course.teacherIds})}
      data.retimedLessons??=[];data.retimedLessons.push({id:old.id,courseId:old.courseId,fromDate:oldDetail.date,fromLesson:oldDetail.lesson,toDate:moved.date,toLesson:moved.lesson});done=true;break;
    }
  }
}
const conflicts=D.conflicts(schedule);if(conflicts.length)throw new Error(conflicts.join('\n'));
data.pending=D.pending(schedule);
data.substitutions=(data.substitutions||[]).concat(substitutions);
data.scheduleRevision='weekday19-nvp-v3';
data.statistics.scheduledPairs=schedule.length;
data.statistics.pendingPairs=data.pending.reduce((n,p)=>n+p.pairs,0);
data.assumptions=data.assumptions.filter(note=>!note.includes('өзіндік жұмыс')&&!note.includes('өзіндік жұмысы'));
data.assumptions.push('Бос жұптарға НВП/АӘД қосымша жоба сабақтары енгізілді. Қосымша сабақтарға мұғалімді студбөлім бекітеді. Бұл жұптар бастапқы жоспардың пән сағаттарымен араластырылмайды.');
data.assumptions.push('Жоспарда орналаспай қалған сабақтар осы пәндерді жүргізетін, тілі сәйкес мұғалімдердің бос уақытына орналастырылды. Мұғалім ауыстырулары жоба ретінде сақталды.');
data.assumptions=[...new Set(data.assumptions)];
const keys=['importId','year','startDate','teachingDays','groups','teachers','courses','issues','pending','assumptions','statistics','excludedPracticeRows','weekdayPairs','scheduleRevision','migration','substitutions'];
const seed=Object.fromEntries(keys.map(k=>[k,data[k]]));seed.schedule=packed;
fs.writeFileSync(path.join(root,'data/curriculum.json'),JSON.stringify(data,null,2));
fs.writeFileSync(path.join(root,'data/timetable.json'),JSON.stringify(packed));
fs.writeFileSync(path.join(root,'portal-seed.js'),'(function(){"use strict";const seed='+JSON.stringify(seed)+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n');
console.log(JSON.stringify({placed:substitutions.length,pending:data.statistics.pendingPairs,teachers:[...new Set(substitutions.map(r=>D.teacherMap.get(r.teacher).name))]}));
