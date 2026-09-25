-- New table backing the Loan Application "My Request" employee flow and its admin approval tab.
-- Mirrors emp_advance_request (see 2026-09-24-emp-advance-request.sql for the full rationale):
-- kept separate from `emp_loan`/`emp_loan_info` because those are live tables read by payroll
-- deduction and the Loan Report — an unapproved employee request must never land there. An
-- `emp_loan` row (plus its full EMI schedule in `emp_loan_info`) is only created, via the existing
-- createLoan(), at approval time.
--
-- No migration tooling exists in this repo (raw SQL via mysql2, no Prisma/migrations dir) — run
-- this manually against each tenant database before deploying the feature.

CREATE TABLE `emp_loan_request` (
  `emp_loan_request_pkey` int(11) NOT NULL AUTO_INCREMENT,
  `emp_fkey` int(11) NOT NULL,
  `loan_amount` float NOT NULL,
  `tenure` int(11) NOT NULL,
  `intrest_rate` float NOT NULL DEFAULT '0',
  `emi_start_month` varchar(7) NOT NULL,
  `remarks` text,
  `request_status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `admin_remarks` text,
  `linked_loan_pkey` int(11) DEFAULT NULL,
  `reviewed_by` varchar(20) DEFAULT NULL,
  `reviewed_date` datetime DEFAULT NULL,
  `created_by` varchar(20) NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` varchar(20) NOT NULL,
  `modified_date` datetime NOT NULL,
  `status` int(11) NOT NULL DEFAULT '1',
  PRIMARY KEY (`emp_loan_request_pkey`),
  KEY `idx_emp_loan_request_emp` (`emp_fkey`),
  KEY `idx_emp_loan_request_status` (`request_status`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
-- latin1, not utf8mb4: matches the existing schema's convention, same as emp_advance_request.
