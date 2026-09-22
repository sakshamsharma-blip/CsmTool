-- Adoption Template catalog seed, from the CSM team's real module/param checklist (Adaption_modules.xlsx).
-- Purely additive: every insert is ON CONFLICT DO NOTHING, so nothing already entered through the
-- Module Builder screen (or a previous run of this file) is touched or overwritten. Weightages and
-- the Mandatory/Adoption classification below are a first-pass default set by Claude, not the CSM
-- team -- every field here is editable from the Adoption Template screen afterward. All 154 params
-- default to type 'M' (mandatory) and category 'Adoption' (part of the base checklist, not an
-- Expansion/upsell item) since the source sheet reads as an onboarding/go-live validation checklist,
-- not a list of paid add-ons -- revisit per-param if some of these should actually be optional or
-- tracked as Expansion pipeline instead.

-- module_params has no description column yet -- adding one so the sheet's per-item validation
-- notes aren't lost, even though the Module Builder UI doesn't show/edit it yet.
alter table module_params add column if not exists description text;

insert into modules (key, name, icon, weight, description)
values ('contractof', 'Contract / OF', '📄', 8, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('contractof', 'Subscription Invoice', 'M', 25, 'Adoption', 'Validate Signed OF and check all the featurs are added in the Lab as per Contract'),
  ('contractof', 'Addons OF', 'M', 25, 'Adoption', 'Additional Feature Signed OF''s'),
  ('contractof', 'Invoice Data', 'M', 25, 'Adoption', 'Validation of Consolidate invoice in Multi Centre'),
  ('contractof', 'TDS Certificate', 'M', 25, 'Adoption', 'Validation of TDS Certificate and Email Confirmation')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('labdashboardconfg', 'Lab & Dashboard Confg.', '🏥', 10, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('labdashboardconfg', 'Updation Of CSM Data', 'M', 13, 'Adoption', 'Acct Manager , Customer Success Manager ,Managed Services, Sales Person'),
  ('labdashboardconfg', 'Centre Details', 'M', 13, 'Adoption', 'Email Id , Contact Number , Lab Address (Primary & Sub Centre''s ), Abbrevation , Contry Code , ISO Code  , Currency'),
  ('labdashboardconfg', 'Billing Info', 'M', 13, 'Adoption', 'Billing Cycle  , Credit Days , Related Billing Centres Addition in Zoho Account, Bank Details  Verification'),
  ('labdashboardconfg', 'Plan Details', 'M', 13, 'Adoption', 'Current Plan , Plan Type , Total MRR , Monthyl MRR,'),
  ('labdashboardconfg', 'Current State', 'M', 12, 'Adoption', 'Update The Configuration as Completed'),
  ('labdashboardconfg', 'Interfacing', 'M', 12, 'Adoption', 'Validation of Machines Count As per plan and get that updated'),
  ('labdashboardconfg', 'Communication', 'M', 12, 'Adoption', 'Validation of Communication Credits as per plan for (WA & SMS)'),
  ('labdashboardconfg', 'Parent Login', 'M', 12, 'Adoption', 'Addition of all the Multi Centre Labs / All child lab health check-up and status update')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('masterconfig', 'Master Config', '🗂️', 15, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('masterconfig', 'Test Master', 'M', 15, 'Adoption', 'Master Linking | Tests, Profile , Bill Only , Template : Tests, Profile ,  (Vaildation of All Billable and Non Billable test/profile and get Removed Unnessasry tests after confirmation) Correct TAT updated for every test, Print Priority Assigned correctly'),
  ('masterconfig', 'Dpartment Config', 'M', 15, 'Adoption', 'Validate Duplicate department and get it removed and assigned correct department to tests'),
  ('masterconfig', 'Sample Type', 'M', 14, 'Adoption', 'Validate Duplicate Sample type and get it resolved and assigned correct Sample type to tests'),
  ('masterconfig', 'Doctor Management', 'M', 14, 'Adoption', 'Validate Correct Signing doctor added and having nesessasry Deparmtent access and his signature correctly updated'),
  ('masterconfig', 'User Management', 'M', 14, 'Adoption', 'All Mandentory and Nessasry User info updated, Correct access control updated, nesessary Department rights provided'),
  ('masterconfig', 'Referral Management', 'M', 14, 'Adoption', 'All nesessary Referral details has been updated, Check Duplicate Referral and Remove it, Marketing person update, Communication flags configured'),
  ('masterconfig', 'Organization Management', 'M', 14, 'Adoption', 'All Nesessary Org info updated. Check the correct org type set-up and usage accordingly, Check Duplicate Org and remove it, Marketing person update, Communication flags configured')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('registration', 'Registration', '👤', 12, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('registration', 'Home Collection', 'M', 7, 'Adoption', 'HomeCollection Booking from Plebho app , Web Prowser etc'),
  ('registration', 'Appointment', 'M', 7, 'Adoption', 'Appointment Booking from CRM, Plebho , Web Prowser etc'),
  ('registration', 'Bulk Registration', 'M', 7, 'Adoption', 'How to do bulk registration of the patients'),
  ('registration', 'AI Registration Form', 'M', 7, 'Adoption', 'How to Do Registration with AI with TRF'),
  ('registration', 'Patient Merge / Demerge', 'M', 6, 'Adoption', 'How can you update the patient which is merged.'),
  ('registration', 'Test Refund', 'M', 6, 'Adoption', 'How to refund Single Test Amount'),
  ('registration', 'Calculate Price', 'M', 6, 'Adoption', 'How to check the Price of Specific Test or organization Price'),
  ('registration', 'Registration Display Fields', 'M', 6, 'Adoption', 'What field Should be reflecting under Display UI'),
  ('registration', 'Registration - Advance Settings', 'M', 6, 'Adoption', 'What are the advanced setting in the registration page'),
  ('registration', 'Registration - Quick Settings', 'M', 6, 'Adoption', null),
  ('registration', 'Upload Id Proof', 'M', 6, 'Adoption', 'If the Document is supposed to be uploaded Aadhar / PAN / Photo Etc , how that can be uploaded'),
  ('registration', 'Missing Data', 'M', 6, 'Adoption', null),
  ('registration', 'Archives', 'M', 6, 'Adoption', null),
  ('registration', 'Report Prints', 'M', 6, 'Adoption', null),
  ('registration', 'Test List', 'M', 6, 'Adoption', null),
  ('registration', 'Operational Status', 'M', 6, 'Adoption', 'Operaion Status')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('operations', 'Operations', '🔬', 15, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('operations', 'Operations Dashboard', 'M', 4, 'Adoption', 'Oprational overview through operations dashboard'),
  ('operations', 'Waiting List', 'M', 4, 'Adoption', 'Operational Waiting List - Patientwise/testwise/instrumentwise'),
  ('operations', 'All Machine Interfacing', 'M', 4, 'Adoption', 'All Machine Interfacing'),
  ('operations', 'QC Module / QC Interfacing', 'M', 4, 'Adoption', 'Machine Quality Control and Callibration'),
  ('operations', 'Auto-Approval / Auto-Dispatch', 'M', 4, 'Adoption', 'Auto Approval of results and dispatching'),
  ('operations', 'Auto Approval Queue', 'M', 4, 'Adoption', 'Auto Approval Queue to review and approve in Bulk'),
  ('operations', 'Machine Flags Display on Report Entry', 'M', 4, 'Adoption', 'Machine Flags Display on Report Entry to ensure no machine error while transferring'),
  ('operations', 'Sample Rerun', 'M', 4, 'Adoption', 'Abnormal results re-run , Auto and Manual Rerun'),
  ('operations', 'Delta Check', 'M', 4, 'Adoption', 'Previious Data of patients - comparision of previous result with current one'),
  ('operations', 'Critical Call Out', 'M', 4, 'Adoption', 'Critical callouts to the doctors and patients using Callout'),
  ('operations', 'Exceptions Tracking', 'M', 4, 'Adoption', 'Operations Exceptions tracking to reduce frequent exceptions'),
  ('operations', 'Historical View  - Test Analytics', 'M', 4, 'Adoption', 'Historical View - Test count and Analytics to see the testcount and details'),
  ('operations', 'Audit Trial', 'M', 4, 'Adoption', 'Auditing the activities of the report/bill/patients'),
  ('operations', 'Microbiology Reporting', 'M', 4, 'Adoption', 'Microbiology Reporting with Antibiotics and Drugs'),
  ('operations', 'PACS Interfacing', 'M', 4, 'Adoption', 'PACS Interfacing for Radiology reports'),
  ('operations', 'Microsoft Word Reporting - Radiology', 'M', 4, 'Adoption', 'Microsoft Word reporting for Radiology'),
  ('operations', 'Patient Trend Beside Overiew - Excel', 'M', 4, 'Adoption', 'Patient Trend Beside Overiew - Excel to see the historical data of the patient'),
  ('operations', 'Operational Overview', 'M', 4, 'Adoption', 'Operations Overview for Signing Doctors to see all the data in one Go'),
  ('operations', 'TAT Analytics', 'M', 4, 'Adoption', 'TAT Analystics for Timely submission of the reports - TAT Dashboard and Monitoring'),
  ('operations', 'Cache Passkey', 'M', 4, 'Adoption', 'Cache Passkey - Helps to sign results more efficiently instead of adding the passkey manually'),
  ('operations', 'Fetch All Pending Reports (Max 10k Records)', 'M', 4, 'Adoption', 'Works when the Lab has more than 10,000 reports in a week , to see all pending in one go'),
  ('operations', 'Hide Not Accessed Reports', 'M', 4, 'Adoption', 'Hide Not Accessed Reports'),
  ('operations', 'Show Dismissed Reports', 'M', 4, 'Adoption', 'Show Dismissed Reports'),
  ('operations', 'Operations Export', 'M', 4, 'Adoption', 'Operations export of the Result Values'),
  ('operations', 'Share Report Manually', 'M', 4, 'Adoption', 'Share Report Manually via Email to Patients, Orgs, Referrals')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('accession', 'Accession', '🧾', 10, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('accession', 'Pending Accession', 'M', 9, 'Adoption', 'All Samples that are billed are Viewed and Collected from Pending Accession'),
  ('accession', 'Pending Collection', 'M', 9, 'Adoption', 'All the Samples that just needs to be collected instead of Receiving can be done from Pending Collection'),
  ('accession', 'Accessed', 'M', 9, 'Adoption', 'All the Samples that are Collected and Received are visible under Accessed Section'),
  ('accession', 'Batch Creation', 'M', 9, 'Adoption', 'Samples that needs to be outsourced to the Other Centres by selecting it Manually can be done through Batch Creation'),
  ('accession', 'Batch Management', 'M', 8, 'Adoption', 'All the Samples that are been Sent / Received from Outsourced centre are been visible under Batch management Section'),
  ('accession', 'Rejected Samples (Redraw Sample , Dismissed Sample)', 'M', 8, 'Adoption', 'All Samples that are been Rejected or Dismissed Due to XYZ reason are been visible under Rejected Samples'),
  ('accession', 'Accession Settings (Prefix , Postfix)', 'M', 8, 'Adoption', 'This is important to be Setup and Configured Properly so that there are no issues while generating the Sample Number , Mostly this should checked for the samples that have Prefix and Postix Samples ( For Eg : Glucose Fasting and PP Samples )'),
  ('accession', 'Accession Flow (Bill Wise , Sample Wise)', 'M', 8, 'Adoption', 'This is Important to be checked and aligned as per the Lab Workflow

Bill Wise : This generates Accession Number same for all the Samples against the Bill 
Sample Wise : This generates Different Accession Number for all the Samples against the Bill'),
  ('accession', 'Accession Pattern', 'M', 8, 'Adoption', 'This is important to be configured to generate the Accession Number against the Samples/Tests'),
  ('accession', 'Worklist and Worksheet', 'M', 8, 'Adoption', 'Worklist : This can be exported to view all the Samples that are under Accession Page 
Worksheet : This Is exported with Parameter Names so that Values can written on the sheet and later reporting can be done under Operations (This is mostly used by the Doctors)'),
  ('accession', 'Scan Mode', 'M', 8, 'Adoption', 'Used to Collect or Receive the Sample by Directly Scanning the Barcode'),
  ('accession', 'Sample Archival', 'M', 8, 'Adoption', 'This is used to preserve the Sample in the Rack and Track it whenever required within 7-10 Days')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('branding', 'Branding', '🎨', 4, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('branding', 'SMS Communication Whitelabeled', 'M', 12, 'Adoption', 'Configuration of SMS Communication for the Whitelabled Account'),
  ('branding', 'Whats App Communication Whitelabeled', 'M', 11, 'Adoption', 'Configuration of Whats App  Communication for the Whitelabled Account'),
  ('branding', 'Email Communication Whitelabeling', 'M', 11, 'Adoption', 'Configuration of Email Communication for the Whitelabled Account'),
  ('branding', 'Email Whitelabeling', 'M', 11, 'Adoption', 'Client request only to update the Sender Email as Whitelabeled'),
  ('branding', 'Custom Doctors Login', 'M', 11, 'Adoption', 'Customization for the Doctors Login as per Clients Requirnemnts (Cover Page , Links , Banners)'),
  ('branding', 'Custom Lab User Login', 'M', 11, 'Adoption', 'Customization for the Lab User Login as per Clients Requirnemnts (Cover Page , Links , Banners)'),
  ('branding', 'Custom CRM Store Login', 'M', 11, 'Adoption', 'Customization for the CRM as per Clients Requirnemnts (Cover Page , Links , Banners)'),
  ('branding', 'Custom Patient Portal Login', 'M', 11, 'Adoption', 'Customization for the Patient Portal Login as per Clients Requirnemnts (Cover Page , Links , Banners)'),
  ('branding', 'Custom Organization  Login', 'M', 11, 'Adoption', 'Customization for the Organization Login as per Clients Requirnemnts (Cover Page , Links , Banners)')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('qualitycontrol', 'Quality Control', '✅', 8, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('qualitycontrol', 'QC Module / QC Interfacing', 'M', 13, 'Adoption', 'Machine Quality Control and Callibration'),
  ('qualitycontrol', 'QC Control Setup', 'M', 13, 'Adoption', 'QC Control Setup'),
  ('qualitycontrol', 'Email Notifications for QC Failures', 'M', 13, 'Adoption', 'Email Notifications for QC Failures'),
  ('qualitycontrol', 'Lot Management', 'M', 13, 'Adoption', 'QC - Lot Management'),
  ('qualitycontrol', 'LJ Chart', 'M', 12, 'Adoption', 'QC - LJ Chart Display'),
  ('qualitycontrol', 'QC Bulk Edit', 'M', 12, 'Adoption', 'QC Bulk Edit'),
  ('qualitycontrol', 'QC Exceptions', 'M', 12, 'Adoption', 'QC Exceptions'),
  ('qualitycontrol', 'QC Settings', 'M', 12, 'Adoption', 'QC Settings')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('inventory', 'Inventory', '📦', 6, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('inventory', 'Inventory - Product Master', 'M', 8, 'Adoption', 'Inventory - Product Master uploading all their current products'),
  ('inventory', 'Master list of Suppliers', 'M', 8, 'Adoption', 'Master list of Suppliers - Uploading all Suppliers'),
  ('inventory', 'Linking Suppliers with Products', 'M', 7, 'Adoption', 'Linking Suppliers with Products - Through Supplier inventory Mapping'),
  ('inventory', 'Current Stock Upload', 'M', 7, 'Adoption', 'Current Stock Upload - Uploading the Current Stock into the inventory Warehouse master'),
  ('inventory', 'Lab Trainings on The modules', 'M', 7, 'Adoption', 'Lab Trainings on The modules, Inventory warehouse and Inventory Operations'),
  ('inventory', 'Purchase Management', 'M', 7, 'Adoption', 'Purchase Management - How to Order and Receive Inventory'),
  ('inventory', 'Operations Inventory Transfer order', 'M', 7, 'Adoption', 'Operations Inventory Transfer order'),
  ('inventory', 'Workflow Setup - Approvals', 'M', 7, 'Adoption', 'Workflow Setup - Approvals'),
  ('inventory', 'Auto Consumptions', 'M', 7, 'Adoption', 'Auto Consumptions'),
  ('inventory', 'Bulk Consumptions', 'M', 7, 'Adoption', 'Bulk Consumptions through excel'),
  ('inventory', 'MIS Reports - Inventory', 'M', 7, 'Adoption', 'MIS Reports - Inventory'),
  ('inventory', 'Lab to Lab order', 'M', 7, 'Adoption', 'Lab to Lab order - Through Mapping for MultiCenters'),
  ('inventory', 'Organization Inventory transfer', 'M', 7, 'Adoption', 'Organization Inventory transfer - for Owned CC Logins'),
  ('inventory', 'Supplier Payment Management', 'M', 7, 'Adoption', 'Supplier Payment Management once paid to the Suppliers')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('others', 'Others', '🔗', 5, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('others', 'AOE / Lab Form Management', 'M', 8, 'Adoption', 'AOE / Lab Form Management for Questionairs'),
  ('others', 'Digital Signature on TRF', 'M', 8, 'Adoption', 'Digital Signature on TRF through CRM Store'),
  ('others', 'Customized PDF Report Format', 'M', 7, 'Adoption', 'Customized PDF Report Format as per lab requirement'),
  ('others', 'Customized Bill PDF Format', 'M', 7, 'Adoption', 'Customized Bill PDF Format as per lab requirement'),
  ('others', 'Customized Invoice PDF Format', 'M', 7, 'Adoption', 'Customized Invoice PDF Format as per lab requirement'),
  ('others', 'Customized TRF Format', 'M', 7, 'Adoption', 'Customized TRF Format as per lab requirement'),
  ('others', 'Integration - POS machine', 'M', 7, 'Adoption', 'Integration - POS machine'),
  ('others', 'Integration - HIS', 'M', 7, 'Adoption', 'Integration - HIS'),
  ('others', 'Integration - Tally/Zoho/Odoo', 'M', 7, 'Adoption', 'Integration - Tally/Zoho/Odoo'),
  ('others', 'Integration - Medical Aids (NH263)', 'M', 7, 'Adoption', 'Integration - Medical Aids'),
  ('others', 'Smart Reports', 'M', 7, 'Adoption', 'Smart Reports'),
  ('others', 'Notifications for B2B Clients', 'M', 7, 'Adoption', 'Notifications for B2B Clients'),
  ('others', 'Logistics Applications', 'M', 7, 'Adoption', 'Logistics Applications'),
  ('others', 'Power Bi - Tool Integration', 'M', 7, 'Adoption', 'Power Bi - Tool Integration')
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('admin', 'Admin', '⚙️', 10, null)
on conflict (key) do nothing;

insert into module_params (module_key, name, type, weight, category, description) values
  ('admin', 'Account Overview', 'M', 3, 'Adoption', null),
  ('admin', 'Account Overview - Overview', 'M', 3, 'Adoption', null),
  ('admin', 'Account Overview - Product Updates', 'M', 3, 'Adoption', null),
  ('admin', 'Account Overview - Subscription', 'M', 3, 'Adoption', null),
  ('admin', 'Account Overview - Centre Details', 'M', 3, 'Adoption', null),
  ('admin', 'Centre Details - Basic Info', 'M', 3, 'Adoption', null),
  ('admin', 'Centre Details - Lab Timings', 'M', 3, 'Adoption', null),
  ('admin', 'Centre Details - Bank Details', 'M', 3, 'Adoption', null),
  ('admin', 'Centre Details - Bank Account Config', 'M', 3, 'Adoption', null),
  ('admin', 'Account Overview - Communication', 'M', 3, 'Adoption', null),
  ('admin', 'Communication - SMS Credits', 'M', 3, 'Adoption', null),
  ('admin', 'Communication - Whatsapp Credits', 'M', 3, 'Adoption', null),
  ('admin', 'Communication - Email', 'M', 3, 'Adoption', null),
  ('admin', 'Referral Management (Add / Edit / Disable)', 'M', 3, 'Adoption', null),
  ('admin', 'Organisation Management (Add / Edit / Disable)', 'M', 3, 'Adoption', null),
  ('admin', 'Profile & Report Management', 'M', 3, 'Adoption', null),
  ('admin', 'Test List', 'M', 3, 'Adoption', null),
  ('admin', 'Master Linking', 'M', 3, 'Adoption', null),
  ('admin', 'Bill Settings', 'M', 3, 'Adoption', null),
  ('admin', 'Invoice Settings', 'M', 3, 'Adoption', null),
  ('admin', 'Report Settings', 'M', 3, 'Adoption', null),
  ('admin', 'Reflex Testing Configuration', 'M', 3, 'Adoption', null),
  ('admin', 'List & Group Management', 'M', 3, 'Adoption', null),
  ('admin', 'Organisation Lists', 'M', 3, 'Adoption', null),
  ('admin', 'Referral Lists', 'M', 3, 'Adoption', null),
  ('admin', 'Outsource Lists', 'M', 3, 'Adoption', null),
  ('admin', 'Discount List', 'M', 2, 'Adoption', null),
  ('admin', 'Doctor Signing List', 'M', 2, 'Adoption', null),
  ('admin', 'Doctor Management', 'M', 2, 'Adoption', null),
  ('admin', 'Add Test to List in (BULK)', 'M', 2, 'Adoption', null),
  ('admin', 'Department Management', 'M', 2, 'Adoption', null),
  ('admin', 'Outsourcing Management', 'M', 2, 'Adoption', null),
  ('admin', 'Centre Management', 'M', 2, 'Adoption', null),
  ('admin', 'User Management Settings', 'M', 2, 'Adoption', null),
  ('admin', 'Storage Management', 'M', 2, 'Adoption', null),
  ('admin', 'Integration Dashboard', 'M', 2, 'Adoption', null),
  ('admin', 'Activity Log', 'M', 2, 'Adoption', null)
on conflict (module_key, name) do nothing;

insert into modules (key, name, icon, weight, description)
values ('auditready', 'Audit Ready', '🛡️', 1, null)
on conflict (key) do nothing;

insert into modules (key, name, icon, weight, description)
values ('crelioinsights', 'Crelio Insights', '📊', 1, null)
on conflict (key) do nothing;
