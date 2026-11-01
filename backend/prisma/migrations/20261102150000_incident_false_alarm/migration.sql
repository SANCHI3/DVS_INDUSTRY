-- Incidents checked and found to be false alarms (with the reason).
-- AlterTable
ALTER TABLE "SecurityIncident" ADD COLUMN     "falseAlarm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "falseAlarmReason" TEXT;

