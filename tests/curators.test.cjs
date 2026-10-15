const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../portal-data.js'),S=require('../portal-seed.js');
const {renderRole}=require('./ui-harness.cjs');
test('Curators cover existing groups without changing group IDs, teacher accounts or timetable identities',()=>{
  assert.equal(D.curatorAssignments.length,79);
  assert.equal(new Set(D.curatorAssignments.map(row=>row.groupId)).size,79);
  assert.deepEqual(D.groups,S.groups.map(g=>g.id));
  assert.equal(D.teachers.length,S.teachers.length);
  for(const group of D.groupRecords){assert.ok(group.curator);const staff=D.staffRecords.filter(t=>t.curatorGroups.includes(group.id));assert.equal(staff.length,1);if(group.curator.teacherId)assert.equal(staff[0].id,group.curator.teacherId);else assert.equal(staff[0].login,null);}
  assert.equal(D.groupMap.get('ЭС9-26-01').curator.curatorName,'Санжар Нұрбекұлы');
  assert.equal(D.groupMap.get('КО9-26-23').curator.curatorName,'Айсұлу Арманқызы');
  assert.equal(D.groupMap.get('ҚШ9-26-15Д').curator.sourceGroup,'КШ9-26-15');
  assert.equal(D.groupMap.get('Д9-26-19').curator.sourceGroup,'Д9-27-19');
  assert.equal(D.teacherMap.get(D.groupMap.get('ЭС9-26-01').curator.teacherId).login,'teacher059');
});
test('Admin can find a group by curator and its teacher by group, including corrected names and directory-only curators',()=>{
  const get=renderRole('admin');get('nav-groups').onclick();
  assert.equal((get('main').innerHTML.match(/<b>Куратор:<\/b>/g)||[]).length,79);
  get('registrySearch').onchange({target:{value:'Айсұлу Арманқызы'}});
  assert.match(get('main').innerHTML,/КО9-26-23/);assert.match(get('main').innerHTML,/Айсұлу Арманқызы/);
  assert.equal((get('main').innerHTML.match(/class="group-card"/g)||[]).length,1);
  get('nav-staff').onclick();get('registrySearch').onchange({target:{value:'ЭС9-26-01'}});
  assert.match(get('main').innerHTML,/Санжар Нұрбекұлы/);assert.match(get('main').innerHTML,/Куратор ·/);
  assert.equal((get('main').innerHTML.match(/class="person"/g)||[]).length,1);
  get('registrySearch').onchange({target:{value:'Ердәулет Қуанышұлы'}});
  assert.match(get('main').innerHTML,/КО-26-39Д/);assert.match(get('main').innerHTML,/Куратор ·/);
});
