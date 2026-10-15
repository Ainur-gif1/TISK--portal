(function () {
  'use strict';
  const D = TiskData,
    C = TiskCalendar,
    P = TiskAdmin,
    days = ['Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма'];
  let workspace = P.load();
  D.applyRegistry(workspace.registry, workspace.calendar);
  const root = document.getElementById('root'),
    seed = D.createDraft();
  let baseline = P.fitCalendar(P.project(seed, workspace.registry)),
    baselineMap = new Map(baseline.map((row) => [row.id, row]));
  const legacyKey = 'tisk-portal-balapan-2026-2027-v1';
  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || fallback;
    } catch {
      return fallback;
    }
  }
  let patch = workspace.schedule || readJSON(legacyKey, null);
  if (!workspace.schedule && patch && patch.scheduleRevision !== D.scheduleRevision) {
    const migrated = {};
    for (const [id, row] of Object.entries(patch.overrides || {})) {
      const previous = D.previousRow(id, patch.scheduleRevision),
        base = baselineMap.get(id);
      if (!base) continue;
      const edits = previous
        ? Object.fromEntries(
            Object.entries(row).filter(
              ([k, v]) => JSON.stringify(v) !== JSON.stringify(previous[k])
            )
          )
        : row;
      migrated[id] = { ...base, ...edits };
    }
    try {
      localStorage.setItem(legacyKey + '-before-weekday19', JSON.stringify(patch));
    } catch {}
    patch = { ...patch, overrides: migrated };
  }
  let schedule = baseline
    .map((row) => ({ ...structuredClone(row), ...(patch?.overrides?.[row.id] || {}) }))
    .filter((row) => !patch?.deleted?.includes(row.id));
  if (Array.isArray(patch?.added))
    schedule.push(...patch.added.filter((row) => D.byId(row.courseId)));
  schedule = P.active(schedule).map((row) => D.singleTeacher(row));
  if (D.conflicts(schedule).length) {
    if (patch)
      try {
        localStorage.setItem('tik-schedule-before-settings', JSON.stringify(patch));
      } catch {}
    schedule = structuredClone(baseline);
  }
  const serverAuth = globalThis.TISK_SERVER_AUTH !== false; // Only an explicit static-demo configuration enables browser login.
  let photos = readJSON('tisk-demo-photos', {}),
    USERS = {},
    groupStudents = [],
    firstTeacher,
    session = null;
  function rebuildUsers() {
    firstTeacher =
      D.teachers.find((t) => D.sourceCourses.some((c) => c.teacherIds.includes(t.id))) ||
      D.teachers[0];
    const admin = {
      key: 'admin',
      login: 'admin',
      role: 'admin',
      name: workspace.adminName || 'Туребай Диана',
      id: 'ADM-001',
      department: 'Оқу бөлімі',
      initials: (workspace.adminName || 'Туребай Диана')
        .split(' ')
        .map((x) => x[0])
        .slice(0, 2)
        .join(''),
      color: '#d7e8e4'
    };
    groupStudents = D.groupRecords.map((g) => {
      let i = D.registryBase.groups.findIndex((b) => b.id === g.id);
      if (i < 0)
        i =
          D.registryBase.groups.length +
          workspace.registry.addedGroups.findIndex((b) => b.id === g.id);
      return {
        key: 'group-student-' + i,
        id: 'GROUP-STUDENT-' + i,
        login: 'student' + String(i + 1).padStart(3, '0'),
        role: 'student',
        name: 'Студент',
        group: g.id,
        department: D.groupName(g.id),
        initials: 'С',
        color: '#e1e6f1'
      };
    });
    const named = D.teachers.map((t) => ({
      ...t,
      key: t.id,
      role: 'teacher',
      name: t.displayName
    }));
    USERS = {
      admin,
      ...(firstTeacher
        ? {
            teacher: {
              ...firstTeacher,
              key: 'teacher',
              login: 'teacher',
              role: 'teacher',
              name: firstTeacher.displayName
            }
          }
        : {}),
      ...(groupStudents[0]
        ? { student: { ...groupStudents[0], key: 'student', login: 'student' } }
        : {}),
      ...Object.fromEntries([...named, ...groupStudents].map((u) => [u.key, u]))
    };
    if (session && !session.key.startsWith('server:')) session = USERS[session.key] || null;
  }
  rebuildUsers();
  sessionStorage.removeItem('tisk-demo-user');
  sessionStorage.removeItem('tisk-demo-role');
  let page = 'home',
    semester = 1,
    week = 1,
    shiftFilter = 0,
    groupFilter = session?.role === 'admin' ? D.groups[0] : '',
    dirty = false,
    calendarOpen = false,
    registrySearch = '',
    editorDate = '';
  let settings = D.calendar.starts,
    calendarMonth = C.parse(D.calendar.starts[1]);
  function persist() {
    const overrides = {},
      added = [],
      ids = new Set(schedule.map((r) => r.id));
    for (const row of schedule) {
      const base = baselineMap.get(row.id);
      if (!base) added.push(row);
      else if (JSON.stringify(row) !== JSON.stringify(base)) overrides[row.id] = row;
    }
    workspace.schedule = {
      overrides,
      added,
      deleted: baseline.filter((r) => !ids.has(r.id)).map((r) => r.id)
    };
    try {
      P.save(workspace);
      dirty = false;
      if (serverAuth && session?.role === 'admin')
        fetch('/api/portal-state', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workspace)
        })
          .then(async (response) => {
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              toast(data.error || 'Өзгеріс сервер базасына сақталмады.');
            }
          })
          .catch(() => toast('Сервер базасына қосылмады. Өзгеріс осы браузерде ғана сақталды.'));
      return true;
    } catch {
      toast('Өзгеріс сақталмады. Браузерде орын жеткіліксіз.');
      return false;
    }
  }
  function rebaseRow(row, oldMap, newMap) {
    const old = oldMap.get(row.id),
      base = newMap.get(row.id);
    if (!base) return row;
    const changes = old
      ? Object.fromEntries(
          Object.entries(row).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(old[k]))
        )
      : row;
    return { ...structuredClone(base), ...changes, date: changes.date ? row.date : base.date };
  }
  function editWorkspace(mutator) {
    const before = structuredClone(workspace),
      beforeRows = structuredClone(schedule),
      beforeBase = baseline,
      oldMap = baselineMap;
    try {
      mutator(workspace);
      D.applyRegistry(workspace.registry, workspace.calendar);
      baseline = P.fitCalendar(P.project(seed, workspace.registry));
      baselineMap = new Map(baseline.map((r) => [r.id, r]));
      const ids = new Set(beforeRows.map((r) => r.id)),
        beforeRowMap = new Map(beforeRows.map((r) => [r.id, r]));
      let rows = baseline
        .filter((r) => ids.has(r.id) || !oldMap.has(r.id))
        .map((r) => {
          const old = beforeRowMap.get(r.id);
          return old ? rebaseRow(old, oldMap, baselineMap) : r;
        });
      rows.push(...beforeRows.filter((r) => !oldMap.has(r.id) && D.byId(r.courseId)));
      schedule = P.fitCalendar(rows);
      for (const operation of workspace.operations.filter((o) => o.active)) {
        operation.before = operation.before.map((r) => rebaseRow(r, oldMap, baselineMap));
        operation.after = operation.after.map((r) =>
          structuredClone(schedule.find((x) => x.id === r.id) || r)
        );
      }
      rebuildUsers();
      if (!persist()) throw Error('Өзгеріс сақталмады.');
      if (groupFilter && !D.groupMap.has(groupFilter)) groupFilter = D.groups[0] || '';
      setViewDate();
      closeModal();
      render();
      toast('Өзгеріс сақталды.');
      return true;
    } catch (error) {
      workspace = before;
      D.applyRegistry(workspace.registry, workspace.calendar);
      schedule = beforeRows;
      baseline = beforeBase;
      baselineMap = oldMap;
      rebuildUsers();
      modalError(error.message);
      return false;
    }
  }
  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function selectedGroup() {
    return D.groupMap.get(session?.role === 'student' ? session.group : groupFilter);
  }

  function limits() {
    const group = selectedGroup();
    return group
      ? { 1: group.semesters[0].weeks, 2: group.semesters[1].weeks }
      : { 1: D.calendar.weeks, 2: D.calendar.weeks };
  }

  function locate(date) {
    const found = C.locate(date, settings, D.calendar.weeks);
    return found && found.week <= limits()[found.semester] ? found : null;
  }

  function setViewDate(date = new Date()) {
    const group = selectedGroup();
    settings = group
      ? { 1: group.semesterDates[0][0], 2: group.semesterDates[1][0] }
      : D.calendar.starts;
    const current = locate(date);
    semester = current?.semester || 1;
    week = current?.week || 1;
    syncMonth();
  }

  function dateFor(day = 0) {
    return C.weekDate(settings, semester, week, day);
  }

  function syncMonth() {
    const date = dateFor();
    calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  }

  function fmt(date) {
    return date.toLocaleDateString('kk-KZ', { day: '2-digit', month: 'short' });
  }
  function displayDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[3] + '.' + match[2] + '.' + match[1] : value;
  }

  function weekLabel() {
    return C.range(dateFor(), dateFor(4));
  }

  function semesterName(s = semester) {
    return s + '-семестр';
  }

  function avatar(person, large = false) {
    const photo = photos[person.id];
    return (
      '<div class="avatar ' +
      (large ? 'large' : '') +
      '" style="background:' +
      person.color +
      '">' +
      (photo ? '<img src="' + esc(photo) + '" alt="Профиль фотосы">' : esc(person.initials)) +
      '</div>'
    );
  }

  function monthCalendar() {
    const min = C.ordinal(C.parse(settings[1])),
      max = C.ordinal(C.add(C.weekDate(settings, 2, limits()[2]), 6)),
      selected = C.ordinal(dateFor()),
      today = C.iso(new Date());
    const prevEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 0, 12),
      nextStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1, 12);
    return (
      '<section id="monthCalendar" class="month-calendar" aria-label="Аптаны күнтізбеден таңдау"><div class="month-header"><button id="prevMonth" class="soft-button" ' +
      (C.ordinal(prevEnd) < min ? 'disabled' : '') +
      ' aria-label="Алдыңғы ай">‹</button><h3>' +
      C.months[calendarMonth.getMonth()] +
      ' ' +
      calendarMonth.getFullYear() +
      '</h3><button id="nextMonth" class="soft-button" ' +
      (C.ordinal(nextStart) > max ? 'disabled' : '') +
      ' aria-label="Келесі ай">›</button></div><div class="month-days">' +
      ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс']
        .map((day) => '<span class="month-day-name">' + day + '</span>')
        .join('') +
      C.monthGrid(calendarMonth)
        .map((date) => {
          const ordinal = C.ordinal(date),
            inWeek = ordinal >= selected && ordinal < selected + 7,
            classes = [
              'month-day',
              date.getMonth() !== calendarMonth.getMonth() ? 'other-month' : '',
              inWeek ? 'selected-week' : '',
              C.iso(date) === today ? 'today' : ''
            ]
              .filter(Boolean)
              .join(' ');
          return (
            '<button class="' +
            classes +
            '" data-date="' +
            C.iso(date) +
            '" ' +
            (!locate(date) ? 'disabled' : '') +
            ' aria-label="' +
            date.getDate() +
            ' ' +
            C.months[date.getMonth()].toLowerCase() +
            ' ' +
            date.getFullYear() +
            '" aria-pressed="' +
            inWeek +
            '">' +
            date.getDate() +
            '</button>'
          );
        })
        .join('') +
      '</div><p class="calendar-hint">Күнді таңдағанда сол аптаның сабақтары көрсетіледі.</p></section>'
    );
  }

  function attachPhoto() {
    const input = document.getElementById('photoInput');
    if (input)
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > 900000) {
          toast('900 КБ-тан аспайтын суретті таңдаңыз.');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          photos[session.id] = reader.result;
          try {
            localStorage.setItem('tisk-demo-photos', JSON.stringify(photos));
            render();
            toast('Фото осы браузерде сақталды');
          } catch {
            toast('Фото сақталмады');
          }
        };
        reader.readAsDataURL(file);
      };
  }

  /* UI additions below */
  function teacherOptions(value = '', none = true) {
    return (
      (none ? '<option value="">Белгіленбеген</option>' : '') +
      D.teachers
        .map(
          (t) =>
            '<option value="' +
            t.id +
            '" ' +
            (value === t.id ? 'selected' : '') +
            '>' +
            esc(t.displayName) +
            '</option>'
        )
        .join('')
    );
  }
  function lessonOptions(group, semester, selected) {
    return D.courses
      .filter((c) => !c.deleted && c.group === group && c.semesters.includes(Number(semester)))
      .map(
        (c) =>
          '<option value="' +
          c.id +
          '" ' +
          (c.id === selected ? 'selected' : '') +
          '>' +
          esc(D.courseTitle(c)) +
          '</option>'
      )
      .join('');
  }
  function lessonTeacherOptions(courseId, selected) {
    const course = D.byId(courseId),
      ids = [...(course?.teacherIds || [])];
    if (selected && !ids.includes(selected)) ids.unshift(selected);
    return (
      ids
        .map((id) => D.teacherMap.get(id))
        .filter(Boolean)
        .map(
          (t) =>
            '<option value="' +
            t.id +
            '" ' +
            (t.id === selected ? 'selected' : '') +
            '>' +
            esc(t.displayName + ' · ' + D.groupName(course.group) + ' · ' + D.courseTitle(course)) +
            '</option>'
        )
        .join('') || '<option value="">Оқытушы белгіленбеген</option>'
    );
  }
  function groupOptions(value, all = true, allowed) {
    return (
      (all ? '<option value="">Барлық топтар</option>' : '') +
      D.sortGroups(allowed || D.groups)
        .map(
          (id) =>
            '<option value="' +
            esc(id) +
            '" ' +
            (value === id ? 'selected' : '') +
            '>' +
            esc(D.groupName(id)) +
            '</option>'
        )
        .join('')
    );
  }
  function bindRemoteUser(user) {
    if (!user) return null;
    if (user.role === 'admin')
      return {
        ...USERS.admin,
        key: 'server:' + user.id,
        id: user.id,
        login: user.login,
        name: user.name
      };
    if (user.role === 'teacher') {
      const teacher = USERS[user.teacherId];
      return teacher
        ? { ...teacher, key: 'server:' + user.id, login: user.login, name: user.name }
        : null;
    }
    if (user.role === 'student') {
      const base = groupStudents.find((s) => s.group === user.groupId);
      return base
        ? {
            ...base,
            key: 'server:' + user.id,
            id: user.id,
            login: user.login,
            name: user.name,
            group: user.groupId
          }
        : null;
    }
    return null;
  }
  async function hydrateServerWorkspace() {
    try {
      const response = await fetch('/api/portal-state', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.workspace) {
        workspace = data.workspace;
        P.save(workspace);
        D.applyRegistry(workspace.registry, workspace.calendar);
        baseline = P.fitCalendar(P.project(seed, workspace.registry));
        baselineMap = new Map(baseline.map((row) => [row.id, row]));
        const saved = workspace.schedule || {};
        schedule = baseline
          .map((row) => ({ ...structuredClone(row), ...(saved.overrides?.[row.id] || {}) }))
          .filter((row) => !saved.deleted?.includes(row.id));
        schedule.push(...(saved.added || []).filter((row) => D.byId(row.courseId)));
        schedule = P.active(schedule).map((row) => D.singleTeacher(row));
        if (D.conflicts(schedule).length) schedule = structuredClone(baseline);
        rebuildUsers();
      } else if (session?.role === 'admin') {
        await fetch('/api/portal-state', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workspace)
        });
      }
    } catch {
      toast('Ортақ база күйін жүктеу мүмкін болмады.');
    }
    setViewDate();
  }
  async function loadRemoteSession() {
    try {
      const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store'
        }),
        data = await response.json();
      if (data.user) {
        session = bindRemoteUser(data.user);
        if (session) {
          page = 'home';
          groupFilter = session.role === 'admin' ? D.groups[0] : '';
          await hydrateServerWorkspace();
          render();
        }
      }
    } catch {}
  }
  function loginScreen(message = '') {
    root.innerHTML =
      '<main class="login-page"><header class="login-brand"><div class="mark">TIK</div><div class="brand-name">TIK College</div></header><section class="login-wrap"><div class="login-card"><div class="login-inner"><h1>Порталға кіру</h1>' +
      (serverAuth
        ? ''
        : '<p class="demo-note">Демо режимі. Деректер жалпыға қолжетімді; өзгерістер осы браузерде ғана сақталады.</p>') +
      '<form id="loginForm"><label class="label" for="login">Логин</label><input id="login" class="field" autocomplete="username" required><label class="label" for="password">Құпиясөз</label><input id="password" class="field" type="password" autocomplete="current-password" required><div id="loginAlert" class="login-alert">' +
      esc(message) +
      '</div><button class="login-button" type="submit">Кіру →</button></form></div></div>' +
      '</section></main>';
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
  }

  function showLoginError(message) {
    const alert = document.getElementById('loginAlert');
    if (alert) alert.textContent = message;
  }

  function authenticateDemoUser(login, password) {
    const user = Object.values(USERS).find((account) => account.login === login);
    if (!user) throw Error('Логин немесе құпиясөз қате.');

    const expectedPassword = user.role === 'admin' ? 'TiskAdmin26' : `TIK-${user.login}-2026`;
    if (password !== expectedPassword) throw Error('Логин немесе құпиясөз қате.');
    return user;
  }

  async function authenticateServerUser(username, password) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Кіру мүмкін болмады.');

    const user = bindRemoteUser(data.user);
    if (!user) throw Error('Бұл аккаунт порталдағы топпен немесе оқытушымен байланыспаған.');
    return user;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const login = document.getElementById('login').value.trim();
    const passwordField = document.getElementById('password');
    const password = passwordField.value;
    passwordField.value = '';

    try {
      session = serverAuth
        ? await authenticateServerUser(login, password)
        : authenticateDemoUser(login, password);
      page = 'home';
      groupFilter = session.role === 'admin' ? D.groups[0] : '';
      shiftFilter = 0;

      if (serverAuth) await hydrateServerWorkspace();
      else setViewDate();
      render();
    } catch (error) {
      showLoginError(error.message || 'Сервермен байланыс жоқ.');
    }
  }

  async function handleLogout() {
    if (serverAuth) {
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin'
        });
        if (!response.ok) throw Error('logout failed');
      } catch {
        toast('Серверден шығу мүмкін болмады. Қайта көріңіз.');
        return;
      }
    }

    sessionStorage.removeItem('tisk-demo-user');
    sessionStorage.removeItem('tisk-demo-role');
    session = null;
    closeModal();
    loginScreen();
  }

  function navItems() {
    return session.role === 'admin'
      ? [
          ['home', '⌂', 'Басты бет'],
          ['schedule', '▦', 'Кестені басқару'],
          ['groups', '▤', 'Топтар'],
          ['staff', '♙', 'Оқытушылар'],
          ['subjects', '▥', 'Пәндер'],
          ...(serverAuth ? [['accounts', '♙', 'Аккаунттар']] : [])
        ]
      : [
          ['home', '⌂', 'Басты бет'],
          ['schedule', '▦', 'Сабақ кестесі']
        ];
  }
  function appShell() {
    root.innerHTML =
      '<div id="app"><header class="app-header"><div class="brand"><div class="mark">TIK</div><div>TIK College</div></div><div class="head-right"><button id="academicYear" class="year-pill" ' +
      (session.role !== 'admin' ? 'disabled' : '') +
      '>' +
      D.calendar.year +
      ' <span>⌄</span></button><button id="logout" class="icon-btn">Шығу ↗</button></div></header><div class="app-layout"><aside class="sidebar"><div class="role-tag">' +
      { admin: 'ОҚУ БӨЛІМІ', teacher: 'ОҚЫТУШЫ', student: 'СТУДЕНТ' }[session.role] +
      '</div><nav class="nav">' +
      navItems()
        .map(
          (n) =>
            '<button data-page="' +
            n[0] +
            '" class="' +
            (page === n[0] ? 'active' : '') +
            '"><span class="ico">' +
            n[1] +
            '</span>' +
            n[2] +
            '</button>'
        )
        .join('') +
      '</nav><div class="side-user">' +
      avatar(session) +
      '<div class="user-text"><b>' +
      esc(session.name) +
      '</b>' +
      (session.role === 'admin'
        ? '<button id="adminProfile" class="text-button">Админ · өңдеу</button>'
        : '') +
      '</div></div></aside><main id="main" class="main"></main></div></div>';
    document.getElementById('logout').onclick = handleLogout;
    document.querySelectorAll('[data-page]').forEach(
      (b) =>
        (b.onclick = () => {
          page = b.dataset.page;
          registrySearch = '';
          calendarOpen = false;
          closeModal();
          render();
        })
    );
    if (session.role === 'admin') {
      document.getElementById('academicYear').onclick = yearModal;
      document.getElementById('adminProfile').onclick = nameModal;
    }
  }
  function profileCard() {
    return (
      '<section class="profile-card">' +
      avatar(session, true) +
      '<div class="profile-info"><span class="eyebrow">Жеке профиль</span><h2>' +
      esc(session.name) +
      '</h2>' +
      (session.role !== 'admin'
        ? '<p>' +
          esc(
            session.group
              ? D.groupName(session.group)
              : session.curatorGroups?.length
                ? 'Куратор · ' + session.curatorGroups.map(D.groupName).join(', ')
                : 'Оқытушы'
          ) +
          '</p>'
        : '') +
      '</div><label class="photo-button">Фото қою<input id="photoInput" type="file" accept="image/*" hidden></label>' +
      (session.role === 'admin'
        ? '<button id="profileEdit" class="soft-button">Атын өзгерту</button>'
        : '') +
      '</section>'
    );
  }
  function renderHome() {
    document.getElementById('main').innerHTML =
      '<h1 class="page-title">' +
      (session.role === 'admin' ? 'Оқу бөлімі' : 'Басты бет') +
      '</h1>' +
      profileCard() +
      (session.role === 'admin'
        ? ''
        : '<section class="card"><div class="card-head"><h3>Апталық сабақ кестесі</h3><button id="goSchedule" class="soft-button">Кестені ашу →</button></div>' +
          weekGrids() +
          '</section>');
    if (session.role === 'admin') document.getElementById('profileEdit').onclick = nameModal;
    else
      document.getElementById('goSchedule').onclick = () => {
        page = 'schedule';
        render();
      };
    attachPhoto();
  }
  function visibleRows(includeAdditional = false) {
    const from = C.iso(dateFor()),
      to = C.iso(dateFor(4));
    let rows = P.active(schedule)
      .filter((r) => r.date >= from && r.date <= to && !D.isHoliday(r.date))
      .map(D.details)
      .filter(Boolean)
      .filter((r) =>
        session.role === 'student'
          ? r.group === session.group
          : (!shiftFilter || r.shift === shiftFilter) &&
            (!groupFilter || r.group === groupFilter) &&
            (session.role !== 'teacher' || r.teachers.includes(session.id))
      );
    const group = selectedGroup();
    if (
      includeAdditional &&
      group &&
      session.role !== 'teacher' &&
      (!shiftFilter || shiftFilter === group.shift)
    )
      rows = rows.concat(
        D.additionalRows(schedule, group.id, from, to).filter((r) => r.shift === group.shift)
      );
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.period.from - b.period.from);
  }
  function toolbar() {
    return (
      '<div class="schedule-controls"><div class="segmented">' +
      [1, 2]
        .map(
          (s) =>
            '<button data-sem="' +
            s +
            '" class="' +
            (semester === s ? 'selected' : '') +
            '">' +
            semesterName(s) +
            '</button>'
        )
        .join('') +
      '</div><div class="date-navigation"><button id="prevWeek" class="soft-button" ' +
      (week === 1 ? 'disabled' : '') +
      '>←</button><button id="calendarToggle" class="date-toggle" aria-expanded="' +
      calendarOpen +
      '">▦ ' +
      weekLabel() +
      ' ⌄</button><button id="nextWeek" class="soft-button" ' +
      (week === limits()[semester] ? 'disabled' : '') +
      '>→</button><button id="currentWeek" class="soft-button">Осы апта</button></div>' +
      (session.role !== 'student'
        ? '<select id="groupSelect" class="year-select" aria-label="Топ">' +
          groupOptions(
            groupFilter,
            true,
            session.role === 'teacher' ? D.teacherGroups(schedule, session.id) : undefined
          ) +
          '</select><select id="shiftSelect" class="year-select" aria-label="Ауысым"><option value="0">Барлық ауысым</option><option value="1" ' +
          (shiftFilter === 1 ? 'selected' : '') +
          '>1-ауысым</option><option value="2" ' +
          (shiftFilter === 2 ? 'selected' : '') +
          '>2-ауысым</option></select>'
        : '') +
      '</div>' +
      (calendarOpen ? monthCalendar() : '')
    );
  }
  function attachToolbar() {
    document.querySelectorAll('[data-sem]').forEach(
      (b) =>
        (b.onclick = () => {
          semester = Number(b.dataset.sem);
          week = 1;
          calendarOpen = false;
          syncMonth();
          render();
        })
    );
    document.getElementById('prevWeek').onclick = () => {
      week = Math.max(1, week - 1);
      syncMonth();
      render();
    };
    document.getElementById('nextWeek').onclick = () => {
      week = Math.min(limits()[semester], week + 1);
      syncMonth();
      render();
    };
    document.getElementById('calendarToggle').onclick = () => {
      calendarOpen = !calendarOpen;
      if (calendarOpen) syncMonth();
      render();
    };
    document.getElementById('currentWeek').onclick = () => {
      const now = locate(new Date());
      if (!now) {
        toast('Бұл күнге оқу аптасы белгіленбеген.');
        return;
      }
      semester = now.semester;
      week = now.week;
      calendarOpen = false;
      syncMonth();
      render();
    };
    if (calendarOpen) {
      document.getElementById('prevMonth').onclick = () => {
        calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1, 12);
        render();
      };
      document.getElementById('nextMonth').onclick = () => {
        calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1, 12);
        render();
      };
      document.querySelectorAll('[data-date]').forEach(
        (b) =>
          (b.onclick = () => {
            const found = locate(C.parse(b.dataset.date));
            if (!found) return;
            semester = found.semester;
            week = found.week;
            calendarOpen = false;
            syncMonth();
            render();
          })
      );
    }
    if (session.role !== 'student') {
      document.getElementById('shiftSelect').onchange = (e) => {
        shiftFilter = Number(e.target.value);
        render();
      };
      document.getElementById('groupSelect').onchange = (e) => {
        const date = dateFor();
        groupFilter = e.target.value;
        shiftFilter = 0;
        setViewDate(date);
        render();
      };
    }
  }
  function calendarSettings() {
    const g = selectedGroup(),
      ranges = g?.semesterDates ||
        workspace.calendar.ranges.all || [
          [D.calendar.starts[1], D.calendar.ends[1]],
          [D.calendar.starts[2], D.calendar.ends[2]]
        ],
      holidays = D.calendar.holidays || [],
      formattedHolidays = holidays.map(displayDate).join(', ');
    return (
      '<section class="card calendar-settings"><div class="card-head"><h3>Сабақ 2 қыркүйектен басталады</h3>' +
      (session.role === 'admin'
        ? '<button id="editSemesterDates" class="soft-button">Мерзімдерді өзгерту</button>'
        : '') +
      '</div><div class="semester-ranges">' +
      ranges
        .map(
          (r, i) =>
            '<div class="semester-range semester-' +
            (i + 1) +
            '"><span>' +
            semesterName(i + 1) +
            '</span><b>' +
            esc(displayDate(r[0]) + ' — ' + displayDate(r[1])) +
            '</b></div>'
        )
        .join('') +
      '</div><div class="holiday-setting"><label for="holidayDate">Мейрам күндері:</label>' +
      (session.role === 'admin'
        ? '<textarea id="holidayDate" class="holiday-input" rows="2" placeholder="16.12.2026, 22.03.2027, 23.03.2027">' +
          esc(formattedHolidays) +
          '</textarea><button id="saveHoliday" class="soft-button">Сақтау</button><small>Күндерді күн.ай.жыл ретімен, үтірмен бөліңіз. Мейрам күндері сабақ кестесі жасалмайды.</small>'
        : '<span>' + esc(formattedHolidays || 'Белгіленбеген') + '</span>') +
      '</div></section>'
    );
  }

  function weekGrids() {
    const group = selectedGroup();
    if (group && shiftFilter && shiftFilter !== group.shift)
      return '<div class="empty-state">Бұл ауысымда емес.</div>';
    const rows = visibleRows(true),
      numbers = group ? [group.shift] : shiftFilter ? [shiftFilter] : [1, 2];
    return numbers
      .map((number) => {
        const shift = D.shifts[number];
        let grid =
          '<section class="shift-section"><div class="shift-caption"><b>' +
          shift.label +
          '</b></div><div class="week-scroll"><div class="week-grid"><div class="week-head time-head">Уақыты</div>' +
          days
            .map(
              (d, i) =>
                '<div class="week-head">' + d + '<br><span>' + fmt(dateFor(i)) + '</span></div>'
            )
            .join('');
        for (const period of shift.periods) {
          grid +=
            '<div class="time-cell"><b>' +
            (period.index + 1) +
            '-жұп</b><br>' +
            period.label +
            '</div>';
          for (let day = 0; day < 5; day++) {
            const date = C.iso(dateFor(day)),
              count = D.pairCount(date);
            if (!count) {
              grid +=
                '<div class="lesson-cell inactive-period">' +
                (D.isHoliday(date) ? 'Мейрам' : 'Сабақ жоқ') +
                '</div>';
              continue;
            }
            const entries = rows.filter(
              (r) => r.shift === number && r.day === day && r.lesson === period.index
            );
            grid +=
              '<div class="lesson-cell">' +
              entries
                .map(
                  (e) =>
                    '<div class="lesson-card' +
                    (e.additional ? ' additional-card' : '') +
                    '" data-class-date="' +
                    e.date +
                    '" data-period="' +
                    e.lesson +
                    '"><strong>' +
                    esc(e.short) +
                    '</strong><span>' +
                    esc(e.groupLabel) +
                    '</span>' +
                    (e.short === 'Топ сағаты'
                      ? ''
                      : '<span>' +
                        esc(e.teacherNames.join(', ') || 'Оқытушы белгіленбеген') +
                        '</span><span>' +
                        esc(e.roomLabel) +
                        '</span>') +
                    '</div>'
                )
                .join('') +
              '</div>';
          }
        }
        return grid + '</div></div></section>';
      })
      .join('');
  }
  function renderSchedule() {
    const isAdmin = session.role === 'admin';
    document.getElementById('main').innerHTML =
      '<h1 class="page-title">' +
      (isAdmin ? 'Кестені басқару' : 'Сабақ кестесі') +
      '</h1>' +
      toolbar() +
      calendarSettings() +
      '<section class="card">' +
      weekGrids() +
      '</section>' +
      (isAdmin ? adminEditor() : '');
    attachToolbar();
    if (isAdmin) {
      document.getElementById('editSemesterDates').onclick = semesterModal;
      document.getElementById('saveHoliday').onclick = () =>
        editWorkspace((s) => {
          const ranges = [
            [D.calendar.starts[1], D.calendar.ends[1]],
            [D.calendar.starts[2], D.calendar.ends[2]]
          ];
          s.calendar.holidays = P.validateHolidays(
            document.getElementById('holidayDate').value,
            ranges
          );
          s.calendar.holiday = s.calendar.holidays[0] || '';
        });
      attachEditor();
    }
  }
  function adminEditor() {
    const from = C.iso(dateFor()),
      to = C.iso(dateFor(4)),
      today = C.iso(new Date());
    if (!editorDate || editorDate < from || editorDate > to)
      editorDate = today >= from && today <= to ? today : from;
    const rows = visibleRows(true).filter((r) => r.date === editorDate);
    return (
      '<section class="card"><div class="card-head"><h3>Күн бойынша өңдеу</h3><input id="editorDate" type="date" class="year-select" value="' +
      editorDate +
      '"></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Күн</th><th>Пән</th><th>Оқытушы</th><th>Топ</th><th>Жұп / уақыт</th><th>Кабинет</th><th>Әрекет</th></tr></thead><tbody>' +
      rows
        .map((e) => {
          const changed =
              JSON.stringify(schedule.find((r) => r.id === e.id)) !==
              JSON.stringify(baselineMap.get(e.id)),
            editable = e.short !== 'Топ сағаты';
          return (
            '<tr data-row="' +
            e.id +
            '" data-date="' +
            e.date +
            '"><td>' +
            displayDate(e.date) +
            '</td><td>' +
            (editable
              ? '<select data-field="course" aria-label="Пән">' +
                lessonOptions(e.group, e.semester, e.courseId) +
                '</select>'
              : esc(e.short)) +
            '</td><td>' +
            (editable
              ? '<select data-field="teacher" aria-label="Оқытушы">' +
                lessonTeacherOptions(e.courseId, e.teachers[0]) +
                '</select>'
              : esc(e.teacherNames.join(', ') || 'Белгіленбеген')) +
            '</td><td>' +
            esc(e.groupLabel) +
            '</td><td class="nowrap">' +
            (e.lesson + 1) +
            '-жұп<br>' +
            e.period.label +
            '</td><td><input data-field="room" value="' +
            esc(e.room) +
            '" aria-label="Кабинет" ' +
            (!editable ? 'disabled' : '') +
            '></td><td><div class="row-actions"><button data-delete="' +
            e.id +
            '" class="del" title="Өзгерісті бастапқы қалпына қайтару" ' +
            (!changed ? 'disabled' : '') +
            '>Өшіру</button></div></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div><div id="scheduleError" class="error-notice hidden" role="alert"></div><div class="actions"><button id="saveSchedule" class="primary small">Кестені сақтау</button></div></section>'
    );
  }

  function attachEditor() {
    document.getElementById('editorDate').onchange = (e) => {
      const target = locate(C.parse(e.target.value));
      if (!target) {
        toast('Оқу жылындағы күнді таңдаңыз.');
        return;
      }
      editorDate = e.target.value;
      semester = target.semester;
      week = target.week;
      syncMonth();
      render();
    };
    document.querySelectorAll('tr[data-row]').forEach((tr) => {
      const id = tr.dataset.row;
      tr.querySelectorAll('[data-field]').forEach(
        (input) =>
          (input.onchange = () => {
            let row = schedule.find((r) => r.id === id);
            if (!row) {
              const virtual = visibleRows(true).find((r) => r.id === id);
              if (!virtual || virtual.short === 'Топ сағаты') return;
              row = D.materializeAdditional(virtual);
              schedule.push(row);
            }
            if (input.dataset.field === 'room') {
              row.room = input.value.trim();
              row.roomOrigin = 'manual';
            } else if (input.dataset.field === 'course') {
              const course = D.byId(input.value);
              if (
                !course ||
                course.group !== D.byId(row.courseId)?.group ||
                !course.semesters.includes(row.semester)
              )
                return;
              row.courseId = course.id;
              row.additional = !!course.additional;
              row.teachers = course.teacherIds.slice(0, 1);
              const teacherSelect = [...tr.querySelectorAll('[data-field]')].find(
                (field) => field.dataset.field === 'teacher'
              );
              if (teacherSelect)
                teacherSelect.innerHTML = lessonTeacherOptions(course.id, row.teachers[0]);
            } else if (input.dataset.field === 'teacher') {
              row.teachers = input.value ? [input.value] : [];
              row.unassigned = !input.value;
            }
            dirty = true;
            const reset = tr.querySelectorAll('[data-delete]')[0];
            if (reset) reset.disabled = false;
          })
      );
    });
    document.querySelectorAll('[data-delete]').forEach(
      (b) =>
        (b.onclick = () => {
          try {
            schedule = P.restoreRow(schedule, baseline, workspace, b.dataset.delete);
            if (persist()) {
              render();
              toast('Өзгеріс бастапқы қалпына қайтарылды.');
            }
          } catch (e) {
            toast(e.message);
          }
        })
    );
    document.getElementById('saveSchedule').onclick = () => {
      const errors = D.conflicts(schedule);
      if (errors.length) {
        const el = document.getElementById('scheduleError');
        el.textContent = errors[0];
        el.classList.remove('hidden');
        return;
      }
      if (persist()) {
        render();
        toast('Кесте сақталды.');
      }
    };
  }

  function searchHeader(title, text, groups = false) {
    return (
      '<div class="page-heading"><div><h1 class="page-title">' +
      title +
      '</h1>' +
      (text ? '<p class="subline">' + text + '</p>' : '') +
      '</div>' +
      (page === 'groups'
        ? '<button id="addGroup" class="primary small">＋ Жаңа топ</button>'
        : page === 'staff'
          ? '<button id="addTeacher" class="primary small">＋ Жаңа оқытушы</button>'
          : '') +
      '</div><div class="registry-tools"><input id="registrySearch" class="field" value="' +
      esc(registrySearch) +
      '" placeholder="Іздеу" aria-label="Іздеу">' +
      (groups
        ? '<select id="registryGroup" class="year-select">' +
          groupOptions(groupFilter) +
          '</select>'
        : '') +
      '</div>'
    );
  }
  function attachSearch() {
    document.getElementById('registrySearch').onchange = (e) => {
      registrySearch = e.target.value;
      render();
    };
    if (page === 'subjects')
      document.getElementById('registryGroup').onchange = (e) => {
        groupFilter = e.target.value;
        render();
      };
  }
  function renderGroups() {
    const query = registrySearch.toLocaleLowerCase(),
      groups = D.sortGroups(
        D.groupRecords.filter((g) =>
          (g.name + ' ' + (g.curator?.curatorName || '')).toLocaleLowerCase().includes(query)
        )
      );
    document.getElementById('main').innerHTML =
      searchHeader('Топтар', D.groups.length + ' топ') +
      '<div class="people">' +
      groups
        .map(
          (g) =>
            '<section class="group-card"><div class="group-top"><span class="group-symbol">▤</span><span class="chip">' +
            g.shift +
            '-ауысым</span></div><h3>' +
            esc(g.name) +
            '</h3><p>' +
            g.year +
            '-курс</p><p><b>Куратор:</b> ' +
            esc(g.curator?.curatorName || 'Белгіленбеген') +
            '</p><div class="actions"><button data-group-calendar="' +
            esc(g.id) +
            '" class="soft-button">Кестесі →</button></div></section>'
        )
        .join('') +
      '</div>';
    attachSearch();
    document.getElementById('addGroup').onclick = () => groupModal();
    document.querySelectorAll('[data-group-calendar]').forEach(
      (b) =>
        (b.onclick = () => {
          groupFilter = b.dataset.groupCalendar;
          shiftFilter = 0;
          page = 'schedule';
          setViewDate();
          render();
        })
    );
  }
  function renderTeachers() {
    const q = registrySearch.toLocaleLowerCase(),
      people = D.staffRecords.filter((t) =>
        (
          t.displayName +
          ' ' +
          t.curatorGroups.map(D.groupName).join(' ') +
          ' ' +
          (t.assignedGroups || []).map(D.groupName).join(' ')
        )
          .toLocaleLowerCase()
          .includes(q)
      );
    document.getElementById('main').innerHTML =
      searchHeader(
        'Оқытушылар',
        D.staffRecords.length + ' оқытушы · ' + D.curatorAssignments.length + ' топ кураторы'
      ) +
      '<div class="people">' +
      people
        .map(
          (t) =>
            '<section class="person">' +
            avatar(t) +
            '<div class="person-info"><strong>' +
            esc(t.displayName) +
            '</strong><small>' +
            (t.curatorGroups.length
              ? 'Куратор · ' + t.curatorGroups.map((id) => esc(D.groupName(id))).join(', ')
              : 'Оқытушы') +
            '</small>' +
            (!t.curatorGroups.length && t.assignedGroups?.length
              ? '<p>' + t.assignedGroups.map((id) => esc(D.groupName(id))).join(', ') + '</p>'
              : '') +
            '</div></section>'
        )
        .join('') +
      '</div>';
    attachSearch();
    document.getElementById('addTeacher').onclick = () => teacherModal();
  }
  function renderSubjects() {
    const q = registrySearch.toLocaleLowerCase(),
      selected = D.courses.filter(
        (c) =>
          !c.deleted &&
          !c.additional &&
          D.groupMap.has(c.group) &&
          (!groupFilter || c.group === groupFilter) &&
          (c.subject + ' ' + D.courseTitle(c)).toLocaleLowerCase().includes(q)
      ),
      bySubject = new Map();
    for (const c of selected) {
      const title = D.courseTitle(c);
      if (!bySubject.has(title)) bySubject.set(title, []);
      bySubject.get(title).push(c);
    }
    document.getElementById('main').innerHTML =
      searchHeader('Пәндер', '', true) +
      '<div class="subject-list">' +
      [...bySubject]
        .sort((a, b) => a[0].localeCompare(b[0], 'kk', { numeric: true }))
        .map(
          ([title, rows]) =>
            '<section class="card"><h3>' +
            esc(title) +
            '</h3>' +
            rows
              .sort((a, b) =>
                D.groupName(a.group).localeCompare(D.groupName(b.group), 'kk', { numeric: true })
              )
              .map(
                (c) =>
                  '<div class="subject-line"><div><b>' +
                  esc(D.groupName(c.group)) +
                  '</b><span>' +
                  c.semesters.map((s) => s + '-семестр').join(', ') +
                  '</span><span>' +
                  c.teacherIds
                    .map((id) => esc(D.teacherMap.get(id)?.displayName || ''))
                    .join(', ') +
                  '</span></div></div>'
              )
              .join('') +
            '</section>'
        )
        .join('') +
      '</div>';
    attachSearch();
  }
  async function renderAccounts() {
    document.getElementById('main').innerHTML =
      '<h1 class="page-title">Аккаунттар</h1><section class="card"><h3>Жаңа аккаунт ашу немесе құпиясөз орнату</h3><form id="accountForm" class="account-form"><label>Рөлі<select id="accountRole" class="field"><option value="TEACHER">Оқытушы</option><option value="STUDENT">Студент</option></select></label><label id="accountTeacherField">Оқытушы<select id="accountTeacher" class="field">' +
      D.teachers
        .map(
          (t) =>
            '<option value="' +
            t.id +
            '">' +
            esc(t.displayName) +
            ' · ' +
            esc(t.login) +
            '</option>'
        )
        .join('') +
      '</select></label><label id="accountGroupField" class="hidden">Тобы<select id="accountGroup" class="field">' +
      groupOptions('', false) +
      '</select></label><label id="accountNameField" class="hidden">Студенттің аты-жөні<input id="accountName" class="field" autocomplete="name"></label><label id="accountNumberField" class="hidden">Студент нөмірі<input id="accountNumber" class="field" autocomplete="off"></label><label>Логин<input id="accountLogin" class="field" required autocomplete="username"></label><label>Құпиясөз (кемінде 12 таңба)<input id="accountPassword" class="field" type="password" required minlength="12" autocomplete="new-password"></label><div id="accountError" class="error-notice hidden" role="alert"></div><button class="primary" type="submit">Аккаунтты сақтау</button></form></section><section class="card"><div class="card-head"><h3>Қолданушылар</h3><button id="reloadAccounts" class="soft-button">Жаңарту</button></div><div id="accountList">Жүктелуде…</div></section>';
    const role = document.getElementById('accountRole'),
      teacher = document.getElementById('accountTeacher'),
      login = document.getElementById('accountLogin');
    const syncRole = () => {
      const student = role.value === 'STUDENT';
      document.getElementById('accountTeacherField').classList.toggle('hidden', student);
      document.getElementById('accountGroupField').classList.toggle('hidden', !student);
      document.getElementById('accountNameField').classList.toggle('hidden', !student);
      document.getElementById('accountNumberField').classList.toggle('hidden', !student);
      login.value = student ? '' : D.teacherMap.get(teacher.value)?.login || '';
    };
    role.onchange = syncRole;
    teacher.onchange = () => {
      if (role.value === 'TEACHER') login.value = D.teacherMap.get(teacher.value)?.login || '';
    };
    syncRole();
    const load = async () => {
      const box = document.getElementById('accountList');
      try {
        const response = await fetch('/api/admin/users', {
            credentials: 'same-origin',
            cache: 'no-store'
          }),
          data = await response.json();
        if (!response.ok) throw Error(data.error);
        box.innerHTML =
          '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Логин</th><th>Аты-жөні</th><th>Рөлі</th><th>Тобы / байланысы</th><th>Күйі</th></tr></thead><tbody>' +
          data.users
            .map(
              (u) =>
                '<tr><td>' +
                esc(u.username) +
                '</td><td>' +
                esc(u.displayName) +
                '</td><td>' +
                ({ ADMIN: 'Оқу бөлімі', TEACHER: 'Оқытушы', STUDENT: 'Студент' }[u.role] ||
                  u.role) +
                '</td><td>' +
                esc(
                  u.groupId
                    ? D.groupName(u.groupId)
                    : u.teacherId
                      ? D.teacherMap.get(u.teacherId)?.displayName || u.teacherId
                      : '—'
                ) +
                '</td><td>' +
                (u.active ? 'Белсенді' : 'Құпиясөз орнатылмаған') +
                '</td></tr>'
            )
            .join('') +
          '</tbody></table></div>';
      } catch (error) {
        box.textContent = error.message || 'Аккаунттар жүктелмеді.';
      }
    };
    document.getElementById('reloadAccounts').onclick = load;
    await load();
    document.getElementById('accountForm').onsubmit = async (event) => {
      event.preventDefault();
      const student = role.value === 'STUDENT',
        payload = {
          role: role.value,
          username: login.value.trim(),
          displayName: student
            ? document.getElementById('accountName').value.trim()
            : D.teacherMap.get(teacher.value)?.displayName || '',
          password: document.getElementById('accountPassword').value,
          ...(student
            ? {
                groupId: document.getElementById('accountGroup').value,
                studentNumber: document.getElementById('accountNumber').value.trim()
              }
            : { teacherId: teacher.value })
        };
      try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }),
          data = await response.json();
        if (!response.ok) throw Error(data.error);
        document.getElementById('accountPassword').value = '';
        document.getElementById('accountName').value = '';
        document.getElementById('accountNumber').value = '';
        document.getElementById('accountError').classList.add('hidden');
        toast('Аккаунт сақталды.');
        await load();
      } catch (error) {
        const box = document.getElementById('accountError');
        box.textContent = error.message || 'Аккаунт сақталмады.';
        box.classList.remove('hidden');
      }
    };
  }
  function openModal(title, body, onSubmit, extra = '') {
    const root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><h2 id="modalTitle">' +
      title +
      '</h2><button id="modalClose" class="icon-btn" aria-label="Жабу">✕</button></div><form id="modalForm">' +
      body +
      '<div id="modalError" class="error-notice hidden" role="alert"></div><div class="modal-actions">' +
      extra +
      '<button id="modalCancel" type="button" class="soft-button">Бас тарту</button><button type="submit" class="primary small">Сақтау</button></div></form></section></div>';
    root.classList.remove('hidden');
    document.getElementById('modalClose').onclick = closeModal;
    document.getElementById('modalCancel').onclick = closeModal;
    document.getElementById('modalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        onSubmit();
      } catch (error) {
        modalError(error.message);
      }
    });
    root.onclick = (e) => {
      if (e.target.classList?.contains('modal-backdrop')) closeModal();
    };
    document.getElementById('modalClose').focus?.();
  }
  function closeModal() {
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';
    root.classList.add('hidden');
  }
  function modalError(message) {
    const el = document.getElementById('modalError');
    el.textContent = message;
    el.classList.remove('hidden');
    if (!document.getElementById('modalRoot').innerHTML) toast(message);
  }
  function inputField(id, label, value, type = 'text') {
    return (
      '<label class="modal-field" for="' +
      id +
      '"><span>' +
      label +
      '</span><input id="' +
      id +
      '" type="' +
      type +
      '" value="' +
      esc(value || '') +
      '" class="field" ' +
      (type === 'text' ? 'maxlength="120"' : '') +
      '></label>'
    );
  }
  function selectField(id, label, options, multiple = false) {
    return (
      '<label class="modal-field" for="' +
      id +
      '"><span>' +
      label +
      '</span><select id="' +
      id +
      '" class="year-select" ' +
      (multiple ? 'multiple size="6"' : '') +
      '>' +
      options +
      '</select></label>'
    );
  }
  function value(id) {
    return document.getElementById(id).value;
  }
  function values(id) {
    return [...document.getElementById(id).selectedOptions].map((o) => o.value);
  }
  function multiGroupOptions(chosen) {
    return D.sortGroups(D.groups)
      .map(
        (id) =>
          '<option value="' +
          esc(id) +
          '" ' +
          (chosen.includes(id) ? 'selected' : '') +
          '>' +
          esc(D.groupName(id)) +
          '</option>'
      )
      .join('');
  }
  function nameModal() {
    openModal('Админнің аты', inputField('adminName', 'Аты-жөні', workspace.adminName), () =>
      editWorkspace((s) => {
        const name = value('adminName').trim();
        if (!name) throw Error('Аты-жөніңізді енгізіңіз.');
        s.adminName = name;
      })
    );
    document.getElementById('adminName').value = workspace.adminName;
  }
  function yearModal() {
    const ranges = [
      [D.calendar.starts[1], D.calendar.ends[1]],
      [D.calendar.starts[2], D.calendar.ends[2]]
    ];
    openModal(
      'Оқу жылы',
      inputField('yearStart', 'Басталу жылы', D.calendar.yearStart, 'number') +
        '<div class="modal-columns">' +
        ranges
          .map(
            (r, i) =>
              '<fieldset><legend>' +
              (i + 1) +
              '-семестр</legend>' +
              inputField('yearSemesterStart' + i, 'Басталуы', r[0], 'date') +
              inputField('yearSemesterEnd' + i, 'Аяқталуы', r[1], 'date') +
              '</fieldset>'
          )
          .join('') +
        '</div>',
      () =>
        editWorkspace((s) => {
          const year = Number(value('yearStart'));
          if (!Number.isInteger(year) || year < 2020 || year > 2100)
            throw Error('2020–2100 аралығындағы жылды енгізіңіз.');
          const ranges = [0, 1].map((i) => [
            value('yearSemesterStart' + i),
            value('yearSemesterEnd' + i)
          ]);
          P.validateRanges(ranges);
          if (ranges[0][0] < year + '-09-02' || ranges[1][1] > year + 1 + '-08-31')
            throw Error('Мерзімдер таңдалған оқу жылына сәйкес келсін.');
          const delta = year - Number(s.calendar.yearStart);
          s.calendar.yearStart = year;
          s.calendar.ranges = { all: ranges };
          s.calendar.holidays = (
            s.calendar.holidays || (s.calendar.holiday ? [s.calendar.holiday] : [])
          ).map((value) => {
            const date = new Date(value + 'T12:00:00Z');
            date.setUTCFullYear(date.getUTCFullYear() + delta);
            return date.toISOString().slice(0, 10);
          });
          s.calendar.holiday = s.calendar.holidays[0] || '';
        })
    );
    document.getElementById('yearStart').value = D.calendar.yearStart;
    ranges.forEach((r, i) => {
      document.getElementById('yearSemesterStart' + i).value = r[0];
      document.getElementById('yearSemesterEnd' + i).value = r[1];
    });
    document.getElementById('yearStart').onchange = () => {
      const year = Number(value('yearStart'));
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return;
      const next = [
        [year + '-09-02', year + 1 + '-01-31'],
        [year + 1 + '-02-01', year + 1 + '-06-30']
      ];
      next.forEach((r, i) => {
        document.getElementById('yearSemesterStart' + i).value = r[0];
        document.getElementById('yearSemesterEnd' + i).value = r[1];
      });
    };
  }
  function semesterModal() {
    const group = selectedGroup(),
      ranges = group?.semesterDates ||
        workspace.calendar.ranges.all || [
          [D.calendar.starts[1], D.calendar.ends[1]],
          [D.calendar.starts[2], D.calendar.ends[2]]
        ];
    openModal(
      'Семестр мерзімдері' + (group ? ' · ' + esc(group.name) : ' · барлық топтар'),
      '<div class="modal-columns">' +
        ranges
          .map(
            (r, i) =>
              '<fieldset><legend>' +
              (i + 1) +
              '-семестр</legend>' +
              inputField('semesterStart' + i, 'Басталуы', r[0], 'date') +
              inputField('semesterEnd' + i, 'Аяқталуы', r[1], 'date') +
              '</fieldset>'
          )
          .join('') +
        '</div>',
      () =>
        editWorkspace((s) => {
          const next = [0, 1].map((i) => [value('semesterStart' + i), value('semesterEnd' + i)]);
          P.validateRanges(next);
          s.calendar.ranges[group?.id || 'all'] = next;
        })
    );
    ranges.forEach((r, i) => {
      document.getElementById('semesterStart' + i).value = r[0];
      document.getElementById('semesterEnd' + i).value = r[1];
    });
  }
  function groupModal(id) {
    const group = D.groupMap.get(id),
      curator = group?.curator;
    openModal(
      group ? 'Топты өңдеу' : 'Жаңа топ',
      inputField('groupName', 'Топ атауы', group?.name) +
        selectField(
          'groupShift',
          'Ауысым',
          '<option value="1">1-ауысым</option><option value="2">2-ауысым</option>'
        ) +
        selectField('groupCurator', 'Куратор', teacherOptions(curator?.teacherId || '')) +
        inputField('groupCuratorName', 'Куратор аты', curator?.curatorName || '') +
        selectField(
          'groupLanguage',
          'Оқу тілі',
          '<option value="kk">Қазақ</option><option value="ru">Орыс</option>'
        ) +
        inputField('groupYear', 'Курс', group?.year || 1, 'number'),
      () =>
        editWorkspace((s) => {
          let curatorId = value('groupCurator'),
            name = value('groupCuratorName').trim();
          if (curatorId && name && D.teacherMap.get(curatorId)?.displayName !== name)
            P.changeTeacher(s, curatorId, { name });
          if (!curatorId && name)
            curatorId = P.changeTeacher(s, null, { name, assignedGroups: [] });
          if (curatorId && !D.teacherMap.has(curatorId)) D.applyRegistry(s.registry, s.calendar);
          P.changeGroup(s, id, {
            name: value('groupName'),
            shift: Number(value('groupShift')),
            language: value('groupLanguage'),
            year: Number(value('groupYear')),
            curatorId
          });
        }),
      group ? '<button id="deleteGroup" class="danger-button" type="button">Топты жою</button>' : ''
    );
    document.getElementById('groupName').value = group?.name || '';
    document.getElementById('groupShift').value = group?.shift || 1;
    document.getElementById('groupCurator').value = curator?.teacherId || '';
    document.getElementById('groupCuratorName').value = curator?.curatorName || '';
    document.getElementById('groupLanguage').value = group?.language || 'kk';
    document.getElementById('groupYear').value = group?.year || 1;
    document.getElementById('groupCurator').onchange = (e) => {
      document.getElementById('groupCuratorName').value =
        D.teacherMap.get(e.target.value)?.displayName || '';
    };
    if (group)
      document.getElementById('deleteGroup').onclick = () =>
        editWorkspace((s) =>
          P.changeGroup(s, id, { deleted: true, name: group.name, shift: group.shift })
        );
  }
  function teacherModal(id) {
    const teacher = D.teacherMap.get(id),
      assigned = teacher?.assignedGroups?.length
        ? teacher.assignedGroups
        : D.teacherGroups(schedule, id);
    openModal(
      teacher ? 'Оқытушыны өңдеу' : 'Жаңа оқытушы',
      inputField('teacherName', 'Аты-жөні', teacher?.displayName) +
        selectField('teacherAssigned', 'Сабақ беретін топтар', multiGroupOptions(assigned), true) +
        selectField(
          'teacherCuratorGroups',
          'Кураторлық топтар',
          multiGroupOptions(teacher?.curatorGroups || []),
          true
        ),
      () =>
        editWorkspace((s) =>
          P.changeTeacher(s, id, {
            name: value('teacherName'),
            assignedGroups: values('teacherAssigned'),
            excludedGroups: [
              ...new Set([...D.teacherGroups(schedule, id), ...(teacher?.excludedGroups || [])])
            ].filter((g) => !values('teacherAssigned').includes(g)),
            curatorGroups: values('teacherCuratorGroups')
          })
        ),
      teacher
        ? '<button id="deleteTeacher" class="danger-button" type="button">Оқытушыны жою</button>'
        : ''
    );
    document.getElementById('teacherName').value = teacher?.displayName || '';
    if (teacher)
      document.getElementById('deleteTeacher').onclick = () =>
        editWorkspace((s) => P.changeTeacher(s, id, { deleted: true, name: teacher.displayName }));
  }
  function courseModal(id) {
    const course = D.byId(id);
    openModal(
      'Пәнді өңдеу',
      inputField('courseName', 'Пән атауы', D.courseTitle(course)) +
        selectField('courseTeacher', 'Оқытушы', teacherOptions(course.teacherIds[0] || '')) +
        selectField('courseGroup', 'Топ', groupOptions(course.group, false)) +
        selectField(
          'courseSemester',
          'Семестр',
          '<option value="1">1-семестр</option><option value="2">2-семестр</option><option value="both">1 және 2 семестр</option>'
        ),
      () =>
        editWorkspace((s) =>
          P.changeCourse(s, id, {
            subject: value('courseName'),
            teacherId: value('courseTeacher'),
            group: value('courseGroup'),
            semesters:
              value('courseSemester') === 'both' ? [1, 2] : [Number(value('courseSemester'))]
          })
        )
    );
    document.getElementById('courseName').value = D.courseTitle(course);
    document.getElementById('courseTeacher').value = course.teacherIds[0] || '';
    document.getElementById('courseGroup').value = course.group;
    document.getElementById('courseSemester').value =
      course.semesters.length > 1 ? 'both' : String(course.semesters[0]);
  }
  function render() {
    if (!session) {
      loginScreen();
      return;
    }
    if (!navItems().some((n) => n[0] === page)) page = 'home';
    appShell();
    if (page === 'home') renderHome();
    else if (page === 'schedule') renderSchedule();
    else if (page === 'groups') renderGroups();
    else if (page === 'staff') renderTeachers();
    else if (page === 'subjects') renderSubjects();
    else if (page === 'accounts' && session.role === 'admin' && serverAuth) renderAccounts();
    else renderHome();
  }
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== 'tik-workspace-v1' && event.key !== 'tisk-demo-photos') return;
    if (dirty) {
      toast('Порталда жаңа өзгерістер бар. Өз өзгерісіңізді сақтап, бетті жаңартыңыз.');
      return;
    }
    if (event.key === 'tisk-demo-photos') {
      photos = readJSON('tisk-demo-photos', {});
      render();
      return;
    }
    const before = workspace;
    try {
      const date = dateFor();
      workspace = P.load();
      D.applyRegistry(workspace.registry, workspace.calendar);
      baseline = P.fitCalendar(P.project(seed, workspace.registry));
      baselineMap = new Map(baseline.map((r) => [r.id, r]));
      const patch = workspace.schedule || {};
      schedule = baseline
        .map((r) => ({ ...structuredClone(r), ...(patch.overrides?.[r.id] || {}) }))
        .filter((r) => !patch.deleted?.includes(r.id));
      schedule.push(...(patch.added || []));
      schedule = P.active(schedule);
      rebuildUsers();
      if (groupFilter && !D.groupMap.has(groupFilter)) groupFilter = D.groups[0] || '';
      setViewDate(date);
      render();
    } catch {
      workspace = before;
      D.applyRegistry(workspace.registry, workspace.calendar);
      toast('Жаңа нұсқаны көру үшін бетті жаңартыңыз.');
    }
  });
  globalThis.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
  setViewDate();
  if (!workspace.schedule) persist();
  render();
  if (serverAuth) loadRemoteSession();
})();
