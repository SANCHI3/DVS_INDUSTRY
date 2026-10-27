-- Additive only: a nullable wage column and a new per-employee daily output
-- table. No existing rows or columns are changed.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "dailyWageRate" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "EmployeeDailyOutput" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "workingHours" DOUBLE PRECISION,
    "expectedParts" DECIMAL(12,3),
    "producedParts" DECIMAL(12,3),
    "operationsCount" INTEGER,
    "remarks" TEXT,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDailyOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDailyOutput_date_idx" ON "EmployeeDailyOutput"("date");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDailyOutput_employeeId_date_key" ON "EmployeeDailyOutput"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "EmployeeDailyOutput" ADD CONSTRAINT "EmployeeDailyOutput_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
