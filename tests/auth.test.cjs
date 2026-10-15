const test=require('node:test'),assert=require('node:assert/strict');
const {renderRole}=require('./ui-harness.cjs');
const submit=get=>get('loginForm').events.submit({preventDefault(){}});
test('Login has no role shortcuts and never trusts stored roles and defaults to server authentication',()=>{
  const get=renderRole(null,{}, {browserSession:[['tisk-demo-user','admin'],['tisk-demo-role','admin']],fetch:async()=>({ok:true,json:async()=>({user:null})})});
  assert.match(get('root').innerHTML,/id="loginForm"/);
  assert.doesNotMatch(get('root').innerHTML,/data-demo|teacherDemo|studentDemo|demo-box/);
  assert.equal(get('login').value,'');assert.equal(get('password').value,'');
  assert.equal(get.session.size,0);
  assert.doesNotMatch(get('root').innerHTML,/data-page="groups"/);
});
test('Shared demo credentials are rejected by the API without a local fallback',async()=>{
  const calls=[];
  const get=renderRole(null,{}, {fetch:async(url,options)=>{calls.push([url,options]);return {ok:url!=='/api/auth/login',json:async()=>url==='/api/auth/login'?{error:'Denied'}:{user:null}}}});
  get('login').value='admin';get('password').value='TiskAdmin26';await submit(get);
  assert.equal(get('loginAlert').textContent,'Denied');assert.equal(get('password').value,'');
  assert.match(get('root').innerHTML,/id="loginForm"/);assert.equal(get.session.size,0);
  const [,options]=calls.find(([url])=>url==='/api/auth/login');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
});
test('API unavailability fails closed',async()=>{
  const get=renderRole(null,{}, {fetch:async()=>{throw Error('Network unavailable')}});
  get('login').value='admin';get('password').value='anything';await submit(get);
  assert.match(get('root').innerHTML,/id="loginForm"/);assert.equal(get.session.size,0);assert.equal(get('loginAlert').textContent,'Network unavailable');
});
test('A verified server login opens the authorized role without saving a browser role',async()=>{
  const get=renderRole(null,{}, {fetch:async url=>({ok:true,json:async()=>url==='/api/auth/login'?{user:{id:'verified-admin',role:'admin',login:'real-admin',name:'Administrator'}}:url==='/api/portal-state'?{workspace:null}:{user:null}})});
  get('login').value='real-admin';get('password').value='unique password';await submit(get);
  assert.match(get('root').innerHTML,/data-page="groups"/);assert.equal(get.session.size,0);
});
test('Logout reports API failure and clears the screen only after server confirmation',async()=>{
  let ok=false;
  const get=renderRole('admin',{}, {fetch:async url=>({ok:url==='/api/auth/logout'?ok:true,json:async()=>({user:null})})});
  await get('logout').onclick();
  assert.match(get('root').innerHTML,/data-page="groups"/);
  assert.match(get('toast').textContent,/Серверден шығу мүмкін болмады/);
  ok=true;await get('logout').onclick();
  assert.match(get('root').innerHTML,/id="loginForm"/);assert.equal(get.session.size,0);
});
test('Explicit Pages demo requires manual credentials for admin, teacher and group, with no API calls',async()=>{
  const get=renderRole(null,{}, {serverAuth:false,browserSession:[['tisk-demo-user','admin']],fetch:async()=>{throw Error('Demo must not use API')}});
  assert.match(get('root').innerHTML,/Демо режимі/);
  assert.doesNotMatch(get('root').innerHTML,/data-demo|teacherDemo|studentDemo/);
  assert.equal(get.session.size,0);assert.equal(get('login').value,'');assert.equal(get('password').value,'');
  get('login').value='admin';get('password').value='wrong';await submit(get);
  assert.match(get('loginAlert').textContent,/қате/);assert.match(get('root').innerHTML,/id="loginForm"/);
  for(const [login,password,admin] of [['admin','TiskAdmin26',true],['teacher001','TIK-teacher001-2026',false],['student001','TIK-student001-2026',false]]){
    get('login').value=login;get('password').value=password;await submit(get);
    assert.match(get('root').innerHTML,/id="logout"/);
    assert.equal(get('root').innerHTML.includes('data-page="groups"'),admin);
    assert.equal(get('password').value,'');assert.equal(get.session.size,0);
    await get('logout').onclick();assert.match(get('root').innerHTML,/id="loginForm"/);
  }
});
test('Only approved demo accounts are documented',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const list=fs.readFileSync(path.join(__dirname,'..','DEMO_ACCOUNTS.md'),'utf8');
  const rows=list.split('\n').filter(line=>/\| (?:admin|teacher\d+|student\d+) \|/.test(line));
  assert.equal(rows.length,11);
  for(const role of ['teacher','student']) for(let i=1;i<=5;i++){
    const login=role+String(i).padStart(3,'0');assert.ok(list.includes(`| ${login} | TIK-${login}-2026 |`));
  }
});
test('Five fictional Kazakh teacher and student profiles can sign in to the Pages demo',async()=>{
  const get=renderRole(null,{}, {serverAuth:false,fetch:async()=>{throw Error('Demo must not use API')}});
  for(const login of ['teacher006','student006','teacher','student']){
    get('login').value=login;get('password').value=`TIK-${login}-2026`;await submit(get);
    assert.match(get('root').innerHTML,/id="loginForm"/);
  }
  const names={teacher:['Айдос Нұрдәулетұлы','Меруерт Қанатқызы','Ерлан Бақытұлы','Гүлназ Серікқызы','Дәурен Асқарұлы'],student:['Әлихан Мақсатұлы','Аружан Ермекқызы','Нұрасыл Даниярұлы','Інжу Маратқызы','Айзере Болатқызы']};
  for(const [role,profiles] of Object.entries(names)){
    for(const [i,name] of profiles.entries()){
      const login=role+String(i+1).padStart(3,'0');
      get('login').value=login;get('password').value=`TIK-${login}-2026`;
      await submit(get);
      assert.ok(get('root').innerHTML.includes(name),`${login} displays ${name}`);
      assert.match(get('root').innerHTML,/id="logout"/);
      assert.ok(!get('root').innerHTML.includes('data-page="groups"'));
      await get('logout').onclick();
    }
  }
});
