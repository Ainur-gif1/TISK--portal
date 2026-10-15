const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../portal-data.js'),S=require('../portal-seed.js');
const schedule=D.createDraft();

test('Archive import retains all source groups and named subjects, with source spelling',()=>{
  assert.equal(D.groups.length,79);assert.equal(new Set(D.groups).size,79);assert.equal(D.teachers.length,150);assert.equal(new Set(D.sourceCourses.map(c=>c.subject)).size,126);
  for(const group of ['КО9-26-20','КО-26-38Д','АЭ 9-24-08р'])assert.ok(D.groups.includes(group));
  assert.equal(new Set(D.teachers.map(t=>t.name)).size,150);
  assert.ok(D.teachers.some(t=>t.name==='Оқытушы 139'));
  assert.equal(S.excludedPracticeRows,390);
  assert.equal(D.issues.filter(i=>i.type==='hours').length,8);
});
test('Shift periods retain ninety minutes and the requested break lengths',()=>{
  assert.deepEqual(D.shifts[1].periods.map(p=>p.label),['08:30 – 10:00','10:15 – 11:45','12:00 – 13:30','13:45 – 15:15']);
  assert.deepEqual(D.shifts[2].periods.map(p=>p.label),['12:00 – 13:30','13:35 – 15:05','15:10 – 16:40','16:45 – 18:15']);
  assert.equal(D.shiftFor('КО9-26-20'),1);assert.equal(D.shiftFor('КО-26-38Д'),2);assert.equal(D.shiftFor(undefined),null);
});
test('Annual schedule preserves source budgets and rejects new conflicts beyond the marked photograph issues',()=>{
  assert.equal(schedule.filter(r=>!r.additional).length,32142);assert.deepEqual(D.conflicts(schedule),[]);
  assert.equal(schedule.map(e=>e.date).sort()[0],'2026-09-02');assert.equal(D.pairCount('2026-09-01'),0);
  assert.ok(D.referenceWarnings(schedule).length>0);assert.ok(D.referenceWarnings(schedule).every(i=>i.date==='2026-09-30'));
  const counts=new Map();
  for(const e of schedule){const key=e.courseId+':'+e.semester;counts.set(key,(counts.get(key)||0)+2)}
  const pending=new Map(D.pending(schedule).map(e=>[e.courseId+':'+e.semester,e.pairs*2]));
  for(const c of D.sourceCourses)for(const semester of c.semesters)assert.equal((counts.get(c.id+':'+semester)||0)+(pending.get(c.id+':'+semester)||0),c.semesterHours[semester-1],c.group+' '+c.subject);
  assert.equal([...pending.values()].reduce((a,b)=>a+b,0),0);
});
test('Impossible teacher capacity remains explicit, and vacant teacher does not invent a person',()=>{
  const pending=D.pending(schedule);assert.equal(pending.reduce((n,r)=>n+r.pairs,0),0);
  assert.ok(pending.every(r=>!['АӘД','НВП','Дала жиыны','Полевой сбор'].includes(D.byId(r.courseId).subject)));
  const teacher=D.teachers.find(t=>t.name==='Оқытушы 119');
  assert.ok(schedule.filter(r=>r.semester===1&&r.teachers.includes(teacher.id)).length>300);
  assert.ok(schedule.filter(r=>r.semester===2&&r.teachers.includes(teacher.id)).length>300);
  assert.ok(schedule.filter(r=>r.unassigned).every(r=>r.teachers.length===0));
  const vacant=D.courses.find(c=>c.group==='BIM9-26-16'&&c.subject==='Қазақ әдебиеті');
  assert.deepEqual(vacant.teacherIds,[]);assert.equal(schedule.filter(r=>r.courseId===vacant.id&&r.unassigned).length,48);
});
test('Every group has exactly four lesson periods on every weekday in both semesters',()=>{
  const byGroup=new Map();for(const row of schedule){const g=D.byId(row.courseId).group;if(!byGroup.has(g))byGroup.set(g,[]);byGroup.get(g).push(row);assert.ok(row.lesson<D.pairCount(row.date))}
  for(const group of D.groupRecords){
    const academic=byGroup.get(group.id)||[],all=academic.concat(D.additionalRows(academic,group.id,group.semesterDates[0][0],group.semesterDates[1][1])),counts=new Map();
    for(const row of all){const key=row.date+':'+row.lesson;if(counts.has(key))assert.ok(row.date==='2026-09-30'&&row.reference&&counts.get(key).reference,'Only marked photograph duplicates are retained: '+group.id+' '+key);counts.set(key,row)}
    for(let date=group.semesterDates[0][0];date<=group.semesterDates[1][1];){
      const days=new Date(date+'T12:00:00Z'),expected=D.pairCount(date);for(let period=0;period<expected;period++)assert.ok(counts.has(date+':'+period),group.id+' '+date);
      assert.ok(!counts.has(date+':'+expected),group.id+' extra pair '+date);days.setUTCDate(days.getUTCDate()+1);date=days.toISOString().slice(0,10);
    }
  }
});
test('All КМ/ПМ module numbers use compact titles, with full titles kept outside timetable rendering',()=>{
  for(const prefix of ['КМ','ПМ'])for(const number of [1,2,3,4,5,6,7])assert.equal(D.courseTitle({module:prefix+number+'.',subject:'Ұзын толық пән атауы'}),prefix+' '+number);
  const vocational=D.courses.filter(c=>/^(КМ|ПМ)\s*\d+/u.test(c.module));assert.ok(vocational.length>200);for(const course of vocational)assert.match(D.courseTitle(course),/^(КМ|ПМ) \d+$/u);
  assert.equal(D.courseTitle({module:'ЖБП 01',subject:'Қазақ тілі'}),'Қазақ тілі');
});
test('Supplemental НВП/АӘД proposals are separate from the source hours and have no invented teacher',()=>{
  const length=schedule.length,g=D.groupRecords[37],rows=D.additionalRows(schedule,g.id,'2026-10-12','2026-10-16');
  assert.ok(rows.length);assert.ok(rows.every(row=>row.rowType==='additional'&&['АӘД','Топ сағаты'].includes(row.short)&&row.teachers.length===0&&row.unassigned));assert.equal(schedule.length,length);
  const ru=D.groupRecords.find(g=>g.language==='ru');assert.ok(D.additionalRows([],ru.id,'2026-10-12','2026-10-16').every(row=>['НВП','Топ сағаты'].includes(row.short)));
  assert.deepEqual(D.pending(schedule.concat(rows.map(D.materializeAdditional))),D.pending(schedule));
  assert.equal(D.pairCount('2026-10-13'),4);assert.equal(D.pairCount('2026-10-12'),4);assert.equal(D.pairCount('2026-10-17'),0);
  const source=schedule.find(row=>row.date==='2026-10-13');assert.match(D.conflicts([{...source,lesson:3}]).join(' '),/жарамсыз/);
});
test('Theory/practical proportions are conserved per course/semester, including mixed pairs',()=>{
  const placedTheory=new Map();for(const e of schedule){const key=e.courseId+':'+e.semester;placedTheory.set(key,(placedTheory.get(key)||0)+(e.kind===0?2:e.kind===2?1:0))}
  const pending=new Set(D.pending(schedule).map(e=>e.courseId+':'+e.semester));
  for(const c of D.sourceCourses)for(const semester of c.semesters)if(!pending.has(c.id+':'+semester))assert.equal(placedTheory.get(c.id+':'+semester)||0,c.theoryBySemester[semester-1],c.group+' '+c.subject);
});
test('Conflict detection rejects overlapping shifts for the same teacher and shared room',()=>{
  const a=D.courses.find(c=>c.shift===1&&c.semesters.includes(1)),b=D.courses.find(c=>c.shift===2&&c.semesters.includes(1)),teacher=D.teachers[0].id;
  const rows=[{id:'a',courseId:a.id,semester:1,date:'2026-09-02',lesson:2,teachers:[teacher],room:''},{id:'b',courseId:b.id,semester:1,date:'2026-09-02',lesson:0,teachers:[teacher],room:''}];
  assert.match(D.conflicts(rows).join(' '),/мұғалім/);
  rows[1].teachers=[D.teachers[1].id];rows[0].room=rows[1].room='101';assert.match(D.conflicts(rows).join(' '),/кабинет/);
  rows[1].room='';rows[0].room='';assert.deepEqual(D.conflicts(rows),[]);
});
test('Unverified payment allocations stay explicit after photo overrides',()=>{
  const course=D.courses.find(c=>c.subgroups===1&&c.teacherAllocationNeedsReview&&c.tracks[0].length===2&&c.tracks[0].every(t=>t.weight!==null)&&c.tracks[0][0].weight!==c.tracks[0][1].weight);
  assert.ok(course);const ids=course.tracks[0].map(t=>t.teacher);
  assert.ok(ids.every(id=>D.teacherMap.has(id)));
  assert.ok(D.issues.some(i=>i.type==='allocation'&&i.courseId===course.id));
});

test('September 30 preserves photographed teachers, shifts and distinct buildings',()=>{
  const rows=schedule.filter(row=>row.sourceRows?.length);assert.equal(rows.length,313);
  const sagieva=D.teachers.find(t=>t.name==='Оқытушы 100'),her=rows.filter(row=>row.teachers.includes(sagieva.id));assert.equal(her.length,2);
  assert.deepEqual(her.map(row=>row.lesson).sort(),[0,1]);assert.ok(her.every(row=>D.byId(row.courseId).group==='КО-26-40Д'&&row.shift===2&&row.room==='404Б'));
  const english=rows.find(row=>D.byId(row.courseId).group==='АЭ9-26-06'&&row.lesson===0);
  assert.equal(english.teachers.length,1);assert.ok(['Оқытушы 056','Оқытушы 093'].includes(D.details(english).teacherNames[0]));assert.equal(D.roomKeys(english).length,1);
  assert.match(D.details(english).roomLabel,/(313|204) · А корпус/);assert.match(D.details(her[0]).roomLabel,/404 · Б корпус/);assert.equal(D.pairCount('2026-09-30'),4);
});
test('Room keys distinguish buildings and normalize Latin/Cyrillic input; new overlaps remain blocked',()=>{
  const a=D.sourceCourses.find(c=>c.shift===1),b=D.sourceCourses.find(c=>c.shift===2),rows=[{id:'ra',courseId:a.id,semester:1,date:'2026-09-02',lesson:2,teachers:[],room:'204А'},{id:'rb',courseId:b.id,semester:1,date:'2026-09-02',lesson:0,teachers:[],room:'204Б'}];
  assert.deepEqual(D.conflicts(rows),[]);rows[1].room='204A';assert.match(D.conflicts(rows).join(' '),/кабинет/);
  const photo=schedule.find(row=>row.reference&&row.room==='404Б'),duplicate={...photo,id:'new-unapproved-photo-duplicate'};assert.match(D.conflicts([...schedule,duplicate]).join(' '),/қабаттасады/);
});
test('Ordinary draft classrooms follow the requested building and use only photographed room numbers',()=>{
  const catalog=new Set(D.roomCatalog.map(r=>r.key));for(const row of schedule.filter(r=>!r.reference))for(const key of D.roomKeys(row)){assert.ok(catalog.has(key));assert.ok(key.endsWith(D.buildingFor(D.byId(row.courseId))))}
  assert.ok(schedule.some(row=>!row.reference&&D.compactModule(D.byId(row.courseId))&&row.room.endsWith('Б')));
  assert.ok(schedule.some(row=>!row.reference&&D.byId(row.courseId).subject==='Қазақ тілі'&&row.room.endsWith('А')));
});
test('Original pending defense lessons were assigned to actual teachers without overlaps',()=>{
  assert.equal(S.substitutions.length,52);const defense=S.substitutions.filter(s=>['АӘД','НВП','Дала жиыны','Полевой сбор'].includes(D.byId(s.courseId).subject));assert.equal(defense.length,50);
  for(const item of S.substitutions){const row=schedule.find(r=>r.id===item.id);assert.ok(row);assert.ok(D.teacherMap.has(row.teachers[0]));assert.ok(D.teacherGroups(schedule,row.teachers[0]).includes(item.group));}
  assert.deepEqual(D.conflicts(schedule),[]);
});
test('Admin can turn a supplemental proposal into an assigned class that appears for that teacher',()=>{
  const proposal=D.additionalRows(schedule,D.groups[37],'2026-10-12','2026-10-16')[0],row=D.materializeAdditional(proposal),free=D.teachers.find(t=>!schedule.some(r=>r.teachers.includes(t.id)));
  row.teachers=[free.id];row.unassigned=false;
  assert.deepEqual(D.conflicts([...schedule,row]),[]);assert.ok(D.teacherGroups([...schedule,row],free.id).includes(row.group||D.byId(row.courseId).group));assert.deepEqual(D.pending([...schedule,row]),D.pending(schedule));
});
