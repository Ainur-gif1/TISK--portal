(function () {
  'use strict';
  const D =
      globalThis.TiskData || (typeof require === 'function' ? require('./portal-data.js') : null),
    key = 'tik-workspace-v1';
  function empty() {
    return {
      version: 1,
      fictionalNamesRevision: 1,
      adminName: 'Айсана Нұрланқызы',
      calendar: { yearStart: 2026, holiday: '2026-12-16', holidays: ['2026-12-16'], ranges: {} },
      registry: { groups: {}, teachers: {}, courses: {}, addedGroups: [], addedTeachers: [] },
      notifications: [],
      operations: [],
      schedule: null
    };
  }
  function load(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const saved = JSON.parse(storage?.getItem(key) || 'null');
      const state = { ...empty(), ...saved };
      if (saved && !saved.fictionalNamesRevision) {
        // Refresh legacy cached identities without losing timetable or registry edits.
        state.adminName = empty().adminName;
        for (const teacher of D.registryBase.staff) {
          const patch = state.registry?.teachers?.[teacher.id];
          if (patch) for (const field of ['name', 'displayName', 'initials', 'aliases', 'sourceForms', 'curatorNames']) delete patch[field];
        }
        for (const group of D.registryBase.groups) {
          const patch = state.registry?.groups?.[group.id];
          if (patch?.curator) patch.curator = structuredClone(group.curator);
        }
        state.fictionalNamesRevision = 1;
        storage?.setItem(key, JSON.stringify(state));
      }
      state.calendar = { ...empty().calendar, ...state.calendar };
      if (!Array.isArray(state.calendar.holidays))
        state.calendar.holidays = state.calendar.holiday ? [state.calendar.holiday] : [];
      return state;
    } catch {
      return empty();
    }
  }
  function save(state, storage = localStorage) {
    storage.setItem(key, JSON.stringify(state));
  }
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function active(rows, includeHoliday = false) {
    return rows
      .filter((r) => {
        const c = D.byId(r.courseId);
        return (
          c && !c.deleted && D.groupMap.has(c.group) && (includeHoliday || !D.isHoliday(r.date))
        );
      })
      .map((r) => {
        const group = D.byId(r.courseId).group,
          teachers = (r.teachers || []).filter(
            (id) =>
              D.teacherMap.has(id) &&
              (r.replacement || !D.teacherMap.get(id).excludedGroups?.includes(group))
          );
        return { ...r, teachers, unassigned: !teachers.length };
      });
  }
  function project(rows, registry = {}) {
    return active(rows, true).map((row) => {
      const c = D.byId(row.courseId),
        g = D.groupMap.get(c.group),
        semester = c.semesters.includes(row.semester) ? row.semester : c.semesters[0],
        originalGroup =
          D.registryBase.groups.find(
            (b) => b.id === D.registryBase.courses.find((x) => x.id === row.courseId)?.group
          ) || D.registryBase.groups.find((b) => b.id === g.id),
        base = originalGroup?.semesterDates[row.semester - 1],
        range = g.semesterDates[semester - 1],
        offset = base ? Math.round((new Date(row.date) - new Date(base[0])) / 86400000) : 0;
      const teachers = registry.courses?.[row.courseId]?.teacherChanged
        ? registry.courses[row.courseId].teacherIds
        : row.teachers;
      return {
        ...row,
        semester,
        date: base ? D.addDays(range[0], offset) : row.date,
        teachers: teachers.filter((id) => D.teacherMap.has(id)),
        unassigned: !teachers.length,
        shift: undefined
      };
    });
  }
  function fitCalendar(input) {
    const rows = active(input),
      books = new Map(),
      kept = [],
      pending = [],
      known = D.referenceWarnings(rows),
      allowed = new Set(
        known.flatMap((x) =>
          x.rowIds
            .map((a) => x.rowIds.map((b) => [x.type + ':' + x.resource, a, b].join('|')))
            .flat()
        )
      );
    const info = (row) => D.details(row),
      resources = (row) => {
        const e = info(row);
        return [
          'group:' + e.group,
          ...row.teachers.map((id) => 'teacher:' + id),
          ...D.roomKeys(row).map((k) => 'room:' + k)
        ];
      };
    function legal(row) {
      const c = D.byId(row.courseId),
        g = D.groupMap.get(c.group),
        range = g?.semesterDates[row.semester - 1],
        day = new Date(row.date + 'T12:00:00Z').getUTCDay();
      return (
        range &&
        c.semesters.includes(row.semester) &&
        row.date >= range[0] &&
        row.date <= range[1] &&
        D.pairCount(row.date) > row.lesson &&
        day >= 1 &&
        day <= 5 &&
        !(day === 2 && row.lesson === 3 && !row.additional)
      );
    }
    function free(row) {
      const e = info(row);
      if (!e?.period) return false;
      return resources(row).every((resource) =>
        (books.get(row.date + '|' + resource) || []).every(
          (other) =>
            e.period.from >= other.to ||
            other.from >= e.period.to ||
            allowed.has([resource, row.id, other.id].join('|'))
        )
      );
    }
    function put(row) {
      const e = info(row);
      for (const resource of resources(row)) {
        const k = row.date + '|' + resource,
          list = books.get(k) || [];
        list.push({ id: row.id, from: e.period.from, to: e.period.to });
        books.set(k, list);
      }
      kept.push(row);
    }
    for (const row of rows) {
      if (legal(row) && free(row)) put(row);
      else pending.push(row);
    }
    for (const row of pending) {
      const g = D.groupMap.get(D.byId(row.courseId).group),
        range = g.semesterDates[row.semester - 1],
        dates = [];
      for (let date = range[0]; date <= range[1]; date = D.addDays(date, 1))
        if (D.pairCount(date)) dates.push(date);
      dates.sort(
        (a, b) =>
          Math.abs(new Date(a) - new Date(row.date)) - Math.abs(new Date(b) - new Date(row.date)) ||
          a.localeCompare(b)
      );
      let chosen;
      for (const date of dates) {
        for (const lesson of [row.lesson, 0, 1, 2, 3].filter((x, i, a) => a.indexOf(x) === i)) {
          const candidate = {
            ...row,
            date,
            lesson,
            reference: false,
            shift: D.byId(row.courseId).shift
          };
          if (legal(candidate) && free(candidate)) {
            chosen = candidate;
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen)
        throw Error(
          D.groupName(g.id) +
            ': ' +
            D.courseTitle(D.byId(row.courseId)) +
            ' сабағына бос уақыт табылмады. Мерзімді ұзартыңыз.'
        );
      put(chosen);
    }
    const errors = D.conflicts(kept);
    if (errors.length) throw Error(errors.slice(0, 3).join(' '));
    return kept;
  }
  function validateRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.length !== 2)
      throw Error('Екі семестрдің мерзімін енгізіңіз.');
    for (const [from, to] of ranges) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
        from > to ||
        !Number.isFinite(new Date(from + 'T12:00:00Z').getTime()) ||
        !Number.isFinite(new Date(to + 'T12:00:00Z').getTime())
      )
        throw Error('Семестрдің басталу және аяқталу күнін тексеріңіз.');
    }
    if (ranges[0][1] >= ranges[1][0]) throw Error('Семестр мерзімдері қабаттаспасын.');
  }
  function validateHolidays(input, ranges) {
    const dates = [
      ...new Set(
        input
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((value) => {
            const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
          })
      )
    ].sort();
    for (const date of dates) {
      const parsed = new Date(date + 'T12:00:00Z');
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date ||
        !ranges.some(([from, to]) => date >= from && date <= to)
      )
        throw Error('Әр мереке күнін КК.АА.ЖЖЖЖ түрінде, семестр мерзімдерінің ішінде жазыңыз.');
    }
    return dates;
  }
  function changeGroup(state, id, values) {
    const r = state.registry,
      existing = D.groupMap.get(id);
    if (!values.deleted) {
      if (!values.name?.trim()) throw Error('Топ атауын енгізіңіз.');
      if (
        D.groupRecords.some(
          (g) => g.id !== id && g.name.toLowerCase() === values.name.trim().toLowerCase()
        )
      )
        throw Error('Бұл топ атауы бар.');
      if (![1, 2].includes(Number(values.shift))) throw Error('Ауысымды таңдаңыз.');
    }
    const curatorId = values.curatorId || null,
      teacher = D.teacherMap.get(curatorId),
      curator = teacher
        ? { groupId: id, teacherId: teacher.id, curatorName: teacher.displayName }
        : null;
    if (existing && r.addedGroups.some((g) => g.id === id)) {
      Object.assign(
        r.addedGroups.find((g) => g.id === id),
        values,
        { name: values.name?.trim(), shift: Number(values.shift), curator }
      );
    } else if (existing) {
      r.groups[id] = {
        ...(r.groups[id] || {}),
        ...values,
        name: values.name?.trim() || existing.name,
        shift: Number(values.shift || existing.shift),
        curator: values.deleted ? existing.curator : curator
      };
    } else {
      const newId = uid('group');
      const ranges = structuredClone(
        D.groupRecords[0]?.semesterDates || [
          [D.calendar.starts[1], D.calendar.ends[1]],
          [D.calendar.starts[2], D.calendar.ends[2]]
        ]
      );
      r.addedGroups.push({
        id: newId,
        name: values.name.trim(),
        shift: Number(values.shift),
        language: values.language || 'kk',
        year: Number(values.year || 1),
        base: Number(values.shift) === 1 ? 9 : 11,
        semesterDates: ranges,
        baseDates: ranges,
        semesters: [
          { number: 1, weeks: 20 },
          { number: 2, weeks: 20 }
        ],
        curator: curator ? { ...curator, groupId: newId } : null
      });
      return newId;
    }
    return id;
  }
  function changeTeacher(state, id, values) {
    if (!values.deleted && !values.name?.trim()) throw Error('Оқытушының атын енгізіңіз.');
    const current = D.teacherMap.get(id),
      patch = {
        ...values,
        name: values.name?.trim() || current?.name,
        displayName: values.name?.trim() || current?.name
      };
    if (current && state.registry.addedTeachers.some((t) => t.id === id))
      Object.assign(
        state.registry.addedTeachers.find((t) => t.id === id),
        patch
      );
    else if (current)
      state.registry.teachers[id] = { ...(state.registry.teachers[id] || {}), ...patch };
    else {
      const newId = uid('teacher');
      id = newId;
      state.registry.addedTeachers.push({
        id: newId,
        ...patch,
        department: 'Оқытушы',
        color: '#e1ebee',
        login: newId,
        curatorGroups: [],
        curatorNames: [],
        assignedGroups: values.assignedGroups || []
      });
    }
    if (values.curatorGroups) {
      for (const g of D.groupRecords) {
        if (values.curatorGroups.includes(g.id))
          state.registry.groups[g.id] = {
            ...(state.registry.groups[g.id] || {}),
            curator: { groupId: g.id, teacherId: id, curatorName: patch.displayName }
          };
        else if (g.curator?.teacherId === id)
          state.registry.groups[g.id] = { ...(state.registry.groups[g.id] || {}), curator: null };
      }
    }
    return id;
  }
  function changeCourse(state, id, values) {
    const c = D.byId(id);
    if (!c) throw Error('Пән табылмады.');
    if (!values.subject?.trim()) throw Error('Пән атауын енгізіңіз.');
    if (!D.groupMap.has(values.group)) throw Error('Топты таңдаңыз.');
    if (values.teacherId && !D.teacherMap.has(values.teacherId)) throw Error('Оқытушыны таңдаңыз.');
    state.registry.courses[id] = {
      ...(state.registry.courses[id] || {}),
      subject: values.subject.trim(),
      short: values.subject.trim(),
      module: values.subject.trim(),
      group: values.group,
      teacherIds:
        values.teacherId === (c.teacherIds[0] || '') && !state.registry.courses[id]?.teacherChanged
          ? c.teacherIds
          : values.teacherId
            ? [values.teacherId]
            : [],
      teacherChanged:
        !!state.registry.courses[id]?.teacherChanged ||
        values.teacherId !== (c.teacherIds[0] || ''),
      semesters: values.semesters.map(Number),
      semesterHours:
        values.semesters.length === 1
          ? [
              values.semesters.includes(1) ? c.semesterHours.reduce((a, b) => a + b, 0) : 0,
              values.semesters.includes(2) ? c.semesterHours.reduce((a, b) => a + b, 0) : 0
            ]
          : structuredClone(
              D.registryBase.courses.find((x) => x.id === c.id)?.semesterHours || c.semesterHours
            )
    };
  }
  function substitutionCandidates(rows, rowId, toId) {
    const row = rows.find((r) => r.id === rowId),
      course = row && D.byId(row.courseId),
      old = row?.teachers[0];
    if (!old || old === toId || !D.teacherMap.has(toId)) return [];
    const replacement = { ...row, teachers: [toId], unassigned: false };
    if (
      D.conflicts(
        rows.filter((r) => r.date === row.date).map((r) => (r.id === rowId ? replacement : r))
      ).length
    )
      return [];
    return rows
      .filter(
        (r) =>
          r.id !== rowId &&
          r.teachers.includes(toId) &&
          r.semester === row.semester &&
          r.date > row.date &&
          (D.byId(r.courseId).teacherIds.includes(old) ||
            D.byId(r.courseId).subject === course.subject)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.lesson - b.lesson)
      .filter(
        (r) =>
          !D.conflicts(
            rows
              .filter((x) => x.date === row.date || x.date === r.date)
              .map((x) =>
                x.id === rowId
                  ? replacement
                  : x.id === r.id
                    ? { ...x, teachers: [old], unassigned: false }
                    : x
              )
          ).length
      )
      .slice(0, 24);
  }
  function substitute(rows, state, rowId, toId, balanceId) {
    const row = rows.find((r) => r.id === rowId),
      candidate = substitutionCandidates(rows, rowId, toId).find((r) => r.id === balanceId);
    if (!row || !candidate)
      throw Error('Жүктемені теңестіретін бос сабақ табылмады. Басқа оқытушыны таңдаңыз.');
    const old = row.teachers[0],
      id = uid('replacement'),
      updated = rows.map((r) =>
        r.id === rowId
          ? { ...r, teachers: [toId], unassigned: false, replacement: id }
          : r.id === candidate.id
            ? { ...r, teachers: [old], unassigned: false, replacement: id }
            : r
      );
    const after = updated.filter((r) => r.id === row.id || r.id === candidate.id),
      before = [structuredClone(row), structuredClone(candidate)];
    state.operations.push({ id, before, after: structuredClone(after), active: true });
    notify(state, {
      operationId: id,
      rows: after,
      teachers: [old, toId],
      text:
        D.groupName(D.byId(row.courseId).group) +
        ' · ' +
        row.date +
        ' · ' +
        (row.lesson + 1) +
        '-жұп: ' +
        D.teacherMap.get(toId).displayName +
        ' ауыстырады. ' +
        D.teacherMap.get(old).displayName +
        ' сабағы ' +
        candidate.date +
        ' · ' +
        (candidate.lesson + 1) +
        '-жұпқа ауыстырылды. Әр оқытушының 1 жұп (2 оқу сағаты) жүктемесі теңестірілді.'
    });
    return updated;
  }
  function notify(state, { operationId, rows, teachers, text }) {
    const groups = [...new Set(rows.map((r) => D.byId(r.courseId).group))],
      ids = new Set(teachers);
    for (const group of groups) {
      const curator = D.groupMap.get(group)?.curator?.teacherId;
      if (curator) ids.add(curator);
    }
    state.notifications.push({
      id: uid('notice'),
      operationId,
      createdAt: new Date().toISOString(),
      teacherIds: [...ids],
      groups,
      text,
      readBy: []
    });
  }
  function forUser(state, user) {
    return state.notifications.filter(
      (n) =>
        user.role === 'admin' ||
        (user.role === 'student' && n.groups.includes(user.group)) ||
        (user.role === 'teacher' && n.teacherIds.includes(user.id))
    );
  }
  function restoreRow(rows, baseline, state, id) {
    const row = rows.find((r) => r.id === id),
      operation = state.operations
        .slice()
        .reverse()
        .find((o) => o.active && o.after.some((r) => r.id === id));
    if (operation) {
      const previous = operation.after.find((r) => r.id === id);
      if (JSON.stringify(row) !== JSON.stringify(previous)) {
        const next = rows.map((r) => (r.id === id ? structuredClone(previous) : r)),
          errors = D.conflicts(next);
        if (errors.length) throw Error(errors[0]);
        return next;
      }
      for (const after of operation.after) {
        if (JSON.stringify(rows.find((r) => r.id === after.id)) !== JSON.stringify(after))
          throw Error('Ауыстырудан кейін сабақ өзгертілген. Алдымен кейінгі өзгерісті қайтарыңыз.');
      }
      const map = new Map(operation.before.map((r) => [r.id, r])),
        next = rows.map((r) => map.get(r.id) || r);
      const errors = D.conflicts(next);
      if (errors.length) throw Error(errors[0]);
      operation.active = false;
      notify(state, {
        operationId: operation.id,
        rows: operation.before,
        teachers: operation.before.flatMap((r) => r.teachers),
        text:
          'Ауыстыру тоқтатылды. ' +
          operation.before
            .map(
              (r) =>
                D.groupName(D.byId(r.courseId).group) +
                ' · ' +
                r.date +
                ' · ' +
                (r.lesson + 1) +
                '-жұп'
            )
            .join('; ') +
          ' бастапқы нұсқаға қайтарылды.'
      });
      return next;
    }
    const original = baseline.find((r) => r.id === id);
    if (!original) return rows.filter((r) => r.id !== id);
    const next = rows.map((r) => (r.id === id ? structuredClone(original) : r)),
      errors = D.conflicts(next);
    if (errors.length) throw Error(errors[0]);
    return next;
  }
  const api = {
    key,
    empty,
    load,
    save,
    uid,
    active,
    project,
    fitCalendar,
    validateRanges,
    validateHolidays,
    changeGroup,
    changeTeacher,
    changeCourse,
    substitutionCandidates,
    substitute,
    forUser,
    restoreRow
  };
  globalThis.TiskAdmin = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
