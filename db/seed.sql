-- Seed data. Every record is fictional, none of this is copied from the
-- real PDD or a real registry - names are just two pools combined at an
-- offset. PDD-1005 and PDD-1010 have a minor mentioned only as narrative
-- context in additional_details, for testing the safety rule in
-- lib/pdd-search.ts.
--
-- MERGE not INSERT so re-running this is safe. N-prefixed strings since
-- the columns are NVARCHAR, without it SQL Server silently drops anything
-- outside the current code page.

MERGE dbo.pdd_records AS target
USING (VALUES
  (N'PDD-1001', N'Daniel Blume', N'Cheyenne', N'WY', N'USA Wrestling',
   N'Sexual Misconduct', N'Permanently Ineligible', NULL),

  (N'PDD-1002', N'Marcus Nathanson', N'Laramie', N'WY', N'USA Wrestling',
   N'Emotional Misconduct', N'Suspended, 2 years',
   N'Sanction includes mandatory education prior to any reinstatement request.'),

  (N'PDD-1003', N'Renata Grantham', N'Sacramento', N'CA', N'USA Gymnastics',
   N'Physical Misconduct', N'Suspended, 3 years', NULL),

  (N'PDD-1004', N'Theodore Kowalczyk', N'San Diego', N'CA', N'USA Swimming',
   N'Failure to Report', N'Probation, 2 years',
   N'Reporting obligation arose under the program''s mandatory reporting policy.'),

  (N'PDD-1005', N'Priya Novosad', N'Denver', N'CO', N'USA Track & Field',
   N'Criminal Disposition', N'Permanently Ineligible',
   N'Criminal disposition on file, involving a minor as the affected party. The subject of this record is an adult; the minor is not a named party in this database.'),

  (N'PDD-1006', N'Wesley Ostrander', N'Boulder', N'CO', N'USA Wrestling',
   N'Sexual Misconduct', N'Permanently Ineligible', NULL),

  (N'PDD-1007', N'Alina Ito', N'Austin', N'TX', N'USA Weightlifting',
   N'Emotional Misconduct', N'Suspended, 1 year', NULL),

  (N'PDD-1008', N'Gerald Kessler', N'Portland', N'OR', N'USA Gymnastics',
   N'Physical Misconduct', N'Suspended, 5 years',
   N'Interim measures were in place prior to the final decision.'),

  (N'PDD-1009', N'Camille Ohlsen', N'Burlington', N'VT', N'USA Swimming',
   N'Failure to Report', N'Suspended, 1 year', NULL),

  (N'PDD-1010', N'Harlan Falk', N'Missoula', N'MT', N'USA Wrestling',
   N'Criminal Disposition', N'Permanently Ineligible',
   N'Underlying criminal case involved a minor. The minor is referenced only as context and is not a searchable subject of this record.')
) AS source (
  id, name, city, state, sport_affiliation, misconduct, action_taken, additional_details
)
ON target.id = source.id

WHEN MATCHED THEN
  UPDATE SET
    name               = source.name,
    city               = source.city,
    state              = source.state,
    sport_affiliation  = source.sport_affiliation,
    misconduct         = source.misconduct,
    action_taken       = source.action_taken,
    additional_details = source.additional_details

WHEN NOT MATCHED BY TARGET THEN
  INSERT (id, name, city, state, sport_affiliation, misconduct, action_taken, additional_details)
  VALUES (source.id, source.name, source.city, source.state, source.sport_affiliation,
          source.misconduct, source.action_taken, source.additional_details);
-- The terminating semicolon above is required. MERGE is one of the few T-SQL
-- statements where omitting it is a syntax error rather than a style choice.
GO
