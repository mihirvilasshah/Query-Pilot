/* Synthetic hospital schema used for tests. No real data. */
SET ANSI_NULLS ON;
GO

CREATE SCHEMA clinic;
GO
CREATE SCHEMA billing;
GO

-- Patients
CREATE TABLE dbo.Patients (
    PatientId   int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Patients PRIMARY KEY,
    FullName    nvarchar(max) NOT NULL,
    Email       nvarchar(100) NULL CONSTRAINT UQ_Patients_Email UNIQUE,
    Balance     decimal(18,2) NOT NULL CONSTRAINT DF_Patients_Balance DEFAULT (0),
    Age         int NULL CONSTRAINT CK_Patients_Age CHECK (Age >= 0),
    DoubleBal   AS (Balance * 2)
);
GO

CREATE TABLE dbo.Doctors (
    DoctorId int NOT NULL,
    Name     nvarchar(80) NOT NULL,
    CONSTRAINT PK_Doctors PRIMARY KEY CLUSTERED (DoctorId)
);
GO

CREATE TABLE clinic.Visits (
    VisitId   int NOT NULL,
    PatientId int NOT NULL,
    DoctorId  int NOT NULL,
    Notes     varchar(500) NULL,
    CONSTRAINT PK_Visits PRIMARY KEY (VisitId),
    CONSTRAINT FK_Visits_Patients FOREIGN KEY (PatientId) REFERENCES dbo.Patients (PatientId) ON DELETE CASCADE
);
GO

CREATE TABLE billing.Invoices (
    InvoiceId int NOT NULL PRIMARY KEY,
    VisitId   int NOT NULL,
    Amount    decimal(18,2) NOT NULL
);
GO

CREATE NONCLUSTERED INDEX IX_Visits_Patient ON clinic.Visits (PatientId DESC) INCLUDE (VisitId) WHERE PatientId > 0;
GO

CREATE VIEW dbo.vPatientVisits AS
SELECT p.PatientId, p.FullName, v.VisitId
FROM dbo.Patients p
JOIN clinic.Visits v ON v.PatientId = p.PatientId;
GO

CREATE FUNCTION billing.fn_Total(@VisitId int) RETURNS decimal(18,2)
AS
BEGIN
    RETURN (SELECT SUM(Amount) FROM billing.Invoices WHERE VisitId = @VisitId);
END;
GO

CREATE PROCEDURE dbo.usp_AdmitPatient @PatientId int, @Note nvarchar(50) = N'none', @Out int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;
    INSERT INTO clinic.Visits (VisitId, PatientId, DoctorId) SELECT 1, @PatientId, 1;
    UPDATE dbo.Patients SET Age = Age + 1 WHERE PatientId = @PatientId;
    EXEC dbo.usp_Audit @PatientId;
    COMMIT;
END;
GO

CREATE PROCEDURE dbo.usp_Audit @PatientId int
AS
BEGIN
    DECLARE @t TABLE (Id int);
    CREATE TABLE #scratch (Id int);
    SELECT billing.fn_Total(1) AS Total;
    SELECT * FROM dbo.vPatientVisits;
END;
GO

CREATE TRIGGER clinic.trg_Visits_Insert ON clinic.Visits AFTER INSERT, UPDATE
AS
BEGIN
    UPDATE dbo.Patients SET Age = Age FROM dbo.Patients p JOIN inserted i ON i.PatientId = p.PatientId;
END;
GO
