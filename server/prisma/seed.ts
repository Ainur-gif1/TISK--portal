import bcrypt from "bcryptjs";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/prisma";

const require = createRequire(import.meta.url);
const D = require("../../portal-data.js") as any;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLocaleLowerCase("en-US");
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!adminUsername || !adminPassword || adminPassword.length < 12) {
  throw new Error("Set BOOTSTRAP_ADMIN_USERNAME and a unique BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters in the server-only .env file.");
}
if (await prisma.lesson.count()) throw new Error("The lesson table is not empty. Seed only a new/empty portal database; use migrations for an existing database.");

const adminHash = await bcrypt.hash(adminPassword, 12);
await prisma.$transaction(async (tx) => {
  await tx.user.upsert({
    where: { username: adminUsername },
    create: { id: "portal-admin", username: adminUsername, displayName: "Туребай Диана", role: "ADMIN", passwordHash: adminHash, active: true },
    update: { displayName: "Туребай Диана", role: "ADMIN", active: true },
  });

  await tx.teacher.createMany({ data: D.teachers.map((teacher: any) => ({
    id: teacher.id,
    fullName: teacher.name,
    displayName: teacher.displayName || teacher.name,
    username: teacher.login,
    sourceData: json(teacher),
  })), skipDuplicates: true });

  await tx.collegeGroup.createMany({ data: D.groupRecords.map((group: any) => ({
    id: group.id,
    name: group.name,
    year: group.year,
    shift: group.shift,
    language: group.language,
    studentCount: group.studentCount || 0,
    semesterDates: json(group.semesterDates),
    curatorName: group.curator?.curatorName || null,
    curatorTeacherId: group.curator?.teacherId || null,
    sourceData: json(group),
  })), skipDuplicates: true });

  const courses = D.courses.map((course: any) => ({
    id: Number(course.id),
    groupId: course.group,
    subject: course.subject,
    module: course.module || null,
    shortTitle: course.short || null,
    semesters: course.semesters || [],
    isAdditional: Boolean(course.additional),
    sourceData: json(course),
  }));
  await tx.course.createMany({ data: courses, skipDuplicates: true });

  const assignments = new Map<string, { teacherId: string; groupId: string }>();
  const courseTeachers = new Map<string, { courseId: number; teacherId: string }>();
  for (const course of D.courses) {
    for (const teacherId of course.teacherIds || []) {
      const key = `${course.id}:${teacherId}`;
      courseTeachers.set(key, { courseId: Number(course.id), teacherId });
      assignments.set(`${teacherId}:${course.group}`, { teacherId, groupId: course.group });
    }
  }
  for (const group of D.groupRecords) if (group.curator?.teacherId) assignments.set(`${group.curator.teacherId}:${group.id}`, { teacherId: group.curator.teacherId, groupId: group.id });
  await tx.courseTeacher.createMany({ data: [...courseTeachers.values()], skipDuplicates: true });
  await tx.teacherGroup.createMany({ data: [...assignments.values()].map(value => ({ ...value })), skipDuplicates: true });

  await tx.user.createMany({ data: D.teachers.filter((teacher: any) => teacher.login).map((teacher: any) => ({
    username: teacher.login.toLocaleLowerCase("en-US"),
    displayName: teacher.displayName || teacher.name,
    role: "TEACHER" as const,
    passwordHash: null,
    active: false,
    teacherId: teacher.id,
  })), skipDuplicates: true });

  const lessons = D.createDraft();
  for (let offset = 0; offset < lessons.length; offset += 1000) {
    const chunk = lessons.slice(offset, offset + 1000);
    await tx.lesson.createMany({ data: chunk.map((lesson: any) => {
      const course = D.byId(lesson.courseId);
      return {
        id: lesson.id,
        courseId: Number(lesson.courseId),
        groupId: course.group,
        semester: lesson.semester,
        date: lesson.date,
        pairIndex: lesson.lesson,
        room: lesson.room || "",
        isAdditional: Boolean(lesson.additional),
        isReference: Boolean(lesson.reference),
        sourceData: json(lesson),
      };
    }), skipDuplicates: true });
    const teacherRows = chunk.flatMap((lesson: any) => (lesson.teachers || []).map((teacherId: string) => ({ lessonId: lesson.id, teacherId })));
    if (teacherRows.length) await tx.lessonTeacher.createMany({ data: teacherRows, skipDuplicates: true });
  }

  await tx.portalSetting.upsert({
    where: { key: "calendar-2026-2027" },
    create: { key: "calendar-2026-2027", value: json(D.calendar) },
    update: {},
  });
  await tx.portalSetting.upsert({
    where: { key: "schedule-revision" },
    create: { key: "schedule-revision", value: D.scheduleRevision },
    update: {},
  });
}, { maxWait: 20_000, timeout: 120_000 });

console.log(`Seeded ${D.groupRecords.length} groups, ${D.teachers.length} teachers, ${D.courses.length} subjects and ${D.createDraft().length} timetable rows.`);
console.log("Teacher accounts are created disabled until an administrator assigns a unique password. Student accounts require the college roster; no student identities were invented.");
await prisma.$disconnect();
