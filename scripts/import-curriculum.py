"""Read extracted workbook cells; retain provenance, never modify the source workbooks."""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

SOURCE = Path(sys.argv[1])
DEST = Path(__file__).resolve().parents[1] / 'data'
DEST.mkdir(exist_ok=True)
books = json.loads(SOURCE.read_text())

def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()

def number(value):
    return value if isinstance(value, (int, float)) else 0

# Only punctuation and confirmed spelling variants are reconciled. Original forms remain recorded.
aliases = {
    'Байділдаева Ж': 'Байдилдаева Ж', 'Сағиева А': 'Сагиева А',
    'Тұрсынханова С': 'Турсынханова С', 'Тұрсынбеков Е': 'Турсынбеков Е',
    'Кулпеишова А': 'Кулпеишова А', 'Саттар.Акбар': 'Саттарханов Акб',
    'Саттар.Акрам': 'Саттарханов Акр',
}
teachers = {}
unparsed = []
issues = []
groups = []
courses = []
excluded = []

def teacher_tokens(raw, source):
    raw = clean(raw)
    if not raw or raw in ['ТБ', 'Вакант', 'Оқытушының аты-жөні', 'ФИО препод.']:
        return []
    raw = raw.replace('СартаеваГ', 'Сартаева Г').replace('РзуановаС', 'Рзуанова С').replace('Шымкентбаев Пешентаев А', 'Шымкентбаев; Пешентаев А')
    # Numeric prefixes are payment allocations in the source, not part of a name.
    chunks = re.findall(r'(\d+)?\s*([А-ЯЁӘҒҚҢӨҰҮҺІA-Z][а-яёәғқңөұүһіa-z.]+)(?:\s*([А-ЯЁӘҒҚҢӨҰҮҺІA-Z](?:[а-яёәғқңөұүһіa-z]+)?)[.]?)?', raw)
    result = []
    for weight, family, initial in chunks:
        name = clean(family.rstrip('.') + (' ' + initial.rstrip('.') if initial else ''))
        if name in ['Саттар Акбар', 'Саттар Акрам']:
            name = 'Саттарханов ' + ('Акб' if name.endswith('Акбар') else 'Акр')
        canonical = aliases.get(name, name)
        key = 'T-' + hashlib.sha256(canonical.encode()).hexdigest()[:10]
        if key not in teachers:
            teachers[key] = {'id': key, 'name': canonical, 'aliases': [], 'sourceForms': [], 'login': 't-' + key[2:], 'department': 'Оқытушы', 'initials': ''.join(p[0] for p in canonical.split()[:2]), 'color': '#d5e5f5'}
        if name not in teachers[key]['aliases']:
            teachers[key]['aliases'].append(name)
        if raw not in teachers[key]['sourceForms']:
            teachers[key]['sourceForms'].append(raw)
        result.append({'teacher': key, 'weight': int(weight) if weight else None})
    if not result:
        unparsed.append({'value': raw, **source})
    return result

# Register teachers from all source sections; excluded practice does not generate lessons.
for book in books:
    for row in book['rows']:
        if row['cells'].get('U'):
            teacher_tokens(row['cells']['U'], {'file': book['file'], 'row': row['row']})

# Resolve an abbreviated surname only when the other rows identify one unique person.
partial_map = {}
for teacher in list(teachers.values()):
    if len(teacher['name'].split()) == 1:
        candidates = [t for t in teachers.values() if len(t['name'].split()) > 1 and t['name'].split()[0] == teacher['name']]
        if len(candidates) == 1:
            partial_map[teacher['id']] = candidates[0]['id']
            candidates[0]['aliases'] += teacher['aliases']
            candidates[0]['sourceForms'] += teacher['sourceForms']

def track(raw, source):
    items = teacher_tokens(raw, source)
    for item in items:
        item['teacher'] = partial_map.get(item['teacher'], item['teacher'])
    return items

def semester(raw):
    raw = clean(raw)
    m = re.search(r'(\d+)\s*сем\s*(\d+)\s*(?:апта|нед)', raw)
    if not m:
        raise ValueError('Semester header: ' + raw)
    split = re.search(r'\((\d+)\s*-\s*(\d+)\)', raw)
    return {'number': int(m[1]), 'weeks': int(m[2]), 'classWeeks': int(split[1]) if split else int(m[2]), 'practiceWeeks': int(split[2]) if split else 0, 'sourceLabel': raw}

for book in sorted(books, key=lambda b: int(re.match(r'\d+', Path(b['file']).name)[0])):
    rows = book['rows']
    group_row = next(r for r in rows if re.search(r'^(Оқу тобы|Учебная группа|Группа)\s*:', clean(r['cells'].get('B'))))
    group_label = clean(group_row['cells']['B'])
    group = group_label.split(':', 1)[1].split(',')[0].strip()
    course_year = int(re.search(r'[123]\s*курс', book['file'])[0][0])
    base = 9 if '9' in book['file'].split('/')[-2] else 11
    header = next(r['cells'] for r in rows if 'сем' in clean(r['cells'].get('R')) and re.search(r'апта|нед', clean(r['cells'].get('R'))))
    sems = [semester(header['R']), semester(header['S'])]
    count_match = re.search(r'(\d+)\s*-?\s*(оқушы|студент)', group_label)
    groups.append({'id': group, 'name': group, 'year': course_year, 'base': base, 'shift': 1 if base == 9 else 2, 'language': 'ru' if 'русская' in group_label else 'kk', 'studentCount': int(count_match[1]) if count_match else None, 'semesters': sems, 'sourceFile': book['file']})
    last = None
    for row in rows:
        c = row['cells']
        module = clean(c.get('A'))
        subject = clean(c.get('B'))
        source = {'file': book['file'], 'sheet': book['sheet'], 'row': row['row']}
        is_module = bool(re.match(r'^(ЖБП|ЖММ|КМ|ООД|ООМ|ПМ)\s*\d+', module)) and not bool(re.search(r'\b00\b', module))
        if is_module and (number(c.get('K')) or number(c.get('L')) or (c.get('K') and not number(c.get('K')))):
            excluded.append({'group': group, 'subject': subject, 'source': source})
            last = None
            continue
        academic = sum(number(c.get(k)) for k in ['H','I','J'])
        hours = [number(c.get('R')), number(c.get('S'))]
        if is_module and academic > 0 and sum(hours) > 0:
            names = track(c.get('U'), source)
            course = {'id': len(courses) + 1, 'group': group, 'shift': 1 if base == 9 else 2, 'module': module, 'subject': subject, 'short': subject, 'theory': number(c.get('H')), 'practical': number(c.get('I')), 'project': number(c.get('J')), 'semesterHours': hours, 'semesters': [s + 1 for s, h in enumerate(hours) if h], 'tracks': [names], 'sources': [source], 'kind': 'Теория / зертханалық-практикалық'}
            if not names:
                issues.append({'type': 'teacher', 'courseId': course['id'], 'group': group, 'subject': subject, 'message': 'Оқытушы орны бос немесе аты-жөні көрсетілмеген.', 'source': source})
            # Some НВП/АӘД rows separate the field camp below the parent row.
            if academic != sum(hours) and academic - sum(hours) != 30:
                issues.append({'type': 'hours', 'courseId': course['id'], 'group': group, 'subject': subject, 'message': 'Семестр бағандары теория және зертхана бағандарының қосындысына сәйкес келмейді; кесте семестр бағандарына сүйенеді.', 'source': source, 'classroomHours': academic, 'semesterHours': sum(hours)})
            courses.append(course)
            last = course
        elif not module and last and not subject and academic > 0 and (c.get('U') or academic == sum(last['semesterHours'])):
            continuation = track(c.get('U'), source)
            if continuation:
                last['tracks'].append(continuation)
            elif len(last['tracks'][0]) == 2:
                last['tracks'] = [[last['tracks'][0][0]], [last['tracks'][0][1]]]
            else:
                issues.append({'type': 'subgroup', 'courseId': last['id'], 'group': group, 'subject': last['subject'], 'message': 'Екінші топшаның оқытушысы көрсетілмеген.', 'source': source})
            last['sources'].append(source)
        elif subject in ['Дала жиыны', 'Полевые сборы', 'Полевой сбор'] and last and sum(hours):
            course = {'id': len(courses) + 1, 'group': group, 'shift': 1, 'module': last['module'], 'subject': subject, 'short': subject, 'theory': 0, 'practical': sum(hours), 'project': 0, 'semesterHours': hours, 'semesters': [s + 1 for s, h in enumerate(hours) if h], 'tracks': last['tracks'], 'sources': [source], 'kind': 'Практикалық сабақ'}
            courses.append(course)
        elif subject or module:
            last = None

teachers = {k: v for k, v in teachers.items() if k not in partial_map}
result = {'importId': 'balapan-2026-2027-v1', 'source': 'балапан 2026-2027.rar', 'year': '2026–2027', 'startDate': '2026-09-01', 'teachingDays': 5, 'academicMinutes': 45, 'groups': groups, 'teachers': sorted(teachers.values(), key=lambda t: t['name']), 'courses': courses, 'issues': issues, 'excludedPracticeRows': len(excluded), 'unparsedTeacherCells': unparsed}
(DEST / 'curriculum.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({'groups': len(groups), 'teachers': len(teachers), 'courses': len(courses), 'subjects': len({c['subject'] for c in courses}), 'issues': len(issues), 'excludedPracticeRows': len(excluded), 'unparsed': unparsed}, ensure_ascii=False))
print('ISSUES', json.dumps(issues, ensure_ascii=False))
