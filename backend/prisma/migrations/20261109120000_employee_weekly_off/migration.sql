-- An employee's own weekly off (0 = Sunday ... 6 = Saturday).
-- NULL means the plant's weekly off (Saturday). Existing rows stay NULL.
ALTER TABLE "Employee" ADD COLUMN "weeklyOffDay" INTEGER;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_weeklyOffDay_check" CHECK ("weeklyOffDay" IS NULL OR "weeklyOffDay" BETWEEN 0 AND 6);
