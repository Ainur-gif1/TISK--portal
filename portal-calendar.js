(function () {
  'use strict';
  const months = [
    'Қаңтар',
    'Ақпан',
    'Наурыз',
    'Сәуір',
    'Мамыр',
    'Маусым',
    'Шілде',
    'Тамыз',
    'Қыркүйек',
    'Қазан',
    'Қараша',
    'Желтоқсан'
  ];
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number),
      date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? date
      : null;
  }
  function iso(date) {
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }
  function add(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
  function ordinal(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  }
  function defaults(year, weeks = 20) {
    const first = new Date(Number(year), 8, 2, 12);
    const firstMonday = add(first, -((first.getDay() + 6) % 7));
    return { 1: iso(first), 2: iso(add(firstMonday, weeks * 7)) };
  }
  function weekDate(settings, semester, week, day = 0) {
    const start = parse(settings[semester]);
    return start ? add(start, -((start.getDay() + 6) % 7) + (week - 1) * 7 + day) : null;
  }
  function locate(date, settings, weeks = 20) {
    if (!date || !Number.isFinite(date.getTime())) return null;
    const day = ordinal(date);
    for (const semester of [1, 2]) {
      const start = parse(settings[semester]);
      if (!start) continue;
      const base = add(start, -((start.getDay() + 6) % 7)),
        distance = day - ordinal(base),
        next = parse(settings[semester + 1]);
      if (day >= ordinal(start) && distance < weeks * 7 && (!next || day < ordinal(next)))
        return { semester, week: Math.floor(distance / 7) + 1 };
    }
    return null;
  }
  function range(start, end) {
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth())
      return (
        start.getDate() +
        '–' +
        end.getDate() +
        ' ' +
        months[start.getMonth()].toLowerCase() +
        ' ' +
        start.getFullYear()
      );
    return (
      start.getDate() +
      ' ' +
      months[start.getMonth()].toLowerCase() +
      ' ' +
      start.getFullYear() +
      ' – ' +
      end.getDate() +
      ' ' +
      months[end.getMonth()].toLowerCase() +
      ' ' +
      end.getFullYear()
    );
  }
  function monthGrid(date) {
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12),
      offset = (first.getDay() + 6) % 7;
    const start = add(first, -offset),
      last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    const count = Math.ceil((offset + last.getDate()) / 7) * 7;
    return Array.from({ length: count }, (_, index) => add(start, index));
  }
  const api = { months, parse, iso, add, ordinal, defaults, weekDate, locate, range, monthGrid };
  globalThis.TiskCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
