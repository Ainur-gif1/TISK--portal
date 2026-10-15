"""Deterministic annual draft; semester budgets are authoritative, practices excluded."""
import collections
import datetime as dt
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'data/curriculum.json').read_text())
groups = {g['id']: g for g in data['groups']}
teachers = {t['id']: t for t in data['teachers']}
teacher_index = {t['id']: i for i, t in enumerate(data['teachers'])}
start = dt.date(2026, 9, 1)
monday = start - dt.timedelta(days=start.weekday())
periods = {1: [(510 + i * 105, 600 + i * 105) for i in range(4)], 2: [(720 + i * 95, 810 + i * 95) for i in range(4)]}
windows = {}
for g in data['groups']:
    first_end = monday + dt.timedelta(weeks=g['semesters'][0]['weeks'])
    second_end = first_end + dt.timedelta(weeks=g['semesters'][1]['weeks'])
    g['semesterDates'] = [[start.isoformat(), (first_end - dt.timedelta(days=1)).isoformat()], [first_end.isoformat(), (second_end - dt.timedelta(days=1)).isoformat()]]
    for semester, (a, b) in enumerate(g['semesterDates'], 1):
        date = dt.date.fromisoformat(a)
        end = dt.date.fromisoformat(b)
        windows[g['id'], semester] = []
        while date <= end:
            if date.weekday() < data['teachingDays']:
                for lesson in range(4):
                    windows[g['id'], semester].append((date.toordinal(), lesson))
            date += dt.timedelta(days=1)

def apportion(total, weights):
    scale = sum(weights)
    raw = [total * w / scale for w in weights]
    counts = [math.floor(n) for n in raw]
    order = sorted(range(len(raw)), key=lambda i: (raw[i] - counts[i], -i), reverse=True)
    for i in order[:total - sum(counts)]:
        counts[i] += 1
    return counts

jobs = []
for course in data['courses']:
    course['teacherIds'] = list(dict.fromkeys(t['teacher'] for track in course['tracks'] for t in track))
    course['subgroups'] = len(course['tracks'])
    theory = course['theory']
    practical = course['practical'] + course['project']
    # Source H/I are annual totals. The source R/S do not divide them by kind.
    year_hours = sum(course['semesterHours'])
    if theory + practical != year_hours:
        theory = min(theory, year_hours)
        practical = year_hours - theory
    theory_by_sem = apportion(int(theory), course['semesterHours'])
    course['theoryBySemester'] = theory_by_sem
    course['practicalBySemester'] = [h - t for h, t in zip(course['semesterHours'], theory_by_sem)]
    track_weights = []
    allocation_review = False
    for track in course['tracks']:
        supplied = [t['weight'] for t in track]
        if len(track) <= 1:
            track_weights.append([1] * len(track))
        elif all(w is not None for w in supplied) and sum(supplied) == year_hours:
            track_weights.append(supplied)
        else:
            track_weights.append([1] * len(track))
            allocation_review = True
    course['teacherAllocationNeedsReview'] = allocation_review
    if allocation_review and not any(i['type'] == 'allocation' and i['courseId'] == course['id'] for i in data['issues']):
        data['issues'].append({'type': 'allocation', 'courseId': course['id'], 'group': course['group'], 'subject': course['subject'], 'message': 'Бір топшаға бірнеше оқытушы берілген. Мұғалімдердің жанындағы төлем сандары нақты сабақ үлесін анықтамайды; осы жобада сабақтар тең бөлінді. Оқытушының семестрдегі үлесін нақтылау қажет.', 'source': course['sources'][0]})
    for semester, hours in enumerate(course['semesterHours'], 1):
        if not hours:
            continue
        count = int(hours // 2)
        tracks = []
        for track, weights in zip(course['tracks'], track_weights):
            if not track:
                tracks.append([None] * count)
                continue
            allocated = apportion(count, weights)
            # Keep separately allocated teachers in chronological blocks, preserving source order.
            tracks.append([t['teacher'] for t, n in zip(track, allocated) for _ in range(n)])
        for pair in range(count):
            theory_remaining = theory_by_sem[semester - 1] - pair * 2
            kind = 0 if theory_remaining >= 2 else 1 if theory_remaining <= 0 else 2
            ids = list(dict.fromkeys(track[pair] for track in tracks if track[pair]))
            jobs.append({'courseId': course['id'], 'group': course['group'], 'semester': semester, 'shift': course['shift'], 'kind': kind, 'teachers': ids, 'pair': pair, 'count': count, 'unassigned': any(not track[pair] for track in tracks)})

teacher_load = collections.Counter(t for j in jobs for t in j['teachers'])
course_map = {c['id']: c for c in data['courses']}

def solve(seed):
    rng = random.Random(seed)
    occupied = {}
    teacher_busy = collections.defaultdict(list)
    course_week = collections.Counter()
    group_day = collections.Counter()
    teacher_day = collections.Counter()
    placed = []
    unplaced = []
    work = jobs[:]
    rng.shuffle(work)
    work.sort(key=lambda j: (-(len(j['teachers']) > 1), -max((teacher_load[t] for t in j['teachers']), default=0), len(windows[j['group'], j['semester']]) / j['count']))
    for job in work:
        options = windows[job['group'], job['semester']]
        target = (job['pair'] + .5) / job['count'] * len(options)
        best = None
        score = float('inf')
        for pos, (date, lesson) in enumerate(options):
            key = (job['group'], date, lesson)
            if key in occupied:
                continue
            begin, end = periods[job['shift']][lesson]
            if any(any(begin < b and a < end for a, b, _ in teacher_busy[t, date]) for t in job['teachers']):
                continue
            week = (date - monday.toordinal()) // 7
            cost = abs(pos - target) * .015 + course_week[job['courseId'], job['semester'], week] * 14 + sum(teacher_day[t, date] for t in job['teachers']) * .4 + group_day[job['group'], date] * .2
            if cost < score:
                score = cost
                best = (date, lesson)
        if best is None:
            unplaced.append(job)
            continue
        date, lesson = best
        entry = dict(job, date=date, lesson=lesson)
        index = len(placed)
        occupied[job['group'], date, lesson] = index
        begin, end = periods[job['shift']][lesson]
        for teacher in job['teachers']:
            teacher_busy[teacher, date].append((begin, end, index))
            teacher_day[teacher, date] += 1
        group_day[job['group'], date] += 1
        course_week[job['courseId'], job['semester'], (date - monday.toordinal()) // 7] += 1
        placed.append(entry)
    return placed, unplaced, occupied, teacher_busy

best = None
for attempt in range(3):
    result = solve(26 + attempt)
    print(json.dumps({'attempt': attempt + 1, 'scheduled': len(result[0]), 'pending': len(result[1])}), flush=True)
    if best is None or len(result[1]) < len(best[1]):
        best = result

placed, pending, occupied, teacher_busy = best

def blockers(job, date, lesson):
    result = set()
    group_block = occupied.get((job['group'], date, lesson))
    if group_block is not None:
        result.add(group_block)
    begin, end = periods[job['shift']][lesson]
    for teacher in job['teachers']:
        result.update(i for a, b, i in teacher_busy[teacher, date] if begin < b and a < end)
    return result

def release(index):
    entry = placed[index]
    occupied.pop((entry['group'], entry['date'], entry['lesson']), None)
    for teacher in entry['teachers']:
        teacher_busy[teacher, entry['date']] = [(a, b, i) for a, b, i in teacher_busy[teacher, entry['date']] if i != index]

def put(index, job, date, lesson):
    entry = dict(job, date=date, lesson=lesson)
    if index == len(placed):
        placed.append(entry)
    else:
        placed[index] = entry
    occupied[job['group'], date, lesson] = index
    begin, end = periods[job['shift']][lesson]
    for teacher in job['teachers']:
        teacher_busy[teacher, date].append((begin, end, index))

# Repair greedy dead ends by moving a conflicting lesson to another legal slot.
def relocate(index, forbidden, depth=1, visiting=None):
    visiting = (visiting or set()) | {index}
    old = dict(placed[index])
    release(index)
    for date, lesson in windows[old['group'], old['semester']]:
        if any(date == day and periods[old['shift']][lesson][0] < periods[shift][pair][1] and periods[shift][pair][0] < periods[old['shift']][lesson][1] for day, shift, pair in forbidden):
            continue
        blocked = blockers(old, date, lesson)
        if not blocked:
            put(index, old, date, lesson)
            return True
    if depth:
        for date, lesson in windows[old['group'], old['semester']]:
            if any(date == day and periods[old['shift']][lesson][0] < periods[shift][pair][1] and periods[shift][pair][0] < periods[old['shift']][lesson][1] for day, shift, pair in forbidden):
                continue
            blocked = blockers(old, date, lesson)
            if len(blocked) == 1 and not blocked & visiting:
                other = next(iter(blocked))
                if relocate(other, forbidden | {(date, old['shift'], lesson)}, depth - 1, visiting):
                    if not blockers(old, date, lesson):
                        put(index, old, date, lesson)
                        return True
    put(index, old, old['date'], old['lesson'])
    return False

remaining = []
for job in pending:
    done = False
    # A fully occupied teacher window cannot be repaired by moving a group lesson.
    if not any(not any(any(periods[job['shift']][lesson][0] < b and a < periods[job['shift']][lesson][1] for a, b, _ in teacher_busy[t, date]) for t in job['teachers']) for date, lesson in windows[job['group'], job['semester']]):
        remaining.append(job)
        continue
    for date, lesson in windows[job['group'], job['semester']]:
        blocked = blockers(job, date, lesson)
        if not blocked or len(blocked) == 1 and relocate(next(iter(blocked)), {(date, job['shift'], lesson)}):
            if not blockers(job, date, lesson):
                put(len(placed), job, date, lesson)
                done = True
                break
    if not done:
        remaining.append(job)

# Chronological kind ordering for each course/teacher combination after placement.
by_assignment = collections.defaultdict(list)
for entry in placed:
    by_assignment[entry['courseId'], entry['semester'], tuple(entry['teachers'])].append(entry)
for entries in by_assignment.values():
    kinds = sorted((e['kind'] for e in entries), key=lambda k: {0:0, 2:1, 1:2}[k])
    for entry, kind in zip(sorted(entries, key=lambda e: (e['date'], e['lesson'])), kinds):
        entry['kind'] = kind

packed = [[e['courseId'], e['semester'], e['date'] - start.toordinal(), e['lesson'], e['kind'], [teacher_index[t] for t in e['teachers']], int(e['unassigned'])] for e in sorted(placed, key=lambda e: (e['date'], e['shift'], e['lesson'], e['group']))]
pending_counts = collections.Counter((e['courseId'], e['semester']) for e in remaining)
data['pending'] = [{'courseId': c, 'semester': s, 'pairs': n, 'message': 'Мұғалімге және топқа бос уақыт табылмады. Басқа оқытушыны бекіту немесе кестені өзгерту қажет.'} for (c, s), n in sorted(pending_counts.items())]
data['assumptions'] = ['Апта: дүйсенбі–жұма. Әр ауысымда төрт 90 минуттық жұп.', 'Пәннің теория және зертхана сағаттары семестр сағаттарына пропорционалды бөлінді.', 'Оқу жұмыс жоспары нақты сабақ күндерін бермейді: сабақтар өз семестрінің күндеріне бөлінді.', 'Каникул мен мереке күндері, кабинеттер және студенттердің жеке деректері файлдарда берілмеген.']
data['assumptions'].append('Бір топшаға бірнеше мұғалім берілгенде, сабақ сағатымен сәйкес келетін үлестер сақталды; нақты сабақ үлесін бермейтін төлем сандары қолданылмай, осы жоба үшін тең бөлінді. Нақтылау тізіміндегі мұғалім үлестерін студбөлім бекітеді.')
data['assumptions'].append('Аттестаттау, кеңес, өзіндік жұмыс және нақты пән атауы жоқ факультатив жолдары жеке пән ретінде жоспарланбады.')
data['statistics'] = {'groups': len(data['groups']), 'teachers': len(data['teachers']), 'subjects': len({c['subject'] for c in data['courses']}), 'plannedPairs': len(jobs), 'scheduledPairs': len(placed), 'pendingPairs': len(remaining)}
(ROOT / 'data/curriculum.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
(ROOT / 'data/timetable.json').write_text(json.dumps(packed, separators=(',', ':')))
public_data = {k: data[k] for k in ['importId','year','startDate','teachingDays','groups','teachers','courses','issues','pending','assumptions','statistics','excludedPracticeRows']}
public_data['schedule'] = packed
(ROOT / 'portal-seed.js').write_text('(function(){"use strict";const seed=' + json.dumps(public_data, ensure_ascii=False, separators=(',', ':')) + ';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n')
print(json.dumps(data['statistics'], ensure_ascii=False), flush=True)
print('PENDING', json.dumps([(course_map[p['courseId']]['group'], course_map[p['courseId']]['subject'], p['semester'], p['pairs']) for p in data['pending']], ensure_ascii=False), flush=True)
