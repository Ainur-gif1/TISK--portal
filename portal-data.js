(function () {
  'use strict';
  const S=globalThis.TiskSeed||(typeof require==='function'?require('./portal-seed.js'):null);
  const calendar={year:S.year,weeks:20,starts:{1:S.lessonStartDate||S.startDate,2:'2027-01-18'},ends:{1:'2027-01-17',2:'2027-05-30'},weekdayPairs:[4,4,4,4,4],holiday:'',holidays:[],yearStart:2026};
  const curatorData=globalThis.TiskCurators||(typeof require==='function'?require('./portal-curators.js'):null);
  const curatorAssignments=curatorData?.assignments||[],curatorByGroup=new Map(curatorAssignments.map(row=>[row.groupId,row]));
  const groupRecords=S.groups.map(group=>({...group,curator:curatorByGroup.get(group.id)||null})),groups=groupRecords.map(g=>g.id),sourceCourses=S.courses.map(course=>structuredClone(course));
  const additionalCourses=groupRecords.map((group,index)=>{const subject=group.language==='ru'?'НВП':'АӘД';return {id:100000+index,group:group.id,shift:group.shift,module:subject,subject,short:subject,kind:'Қосымша жоба сабағы',additional:true,teacherIds:[],subgroups:1,semesterHours:[0,0],semesters:[1,2],theoryBySemester:[0,0],practicalBySemester:[0,0],tracks:[[]],sources:[]}});
  const referenceCourses=S.referenceCourses||[],courses=sourceCourses.concat(additionalCourses,referenceCourses);
  const teachers=S.teachers.map((teacher,index)=>({...teacher,login:'teacher'+String(index+1).padStart(3,'0'),key:teacher.id}));
  for(const teacher of teachers){const assignments=curatorAssignments.filter(row=>row.teacherId===teacher.id);teacher.curatorGroups=assignments.map(row=>row.groupId);teacher.curatorNames=[...new Set(assignments.map(row=>row.curatorName))];teacher.displayName=assignments.find(row=>row.confirmedByUser)?.curatorName||assignments[0]?.curatorName||teacher.name;}
  const curatorOnly=new Map();for(const row of curatorAssignments.filter(row=>!row.teacherId)){if(!curatorOnly.has(row.curatorName))curatorOnly.set(row.curatorName,{id:'curator-'+row.sourceRow,name:row.curatorName,displayName:row.curatorName,department:'Топ кураторы',initials:row.curatorName.split(' ').map(part=>part[0]).slice(0,2).join(''),color:'#d5e5f5',curatorGroups:[],curatorNames:[row.curatorName],login:null});curatorOnly.get(row.curatorName).curatorGroups.push(row.groupId);}
  const staffRecords=teachers.concat([...curatorOnly.values()]);
  const courseMap=new Map(courses.map(c=>[c.id,c])),teacherMap=new Map(teachers.map(t=>[t.id,t])),groupMap=new Map(groupRecords.map(g=>[g.id,g]));
  const kinds=['Теория','Зертханалық-практикалық','Теория / практика'];
  function shiftFor(group) {return groupMap.get(group)?.shift??(group?(/^[^\d]*9/.test(String(group))?1:2):null);}
  function clock(min) {return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
  function makeShift(number,start,gap) {return {number,label:number+'-ауысым',start,gap,periods:Array.from({length:4},(_,index)=>{const from=start+index*(90+gap);return {index,from,to:from+90,label:clock(from)+' – '+clock(from+90)}})};}
  const shifts={1:makeShift(1,510,15),2:makeShift(2,720,5)};
  const byId=id=>courseMap.get(Number(id));
  function compactModule(course) {const match=/^\s*(КМ|ПМ)\s*(\d+)/u.exec(course.module||'');return match?match[1]+' '+Number(match[2]):'';}
  function courseTitle(course) {return compactModule(course)||course.short||course.subject;}
  function isHoliday(date){return (calendar.holidays||[]).includes(date)||date===calendar.holiday;}
  function pairCount(date) {if(date<calendar.starts[1]||isHoliday(date))return 0;const day=new Date(date+'T12:00:00Z').getUTCDay();return day>=1&&day<=5?calendar.weekdayPairs[day-1]:0;}
  function addDays(value,days) {const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
  function expand(row,index) {return {id:typeof row[7]==='string'?row[7]:'seed-'+(row[7]??index),courseId:row[0],semester:row[1],date:addDays(S.startDate,row[2]),lesson:row[3],kind:row[4],teachers:row[5].map(i=>S.teachers[i].id),unassigned:!!row[6],room:row[8]||'',status:'draft',...(row[9]||{})};}
  function createDraft() {return S.schedule.map(expand);}
  function singleTeacher(entry,preferred) {
    const ids=entry.teachers||[],selected=ids.includes(preferred)?preferred:ids[0],index=ids.indexOf(selected),parts=String(entry.room||'').split(' / ').filter(Boolean);
    const photoRoom=(S.referenceSchedule?.sourceRows||[]).find(row=>entry.sourceRows?.includes(row.id)&&row.teacher===selected&&row.room)?.room;
    return {...entry,teachers:selected?[selected]:[],unassigned:!selected,room:photoRoom&&parts.includes(photoRoom)?photoRoom:parts[index]||parts[0]||''};
  }
  function previousRow(id,revision) {
    const row=S.migration?.byRevision?.[revision]?.[id]||S.migration?.previousRows?.[id];if(row)return expand(row,0);
    if(revision==='weekday19-nvp-v3'){const packed=S.schedule.find((r,i)=>(typeof r[7]==='string'?r[7]:'seed-'+(r[7]??i))===id);if(packed)return expand(packed.slice(0,8),0)}return null;
  }
  function buildingFor(course) {return compactModule(course)||course.referenceOnly&&course.subject==='Электр'?'Б':'А';}
  function rooms(value,building='А') {return String(value||'').split(/\s*\/\s*/u).filter(Boolean).map(part=>{const match=/^(\d+)\s*([АAБB])?$/iu.exec(part);return match?{number:match[1],building:match[2]?/[БB]/iu.test(match[2])?'Б':'А':building,key:match[1]+(match[2]?/[БB]/iu.test(match[2])?'Б':'А':building)}:{label:part,building}});}
  function roomLabel(entry) {const building=entry.building||buildingFor(byId(entry.courseId));return rooms(entry.room,building).map(room=>room.number?room.number+' · '+room.building+' корпус':room.label.replace(/ · ([АБ])$/u,' · $1 корпус')).join(' / ')||building+' корпус · кабинет белгіленбеген';}
  function roomKeys(entry) {return rooms(entry.room,entry.building||buildingFor(byId(entry.courseId))).filter(r=>r.key).map(r=>r.key);}
  function referenceWarnings(schedule) {const map=new Map(schedule.map(row=>[row.id,row]));return (S.referenceSchedule?.issues||[]).filter(issue=>issue.rowIds.every((id,index)=>{
    const row=map.get(id);if(!row)return false;const previous=JSON.parse(issue.signatures[index]);const g=groupMap.get(byId(row.courseId)?.group),b=g?.baseDates?.[row.semester-1],n=g?.semesterDates[row.semester-1];if(b&&n)previous[1]=addDays(previous[1],Math.round((new Date(n[0]+'T12:00:00Z')-new Date(b[0]+'T12:00:00Z'))/86400000));
    if(row.date!==previous[1]||row.lesson!==previous[2]||(row.shift||byId(row.courseId).shift)!==previous[3])return false;
    return issue.type==='group'?byId(row.courseId).group===issue.resource:issue.type==='teacher'?(row.teachers||[]).includes(issue.resource):roomKeys(row).includes(issue.resource);
  }));}
  function details(entry) {
    const course=byId(entry.courseId);if(!course||course.deleted||!groupMap.has(course.group))return null;
    const shift=entry.shift||course.shift,subgroups=1;
    const referenceTitles={history:groupMap.get(course.group)?.language==='ru'?'История Казахстана':'Қазақстан тарихы',economics:'Экономика',physical:'Дене шынықтыру',digital:'Сандық технологиялар',informatics:'Информатика'};
    return {...entry,additional:!!(entry.additional||course.additional),rowType:entry.additional||course.additional?'additional':'source',group:course.group,shift,subject:course.subject,groupLabel:groupName(course.group),short:(entry.additional&&new Date(entry.date+'T12:00:00Z').getUTCDay()===2&&entry.lesson===3?'Топ сағаты':null)||entry.referenceTitle||(entry.reference&&!compactModule(course)&&referenceTitles[entry.referenceArea])||courseTitle(course),module:compactModule(course)||course.module,kindLabel:course.referenceOnly?'Суреттегі сабақ · пәнді нақтылау':entry.additional||course.additional?'Қосымша жоба сабағы':kinds[entry.kind]||course.kind,teacherNames:(entry.teachers||[]).map(id=>teacherMap.get(id)?.displayName||teacherMap.get(id)?.name).filter(Boolean),subgroups,roomLabel:roomLabel(entry),roomNeedsReview:!/Спорт алаңы/u.test(entry.room||'')&&roomKeys(entry).length<Math.max(1,subgroups),day:new Date(entry.date+'T12:00:00Z').getUTCDay()-1,period:shifts[shift]?.periods[entry.lesson]};
  }
  function additionalRows(schedule,groupId,from,to) {
    const group=groupMap.get(groupId);if(!group)return[];
    const occupied=new Set(schedule.filter(row=>byId(row.courseId)?.group===groupId&&row.date>=from&&row.date<=to).map(row=>row.date+':'+row.lesson));
    const result=[];
    for(let date=from;date<=to;date=addDays(date,1)) {
      const semester=group.semesterDates.findIndex(range=>date>=range[0]&&date<=range[1])+1;if(!semester)continue;
      const course=additionalCourses.find(c=>c.group===groupId),shiftsOnDate=new Map();for(const row of schedule.filter(r=>r.date===date&&byId(r.courseId)?.group===groupId)){const shift=row.shift||group.shift;shiftsOnDate.set(shift,(shiftsOnDate.get(shift)||0)+1)}const shift=[...shiftsOnDate].sort((a,b)=>b[1]-a[1])[0]?.[0]||group.shift;
      for(let lesson=0;lesson<pairCount(date);lesson++)if(!occupied.has(date+':'+lesson))result.push(details({id:'additional-'+course.id+'-'+date+'-'+lesson,courseId:course.id,additional:true,date,semester,shift,lesson,kind:0,teachers:[],unassigned:true,room:'',status:'draft'}));
    }
    return result;
  }
  function materializeAdditional(row) {return {id:row.id,courseId:row.courseId,additional:true,date:row.date,semester:row.semester,shift:row.shift,lesson:row.lesson,kind:row.kind??0,teachers:row.teachers||[],unassigned:!row.teachers?.length,room:row.room||'',status:'draft'};}
  function teacherGroups(schedule,teacherId) {return [...new Set(schedule.filter(row=>(row.teachers||[]).includes(teacherId)).map(row=>byId(row.courseId)?.group).filter(Boolean))];}
  function conflicts(schedule) {
    const errors=[],busy=new Map(),ids=new Set(),slots=new Set(),known=referenceWarnings(schedule);
    for(const row of schedule) {
      const entry=details(row),course=byId(row.courseId),g=course&&groupMap.get(course.group),bounds=g?.semesterDates[row.semester-1];
      const date=new Date(row.date+'T12:00:00Z');
      if(!entry||!entry.period||!bounds||(row.teachers||[]).length>1||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==row.date||date.getUTCDay()<1||date.getUTCDay()>5||entry.lesson>=pairCount(row.date)||(date.getUTCDay()===2&&row.lesson===3&&!row.additional)||row.date<bounds[0]||row.date>bounds[1]||!course.semesters.includes(row.semester)||(row.teachers||[]).some(id=>!teacherMap.has(id))||ids.has(row.id)) {
        errors.push('Сабақтың күні, семестрі немесе оқытушы дерегі жарамсыз.');continue;
      }
      ids.add(row.id);const slot=entry.group+':'+row.date+':'+row.lesson;if(slots.has(slot))errors.push(row.date+': топ жұбы қайталанады.');slots.add(slot);
      const resources=['group:'+entry.group,...(entry.teachers||[]).map(id=>'teacher:'+id),...roomKeys(entry).map(key=>'room:'+key)];
      for(const resource of resources) {
        const key=row.date+':'+resource,prev=busy.get(key)||[];
        if(prev.some(p=>entry.period.from<p.to&&p.from<entry.period.to&&!known.some(issue=>issue.type===resource.split(':')[0]&&issue.resource===resource.slice(resource.indexOf(':')+1)&&issue.rowIds.includes(row.id)&&issue.rowIds.includes(p.id))))errors.push(row.date+': '+(resource.startsWith('group:')?'топ':resource.startsWith('teacher:')?'мұғалім':'кабинет')+' уақыты қабаттасады.');
        prev.push({...entry.period,id:row.id});busy.set(key,prev);
      }
    }
    return [...new Set(errors)];
  }
  function pending(schedule) {
    const counts=new Map();
    for(const row of schedule){if(row.additional||byId(row.courseId)?.additional)continue;const key=row.courseId+':'+row.semester;counts.set(key,(counts.get(key)||0)+1)}
    return sourceCourses.flatMap(course=>course.semesters.map(semester=>({courseId:course.id,semester,pairs:course.semesterHours[semester-1]/2-(counts.get(course.id+':'+semester)||0)}))).filter(row=>row.pairs>0);
  }
  function allocate(schedule,item,teacherId) {
    const course=byId(item.courseId),group=groupMap.get(course.group),range=group.semesterDates[item.semester-1],added=[];
    if(!teacherMap.has(teacherId))return added;
    const occupied=schedule.map(details).filter(Boolean),theory=course.theoryBySemester[item.semester-1],counts=schedule.filter(row=>row.courseId===course.id&&row.semester===item.semester);
    const theoryRemaining=Math.max(0,theory-counts.reduce((total,row)=>total+(row.kind===0?2:row.kind===2?1:0),0));
    for(let date=range[0];date<=range[1]&&added.length<item.pairs;date=addDays(date,1)) {
      const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(weekday<1||weekday>5)continue;
      for(const period of shifts[course.shift].periods) {
        if(period.index>=pairCount(date))continue;
        if(added.length>=item.pairs)break;
        const blocked=occupied.some(row=>row.date===date&&period.from<row.period.to&&row.period.from<period.to&&(row.group===course.group||(row.teachers||[]).includes(teacherId)));
        if(blocked)continue;
        const entry={id:'assigned-'+course.id+'-'+date+'-'+period.index,courseId:course.id,semester:item.semester,date,lesson:period.index,kind:theoryRemaining-added.length*2>=2?0:theoryRemaining-added.length*2>0?2:1,teachers:[teacherId],unassigned:false,room:'',status:'draft'};
        added.push(entry);occupied.push(details(entry));
      }
    }
    return added;
  }
  const registryBase=structuredClone({groups:groupRecords,teachers,staff:staffRecords,courses:sourceCourses,additional:additionalCourses,reference:referenceCourses,curators:curatorAssignments});
  const collator=new Intl.Collator('kk',{numeric:true,sensitivity:'base'});
  function groupName(id) {return groupMap.get(id)?.name||id;}
  function sortGroups(list) {return [...list].sort((a,b)=>{const an=groupName(typeof a==='string'?a:a.id),bn=groupName(typeof b==='string'?b:b.id),prefix=x=>(x.match(/^[^0-9]+/)||[''])[0].trim();return collator.compare(prefix(an),prefix(bn))||collator.compare(an,bn)});}
  function applyRegistry(registry={},settings={}) {
    const year=Number(settings.yearStart||2026),shiftDate=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCFullYear(date.getUTCFullYear()+year-2026);return date.toISOString().slice(0,10)};
    calendar.yearStart=year;calendar.year=year+'–'+(year+1);calendar.starts={1:year+'-09-02',2:(year+1)+'-01-18'};calendar.ends={1:(year+1)+'-01-17',2:(year+1)+'-05-30'};calendar.holidays=Array.isArray(settings.holidays)?[...new Set(settings.holidays)]:settings.holiday?[settings.holiday]:[];if(settings.holiday&&calendar.holidays[0]!==settings.holiday)calendar.holidays=[settings.holiday];calendar.holiday=calendar.holidays[0]||'';if(settings.ranges?.all){calendar.starts={1:settings.ranges.all[0][0],2:settings.ranges.all[1][0]};calendar.ends={1:settings.ranges.all[0][1],2:settings.ranges.all[1][1]};}
    const loadedGroups=registryBase.groups.map(g=>({...structuredClone(g),baseDates:structuredClone(g.semesterDates),semesterDates:g.semesterDates.map(range=>range.map(shiftDate)),...(registry.groups?.[g.id]||{})})).concat(structuredClone(registry.addedGroups||[]).map(g=>{const baseYear=Number(g.baseDates?.[0][0].slice(0,4)||g.semesterDates[0][0].slice(0,4)),delta=year-baseYear;return {...g,semesterDates:(g.baseDates||g.semesterDates).map(range=>range.map(value=>{const d=new Date(value+'T12:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+delta);return d.toISOString().slice(0,10)}))}}));
    groupRecords.splice(0,groupRecords.length,...loadedGroups.filter(g=>!g.deleted).map(g=>{const dates=settings.ranges?.[g.id]||settings.ranges?.all;if(dates)g.semesterDates=structuredClone(dates);g.semesters=g.semesterDates.map((r,i)=>({...g.semesters?.[i],number:g.semesters?.[i]?.number||i+1,weeks:Math.max(1,Math.floor((new Date(r[1])-new Date(addDays(r[0],-((new Date(r[0]+'T12:00:00Z').getUTCDay()+6)%7))))/604800000)+1)}));return g}));
    groupMap.clear();for(const g of groupRecords)groupMap.set(g.id,g);groups.splice(0,groups.length,...sortGroups(groupRecords).map(g=>g.id));
    const loadedStaff=registryBase.staff.map(t=>({...structuredClone(t),...(registry.teachers?.[t.id]||{})})).concat(structuredClone(registry.addedTeachers||[])).filter(t=>!t.deleted);
    staffRecords.splice(0,staffRecords.length,...loadedStaff);
    for(const t of staffRecords){t.displayName=t.displayName||t.name;t.name=t.displayName;t.initials=t.name.split(' ').map(x=>x[0]).slice(0,2).join('');t.curatorGroups=[];t.curatorNames=[];t.assignedGroups=t.assignedGroups||[];t.login=t.login||'curator'+t.id.replace(/[^a-z0-9]/gi,'');}
    teacherMap.clear();for(const t of staffRecords)teacherMap.set(t.id,t);
    curatorAssignments.splice(0,curatorAssignments.length);
    for(const g of groupRecords){const baseCurator=g.curator&&(registryBase.staff.find(t=>t.id===g.curator.teacherId)||registryBase.staff.find(t=>t.name===g.curator.curatorName));if(baseCurator&&registry.teachers?.[baseCurator.id]?.deleted||g.curator?.teacherId&&!teacherMap.has(g.curator.teacherId))g.curator=null;if(g.curator){g.curator={...g.curator,groupId:g.id};const t=teacherMap.get(g.curator.teacherId)||staffRecords.find(t=>t.name===g.curator.curatorName||registryBase.staff.find(b=>b.id===t.id)?.curatorNames?.includes(g.curator.curatorName));if(t){g.curator.teacherId=t.id;g.curator.curatorName=t.displayName;t.curatorGroups.push(g.id);t.curatorNames.push(t.displayName);}else g.curator.teacherId=null;curatorAssignments.push(g.curator)}}
    teachers.splice(0,teachers.length,...staffRecords);
    sourceCourses.splice(0,sourceCourses.length,...registryBase.courses.map(c=>({...structuredClone(c),...(registry.courses?.[c.id]||{})})));
    referenceCourses.splice(0,referenceCourses.length,...registryBase.reference.map(c=>({...structuredClone(c),...(registry.courses?.[c.id]||{})})));
    additionalCourses.splice(0,additionalCourses.length,...groupRecords.map((g,index)=>({...structuredClone(registryBase.additional.find(c=>c.group===g.id)||{id:100000+registryBase.groups.length+(registry.addedGroups||[]).findIndex(x=>x.id===g.id),group:g.id,additional:true,module:g.language==='ru'?'НВП':'АӘД',subject:g.language==='ru'?'НВП':'АӘД',short:g.language==='ru'?'НВП':'АӘД',semesters:[1,2],semesterHours:[0,0],teacherIds:[],theoryBySemester:[0,0],practicalBySemester:[0,0],tracks:[[]],sources:[]}),shift:g.shift})));
    for(const c of sourceCourses.concat(referenceCourses)){c.shift=groupMap.get(c.group)?.shift||c.shift;c.teacherIds=c.teacherIds.filter(id=>teacherMap.has(id));}
    courses.splice(0,courses.length,...sourceCourses.concat(additionalCourses,referenceCourses));courseMap.clear();for(const c of courses)courseMap.set(c.id,c);
    calendar.weeks=Math.max(20,...groupRecords.flatMap(g=>g.semesters.map(s=>s.weeks)));data.statistics.subjects=new Set(courses.filter(c=>!c.deleted&&groupMap.has(c.group)).map(c=>c.subject)).size;
    return data;
  }
  const data={applyRegistry,groupName,sortGroups,registryBase,addDays,groups,groupRecords,teachers,staffRecords,curatorAssignments,courses,sourceCourses,additionalCourses,referenceCourses,calendar,shiftFor,shifts,byId,teacherMap,groupMap,createDraft,singleTeacher,previousRow,details,additionalRows,materializeAdditional,teacherGroups,conflicts,pending,allocate,kinds,courseTitle,compactModule,pairCount,isHoliday,rooms,roomLabel,roomKeys,buildingFor,referenceWarnings,referenceSchedule:S.referenceSchedule,roomCatalog:S.roomCatalog||[],issues:S.issues,assumptions:S.assumptions,statistics:{...S.statistics,sourceSubjects:S.statistics.subjects,subjects:new Set(courses.map(c=>c.subject)).size},importId:S.importId,scheduleRevision:S.scheduleRevision};
  globalThis.TiskData=data;
  if(typeof module!=='undefined'&&module.exports)module.exports=data;
})();
