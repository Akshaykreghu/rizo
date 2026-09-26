-- Adds a 'Deleted' terminal request_status to both request tables, plus a deleted_by/deleted_date
-- audit pair, so that deleting a loan/advance created from an approved request is reflected back
-- on the request itself — instead of the request permanently showing "Approved" for something that
-- no longer exists. See lib/loans.ts's markLoanRequestDeletedByLoanId() and lib/advances.ts's
-- markAdvanceRequestDeletedByAdvanceId(), called from the respective DELETE /api/.../[id] routes.

ALTER TABLE `emp_loan_request`
  MODIFY COLUMN `request_status` ENUM('Pending','Approved','Rejected','Deleted') NOT NULL DEFAULT 'Pending',
  ADD COLUMN `deleted_by` varchar(20) DEFAULT NULL,
  ADD COLUMN `deleted_date` datetime DEFAULT NULL;

ALTER TABLE `emp_advance_request`
  MODIFY COLUMN `request_status` ENUM('Pending','Approved','Rejected','Deleted') NOT NULL DEFAULT 'Pending',
  ADD COLUMN `deleted_by` varchar(20) DEFAULT NULL,
  ADD COLUMN `deleted_date` datetime DEFAULT NULL;
