-- New table backing the Salary Advance "My Request" employee flow and its admin approval tab.
-- Deliberately separate from `emp_advance`: both the admin's existing pending-advances list and
-- the `payroll_master_approve` settlement stored procedure scan `emp_advance` filtered only on
-- `status = 1 AND is_credited = 'N'`, so an unapproved employee request must never land there —
-- it would show up as a live advance and could be settled by payroll before anyone approves it.
-- An `emp_advance` row is only created (via the existing createAdvance()) at approval time.
--
-- No migration tooling exists in this repo (raw SQL via mysql2, no Prisma/migrations dir) — run
-- this manually against each tenant database before deploying the feature.

CREATE TABLE `emp_advance_request` (
  `emp_advance_request_pkey` int(11) NOT NULL AUTO_INCREMENT,
  `emp_fkey` int(11) NOT NULL,
  `advance_amount` float NOT NULL,
  `affected_month` varchar(7) NOT NULL,
  `remarks` text,
  `request_status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `admin_remarks` text,
  `linked_advance_pkey` int(11) DEFAULT NULL,
  `reviewed_by` varchar(20) DEFAULT NULL,
  `reviewed_date` datetime DEFAULT NULL,
  `created_by` varchar(20) NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` varchar(20) NOT NULL,
  `modified_date` datetime NOT NULL,
  `status` int(11) NOT NULL DEFAULT '1',
  PRIMARY KEY (`emp_advance_request_pkey`),
  KEY `idx_emp_advance_request_emp` (`emp_fkey`),
  KEY `idx_emp_advance_request_status` (`request_status`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
-- latin1, not utf8mb4: matches the existing schema's convention (emp_advance and most legacy
-- tables are latin1) — a mismatched charset on a joined/compared column risks silent corruption
-- or comparison issues, per prior deployment findings.
