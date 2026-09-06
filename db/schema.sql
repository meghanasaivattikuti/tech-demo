-- Schema for the RDS database standing in for the real system of record.
-- Columns match the live public PDD's confirmed search-result columns
-- exactly (Name, City, State, Sport Affiliation, Misconduct, Action Taken,
-- Additional Details). GO separates batches, db/migrate.mjs splits on it
-- before sending since it's a sqlcmd/SSMS thing, not real T-SQL.

IF OBJECT_ID(N'dbo.pdd_records', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.pdd_records (
    id                 VARCHAR(32)   NOT NULL,

    -- NVARCHAR since names/cities will get non-ASCII characters eventually,
    -- collation pinned explicitly so search stays case-insensitive
    -- regardless of what collation the instance itself defaults to
    name               NVARCHAR(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    city               NVARCHAR(128) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    state              CHAR(2)       COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    sport_affiliation  NVARCHAR(128) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    misconduct         NVARCHAR(128) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    action_taken       NVARCHAR(128) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,

    -- the only column that can reference a minor as context, so it's
    -- deliberately not searchable, see lib/pdd-search.ts
    additional_details NVARCHAR(MAX) NULL,

    -- SYSUTCDATETIME not SYSDATETIME so this doesn't shift with the
    -- instance's timezone
    updated_at         DATETIME2(3)  NOT NULL
                         CONSTRAINT DF_pdd_records_updated_at DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_pdd_records PRIMARY KEY CLUSTERED (id)
  );
END
GO

-- state + sport_affiliation are what search hits most, indexed since this
-- runs as a real WHERE clause. no CREATE INDEX IF NOT EXISTS in T-SQL,
-- hence the sys.indexes guard on all three below
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_pdd_records_state'
    AND object_id = OBJECT_ID(N'dbo.pdd_records')
)
  CREATE NONCLUSTERED INDEX IX_pdd_records_state ON dbo.pdd_records (state);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_pdd_records_sport_affiliation'
    AND object_id = OBJECT_ID(N'dbo.pdd_records')
)
  CREATE NONCLUSTERED INDEX IX_pdd_records_sport_affiliation
    ON dbo.pdd_records (sport_affiliation);
GO

-- this one's a real fix, not a precaution - ORDER BY name was taking ~25s
-- on 10 rows. turned out to be RESOURCE_SEMAPHORE (a memory grant wait, not
-- actual work) since SQL Server Express on a small instance has to queue
-- for memory even for a tiny sort. ORDER BY id was always instant since id
-- is the clustered key and needs no sort at all - this index gives name the
-- same property, no sort operator, no memory grant
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_pdd_records_name'
    AND object_id = OBJECT_ID(N'dbo.pdd_records')
)
  CREATE NONCLUSTERED INDEX IX_pdd_records_name ON dbo.pdd_records (name);
GO

-- T-SQL has no ON UPDATE CURRENT_TIMESTAMP like MySQL, so this trigger is
-- what keeps updated_at honest on every write, from any client
CREATE OR ALTER TRIGGER dbo.trg_pdd_records_updated_at
ON dbo.pdd_records
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE target
    SET updated_at = SYSUTCDATETIME()
  FROM dbo.pdd_records AS target
  INNER JOIN inserted AS i ON target.id = i.id;
END
GO
