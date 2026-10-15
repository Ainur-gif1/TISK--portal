"""Move fourth-Tuesday classes; preserve existing lesson identities and source budgets."""
import collections
import datetime as dt
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = json.loads((root / 'data/curriculum.json').read_text())
packed = json.loads((root / 'data/timetable.json').read_text())
courses = {c['id']: c for c in data['courses']}
groups = {g['id']: g for g in data['groups']}
start = dt.date.fromisoformat(data['startDate'])
pattern = [4, 3, 4, 4, 4]
periods = {1: [(510+i*105,600+i*105) for i in range(4)], 2: [(720+i*95,810+i*95) for i in range(4)]}
busy = collections.defaultdict(list)
group_day = collections.Counter()
teacher_load = collections.Counter(t for r in packed for t in r[5])
source_rows = data.get('migration', {}).get('previousRows', {})
kept, moving = [], []
kept_by_id = {}

def identity(row):
    return row[7] if len(row) > 7 and isinstance(row[7], str) else 'seed-' + str(row[7])

def resources(row):
    course = courses[row[0]]
    return [('g',course['group'],row[2])] + [('t',t,row[2]) for t in row[5]]

def put(row):
    course = courses[row[0]]
    a, b = periods[course['shift']][row[3]]
    for resource in resources(row):
        busy[resource].append((a,b,identity(row)))
    group_day[course['group'],row[2]] += 1
    ident = identity(row)
    if ident in kept_by_id:
        kept_by_id[ident][:] = row
    else:
        kept.append(row)
        kept_by_id[ident] = row

def release(row):
    ident = identity(row)
    for resource in resources(row):
        busy[resource] = [(a,b,i) for a,b,i in busy[resource] if i != ident]
    group_day[courses[row[0]]['group'],row[2]] -= 1

def candidates(row):
    course = courses[row[0]]
    group = groups[course['group']]
    first,last = map(dt.date.fromisoformat,group['semesterDates'][row[1]-1])
    date = first
    while date <= last:
        if date.weekday()<5:
            for lesson in range(pattern[date.weekday()]):
                candidate = row[:]
                candidate[2],candidate[3] = (date-start).days,lesson
                yield candidate
        date += dt.timedelta(days=1)

def blockers(row):
    a,b = periods[courses[row[0]]['shift']][row[3]]
    return {ident for resource in resources(row) for prev_a,prev_b,ident in busy[resource] if a<prev_b and prev_a<b}

def reserved(row,forbidden):
    a,b = periods[courses[row[0]]['shift']][row[3]]
    return any(row[2]==day and a<other_b and other_a<b for day,other_a,other_b in forbidden)

def move_other(ident,forbidden,depth=1,visited=None):
    visited=(visited or set())|{ident}
    old=kept_by_id[ident][:]
    release(old)
    for candidate in candidates(old):
        if not reserved(candidate,forbidden) and not blockers(candidate):
            source_rows.setdefault(ident,old)
            put(candidate)
            return True
    if depth:
        for candidate in candidates(old):
            if reserved(candidate,forbidden):continue
            blocked=blockers(candidate)
            if len(blocked)==1 and not blocked & visited:
                a,b=periods[courses[old[0]]['shift']][candidate[3]]
                if move_other(next(iter(blocked)),forbidden|{(candidate[2],a,b)},depth-1,visited):
                    source_rows.setdefault(ident,old)
                    put(candidate)
                    return True
    put(old)
    return False

for index, original in enumerate(packed):
    row = original[:] if len(original)>7 else original+[index]
    date = start + dt.timedelta(days=row[2])
    if row[3] >= pattern[date.weekday()]:
        source_rows.setdefault(identity(row),row)
        moving.append(row)
    else:
        put(row)

known = set(kept_by_id)|{identity(row) for row in moving}
moving.extend(row[:] for ident,row in source_rows.items() if ident not in known)

pending_rows = []
moving.sort(key=lambda r:(-len(r[5]),-max((teacher_load[t] for t in r[5]),default=0),r[0],r[2]))
for original in moving:
    course = courses[original[0]]
    group = groups[course['group']]
    first, last = map(dt.date.fromisoformat,group['semesterDates'][original[1]-1])
    date = first
    best, score = None, float('inf')
    while date <= last:
        weekday = date.weekday()
        if weekday < 5:
            offset = (date-start).days
            for lesson in range(pattern[weekday]):
                candidate = original[:]
                candidate[2],candidate[3] = offset,lesson
                a,b = periods[course['shift']][lesson]
                if blockers(candidate):
                    continue
                cost = abs(offset-original[2])*.4 + abs(lesson-original[3])*.1 - group_day[course['group'],offset]*5
                if cost < score:
                    best,score = candidate,cost
        date += dt.timedelta(days=1)
    if best is None:
        pending_rows.append(original)
    else:
        put(best)

unresolved=[]
for original in pending_rows:
    course=courses[original[0]]
    # Do not search a fully occupied teacher window: this is a real capacity limit.
    if not any(not any(any(periods[course['shift']][candidate[3]][0]<b and a<periods[course['shift']][candidate[3]][1] for a,b,_ in busy[('t',t,candidate[2])]) for t in original[5]) for candidate in candidates(original)):
        bounds=groups[course['group']]['semesterDates'][original[1]-1]
        expandable=any(groups[courses[other[0]]['group']]['semesterDates'][other[1]-1][0]<bounds[0] or groups[courses[other[0]]['group']]['semesterDates'][other[1]-1][1]>bounds[1] for other in kept if any(t in original[5] for t in other[5]))
        if not expandable:
            unresolved.append(original)
            continue
    placed=False
    for candidate in candidates(original):
        blocked=blockers(candidate)
        if not blocked:
            put(candidate);placed=True;break
        if len(blocked)==1:
            a,b=periods[course['shift']][candidate[3]]
            if move_other(next(iter(blocked)),{(candidate[2],a,b)}):
                put(candidate);placed=True;break
    if not placed:unresolved.append(original)
pending_rows=unresolved

counts = collections.Counter((r[0],r[1]) for r in kept)
data['pending'] = [{'courseId':c['id'],'semester':s,'pairs':int(c['semesterHours'][s-1]/2-counts[c['id'],s]),'message':'Негізгі мұғалімге бос уақыт жетпейді. Оқытушыны немесе кестені нақтылау қажет.'} for c in data['courses'] for s in c['semesters'] if c['semesterHours'][s-1]/2>counts[c['id'],s]]
data['weekdayPairs'] = pattern
data['scheduleRevision'] = 'weekday19-v2'
data['migration'] = {'fromRevision':'four-pair-v1','previousRows':source_rows}
data['assumptions'][0] = 'Дүйсенбі, сәрсенбі, бейсенбі, жұма — 4 жұп; сейсенбі — 3 жұп. Жұп ұзақтығы 90 минут.'
data['assumptions'] = [s for s in data['assumptions'] if not s.startswith('Бос оқу жұптары')]
data['assumptions'].append('Бос оқу жұптары студенттің өзіндік жұмысы ретінде көрсетіледі. Бұл уақыт пәннің сабақ сағатына және мұғалімнің сабағына қосылмайды.')
data['statistics']['scheduledPairs'] = len(kept)
data['statistics']['pendingPairs'] = sum(r['pairs'] for r in data['pending'])
kept.sort(key=lambda r:(r[2],courses[r[0]]['shift'],r[3],courses[r[0]]['group']))
(root/'data/curriculum.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
(root/'data/timetable.json').write_text(json.dumps(kept,separators=(',',':')))
keys=['importId','year','startDate','teachingDays','groups','teachers','courses','issues','pending','assumptions','statistics','excludedPracticeRows','weekdayPairs','scheduleRevision','migration']
seed={k:data[k] for k in keys}
seed['schedule']=kept
(root/'portal-seed.js').write_text('(function(){"use strict";const seed='+json.dumps(seed,ensure_ascii=False,separators=(',',':'))+';globalThis.TiskSeed=seed;if(typeof module!=="undefined"&&module.exports)module.exports=seed;})();\n')
print(json.dumps({'retimedTuesdayClasses':len(moving)-len(pending_rows),'newPending':len(pending_rows),'scheduled':len(kept),'pending':data['statistics']['pendingPairs']},ensure_ascii=False))
