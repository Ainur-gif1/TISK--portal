const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../portal-seed.js'),C=require('../portal-curators.js'),P=require('../portal-admin.js');
const allowed=new Set(['Айдос Нұрдәулетұлы','Меруерт Қанатқызы','Ерлан Бақытұлы','Гүлназ Серікқызы','Дәурен Асқарұлы']);
test('Published teacher and curator identities use the approved list or neutral labels',()=>{
  const curriculum=require('../data/curriculum.json');
  const byId=new Map(S.teachers.map(t=>[t.id,t.name]));
  for(const t of [...S.teachers,...curriculum.teachers]){
    assert.ok(allowed.has(t.name)||/^Оқытушы \d{3}$/.test(t.name),t.name);
    assert.equal(t.name,byId.get(t.id));
    for(const name of [...t.aliases,...t.sourceForms]) assert.equal(name,t.name);
  }
  for(const row of C.assignments){
    assert.ok(allowed.has(row.curatorName)||/^(Оқытушы|Куратор) \d{3}$/.test(row.curatorName),row.curatorName);
    if(row.teacherId) assert.equal(row.curatorName,byId.get(row.teacherId));
  }
  assert.equal(P.empty().adminName,'Портал әкімшісі');
  for(const file of ['portal-seed.js','portal-curators.js','portal-admin.js','portal.js']){
    assert.equal(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),fs.readFileSync(path.join(__dirname,'..','dist',file),'utf8'));
  }
});
test('Revision one cached names migrate to the approved identities without changing timetable rows',()=>{
  const state=P.empty();state.fictionalNamesRevision=1;state.adminName='Ескі әкімші';
  const t=S.teachers[5];state.registry.teachers[t.id]={name:'Ескі есім',displayName:'Ескі есім',department:'Демо'};
  state.schedule=[{id:'saved-row',room:'101А'}];let saved=JSON.stringify(state);
  const migrated=P.load({getItem:()=>saved,setItem:(key,value)=>{saved=value;}});
  assert.equal(migrated.fictionalNamesRevision,2);assert.equal(migrated.adminName,'Портал әкімшісі');
  assert.equal(migrated.registry.teachers[t.id].name,undefined);assert.equal(migrated.registry.teachers[t.id].department,'Демо');
  assert.deepEqual(migrated.schedule,state.schedule);
});
