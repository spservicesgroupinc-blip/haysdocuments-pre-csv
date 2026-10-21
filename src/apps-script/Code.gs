/**
 * ============================================================================
 *  HAYS + SONS COMPLETE RESTORATION - CUSTOMER & JOB DATABASE
 *  Google Apps Script backend  -  the complete backend (one file)
 * ============================================================================
 *
 *  THIS ONE FILE IS THE ENTIRE BACKEND. Paste it into the Apps Script editor's
 *  Code.gs in a single go: clear the placeholder first (Ctrl+A, then Delete),
 *  paste, and save. Then press Ctrl+End - the last line must be a single "}"
 *  and the file must match the line count printed by "npm run apps:ascii".
 *  Keep it pure ASCII; it is delivered by copy-paste.
 *
 *  QUICK START
 *    1. Paste this whole file into Code.gs (see above).
 *    2. Project Settings -> Show appsscript.json -> paste the manifest.
 *    3. Run ONE command and approve the permissions prompt:
 *         setupDatabase()
 *       That provisions the spreadsheet, every sheet, all headers, formatting
 *       and the README tab. It is idempotent, so running it again is safe.
 *       Add an admin in the same call with three arguments, run from a
 *       temporary wrapper because the editor cannot pass arguments:
 *         function bootstrap() {
 *           setupDatabase('you@example.com', 'Your Name', 'a-strong-password');
 *         }
 *    4. Run selfTest()  ->  should report PASS
 *    5. Deploy -> New deployment -> Web app
 *         Execute as:      Me
 *         Who has access:  Anyone
 *       Copy the /exec URL into the front-end as VITE_APPS_SCRIPT_URL
 *    6. SIGN-UP IS OPEN by default - anyone with the web app URL can create an
 *       account from the login page. To lock it down, run either of these from
 *       the function dropdown (no arguments, so they run directly, and both take
 *       effect immediately with no redeploy):
 *         disableRegistration()   -> no sign-up at all
 *         useInviteCode()         -> an invite code is required
 *
 *  If step 3 is skipped, the very first web request provisions the database
 *  automatically, so a fresh deployment is never left half-built.
 *
 *  SECURITY MODEL
 *    The app has its own login page. Credentials are checked against the "Users"
 *    sheet and a short-lived bearer token is issued, recorded in the "Sessions"
 *    sheet and sent with every subsequent request.
 *
 *    Passwords are never stored in plain text: each account carries a random
 *    salt and an iterated HMAC-SHA256 derivation. Accounts lock after repeated
 *    failures and sessions expire automatically.
 *
 *    The Google ID-token path (ALLOWED_CLIENT_ID / ALLOWED_EMAILS) remains
 *    available but optional. SHARED_SECRET is a deliberate developer bypass and
 *    must stay unset in production.
 *
 *    Self-service sign-up is OPEN by default: anyone who has the web app URL can
 *    create an account from the login page. It can be restricted to an invite
 *    code, or switched off entirely, and it can never create an administrator.
 *    The policy lives in the REGISTRATION_MODE Script Property:
 *      open (default) | invite | off
 *
 *  API
 *    POST /exec   Content-Type: text/plain;charset=utf-8
 *                 body: {"action":"login","email":"...","password":"..."}
 *                       {"action":"register","email":"...","name":"...","password":"...","inviteCode":"..."}
 *                       {"action":"saveJob","sessionToken":"<token>","job":{...}}
 *                       {"action":"saveDraft","sessionToken":"<token>","draft":{"job":{...},"recordId":"..."}}
 *                       {"action":"getDraft","sessionToken":"<token>"}
 *                 Every response is HTTP 200 with a JSON envelope:
 *                 {"ok":true,"data":{...}}  |  {"ok":false,"error":"...","code":"..."}
 *                 Always branch on 'ok', never on the HTTP status.
 *
 *  DATA MODEL
 *    The spreadsheet is the system of record. Every account reads and writes the
 *    same "Jobs" sheet, so a record entered under one login is visible under any
 *    other, on any device. The record currently being edited is autosaved to the
 *    "Drafts" sheet (saveDraft / getDraft), so an unfinished job is never
 *    stranded in one browser profile. A device may keep an offline cache plus an
 *    outbox of pending writes, but those are only copies: the queue is replayed
 *    here as soon as the device is online.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * 1. CONFIGURATION
 * ------------------------------------------------------------------------ */

var PROP = {
  DB_SPREADSHEET_ID: 'DB_SPREADSHEET_ID',
  SCHEMA_VERSION: 'SCHEMA_VERSION',
  ALLOWED_CLIENT_ID: 'ALLOWED_CLIENT_ID',
  ALLOWED_EMAILS: 'ALLOWED_EMAILS',
  REQUIRE_ID_TOKEN: 'REQUIRE_ID_TOKEN',
  SHARED_SECRET: 'SHARED_SECRET',
  DB_SHEET_NAME: 'DB_SHEET_NAME',
  LOG_SHEET_NAME: 'LOG_SHEET_NAME',
  USERS_SHEET_NAME: 'USERS_SHEET_NAME',
  SESSIONS_SHEET_NAME: 'SESSIONS_SHEET_NAME',
  REGISTRATION_CODE: 'REGISTRATION_CODE',
  REGISTRATION_MODE: 'REGISTRATION_MODE',
  REGISTRATION_EMAIL_DOMAINS: 'REGISTRATION_EMAIL_DOMAINS',
  REGISTRATION_DEFAULT_ROLE: 'REGISTRATION_DEFAULT_ROLE',
  DRAFTS_SHEET_NAME: 'DRAFTS_SHEET_NAME',
  WORKFLOW_ENFORCE_REVISIONS: 'WORKFLOW_ENFORCE_REVISIONS',
  WORKFLOW_DRIVE_ROOT_ID: 'WORKFLOW_DRIVE_ROOT_ID'
};

var DEFAULTS = {
  DB_SHEET_NAME: 'Jobs',
  LOG_SHEET_NAME: 'AuditLog',
  USERS_SHEET_NAME: 'Users',
  SESSIONS_SHEET_NAME: 'Sessions',
  DRAFTS_SHEET_NAME: 'Drafts',
  SCHEMA_VERSION: 2,
  REQUIRE_ID_TOKEN: 'true',
  SPREADSHEET_TITLE: 'Hays + Sons - Customer & Job Database',
  NOTES_SHEET_NAME: 'README',
  WEBAPP_ACCESS_HINT: 'Anyone',
  EXECUTE_AS_HINT: 'Me',
  // --- Authentication tunables -------------------------------------------------
  SESSION_HOURS: 12,
  PASSWORD_ITERATIONS: 1500,
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  // --- Self-service registration ------------------------------------------------
  MIN_PASSWORD_LENGTH: 8,
  MIN_REGISTRATION_CODE_LENGTH: 12,
  REGISTRATION_DEFAULT_ROLE: 'editor',
  REGISTRATION_MODE: 'open'
};

/** 'Jobs' sheet columns, in order. Keep in sync with the front-end index columns. */
var JOB_HEADERS = [
  'RecordId',
  'JobNumber',
  'JobName',
  'CustomerName',
  'Email',
  'MobilePhone',
  'LossAddress',
  'Carrier',
  'ClaimNumber',
  'Status',
  'CreatedAt',
  'UpdatedAt',
  'UpdatedBy',
  'SchemaVersion',
  'RecordJson',
  'Deleted',
  'Revision',
  'LastMutationId'
];

var JOB_ITEM_HEADERS = ['JobId', 'Kind', 'ItemId', 'Revision', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy', 'DeletedAt', 'LastMutationId', 'PayloadJson'];
var JOB_MUTATION_HEADERS = ['MutationId', 'Actor', 'JobId', 'Target', 'Action', 'RequestHash', 'ExpectedRevision', 'State', 'IntentJson', 'ResultJson', 'CreatedAt', 'UpdatedAt'];
var WORKSPACE_DRAFT_HEADERS = ['DraftId', 'Actor', 'DeviceId', 'JobId', 'Revision', 'UpdatedAt', 'UpdatedBy', 'LastMutationId', 'PayloadJson'];
var WORKFLOW_KINDS = ['workflow', 'activity', 'selection', 'change', 'closeout', 'attachment', 'artifact'];
var WORKFLOW_STAGES = ['intake', 'awaiting_contract', 'ready_for_production', 'in_production', 'on_hold', 'closeout', 'complete', 'cancelled'];
var WORKFLOW_SCHEMA_READY_ = false;

/** Append-only audit trail. */
var LOG_HEADERS = ['Timestamp', 'User', 'Action', 'RecordId', 'JobNumber', 'Detail'];

/** Application accounts. */
var USER_HEADERS = [
  'Email',
  'Name',
  'Role',
  'Salt',
  'PasswordHash',
  'Active',
  'FailedAttempts',
  'LockedUntil',
  'CreatedAt',
  'LastLoginAt'
];

/** Short-lived bearer sessions issued on successful login. */
var SESSION_HEADERS = ['Token', 'Email', 'Name', 'Role', 'CreatedAt', 'ExpiresAt', 'LastSeenAt'];

/**
 * The shared workspace draft: the record currently open in the app, stored so
 * an unfinished record is never stranded on one device and follows the team to
 * any account. One row, keyed on the fixed id in DRAFT_ROW_ID.
 */
var DRAFT_HEADERS = [
  'DraftId',
  'UpdatedAt',
  'UpdatedBy',
  'RecordId',
  'JobNumber',
  'CustomerName',
  'SchemaVersion',
  'PayloadJson'
];

var DRAFT_ROW_ID = 'current';

var ROLE_VALUES = ['admin', 'editor', 'viewer'];

var STATUS_VALUES = ['Draft', 'Active', 'On Hold', 'Complete', 'Cancelled'];

/* Fields that round-trip as 'number | empty-string' in the front-end. */
var NUMERIC_OR_BLANK_PATHS = [
  'insurance.roughEstimateAmount',
  'financials.totalApprovedRcv',
  'financials.deductible',
  'changeOrder.originalContractSum',
  'changeOrder.netPreviousChanges',
  'changeOrder.changeAmount',
  'changeOrder.addedDays',
  'checklist.depreciationAmount'
];

/** Always-numeric fields (default supplied). */
var NUMERIC_PATHS = {
  'financials.netClaimValue': 0,
  'financials.downPayment': 0,
  'financials.midProgressPayment': 0,
  'financials.balancePayment': 0,
  'financials.commenceDays': 10,
  'financials.completeDays': 60
};

/** Boolean fields. */
var BOOLEAN_PATHS = [
  'mortgage.hasMortgage',
  'changeOrder.isInsuranceRelated',
  'checklist.isSelfPay',
  'checklist.isProgramClaim',
  'checklist.hasCheckBeenSent',
  'checklist.isDepreciationWithheld'
];

/** Case-sensitive string unions. */
var ENUM_PATHS = {
  'changeOrder.changeType': { values: ['increase', 'decrease', 'unchanged'], fallback: 'increase' },
  'checklist.hasDeductibleBeenCollected': { values: ['Yes', 'No', 'Pending'], fallback: 'No' }
};

/* ---------------------------------------------------------------------------
 * 2. PROVISIONING & SCHEMA
 * ------------------------------------------------------------------------ */

function setupDatabase(adminEmail, adminName, adminPassword) {
  var props = PropertiesService.getScriptProperties();
  var created = false;
  var spreadsheet = null;

  var existingId = props.getProperty(PROP.DB_SPREADSHEET_ID);
  if (existingId) {
    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
    } catch (err) {
      Logger.log('Stored DB_SPREADSHEET_ID is not reachable (' + err + '). A new spreadsheet will be created.');
      spreadsheet = null;
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create(DEFAULTS.SPREADSHEET_TITLE);
    created = true;
  }

  var jobSheetName = props.getProperty(PROP.DB_SHEET_NAME) || DEFAULTS.DB_SHEET_NAME;
  var logSheetName = props.getProperty(PROP.LOG_SHEET_NAME) || DEFAULTS.LOG_SHEET_NAME;
  var usersSheetName = props.getProperty(PROP.USERS_SHEET_NAME) || DEFAULTS.USERS_SHEET_NAME;
  var sessionsSheetName = props.getProperty(PROP.SESSIONS_SHEET_NAME) || DEFAULTS.SESSIONS_SHEET_NAME;
  var draftsSheetName = props.getProperty(PROP.DRAFTS_SHEET_NAME) || DEFAULTS.DRAFTS_SHEET_NAME;

  var jobsResult = ensureSheet_(spreadsheet, jobSheetName, JOB_HEADERS);
  var logResult = ensureSheet_(spreadsheet, logSheetName, LOG_HEADERS);
  var usersResult = ensureSheet_(spreadsheet, usersSheetName, USER_HEADERS);
  var sessionsResult = ensureSheet_(spreadsheet, sessionsSheetName, SESSION_HEADERS);
  var draftsResult = ensureSheet_(spreadsheet, draftsSheetName, DRAFT_HEADERS);
  ensureWorkflowSchema_(spreadsheet);

  props.setProperty(PROP.DB_SPREADSHEET_ID, spreadsheet.getId());
  props.setProperty(PROP.DB_SHEET_NAME, jobSheetName);
  props.setProperty(PROP.LOG_SHEET_NAME, logSheetName);
  props.setProperty(PROP.USERS_SHEET_NAME, usersSheetName);
  props.setProperty(PROP.SESSIONS_SHEET_NAME, sessionsSheetName);
  props.setProperty(PROP.DRAFTS_SHEET_NAME, draftsSheetName);
  if (!props.getProperty(PROP.SCHEMA_VERSION)) {
    props.setProperty(PROP.SCHEMA_VERSION, String(DEFAULTS.SCHEMA_VERSION));
  }
  if (!props.getProperty(PROP.REQUIRE_ID_TOKEN)) {
    props.setProperty(PROP.REQUIRE_ID_TOKEN, DEFAULTS.REQUIRE_ID_TOKEN);
  }

  removeDefaultSheet_(spreadsheet);

  var jobsSheet = spreadsheet.getSheetByName(jobSheetName);
  var logSheet = spreadsheet.getSheetByName(logSheetName);
  var usersSheet = spreadsheet.getSheetByName(usersSheetName);
  var sessionsSheet = spreadsheet.getSheetByName(sessionsSheetName);
  var draftsSheet = spreadsheet.getSheetByName(draftsSheetName);

  applySheetFormatting_(jobsSheet, JOB_HEADERS);
  applySheetFormatting_(logSheet, LOG_HEADERS);
  applySheetFormatting_(usersSheet, USER_HEADERS);
  applySheetFormatting_(sessionsSheet, SESSION_HEADERS);
  applySheetFormatting_(draftsSheet, DRAFT_HEADERS);

  hideColumns_(usersSheet, USER_HEADERS, ['Salt', 'PasswordHash']);
  hideColumns_(sessionsSheet, SESSION_HEADERS, ['Token']);

  writeNotesTab_(spreadsheet, jobSheetName, logSheetName, usersSheetName, sessionsSheetName, draftsSheetName);

  var userCount = countDataRows_(usersSheet);

  var summary = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    created: created,
    jobsSheet: jobSheetName,
    logSheet: logSheetName,
    usersSheet: usersSheetName,
    sessionsSheet: sessionsSheetName,
    draftsSheet: draftsSheetName,
    userCount: userCount,
    columnsAdded:
      jobsResult.columnsAdded +
      logResult.columnsAdded +
      usersResult.columnsAdded +
      sessionsResult.columnsAdded +
      draftsResult.columnsAdded,
    schemaVersion: Number(props.getProperty(PROP.SCHEMA_VERSION)),
    requiresFirstUser: userCount === 0,
    webAppUrl: ScriptApp.getService().getUrl()
  };

  var bootstrap = null;
  if (adminEmail && adminPassword) {
    bootstrap = createUser(adminEmail, adminName || adminEmail, adminPassword, 'admin');
    summary.userCount = countDataRows_(usersSheet);
    summary.requiresFirstUser = false;
  }

  summary.nextSteps = bootstrap
    ? 'Account "' + bootstrap.email + '" is ready. Log in through the app with that email and password.'
    : userCount === 0
    ? 'Create your first login with createUser(email, name, password, "admin"), then sign in through the app.'
    : 'Set up. Sign in through the app, then paste the web app /exec URL into VITE_APPS_SCRIPT_URL.';

  Logger.log('setupDatabase complete.\n' + JSON.stringify(summary, null, 2));
  Logger.log('NEXT: ' + summary.nextSteps);
  return summary;
}

function ensureDatabaseReady_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP.DB_SPREADSHEET_ID)) return false;

  Logger.log('No database configured - provisioning automatically on first use.');
  try {
    var summary = setupDatabase();
    Logger.log('Automatic provisioning complete: ' + summary.spreadsheetUrl);
    return true;
  } catch (err) {
    throw appError_(
      'not_configured',
      'The database could not be provisioned automatically (' +
        ((err && err.message) || err) +
        '). Open the Apps Script editor and run setupDatabase() once, then try again.'
    );
  }
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  var columnsAdded = 0;
  var lastColumn = Math.max(sheet.getLastColumn(), 0);
  var existing = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    columnsAdded = headers.length;
  } else {
    var present = {};
    for (var i = 0; i < existing.length; i++) {
      if (existing[i]) present[String(existing[i])] = true;
    }
    for (var h = 0; h < headers.length; h++) {
      if (!present[headers[h]]) {
        sheet.getRange(1, sheet.getLastColumn() + 1, 1, 1).setValue(headers[h]);
        columnsAdded++;
      }
    }
  }

  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  return { columnsAdded: columnsAdded };
}

function removeDefaultSheet_(spreadsheet) {
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (sheet.getName() === 'Sheet1' && sheet.getLastRow() === 0 && sheets.length > 1) {
      spreadsheet.deleteSheet(sheet);
    }
  }
}

function applySheetFormatting_(sheet, headers) {
  if (!sheet) return;

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#dc2626')
    .setVerticalAlignment('middle')
    .setWrap(false);
  sheet.setRowHeight(1, 28);

  var textColumns = [
    'RecordId',
    'JobNumber',
    'ClaimNumber',
    'RecordJson',
    'PayloadJson',
    'CreatedAt',
    'UpdatedAt'
  ];
  for (var i = 0; i < headers.length; i++) {
    if (textColumns.indexOf(headers[i]) !== -1) {
      sheet.getRange(2, i + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    }
  }

  for (var c = 0; c < headers.length; c++) {
    var name = headers[c];
    if (name === 'RecordJson' || name === 'PayloadJson') sheet.setColumnWidth(c + 1, 120);
    else if (name === 'Email' || name === 'LossAddress') sheet.setColumnWidth(c + 1, 200);
    else sheet.setColumnWidth(c + 1, Math.max(120, Math.min(220, name.length * 12 + 60)));
  }

  var recordIdCol = headers.indexOf('RecordId');
  var jsonCol = headers.indexOf('RecordJson');
  var payloadCol = headers.indexOf('PayloadJson');
  if (recordIdCol !== -1) sheet.hideColumns(recordIdCol + 1);
  if (jsonCol !== -1) sheet.hideColumns(jsonCol + 1);
  if (payloadCol !== -1) sheet.hideColumns(payloadCol + 1);
}

function hideColumns_(sheet, headers, names) {
  if (!sheet) return;
  for (var i = 0; i < names.length; i++) {
    var index = headers.indexOf(names[i]);
    if (index === -1) continue;
    try {
      sheet.hideColumns(index + 1);
    } catch (err) {
      Logger.log('Could not hide column ' + names[i] + ': ' + err);
    }
  }
}

function countDataRows_(sheet) {
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  return lastRow < 2 ? 0 : lastRow - 1;
}

function writeNotesTab_(spreadsheet, jobSheetName, logSheetName, usersSheetName, sessionsSheetName, draftsSheetName) {
  var sheet = spreadsheet.getSheetByName(DEFAULTS.NOTES_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(DEFAULTS.NOTES_SHEET_NAME);
  sheet.clear();

  var lines = [
    ['Hays + Sons Complete Restoration - Customer & Job Database'],
    ['Provisioned', new Date().toISOString()],
    ['Schema version', String(currentSchemaVersion_())],
    [''],
    ['HOW THIS WORKS'],
    ['This spreadsheet is the system of record for customer/job data entered in the document automation app.'],
    ['The front-end talks to the Apps Script web app, which reads and writes the "' + jobSheetName + '" sheet.'],
    ['Every change is also appended to "' + logSheetName + '".'],
    [''],
    ['SHEETS'],
    [jobSheetName, 'One row per saved job. RecordJson holds the complete record.'],
    [logSheetName, 'Append-only audit trail of who changed what and when.'],
    [usersSheetName, 'Application accounts. Salt and PasswordHash are hidden.'],
    [sessionsSheetName, 'Active login sessions. The Token column is hidden.'],
    [
      draftsSheetName,
      'The shared workspace draft - the record currently being edited. PayloadJson is hidden. One row, so nothing is lost if a device is replaced.'
    ],
    [''],
    ['SIGNING IN'],
    ['The app has its own login page. Credentials are checked against the "' + usersSheetName + '" sheet.'],
    ['Passwords are never stored in plain text - each account has a random salt and an iterated hash.'],
    ['Create accounts from the Apps Script editor with createUser(email, name, password, role).'],
    ['People can also create their own account from the login page. See REGISTRATION_MODE below.'],
    ['Sessions expire after ' + DEFAULTS.SESSION_HOURS + ' hours and are listed in "' + sessionsSheetName + '".'],
    [''],
    ['COLUMNS - ' + jobSheetName]
  ];

  for (var i = 0; i < JOB_HEADERS.length; i++) {
    lines.push(['  ' + (i + 1) + '. ' + JOB_HEADERS[i], describeColumn_(JOB_HEADERS[i])]);
  }

  lines.push(['']);
  lines.push(['COLUMNS - ' + logSheetName]);
  for (var l = 0; l < LOG_HEADERS.length; l++) {
    lines.push(['  ' + (l + 1) + '. ' + LOG_HEADERS[l], '']);
  }

  lines.push(['']);
  lines.push(['COLUMNS - ' + draftsSheetName]);
  for (var d = 0; d < DRAFT_HEADERS.length; d++) {
    lines.push(['  ' + (d + 1) + '. ' + DRAFT_HEADERS[d], '']);
  }
  lines.push(['']);
  lines.push(['DRAFTING']);
  lines.push([
    'Shared draft',
    'The app autosaves the record being edited into ' + draftsSheetName + ', so a browser reset, a new device or a different login never loses in-progress work.'
  ]);
  lines.push(['Saved jobs', 'Clicking Save Job promotes the workspace draft into the ' + jobSheetName + ' sheet (the system of record).']);

  lines.push(['']);
  lines.push(['SECURITY - do not weaken these in production']);
  lines.push(['Sessions', 'Bearer tokens issued by login; expire after ' + DEFAULTS.SESSION_HOURS + ' hours.']);
  lines.push([
    'Lockout',
    'An account locks for ' + DEFAULTS.LOCKOUT_MINUTES + ' minutes after ' + DEFAULTS.MAX_FAILED_ATTEMPTS + ' failed attempts.'
  ]);
  lines.push(['ALLOWED_CLIENT_ID', 'Optional Google ID-token path (legacy).']);
  lines.push(['ALLOWED_EMAILS', 'Optional Google ID-token path (legacy).']);
  lines.push(['SHARED_SECRET', 'DEVELOPER BYPASS ONLY - leave blank in production.']);
  lines.push(['REGISTRATION_MODE', describeRegistrationMode_()]);

  var width = 2;
  sheet.getRange(1, 1, lines.length, width).setValues(
    lines.map(function (row) {
      var padded = row.slice(0, width);
      while (padded.length < width) padded.push('');
      return padded;
    })
  );

  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setFontSize(14);
  sheet.setColumnWidth(1, 320);
  sheet.setColumnWidth(2, 520);
  sheet.getRange(4, 1, lines.length - 3, width).setWrap(true).setVerticalAlignment('top');
}

function describeColumn_(name) {
  var map = {
    RecordId: 'Immutable UUID. Primary key. Never edited.',
    JobNumber: 'Human-facing job number, e.g. FW-2026-0842.',
    JobName: 'Job / project name.',
    CustomerName: 'Property owner.',
    Email: 'Customer email.',
    MobilePhone: 'Best contact number.',
    LossAddress: 'Property where the loss occurred.',
    Carrier: 'Insurance carrier.',
    ClaimNumber: 'Carrier claim number.',
    Status: 'Draft | Active | On Hold | Complete | Cancelled.',
    CreatedAt: 'YYYY-MM-DD when the job was first created.',
    UpdatedAt: 'ISO timestamp of the last save.',
    UpdatedBy: 'Verified email of the last editor.',
    SchemaVersion: 'Record schema version for future migrations.',
    RecordJson: 'Complete record as JSON. Source of truth for reload.',
    Deleted: 'TRUE for soft-deleted rows.'
  };
  return map[name] || '';
}

/* ---------------------------------------------------------------------------
 * 3. MENU & ACCESSORS
 * ------------------------------------------------------------------------ */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Hays + Sons DB')
      .addItem('Set up / repair database', 'setupDatabase')
      .addItem('Run self test', 'selfTest')
      .addItem('Turn ON self-service sign-up', 'enableRegistration')
      .addItem('Turn OFF self-service sign-up', 'disableRegistration')
      .addItem('List users', 'listUsers')
      .addItem('Clean up expired sessions', 'cleanupSessions')
      .addItem('Sign out everyone', 'revokeAllSessions')
      .addItem('Show install info', 'showInstallInfo')
      .addToUi();
  } catch (err) {
    // Standalone scripts have no UI; this is normal.
  }
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP.DB_SPREADSHEET_ID);
  if (!id) {
    ensureDatabaseReady_();
    id = PropertiesService.getScriptProperties().getProperty(PROP.DB_SPREADSHEET_ID);
  }
  return SpreadsheetApp.openById(id);
}

function jobsSheet_() {
  var ss = getSpreadsheet_();
  var name = PropertiesService.getScriptProperties().getProperty(PROP.DB_SHEET_NAME) || DEFAULTS.DB_SHEET_NAME;
  return ss.getSheetByName(name);
}

function usersSheet_() {
  var ss = getSpreadsheet_();
  var name = PropertiesService.getScriptProperties().getProperty(PROP.USERS_SHEET_NAME) || DEFAULTS.USERS_SHEET_NAME;
  return ss.getSheetByName(name);
}

function sessionsSheet_() {
  var ss = getSpreadsheet_();
  var name = PropertiesService.getScriptProperties().getProperty(PROP.SESSIONS_SHEET_NAME) || DEFAULTS.SESSIONS_SHEET_NAME;
  return ss.getSheetByName(name);
}

function logSheet_() {
  var ss = getSpreadsheet_();
  var name = PropertiesService.getScriptProperties().getProperty(PROP.LOG_SHEET_NAME) || DEFAULTS.LOG_SHEET_NAME;
  return ss.getSheetByName(name);
}

/**
 * The Drafts sheet, created on first use so a deployment that has not re-run
 * setupDatabase() yet still stores the shared draft correctly.
 */
function draftsSheet_() {
  var ss = getSpreadsheet_();
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty(PROP.DRAFTS_SHEET_NAME) || DEFAULTS.DRAFTS_SHEET_NAME;
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    ensureSheet_(ss, name, DRAFT_HEADERS);
    sheet = ss.getSheetByName(name);
    applySheetFormatting_(sheet, DRAFT_HEADERS);
    props.setProperty(PROP.DRAFTS_SHEET_NAME, name);
    appendLog_('SYSTEM', 'DRAFT_SHEET_CREATED', '', '', 'Created sheet ' + name);
  }
  return sheet;
}

function showInstallInfo() {
  var props = PropertiesService.getScriptProperties();

  var userCount = 0;
  var sessionCount = 0;
  try {
    userCount = countDataRows_(usersSheet_());
  } catch (err) {
    userCount = -1;
  }
  try {
    sessionCount = countDataRows_(sessionsSheet_());
  } catch (err) {
    sessionCount = -1;
  }

  var info = {
    spreadsheetId: props.getProperty(PROP.DB_SPREADSHEET_ID) || '(not set - run setupDatabase)',
    schemaVersion: props.getProperty(PROP.SCHEMA_VERSION) || '(not set)',
    jobsSheet: props.getProperty(PROP.DB_SHEET_NAME) || DEFAULTS.DB_SHEET_NAME,
    logSheet: props.getProperty(PROP.LOG_SHEET_NAME) || DEFAULTS.LOG_SHEET_NAME,
    usersSheet: props.getProperty(PROP.USERS_SHEET_NAME) || DEFAULTS.USERS_SHEET_NAME,
    sessionsSheet: props.getProperty(PROP.SESSIONS_SHEET_NAME) || DEFAULTS.SESSIONS_SHEET_NAME,
    userCount: userCount,
    activeSessionCount: sessionCount,
    sessionHours: DEFAULTS.SESSION_HOURS,
    signedInAccounts: userCount === 0 ? '(none - run createUser to add the first account)' : userCount,
    legacyIdTokenPathEnabled: props.getProperty(PROP.REQUIRE_ID_TOKEN) !== 'false',
    allowedClientIdSet: !!props.getProperty(PROP.ALLOWED_CLIENT_ID),
    allowedEmails: props.getProperty(PROP.ALLOWED_EMAILS) || '(not set)',
    developerBypassEnabled: !!props.getProperty(PROP.SHARED_SECRET),
    selfRegistrationMode: registrationMode_(),
    selfRegistrationEnabled: registrationEnabled_(),
    selfRegistrationRequiresCode: registrationRequiresCode_(),
    selfRegistrationDomains: props.getProperty(PROP.REGISTRATION_EMAIL_DOMAINS) || '(any domain)',
    selfRegistrationRole: registrationEnabled_() ? selfRegistrationRole_() : '(n/a)',
    webAppUrl: ScriptApp.getService().getUrl() || '(not deployed)'
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

/* ---------------------------------------------------------------------------
 * 4. WEB APP ENTRY POINTS
 * ------------------------------------------------------------------------ */

function doGet(e) {
  try {
    var payload = parseRequest_(e);
    if (!payload.action) payload.action = 'ping';
    return handleAction_(payload);
  } catch (err) {
    return errorResponse_(err);
  }
}

function doPost(e) {
  try {
    var payload = parseRequest_(e);
    return handleAction_(payload);
  } catch (err) {
    return errorResponse_(err);
  }
}

function parseRequest_(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      return { action: 'raw', contents: e.postData.contents };
    }
  }
  if (e.parameter) {
    return e.parameter;
  }
  return {};
}

function handleAction_(payload) {
  var action = payload.action;

  // Unauthenticated routes
  if (action === 'ping') {
    return successResponse_({ status: 'ok', timestamp: new Date().toISOString() });
  }
  if (action === 'login') {
    var loginResult = loginUser_(payload.email, payload.password);
    return successResponse_(loginResult);
  }
  if (action === 'register') {
    var regResult = registerUser_(payload.email, payload.name, payload.password, payload.inviteCode);
    return successResponse_(regResult);
  }

  // Authenticated routes
  var user = authenticateRequest_(payload);

  if (action === 'logout') {
    revokeSession_(payload.sessionToken || payload.token);
    return successResponse_({ loggedOut: true });
  }
  if (action === 'getCurrentUser' || action === 'checkSession') {
    return successResponse_({ user: user });
  }
  if (action === 'listJobs') {
    var jobs = listJobs_(user, payload);
    return successResponse_(jobs);
  }
  if (action === 'getJob') {
    var job = getJob_(user, payload.recordId);
    return successResponse_(job);
  }
  if (action === 'saveJob') {
    var savedJob = saveJob_(user, payload.job, payload);
    return successResponse_(savedJob);
  }
  if (action === 'deleteJob') {
    var delResult = deleteJob_(user, payload.recordId, payload);
    return successResponse_(delResult);
  }
  if (action === 'saveDraft') {
    var draftPayload = payload.draft || (payload.job ? payload : null);
    return successResponse_(saveDraft_(user, draftPayload));
  }
  if (action === 'getDraft') {
    return successResponse_({ draft: getDraft_(user) });
  }
  if (action === 'getCapabilities') return successResponse_(getCapabilities_(user));
  if (action === 'listJobItems') return successResponse_(listJobItems_(user, payload));
  if (action === 'mutateJobItem') return successResponse_(mutateJobItem_(user, payload));
  if (action === 'listJobWorkflowSummaries') return successResponse_(listJobWorkflowSummaries_(user, payload));
  if (action === 'saveWorkspaceDraft') return successResponse_(saveWorkspaceDraft_(user, payload));
  if (action === 'listWorkspaceDrafts') return successResponse_(listWorkspaceDrafts_(user, payload));
  if (action === 'reserveJobAttachment') return successResponse_(reserveJobAttachment_(user, payload));
  if (action === 'uploadJobAttachment') return successResponse_(uploadJobAttachment_(user, payload));
  if (action === 'getJobAttachment') return successResponse_(getJobAttachment_(user, payload));
  if (action === 'listUsers') {
    if (user.role !== 'admin') throw appError_('forbidden', 'Administrator rights required.');
    return successResponse_(listUsers());
  }

  throw appError_('unknown_action', 'Unrecognized action: ' + action);
}

function successResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(err) {
  var code = (err && err.code) || 'server_error';
  var message = (err && err.message) || String(err);
  var failure = { ok: false, error: message, code: code };
  if (err && err.details) failure.details = err.details;
  return ContentService.createTextOutput(JSON.stringify(failure))
    .setMimeType(ContentService.MimeType.JSON);
}

function appError_(code, message, details) {
  var err = new Error(message || code);
  err.code = code;
  if (details) err.details = details;
  return err;
}

/* ---------------------------------------------------------------------------
 * 5. AUTHENTICATION & SECURITY
 * ------------------------------------------------------------------------ */

function hashPassword_(password, salt) {
  var iterations = DEFAULTS.PASSWORD_ITERATIONS;
  var key = salt;
  var hash = password;
  for (var i = 0; i < iterations; i++) {
    var sig = Utilities.computeHmacSha256Signature(hash + key, key);
    hash = Utilities.base64Encode(sig);
  }
  return hash;
}

function generateSalt_() {
  var randomString = Utilities.getUuid() + ':' + Math.random() + ':' + new Date().getTime();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, randomString);
  return Utilities.base64Encode(digest);
}

function authenticateRequest_(payload) {
  ensureDatabaseReady_();
  var props = PropertiesService.getScriptProperties();

  // Developer bypass (if explicitly configured)
  var devSecret = props.getProperty(PROP.SHARED_SECRET);
  if (devSecret && payload.sharedSecret === devSecret) {
    return { email: 'dev-bypass@system.local', name: 'Developer Bypass', role: 'admin' };
  }

  var token = payload.sessionToken || payload.token;
  if (!token) {
    throw appError_('unauthorized', 'Authentication required. No session token provided.');
  }

  var user = validateSession_(token);
  if (!user) {
    throw appError_('session_expired', 'Session invalid or expired. Please sign in again.');
  }
  return user;
}

function createSession_(email, name, role) {
  var sheet = sessionsSheet_();
  var token = Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + DEFAULTS.SESSION_HOURS * 60 * 60 * 1000);

  sheet.appendRow([
    token,
    email,
    name,
    role,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString()
  ]);

  return {
    token: token,
    expiresAt: expires.toISOString()
  };
}

function validateSession_(token) {
  if (!token) return null;
  var sheet = sessionsSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;

  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      var expiresAt = new Date(data[i][5]);
      if (now > expiresAt) {
        return null;
      }
      // Autosave must not rewrite Sessions on every keystroke pause.
      if (!data[i][6] || now.getTime() - new Date(data[i][6]).getTime() >= 300000) {
        try { sheet.getRange(i + 1, 7).setValue(now.toISOString()); } catch (e) {}
      }
      return {
        email: String(data[i][1]),
        name: String(data[i][2]),
        role: String(data[i][3])
      };
    }
  }
  return null;
}

function revokeSession_(token) {
  if (!token) return;
  var sheet = sessionsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function revokeAllSessions() {
  var sheet = sessionsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  Logger.log('All active sessions have been revoked.');
}

function cleanupSessions() {
  var sheet = sessionsSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;

  var now = new Date();
  var removed = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var expiresAt = new Date(data[i][5]);
    if (now > expiresAt) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  Logger.log('Cleaned up ' + removed + ' expired session(s).');
  return removed;
}

/* ---------------------------------------------------------------------------
 * 6. USER MANAGEMENT & REGISTRATION
 * ------------------------------------------------------------------------ */

function registrationMode_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(PROP.REGISTRATION_MODE) || DEFAULTS.REGISTRATION_MODE;
}

function registrationEnabled_() {
  return registrationMode_() !== 'off';
}

function registrationRequiresCode_() {
  return registrationMode_() === 'invite';
}

function selfRegistrationRole_() {
  var props = PropertiesService.getScriptProperties();
  var role = props.getProperty(PROP.REGISTRATION_DEFAULT_ROLE) || DEFAULTS.REGISTRATION_DEFAULT_ROLE;
  return role === 'viewer' ? 'viewer' : 'editor';
}

function describeRegistrationMode_() {
  var mode = registrationMode_();
  if (mode === 'off') return 'Disabled. Users must be created by an administrator.';
  if (mode === 'invite') return 'Invite code required. Script Property REGISTRATION_CODE must match.';
  return 'Open. Anyone with the web app URL can create an account.';
}

function enableRegistration() {
  PropertiesService.getScriptProperties().setProperty(PROP.REGISTRATION_MODE, 'open');
  Logger.log('Registration is now OPEN.');
}

function disableRegistration() {
  PropertiesService.getScriptProperties().setProperty(PROP.REGISTRATION_MODE, 'off');
  Logger.log('Registration is now OFF.');
}

function useInviteCode(code) {
  if (!code || String(code).length < DEFAULTS.MIN_REGISTRATION_CODE_LENGTH) {
    throw new Error('Invite code must be at least ' + DEFAULTS.MIN_REGISTRATION_CODE_LENGTH + ' characters.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROP.REGISTRATION_MODE, 'invite');
  props.setProperty(PROP.REGISTRATION_CODE, String(code));
  Logger.log('Registration set to INVITE with code.');
}

function createUser(email, name, password, role) {
  ensureDatabaseReady_();
  if (!email || !password) throw appError_('bad_request', 'Email and password are required.');
  email = String(email).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError_('invalid_email', 'A valid email address is required.');
  role = role || 'editor';

  if (ROLE_VALUES.indexOf(role) === -1) {
    throw appError_('invalid_role', 'Role must be one of: ' + ROLE_VALUES.join(', '));
  }
  if (String(password).length < DEFAULTS.MIN_PASSWORD_LENGTH) {
    throw appError_('weak_password', 'Password must be at least ' + DEFAULTS.MIN_PASSWORD_LENGTH + ' characters.');
  }

  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email) {
      throw appError_('user_exists', 'A user with this email already exists.');
    }
  }

  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  var now = new Date().toISOString();

  sheet.appendRow([
    email,
    name || email,
    role,
    salt,
    hash,
    true, // Active
    0,    // FailedAttempts
    '',   // LockedUntil
    now,  // CreatedAt
    ''    // LastLoginAt
  ]);

  appendLog_('SYSTEM', 'USER_CREATED', '', '', 'Created account for ' + email + ' (' + role + ')');
  return { email: email, name: name || email, role: role };
}

function removeUser_(email) {
  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(email).toLowerCase()) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function listUsers() {
  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    users.push({
      email: data[i][0],
      name: data[i][1],
      role: data[i][2],
      active: data[i][5],
      createdAt: data[i][8],
      lastLoginAt: data[i][9]
    });
  }
  Logger.log(JSON.stringify(users, null, 2));
  return users;
}

function loginUser_(email, password) {
  ensureDatabaseReady_();
  if (!email || !password) throw appError_('bad_request', 'Email and password are required.');
  email = String(email).trim().toLowerCase();

  var sheet = usersSheet_();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var row = null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email) {
      rowIndex = i + 1;
      row = data[i];
      break;
    }
  }

  if (!row) throw appError_('invalid_credentials', 'Incorrect email or password.');

  var name = row[1];
  var role = row[2];
  var salt = row[3];
  var expectedHash = row[4];
  var active = row[5];
  var failedAttempts = Number(row[6]) || 0;
  var lockedUntilStr = row[7];

  if (!active) throw appError_('account_disabled', 'This account has been disabled.');

  var now = new Date();
  if (lockedUntilStr) {
    var lockedUntil = new Date(lockedUntilStr);
    if (now < lockedUntil) {
      var minutesLeft = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
      throw appError_('account_locked', 'Account locked due to failed attempts. Try again in ' + minutesLeft + ' minute(s).');
    }
  }

  var candidateHash = hashPassword_(password, salt);
  if (candidateHash !== expectedHash) {
    failedAttempts++;
    var updateRange = sheet.getRange(rowIndex, 7, 1, 2);
    if (failedAttempts >= DEFAULTS.MAX_FAILED_ATTEMPTS) {
      var lockExpires = new Date(now.getTime() + DEFAULTS.LOCKOUT_MINUTES * 60 * 1000);
      updateRange.setValues([[failedAttempts, lockExpires.toISOString()]]);
      appendLog_(email, 'LOGIN_LOCKED', '', '', 'Locked out after ' + failedAttempts + ' failed attempts');
      throw appError_('account_locked', 'Too many failed attempts. Account locked for ' + DEFAULTS.LOCKOUT_MINUTES + ' minutes.');
    } else {
      updateRange.setValues([[failedAttempts, '']]);
      appendLog_(email, 'LOGIN_FAILED', '', '', 'Failed login attempt (' + failedAttempts + ')');
      throw appError_('invalid_credentials', 'Incorrect email or password.');
    }
  }

  // Login successful: reset attempts and record timestamp
  sheet.getRange(rowIndex, 7, 1, 4).setValues([[0, '', row[8], now.toISOString()]]);

  var session = createSession_(email, name, role);
  appendLog_(email, 'LOGIN_SUCCESS', '', '', 'Session started');

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: { email: email, name: name, role: role }
  };
}

function registerUser_(email, name, password, inviteCode) {
  var mode = registrationMode_();
  if (mode === 'off') {
    throw appError_('registration_closed', 'Self-service registration is currently disabled.');
  }

  if (mode === 'invite') {
    var requiredCode = PropertiesService.getScriptProperties().getProperty(PROP.REGISTRATION_CODE);
    if (!requiredCode || String(inviteCode).trim() !== requiredCode.trim()) {
      throw appError_('invalid_invite_code', 'Invalid or missing registration invite code.');
    }
  }

  email = String(email || '').trim().toLowerCase();

  var allowedDomains = PropertiesService.getScriptProperties().getProperty(PROP.REGISTRATION_EMAIL_DOMAINS);
  if (allowedDomains) {
    var domains = allowedDomains.split(',').map(function (d) { return d.trim().toLowerCase(); });
    var emailDomain = String(email).split('@')[1] || '';
    if (domains.indexOf(emailDomain.toLowerCase()) === -1) {
      throw appError_('domain_not_allowed', 'Email domain is not authorized for registration.');
    }
  }

  var defaultRole = selfRegistrationRole_();
  var user = createUser(email, name, password, defaultRole);
  var session = createSession_(user.email, user.name, user.role);

  appendLog_(user.email, 'REGISTRATION_SUCCESS', '', '', 'User registered via ' + mode + ' mode');

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: user
  };
}

/* ---------------------------------------------------------------------------
 * 7. JOB DATA LAYER
 * ------------------------------------------------------------------------ */

function emptyRecordTemplate_() {
  return {
    recordId: '',
    jobNumber: '',
    jobName: '',
    customerName: '',
    email: '',
    mobilePhone: '',
    lossAddress: '',
    carrier: '',
    claimNumber: '',
    status: 'Draft',
    insurance: { roughEstimateAmount: '' },
    financials: {
      totalApprovedRcv: '',
      deductible: '',
      netClaimValue: 0,
      downPayment: 0,
      midProgressPayment: 0,
      balancePayment: 0,
      commenceDays: 10,
      completeDays: 60
    },
    mortgage: { hasMortgage: false },
    changeOrder: {
      originalContractSum: '',
      netPreviousChanges: '',
      changeAmount: '',
      addedDays: '',
      changeType: 'increase',
      isInsuranceRelated: false
    },
    checklist: {
      depreciationAmount: '',
      isSelfPay: false,
      isProgramClaim: false,
      hasCheckBeenSent: false,
      isDepreciationWithheld: false,
      hasDeductibleBeenCollected: 'No'
    },
    productionNotes: { notes: '' }
  };
}

function saveJob_(user, jobData, options) {
  return withWriteLock_(function () {
    requireWorkflowUser_(user, true);
    if (options && Number(options.protocolVersion) === 2) return saveJobV2Unlocked_(user, jobData, options);
    requireCompatibleWriter_();
    return saveJobUnlocked_(user, jobData);
  });
}

/** Serialize writes across devices and flush before releasing the lock. */
function withWriteLock_(operation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw appError_('busy', 'The database is busy. Your changes will retry automatically.');
  try {
    var result = operation();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function saveJobUnlocked_(user, jobData) {
  if (user.role === 'viewer') {
    throw appError_('forbidden', 'Viewer role does not have permission to save or update jobs.');
  }
  if (!jobData || typeof jobData !== 'object') {
    throw appError_('bad_request', 'Job record payload is missing or invalid.');
  }

  ensureWorkflowSchema_();
  var sheet = jobsSheet_();
  var recordId = jobData.recordId || jobData.RecordId || Utilities.getUuid();
  jobData.recordId = recordId;
  recoverWorkspaceTarget_('job:' + recordId);

  var nowIso = new Date().toISOString();
  var todayStr = nowIso.slice(0, 10);

  // Look up existing row
  var data = normalizeWorkspaceCoreRows_(sheet.getDataRange().getValues());
  var targetRow = -1;
  var existingCreatedAt = todayStr;
  var revision = 1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(recordId)) {
      if (coreJobDeleted_(data[i])) throw appError_('not_found', 'Deleted jobs cannot be overwritten.');
      targetRow = i + 1;
      existingCreatedAt = data[i][10] || todayStr;
      revision = (Number(data[i][16]) || 1) + 1;
      break;
    }
  }

  // Guard against exceeding the 50,000-character Google Sheets cell limit.
  // Long free-text fields (Production Notes, Loss Description, etc.) can push
  // the serialized record past it, which would fail the whole save.
  var recordJson = JSON.stringify(jobData);
  if (recordJson.length > 49000) {
    throw appError_(
      'record_too_large',
      'Job record is ' + recordJson.length + ' characters, over the 50,000-character storage limit. Shorten the Production Notes or other long text fields.'
    );
  }

  var rowValues = [
    recordId,
    (jobData.customer || {}).jobNumber || jobData.jobNumber || jobData.JobNumber || '',
    (jobData.customer || {}).jobName || jobData.jobName || jobData.JobName || '',
    (jobData.customer || {}).customerName || jobData.customerName || jobData.CustomerName || '',
    (jobData.customer || {}).email || jobData.email || jobData.Email || '',
    (jobData.customer || {}).mobilePhone || jobData.mobilePhone || jobData.MobilePhone || '',
    (jobData.customer || {}).lossAddress || jobData.lossAddress || jobData.LossAddress || '',
    (jobData.insurance || {}).carrier || jobData.carrier || jobData.Carrier || '',
    (jobData.insurance || {}).claimNumber || jobData.claimNumber || jobData.ClaimNumber || '',
    jobData.status || jobData.Status || 'Draft',
    targetRow !== -1 ? existingCreatedAt : todayStr,
    nowIso,
    user.email,
    currentSchemaVersion_(),
    recordJson,
    false, // Deleted
    revision,
    ''
  ];

  if (targetRow !== -1) {
    workspacePutCoreRow_(targetRow, rowValues);
    appendLog_(user.email, 'JOB_UPDATED', recordId, rowValues[1], 'Job updated');
  } else {
    workspacePutCoreRow_(null, rowValues);
    appendLog_(user.email, 'JOB_CREATED', recordId, rowValues[1], 'New job record added');
  }

  return attachJobMetadata_(jobData, rowValues);
}

function getJob_(user, recordId) {
  requireWorkflowUser_(user, false);
  if (!recordId) throw appError_('bad_request', 'recordId is required.');
  var sheet = jobsSheet_();
  var data = normalizeWorkspaceCoreRows_(sheet.getDataRange().getValues());

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(recordId)) {
      var isDeleted = data[i][15] === true || String(data[i][15]).toUpperCase() === 'TRUE';
      if (isDeleted) throw appError_('not_found', 'Job record has been deleted.');

      var jsonStr = data[i][14];
      try {
        return attachJobMetadata_(JSON.parse(jsonStr), data[i]);
      } catch (err) {
        throw appError_('data_corrupt', 'Stored JSON could not be parsed: ' + err);
      }
    }
  }
  throw appError_('not_found', 'Job record not found.');
}

function listJobs_(user, options) {
  requireWorkflowUser_(user, false);
  options = options || {};
  var sheet = jobsSheet_();
  var data = normalizeWorkspaceCoreRows_(sheet.getDataRange().getValues());
  var jobs = [];

  for (var i = 1; i < data.length; i++) {
    var isDeleted = data[i][15] === true || String(data[i][15]).toUpperCase() === 'TRUE';
    if (isDeleted && !options.includeDeleted) continue;

    var recordId = data[i][0];
    if (!recordId) continue;

    var item = {
      recordId: recordId,
      jobNumber: data[i][1],
      jobName: data[i][2],
      customerName: data[i][3],
      email: data[i][4],
      mobilePhone: data[i][5],
      lossAddress: data[i][6],
      carrier: data[i][7],
      claimNumber: data[i][8],
      status: data[i][9],
      createdAt: data[i][10],
      updatedAt: data[i][11],
      updatedBy: data[i][12],
      deleted: isDeleted
    };
    item.revision = Number(data[i][16]) || 1;

    if (options.fullRecords) {
      try {
        item.record = attachJobMetadata_(JSON.parse(data[i][14]), data[i]);
      } catch (e) {
        item.record = null;
      }
    }
    jobs.push(item);
  }
  return jobs;
}

function deleteJob_(user, recordId, options) {
  return withWriteLock_(function () {
    requireWorkflowUser_(user, true);
    if (options && Number(options.protocolVersion) === 2) return deleteJobV2Unlocked_(user, recordId, options);
    requireCompatibleWriter_();
    return deleteJobUnlocked_(user, recordId);
  });
}

function deleteJobUnlocked_(user, recordId) {
  if (user.role === 'viewer') {
    throw appError_('forbidden', 'Viewer role cannot delete jobs.');
  }
  if (!recordId) throw appError_('bad_request', 'recordId is required.');

  ensureWorkflowSchema_();
  recoverWorkspaceTarget_('job:' + recordId);
  var sheet = jobsSheet_();
  var data = normalizeWorkspaceCoreRows_(sheet.getDataRange().getValues());

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(recordId)) {
      var updated = data[i].slice();
      updated[11] = new Date().toISOString(); updated[12] = user.email;
      updated[15] = true; updated[16] = (Number(data[i][16]) || 1) + 1; updated[17] = '';
      workspacePutCoreRow_(i + 1, updated);
      appendLog_(user.email, 'JOB_DELETED', recordId, String(data[i][1]), 'Job soft-deleted');
      return { recordId: recordId, deleted: true };
    }
  }
  throw appError_('not_found', 'Job record not found.');
}

/* ---------------------------------------------------------------------------
 * 7B. SHARED WORKSPACE DRAFT
 * ------------------------------------------------------------------------ */

/**
 * Stores the record currently open in the workspace.
 *
 * The draft is deliberately shared by the whole team: a single row keyed on
 * 'current'. It exists so that in-progress work is never stranded on one device
 * (the previous behaviour kept it in the browser only). Whoever autosaves last
 * wins, and whoever opens the app next picks it up - including on a brand new
 * machine or under a different account.
 */
function saveDraft_(user, draft) {
  return withWriteLock_(function () { return saveDraftUnlocked_(user, draft); });
}

function saveDraftUnlocked_(user, draft) {
  if (user.role === 'viewer') {
    throw appError_('forbidden', 'Viewer role does not have permission to save the workspace draft.');
  }
  requireCompatibleWriter_();
  if (!draft || typeof draft !== 'object' || !draft.job || typeof draft.job !== 'object') {
    throw appError_('bad_request', 'Draft payload is missing or invalid.');
  }

  // Guard against the 50,000-character Google Sheets cell limit, same as saveJob_.
  var payloadJson = JSON.stringify(draft.job);
  if (payloadJson.length > 49000) {
    throw appError_(
      'record_too_large',
      'The draft is ' + payloadJson.length + ' characters, over the 50,000-character storage limit. Shorten the Production Notes or other long text fields.'
    );
  }

  var job = draft.job;
  var nowIso = new Date().toISOString();
  var recordId = String(draft.recordId || job.recordId || '');
  var customer = job.customer && typeof job.customer === 'object' ? job.customer : {};
  var rowValues = [
    DRAFT_ROW_ID,
    nowIso,
    user.email,
    recordId,
    String(job.jobNumber || customer.jobNumber || ''),
    String(job.customerName || customer.customerName || ''),
    currentSchemaVersion_(),
    payloadJson
  ];

  var sheet = draftsSheet_();
  var data = sheet.getDataRange().getValues();
  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === DRAFT_ROW_ID) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow !== -1) {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return {
    draftId: DRAFT_ROW_ID,
    updatedAt: nowIso,
    updatedBy: user.email,
    recordId: recordId,
    job: job
  };
}

/** Returns the shared workspace draft, or null when the workspace is empty. */
function getDraft_(user) {
  var sheet = draftsSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== DRAFT_ROW_ID) continue;

    var payloadJson = data[i][7];
    if (!payloadJson) return null;

    var job = null;
    try {
      job = JSON.parse(payloadJson);
    } catch (err) {
      throw appError_('data_corrupt', 'The stored draft could not be parsed: ' + err);
    }
    if (!job) return null;

    return {
      draftId: DRAFT_ROW_ID,
      updatedAt: data[i][1] ? String(data[i][1]) : '',
      updatedBy: data[i][2] ? String(data[i][2]) : '',
      recordId: data[i][3] ? String(data[i][3]) : '',
      job: job
    };
  }

  return null;
}

/* ---------------------------------------------------------------------------
 * 7C. REVISIONED JOB WORKSPACE
 * All durable mutation intents contain metadata only; file bytes never enter
 * Sheets. An intent is flushed before a row is changed, and is recovered before
 * another writer can change the same target.
 * ------------------------------------------------------------------------ */

function ensureWorkflowSchema_(spreadsheet) {
  if (!spreadsheet && WORKFLOW_SCHEMA_READY_) return;
  var ss = spreadsheet || getSpreadsheet_();
  var props = PropertiesService.getScriptProperties();
  ensureSheet_(ss, props.getProperty(PROP.DB_SHEET_NAME) || DEFAULTS.DB_SHEET_NAME, JOB_HEADERS);
  ensureSheet_(ss, 'JobItems', JOB_ITEM_HEADERS);
  ensureSheet_(ss, 'JobMutations', JOB_MUTATION_HEADERS);
  ensureSheet_(ss, 'WorkspaceDrafts', WORKSPACE_DRAFT_HEADERS);
  if (Number(props.getProperty(PROP.SCHEMA_VERSION)) < 2) props.setProperty(PROP.SCHEMA_VERSION, '2');
  WORKFLOW_SCHEMA_READY_ = true;
}

function requireWorkflowUser_(user, write) {
  if (!user || !user.email || ROLE_VALUES.indexOf(user.role) === -1) throw appError_('unauthorized', 'A valid application account is required.');
  if (write && user.role !== 'admin' && user.role !== 'editor') throw appError_('forbidden', 'Editor rights are required.');
}

function requireCompatibleWriter_() {
  if (PropertiesService.getScriptProperties().getProperty(PROP.WORKFLOW_ENFORCE_REVISIONS) === 'true') {
    throw appError_('client_upgrade_required', 'Update the application before saving. Your work remains on this device.');
  }
}

function getCapabilities_(user) {
  requireWorkflowUser_(user, false);
  ensureWorkflowSchema_();
  var protectedWrites = PropertiesService.getScriptProperties().getProperty(PROP.WORKFLOW_ENFORCE_REVISIONS) === 'true';
  var storage = !!PropertiesService.getScriptProperties().getProperty(PROP.WORKFLOW_DRIVE_ROOT_ID);
  return {
    apiVersion: 2, schemaVersion: 2,
    features: ['revisioned_jobs', 'job_items', 'mutation_journal', 'scoped_drafts', 'workflow_summaries', 'private_attachments', 'immutable_artifacts', 'change_numbering'],
    revisionProtection: protectedWrites, revisionEnforcement: protectedWrites, attachmentConfigured: storage,
    attachments: { configured: storage, maxBytes: 5242880, maxFileBytes: 5242880, maxBatchFiles: 10, maxExportBytes: 26214400, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }
  };
}

function workflowTable_(name) { ensureWorkflowSchema_(); return getSpreadsheet_().getSheetByName(name); }
function cloneWorkspace_(value) { return JSON.parse(JSON.stringify(value)); }
function workspaceText_(value, max) { return typeof value === 'string' && value.length <= (max || 8000); }
function workspaceId_(value) { return workspaceText_(value, 200) && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value); }
function workspaceAssert_(condition, message, code) { if (!condition) throw appError_(code || 'bad_request', message); }
function stableWorkspaceJson_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableWorkspaceJson_).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(function (key) { return value[key] !== undefined; }).map(function (key) { return JSON.stringify(key) + ':' + stableWorkspaceJson_(value[key]); }).join(',') + '}';
}
function workspaceDigest_(value) {
  var bytes = typeof value === 'string' ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8) : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return bytes.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
function workspaceMutationId_(value) { workspaceAssert_(workspaceId_(value), 'A stable mutationId is required.'); return value; }
function workspaceRevision_(value) { workspaceAssert_(Number.isSafeInteger(value) && value >= 0, 'expectedRevision must be a non-negative integer.'); return value; }
function workspaceRow_(sheet, predicate) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (predicate(rows[i])) return { row: i + 1, values: rows[i] };
  return null;
}
function workspacePutRow_(sheet, row, values) {
  if (row) sheet.getRange(row, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}
function normalizeWorkspaceCoreRows_(rows) {
  if (!rows.length) return rows;
  var revisionColumn = rows[0].indexOf('Revision'); var mutationColumn = rows[0].indexOf('LastMutationId');
  return rows.map(function (row, index) { return index === 0 ? row : row.slice(0, 16).concat([revisionColumn === -1 ? '' : row[revisionColumn], mutationColumn === -1 ? '' : row[mutationColumn]]); });
}
function workspacePutCoreRow_(rowNumber, values) {
  var sheet = jobsSheet_(); var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var physical = rowNumber ? sheet.getRange(rowNumber, 1, 1, width).getValues()[0] : new Array(width).fill('');
  for (var i = 0; i < 16; i++) physical[i] = values[i];
  physical[headers.indexOf('Revision')] = values[16]; physical[headers.indexOf('LastMutationId')] = values[17];
  workspacePutRow_(sheet, rowNumber, physical);
}
function coreJobRow_(id) {
  var rows = normalizeWorkspaceCoreRows_(jobsSheet_().getDataRange().getValues());
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(id)) return { row: i + 1, values: rows[i] };
  return null;
}
function coreJobDeleted_(row) { return row[15] === true || String(row[15]).toUpperCase() === 'TRUE'; }
function attachJobMetadata_(job, row) {
  var record = cloneWorkspace_(job);
  record.revision = Number(row[16]) || 1;
  record.updatedAt = String(row[11] || '');
  record.updatedBy = String(row[12] || '');
  record.schemaVersion = 2;
  return record;
}
function requireWorkspaceJob_(user, jobId, write) {
  requireWorkflowUser_(user, write);
  workspaceAssert_(workspaceId_(jobId), 'A valid jobId is required.');
  var row = coreJobRow_(jobId);
  if (!row || coreJobDeleted_(row.values)) throw appError_('not_found', 'Job not found or deleted.');
  return row;
}
function readWorkspaceItemRow_(jobId, kind, id) {
  return workspaceRow_(workflowTable_('JobItems'), function (row) { return String(row[0]) === jobId && String(row[1]) === kind && String(row[2]) === id; });
}
function workspaceItemFromRow_(row) {
  return { jobId: String(row[0]), kind: String(row[1]), itemId: String(row[2]), revision: Number(row[3]), createdAt: String(row[4]), createdBy: String(row[5]), updatedAt: String(row[6]), updatedBy: String(row[7]), deletedAt: row[8] ? String(row[8]) : null, lastMutationId: String(row[9]), payload: JSON.parse(row[10]) };
}
function workspaceItem_(jobId, kind, id, optional) {
  var found = readWorkspaceItemRow_(jobId, kind, id);
  var item = found && workspaceItemFromRow_(found.values);
  if ((!item || item.deletedAt) && !optional) throw appError_('not_found', 'Supporting record not found in this job.');
  return item;
}
function workspaceItemValues_(item) { return [item.jobId, item.kind, item.itemId, item.revision, item.createdAt, item.createdBy, item.updatedAt, item.updatedBy, item.deletedAt || '', item.lastMutationId, JSON.stringify(item.payload)]; }
function workspaceConflict_(current) { throw appError_('conflict', 'This record changed on another device. Review both copies before saving.', { current: current }); }

function journalBinding_(user, jobId, target, action, request) {
  return { actor: String(user.email).toLowerCase(), jobId: jobId, target: target, action: action, hash: workspaceDigest_(stableWorkspaceJson_(request)) };
}
function journalReplay_(mutationId, binding) {
  var sheet = workflowTable_('JobMutations');
  var found = workspaceRow_(sheet, function (row) { return String(row[0]) === mutationId; });
  if (!found) return null;
  var row = found.values;
  if (String(row[1]) !== binding.actor || String(row[2]) !== binding.jobId || String(row[3]) !== binding.target || String(row[4]) !== binding.action || String(row[5]) !== binding.hash) {
    throw appError_('idempotency_conflict', 'This mutationId is already bound to a different request.');
  }
  if (row[7] !== 'applied') return { result: recoverWorkspaceJournal_(found) };
  repairWorkspaceEvent_(JSON.parse(row[8]));
  return { result: JSON.parse(row[9]) };
}
function recoverWorkspaceTarget_(target) {
  var rows = workflowTable_('JobMutations').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3]) === target && rows[i][7] !== 'applied') recoverWorkspaceJournal_({ row: i + 1, values: rows[i] });
  }
}
function recoverWorkspaceJobChanges_(jobId) {
  var rows = workflowTable_('JobMutations').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === jobId && String(rows[i][3]).indexOf('item:' + jobId + ':change:') === 0 && rows[i][7] !== 'applied') recoverWorkspaceJournal_({ row: i + 1, values: rows[i] });
  }
}
function commitWorkspaceIntent_(mutationId, binding, expectedRevision, intent) {
  intent.mutationId = mutationId;
  var serialized = JSON.stringify(intent);
  workspaceAssert_(serialized.length <= 49000, 'The durable mutation is too large. Shorten this record.', 'record_too_large');
  var now = new Date().toISOString();
  var values = [mutationId, binding.actor, binding.jobId, binding.target, binding.action, binding.hash, expectedRevision, 'pending', serialized, '', now, now];
  var sheet = workflowTable_('JobMutations');
  sheet.appendRow(values);
  SpreadsheetApp.flush();
  return recoverWorkspaceJournal_({ row: sheet.getLastRow(), values: values });
}
function recoverWorkspaceJournal_(entry) {
  var intent = JSON.parse(entry.values[8]);
  var current;
  if (intent.type === 'item' || intent.type === 'upload') {
    if (intent.type === 'upload') {
      requireWorkspaceJob_({ email: intent.item.updatedBy, role: 'editor' }, intent.item.jobId, true);
      if (!workspaceExistingDriveFile_(intent.item.payload, true)) throw appError_('busy', 'A file transfer is still pending. Retry the original upload.');
    }
    current = readWorkspaceItemRow_(intent.item.jobId, intent.item.kind, intent.item.itemId);
    if (!current || String(current.values[9]) !== intent.mutationId) {
      requireWorkspaceJob_({ email: intent.item.updatedBy, role: 'editor' }, intent.item.jobId, true);
      var liveRevision = current ? Number(current.values[3]) : 0;
      if (liveRevision !== Number(entry.values[6])) workspaceConflict_(current && workspaceItemFromRow_(current.values));
      workspacePutRow_(workflowTable_('JobItems'), current && current.row, workspaceItemValues_(intent.item));
    }
  } else if (intent.type === 'job') {
    current = coreJobRow_(intent.record.recordId);
    if (!current || String(current.values[17]) !== intent.mutationId) {
      var coreRevision = current ? Number(current.values[16]) || 1 : 0;
      if (coreRevision !== Number(entry.values[6])) workspaceConflict_(current && attachJobMetadata_(JSON.parse(current.values[14]), current.values));
      workspacePutCoreRow_(current && current.row, workspaceCoreValues_(intent.record, intent.createdAt, intent.updatedAt, intent.actor, intent.deleted, intent.revision, intent.mutationId));
    }
  } else if (intent.type === 'draft') {
    var draftSheet = workflowTable_('WorkspaceDrafts');
    current = workspaceRow_(draftSheet, function (row) { return row[0] === intent.draft.draftId; });
    if (!current || String(current.values[7]) !== intent.mutationId) {
      if ((current ? Number(current.values[4]) : 0) !== Number(entry.values[6])) workspaceConflict_(current && workspaceDraftFromRow_(current.values));
      workspacePutRow_(draftSheet, current && current.row, [intent.draft.draftId, intent.actor, intent.deviceId, intent.jobId, intent.draft.revision, intent.draft.updatedAt, intent.actor, intent.mutationId, JSON.stringify(intent.draft.job)]);
    }
  }
  SpreadsheetApp.flush();
  repairWorkspaceEvent_(intent);
  var result = intent.type === 'item' || intent.type === 'upload' ? { item: intent.item, mutationId: intent.mutationId } : intent.type === 'draft' ? intent.draft : intent.deleted ? { recordId: intent.record.recordId, deleted: true, revision: intent.revision, updatedAt: intent.updatedAt, mutationId: intent.mutationId } : intent.record;
  var values = entry.values.slice(); values[7] = 'applied'; values[9] = JSON.stringify(result); values[11] = new Date().toISOString();
  workflowTable_('JobMutations').getRange(entry.row, 1, 1, values.length).setValues([values]);
  return result;
}
function repairWorkspaceEvent_(intent) {
  if (intent.type !== 'item' || ['workflow', 'selection', 'change', 'closeout', 'artifact'].indexOf(intent.item.kind) === -1) return;
  var business = intent.item;
  var id = 'event:' + intent.mutationId;
  if (readWorkspaceItemRow_(business.jobId, 'activity', id)) return;
  var labels = { workflow: 'Job stage or next action updated.', selection: 'Selection or recorded decision updated.', change: 'Change request updated.', closeout: 'Closeout review updated.', artifact: 'Document version recorded.' };
  var event = { jobId: business.jobId, kind: 'activity', itemId: id, revision: 1, createdAt: business.updatedAt, createdBy: business.updatedBy, updatedAt: business.updatedAt, updatedBy: business.updatedBy, deletedAt: null, lastMutationId: intent.mutationId,
    payload: { note: labels[business.kind], occurredAt: business.updatedAt, source: 'system', eventCode: business.kind + '.' + intent.operation, sourceMutationId: intent.mutationId, attachmentIds: [] } };
  workflowTable_('JobItems').appendRow(workspaceItemValues_(event));
}
function workspaceCoreValues_(job, createdAt, updatedAt, actor, deleted, revision, mutationId) {
  var customer = job.customer || {}; var insurance = job.insurance || {};
  return [job.recordId, customer.jobNumber || job.jobNumber || '', customer.jobName || job.jobName || '', customer.customerName || job.customerName || '', customer.email || job.email || '', customer.mobilePhone || job.mobilePhone || '', customer.lossAddress || job.lossAddress || '', insurance.carrier || job.carrier || '', insurance.claimNumber || job.claimNumber || '', job.status || 'Draft', createdAt, updatedAt, actor, 2, JSON.stringify(job), !!deleted, revision, mutationId];
}
function saveJobV2Unlocked_(user, jobData, options) {
  workspaceAssert_(jobData && typeof jobData === 'object' && !Array.isArray(jobData), 'Job payload is required.');
  var jobId = jobData.recordId || jobData.id;
  workspaceAssert_(workspaceId_(jobId), 'A stable job recordId is required.');
  workspaceMutationId_(options.mutationId); workspaceRevision_(options.expectedRevision); ensureWorkflowSchema_();
  var target = 'job:' + jobId;
  var binding = journalBinding_(user, jobId, target, 'saveJob', { job: jobData, expectedRevision: options.expectedRevision });
  var replay = journalReplay_(options.mutationId, binding); if (replay) return replay.result;
  recoverWorkspaceTarget_(target);
  var current = coreJobRow_(jobId);
  if (current && coreJobDeleted_(current.values)) throw appError_('not_found', 'Deleted jobs cannot be overwritten.');
  var revision = current ? Number(current.values[16]) || 1 : 0;
  if (revision !== options.expectedRevision) workspaceConflict_(current && attachJobMetadata_(JSON.parse(current.values[14]), current.values));
  var record = cloneWorkspace_(jobData);
  workspaceAssert_(!record.jobItems && !record.items && !record.attachments && !record.artifacts, 'Supporting records must be saved separately.');
  var now = new Date().toISOString();
  record.recordId = jobId; record.schemaVersion = 2; record.revision = revision + 1; record.updatedAt = now; record.updatedBy = user.email;
  workspaceAssert_(JSON.stringify(record).length <= 49000, 'The job is too large to save.', 'record_too_large');
  return commitWorkspaceIntent_(options.mutationId, binding, revision, { type: 'job', record: record, actor: user.email, createdAt: current ? current.values[10] : now.slice(0, 10), updatedAt: now, revision: revision + 1, deleted: false });
}
function deleteJobV2Unlocked_(user, jobId, options) {
  workspaceAssert_(workspaceId_(jobId), 'recordId is required.'); workspaceMutationId_(options.mutationId); workspaceRevision_(options.expectedRevision); ensureWorkflowSchema_();
  var target = 'job:' + jobId;
  var binding = journalBinding_(user, jobId, target, 'deleteJob', { recordId: jobId, expectedRevision: options.expectedRevision });
  var replay = journalReplay_(options.mutationId, binding); if (replay) return replay.result;
  recoverWorkspaceTarget_(target);
  var current = requireWorkspaceJob_(user, jobId, true);
  var revision = Number(current.values[16]) || 1;
  if (revision !== options.expectedRevision) workspaceConflict_(attachJobMetadata_(JSON.parse(current.values[14]), current.values));
  var record = attachJobMetadata_(JSON.parse(current.values[14]), current.values);
  var now = new Date().toISOString(); record.revision = revision + 1; record.updatedAt = now; record.updatedBy = user.email;
  return commitWorkspaceIntent_(options.mutationId, binding, revision, { type: 'job', record: record, actor: user.email, createdAt: current.values[10], updatedAt: now, revision: revision + 1, deleted: true });
}

function workspaceObject_(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function workspaceDate_(value) { return value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value); }
function workspaceIds_(value) { return Array.isArray(value) && value.length <= 100 && value.every(workspaceId_); }
function workspacePerson_(value) { return workspaceObject_(value) && workspaceText_(value.name, 200) && (value.email === undefined || value.email === '' || (workspaceText_(value.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))); }
function workspaceDecision_(value, allowed) {
  return workspaceObject_(value) && allowed.indexOf(value.status) !== -1 && workspaceText_(value.name, 200) && workspaceDate_(value.date) && workspaceText_(value.note) && workspaceIds_(value.evidenceIds) && (['approved', 'rejected', 'changes_requested'].indexOf(value.status) === -1 || (!!value.name.trim() && !!value.date));
}
function validateWorkspacePayload_(kind, payload) {
  workspaceAssert_(WORKFLOW_KINDS.indexOf(kind) !== -1 && workspaceObject_(payload), 'Unknown supporting record kind or invalid payload.');
  workspaceAssert_(JSON.stringify(payload).length < 40000, 'Supporting records must be below 40,000 characters.', 'record_too_large');
  var p = payload;
  var valid = false;
  var allowed = {
    workflow: ['stage', 'nextAction', 'holdReason', 'contractBaseAmountCents', 'openingPreviousChangesCents', 'baselineReviewed', 'latestHandoffArtifactId', 'confirmations', 'handoffOverrideReason'],
    activity: ['note', 'occurredAt', 'source', 'attachmentIds', 'eventCode', 'sourceMutationId'],
    selection: ['room', 'item', 'specification', 'allowanceCents', 'neededBy', 'responsiblePerson', 'decision', 'attachmentIds'],
    change: ['number', 'scope', 'insuranceRelated', 'amountCents', 'addedDays', 'lifecycle', 'customerDecision', 'carrierDecision', 'attachmentIds', 'linkedSelectionIds', 'documentArtifactId', 'legacy', 'predecessorId'],
    closeout: ['completionDate', 'checklist', 'punchItems', 'attachmentIds', 'latestArtifactId', 'completionOverrideReason'],
    attachment: ['filename', 'mimeType', 'byteSize', 'sha256', 'driveFileId', 'parent', 'uploadState', 'caption', 'category', 'driveFolderId'],
    artifact: ['type', 'sourceRevisions', 'generatedAt', 'generatedBy', 'snapshotAttachmentId', 'outputAttachmentIds', 'reviewState', 'audience']
  };
  workspaceAssert_(Object.keys(p).every(function (key) { return allowed[kind].indexOf(key) !== -1; }), 'Unknown payload fields are not accepted.');
  if (kind === 'workflow') {
    var a = p.nextAction; var c = p.confirmations;
    valid = WORKFLOW_STAGES.indexOf(p.stage) !== -1 && workspaceText_(p.holdReason) && (p.contractBaseAmountCents === null || Number.isSafeInteger(p.contractBaseAmountCents)) && Number.isSafeInteger(p.openingPreviousChangesCents) && typeof p.baselineReviewed === 'boolean' && workspaceText_(p.handoffOverrideReason) && (p.latestHandoffArtifactId === null || workspaceId_(p.latestHandoffArtifactId));
    valid = valid && (p.stage !== 'on_hold' || !!p.holdReason.trim()) && (a === null || (workspaceObject_(a) && workspaceId_(a.id) && workspaceText_(a.title, 500) && !!a.title.trim() && workspacePerson_(a.responsiblePerson) && !!a.responsiblePerson.name.trim() && (a.dueDate === undefined || workspaceDate_(a.dueDate)) && (a.completedAt === undefined || (workspaceText_(a.completedAt, 40) && !isNaN(Date.parse(a.completedAt))))));
    valid = valid && workspaceObject_(c) && typeof c.contractSigned === 'boolean' && typeof c.scopeReviewed === 'boolean' && ['pending', 'recorded', 'not_applicable'].indexOf(c.initialPayment) !== -1 && ['pending', 'reviewed', 'not_applicable'].indexOf(c.mortgageReviewed) !== -1;
  } else if (kind === 'activity') {
    valid = workspaceText_(p.note) && !!p.note.trim() && ['manual', 'system'].indexOf(p.source) !== -1 && workspaceText_(p.occurredAt, 40) && !isNaN(Date.parse(p.occurredAt)) && workspaceIds_(p.attachmentIds);
  } else if (kind === 'selection') {
    valid = workspaceText_(p.room, 300) && workspaceText_(p.item, 300) && !!p.item.trim() && workspaceText_(p.specification) && (p.allowanceCents === null || Number.isSafeInteger(p.allowanceCents)) && workspaceDate_(p.neededBy) && workspacePerson_(p.responsiblePerson) && workspaceDecision_(p.decision, ['pending', 'approved', 'changes_requested']) && workspaceIds_(p.attachmentIds);
  } else if (kind === 'change') {
    valid = workspaceText_(p.number, 100) && workspaceText_(p.scope) && !!p.scope.trim() && typeof p.insuranceRelated === 'boolean' && Number.isSafeInteger(p.amountCents) && Number.isSafeInteger(p.addedDays) && p.addedDays >= 0 && ['draft', 'submitted', 'closed', 'void'].indexOf(p.lifecycle) !== -1 && workspaceDecision_(p.customerDecision, ['pending', 'approved', 'rejected']) && workspaceDecision_(p.carrierDecision, ['pending', 'approved', 'rejected', 'not_applicable']) && workspaceIds_(p.attachmentIds) && workspaceIds_(p.linkedSelectionIds) && (p.documentArtifactId === null || workspaceId_(p.documentArtifactId)) && (p.predecessorId === undefined || workspaceId_(p.predecessorId));
    valid = valid && (!p.insuranceRelated || p.carrierDecision.status !== 'not_applicable');
  } else if (kind === 'closeout') {
    valid = workspaceDate_(p.completionDate) && Array.isArray(p.checklist) && p.checklist.length <= 100 && Array.isArray(p.punchItems) && p.punchItems.length <= 100 && workspaceIds_(p.attachmentIds) && workspaceText_(p.completionOverrideReason) && (p.latestArtifactId === null || workspaceId_(p.latestArtifactId));
    valid = valid && p.checklist.every(function (row) { return workspaceObject_(row) && workspaceId_(row.id) && workspaceText_(row.label, 500) && ['pending', 'done', 'not_applicable'].indexOf(row.state) !== -1 && workspaceText_(row.note) && workspaceIds_(row.evidenceIds) && (row.state !== 'not_applicable' || !!row.note.trim()); });
    valid = valid && p.punchItems.every(function (row) { return workspaceObject_(row) && workspaceId_(row.id) && workspaceText_(row.title, 500) && !!row.title.trim() && ['open', 'done'].indexOf(row.state) !== -1 && (row.dueDate === undefined || workspaceDate_(row.dueDate)) && (row.responsiblePerson === undefined || workspacePerson_(row.responsiblePerson)); });
  } else if (kind === 'attachment') {
    valid = workspaceText_(p.filename, 255) && !!p.filename.trim() && workspaceText_(p.mimeType, 100) && Number.isSafeInteger(p.byteSize) && p.byteSize > 0 && p.byteSize <= 5242880 && /^[a-f0-9]{64}$/.test(p.sha256) && workspaceId_(p.driveFileId) && workspaceObject_(p.parent) && WORKFLOW_KINDS.indexOf(p.parent.kind) !== -1 && workspaceId_(p.parent.itemId) && ['reserved', 'ready', 'failed'].indexOf(p.uploadState) !== -1 && (p.caption === undefined || workspaceText_(p.caption, 500)) && (p.category === undefined || workspaceText_(p.category, 100));
  } else if (kind === 'artifact') {
    valid = ['handoff', 'change_order', 'closeout'].indexOf(p.type) !== -1 && workspaceObject_(p.sourceRevisions) && Object.keys(p.sourceRevisions).length <= 200 && Object.keys(p.sourceRevisions).every(function (key) { return workspaceText_(key, 400) && Number.isSafeInteger(p.sourceRevisions[key]) && p.sourceRevisions[key] >= 0; }) && workspaceText_(p.generatedAt, 40) && !isNaN(Date.parse(p.generatedAt)) && workspaceText_(p.generatedBy, 254) && workspaceId_(p.snapshotAttachmentId) && workspaceIds_(p.outputAttachmentIds) && ['draft', 'final'].indexOf(p.reviewState) !== -1 && (p.audience === undefined || ['internal', 'customer', 'carrier'].indexOf(p.audience) !== -1);
  }
  workspaceAssert_(valid, 'Invalid ' + kind + ' payload. Complete required fields and recorded decisions.');
}

function verifyWorkspaceRelations_(jobId, kind, itemId, p) {
  var refs = (p.attachmentIds || []).slice();
  var decisions = [p.decision, p.customerDecision, p.carrierDecision];
  decisions.forEach(function (decision) { if (decision) refs = refs.concat(decision.evidenceIds || []); });
  (p.checklist || []).forEach(function (row) { refs = refs.concat(row.evidenceIds || []); });
  refs.forEach(function (id) { workspaceItem_(jobId, 'attachment', id); });
  (p.linkedSelectionIds || []).forEach(function (id) { workspaceItem_(jobId, 'selection', id); });
  if (p.predecessorId) workspaceItem_(jobId, 'change', p.predecessorId);
  ['latestHandoffArtifactId', 'documentArtifactId', 'latestArtifactId'].forEach(function (key) {
    if (p[key]) {
      var artifact = workspaceItem_(jobId, 'artifact', p[key]);
      workspaceAssert_(artifact.payload.reviewState === 'final', 'Linked documents must be published.', 'dependency_pending');
      var expectedType = key === 'latestHandoffArtifactId' ? 'handoff' : key === 'documentArtifactId' ? 'change_order' : 'closeout';
      workspaceAssert_(artifact.payload.type === expectedType, 'The linked document has the wrong artifact type.');
    }
  });
  if (kind === 'artifact' && p.reviewState === 'final') {
    workspaceAssert_(Object.prototype.hasOwnProperty.call(p.sourceRevisions, 'job:' + jobId) || Object.prototype.hasOwnProperty.call(p.sourceRevisions, 'job'), 'A published document must record its core job revision.');
    if (p.type === 'change_order') {
      var baseline = workspaceItem_(jobId, 'workflow', 'workflow:' + jobId, true);
      workspaceAssert_(baseline && baseline.payload.baselineReviewed && baseline.payload.contractBaseAmountCents !== null, 'Review the contract baseline before publishing a change document.', 'dependency_pending');
      workspaceAssert_(Object.keys(p.sourceRevisions).some(function (key) {
        if (key.indexOf('change:') !== 0) return false;
        var change = workspaceItem_(jobId, 'change', key.slice(7), true);
        return change && !change.deletedAt && !!change.payload.number;
      }), 'A final change document requires its numbered change source.', 'dependency_pending');
    }
    [p.snapshotAttachmentId].concat(p.outputAttachmentIds).forEach(function (id) {
      var file = workspaceItem_(jobId, 'attachment', id);
      workspaceAssert_(file.payload.uploadState === 'ready' && file.payload.parent.kind === 'artifact' && file.payload.parent.itemId === itemId, 'All published document files must be ready and belong to this artifact.', 'dependency_pending');
    });
    workspaceAssert_(workspaceItem_(jobId, 'attachment', p.snapshotAttachmentId).payload.mimeType === 'application/json', 'The frozen source must be a private JSON snapshot.');
    workspaceAssert_(p.outputAttachmentIds.length > 0, 'A published document needs an output file.');
    Object.keys(p.sourceRevisions).forEach(function (key) {
      var revision;
      if (key === 'job:' + jobId || key === 'job') { var job = coreJobRow_(jobId); revision = job ? Number(job.values[16]) || 1 : -1; }
      else { var colon = key.indexOf(':'); var source = colon > 0 ? workspaceItem_(jobId, key.slice(0, colon), key.slice(colon + 1), true) : null; revision = source && !source.deletedAt ? source.revision : -1; }
      workspaceAssert_(revision === p.sourceRevisions[key], 'A document source changed. Refresh and regenerate before publishing.', 'conflict');
    });
  }
}

function mutateJobItem_(user, request) {
  return withWriteLock_(function () {
    requireWorkflowUser_(user, true); ensureWorkflowSchema_();
    var jobId = request.jobId; var kind = request.kind; var id = request.itemId; var operation = request.operation;
    workspaceAssert_(workspaceId_(jobId) && WORKFLOW_KINDS.indexOf(kind) !== -1 && workspaceId_(id), 'Valid jobId, kind and itemId are required.');
    workspaceAssert_(['create', 'update', 'delete'].indexOf(operation) !== -1, 'Use create, update or delete. Arbitrary patches are not supported.');
    workspaceMutationId_(request.mutationId); workspaceRevision_(request.expectedRevision);
    var target = 'item:' + jobId + ':' + kind + ':' + id;
    var binding = journalBinding_(user, jobId, target, 'mutateJobItem', { operation: operation, expectedRevision: request.expectedRevision, payload: request.payload });
    var replay = journalReplay_(request.mutationId, binding); if (replay) return replay.result;
    requireWorkspaceJob_(user, jobId, true); recoverWorkspaceTarget_(target);
    var found = readWorkspaceItemRow_(jobId, kind, id); var current = found ? workspaceItemFromRow_(found.values) : null;
    var revision = current ? current.revision : 0;
    if (revision !== request.expectedRevision) workspaceConflict_(current);
    workspaceAssert_((operation === 'create' && !current) || (operation !== 'create' && !!current && !current.deletedAt), 'This supporting record does not exist or already exists.', current ? 'conflict' : 'not_found');
    if (kind === 'workflow' || kind === 'closeout') workspaceAssert_(id === kind + ':' + jobId, 'Singleton records use ' + kind + ':<jobId>.');
    if (kind === 'activity' && current) workspaceAssert_(current.payload.source === 'manual' && (current.createdBy === user.email || user.role === 'admin'), 'Only the author or an administrator may correct a manual update.', 'forbidden');
    if (kind === 'artifact' && current && current.payload.reviewState === 'final') throw appError_('immutable_artifact', 'Published document versions cannot be edited or removed.');
    if (operation !== 'delete') workspaceAssert_(workspaceObject_(request.payload), 'A complete supporting payload is required.');
    var payload = operation === 'delete' ? cloneWorkspace_(current.payload) : cloneWorkspace_(request.payload);
    if (operation !== 'delete') {
      validateWorkspacePayload_(kind, payload);
      if (kind === 'activity') workspaceAssert_(payload.source === 'manual' && !payload.eventCode && !payload.sourceMutationId, 'System history is generated by the server.', 'forbidden');
      if (kind === 'selection' && current && current.payload.decision.status === 'approved' && (current.payload.specification !== payload.specification || current.payload.allowanceCents !== payload.allowanceCents)) {
        payload.decision = { status: 'pending', name: '', date: '', note: '', evidenceIds: [] };
      }
      if (kind === 'attachment') {
        workspaceAssert_(!!current, 'Reserve attachments through the attachment endpoint.', 'forbidden');
        ['filename', 'mimeType', 'byteSize', 'sha256', 'driveFileId', 'parent', 'uploadState', 'driveFolderId'].forEach(function (key) { workspaceAssert_(stableWorkspaceJson_(current.payload[key]) === stableWorkspaceJson_(payload[key]), 'Attachment storage metadata is server controlled.', 'forbidden'); });
      }
      if (kind === 'artifact') { payload.generatedBy = current ? current.payload.generatedBy : user.email; payload.generatedAt = current ? current.payload.generatedAt : new Date().toISOString(); }
      if (kind === 'workflow' && current && (current.payload.contractBaseAmountCents !== payload.contractBaseAmountCents || current.payload.openingPreviousChangesCents !== payload.openingPreviousChangesCents || (current.payload.baselineReviewed && !payload.baselineReviewed))) {
        recoverWorkspaceJobChanges_(jobId);
        workspaceAssert_(!workspaceItemsForJob_(jobId).some(function (entry) { return entry.kind === 'change' && !entry.payload.legacy && entry.payload.number; }), 'The reviewed contract baseline is frozen after a change is issued.', 'immutable_baseline');
      }
      if (kind === 'change') {
        if (current && current.payload.number) workspaceAssert_(payload.number === current.payload.number, 'An assigned change number cannot be changed.');
        else if (!payload.legacy) workspaceAssert_(!payload.number, 'New display numbers are assigned by the server.');
        if (current && current.payload.number) {
          ['number', 'scope', 'amountCents', 'addedDays', 'insuranceRelated', 'legacy', 'predecessorId', 'linkedSelectionIds'].forEach(function (key) { workspaceAssert_(stableWorkspaceJson_(current.payload[key]) === stableWorkspaceJson_(payload[key]), 'Issued changes require an amendment for content edits.', 'immutable_artifact'); });
          if (!current.payload.legacy) workspaceAssert_(payload.lifecycle !== 'draft', 'Issued changes cannot return to draft. Create an amendment.', 'immutable_artifact');
          if (current.payload.documentArtifactId) workspaceAssert_(payload.documentArtifactId === current.payload.documentArtifactId, 'The issued document cannot be replaced.', 'immutable_artifact');
        }
        if ((!current || !current.payload.legacy) && id !== 'legacy:' + jobId) workspaceAssert_(!payload.legacy, 'Legacy snapshots can only be imported using a legacy:<jobId> ID.', 'forbidden');
        if (id === 'legacy:' + jobId && !current) {
          var legacyJob = JSON.parse(coreJobRow_(jobId).values[14]);
          workspaceAssert_(payload.legacy && stableWorkspaceJson_(payload.legacy) === stableWorkspaceJson_(legacyJob.changeOrder), 'Legacy snapshots must preserve the original change fields.');
          workspaceAssert_(payload.customerDecision.status === 'pending' && ['pending', 'not_applicable'].indexOf(payload.carrierDecision.status) !== -1, 'Imported legacy decisions must remain pending.');
        }
        if (payload.lifecycle !== 'draft' && !payload.number && !payload.legacy) {
          var baseline = workspaceItem_(jobId, 'workflow', 'workflow:' + jobId, true);
          workspaceAssert_(baseline && baseline.payload.baselineReviewed && baseline.payload.contractBaseAmountCents !== null, 'Review the contract base and brought-forward changes before issuing a change.', 'dependency_pending');
          recoverWorkspaceJobChanges_(jobId);
          var changes = workspaceItemsForJob_(jobId).filter(function (item) { return item.kind === 'change'; });
          var maximum = changes.reduce(function (max, item) { var n = /^CO-(\d+)$/.exec(item.payload.number || ''); return n ? Math.max(max, Number(n[1])) : max; }, 0);
          payload.number = 'CO-' + String(maximum + 1).padStart(3, '0');
        } else if (!current && !payload.legacy) workspaceAssert_(!payload.number, 'New display numbers are assigned by the server.');
      }
      verifyWorkspaceRelations_(jobId, kind, id, payload);
    } else if (kind === 'change' && current.payload.number) {
      throw appError_('immutable_artifact', 'Issued changes cannot be removed. Record a void or create an amendment.');
    } else if (kind === 'attachment') {
      workspaceAssert_(!workspaceItemsForJob_(jobId).some(function (item) { return item.kind === 'artifact' && item.payload.reviewState === 'final' && (item.payload.snapshotAttachmentId === id || item.payload.outputAttachmentIds.indexOf(id) !== -1); }), 'This file belongs to an immutable document version.', 'referenced_attachment');
    }
    var now = new Date().toISOString();
    var item = { jobId: jobId, kind: kind, itemId: id, revision: revision + 1, createdAt: current ? current.createdAt : now, createdBy: current ? current.createdBy : user.email, updatedAt: now, updatedBy: user.email, deletedAt: operation === 'delete' ? now : null, lastMutationId: request.mutationId, payload: payload };
    return commitWorkspaceIntent_(request.mutationId, binding, revision, { type: 'item', item: item, operation: operation });
  });
}
function workspaceItemsForJob_(jobId) {
  var rows = workflowTable_('JobItems').getDataRange().getValues(); var result = [];
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === jobId) result.push(workspaceItemFromRow_(rows[i]));
  return result;
}
function workspacePage_(items, scope, request, idOf) {
  var size = request.pageSize === undefined ? 50 : Number(request.pageSize);
  workspaceAssert_(Number.isInteger(size) && size >= 1, 'Invalid page size.'); size = Math.min(100, size);
  var after = '';
  if (request.cursor) {
    try { var cursor = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(request.cursor)).getDataAsString()); }
    catch (err) { throw appError_('bad_request', 'Invalid cursor.'); }
    workspaceAssert_(cursor.scope === scope && typeof cursor.after === 'string', 'The cursor belongs to another job or filter.'); after = cursor.after;
  }
  items.sort(function (a, b) { var x = idOf(a); var y = idOf(b); return x < y ? -1 : x > y ? 1 : 0; });
  var remaining = items.filter(function (item) { return idOf(item) > after; }); var page = remaining.slice(0, size);
  return { items: page, nextCursor: remaining.length > size ? Utilities.base64EncodeWebSafe(JSON.stringify({ scope: scope, after: idOf(page[page.length - 1]) })) : null, serverTime: new Date().toISOString() };
}
function listJobItems_(user, request) {
  requireWorkspaceJob_(user, request.jobId, false);
  var kinds = request.kinds === undefined ? WORKFLOW_KINDS.slice() : request.kinds;
  workspaceAssert_(Array.isArray(kinds) && kinds.length > 0 && kinds.every(function (kind) { return WORKFLOW_KINDS.indexOf(kind) !== -1; }), 'Invalid item kinds.');
  kinds = kinds.slice().sort();
  var items = workspaceItemsForJob_(request.jobId).filter(function (item) { return kinds.indexOf(item.kind) !== -1; });
  return workspacePage_(items, request.jobId + ':' + kinds.join(','), request, function (item) { return item.kind + ':' + item.itemId; });
}
function listJobWorkflowSummaries_(user, request) {
  requireWorkflowUser_(user, false);
  workspaceAssert_(Array.isArray(request.jobIds) && request.jobIds.length <= 100 && request.jobIds.every(workspaceId_), 'Request at most 100 job IDs.');
  var summaries = request.jobIds.map(function (id) {
    var job = requireWorkspaceJob_(user, id, false); var items = workspaceItemsForJob_(id).filter(function (item) { return !item.deletedAt; });
    var workflowItem = items.filter(function (item) { return item.kind === 'workflow'; })[0];
    var workflow = workflowItem ? workflowItem.payload : { stage: ({ Draft: 'intake', Active: 'in_production', 'On Hold': 'on_hold', Complete: 'complete', Cancelled: 'cancelled' })[job.values[9]] || 'intake', nextAction: null };
    var updates = items.filter(function (item) { return item.kind === 'activity' && item.payload.source === 'manual'; }).sort(function (a, b) { return b.payload.occurredAt.localeCompare(a.payload.occurredAt) || b.itemId.localeCompare(a.itemId); });
    var reminders = [];
    if (['complete', 'cancelled'].indexOf(workflow.stage) === -1) {
      items.forEach(function (item) {
        if (item.kind === 'selection' && item.payload.decision.status !== 'approved') reminders.push({ id: item.itemId, kind: 'selection', title: item.payload.item, dueDate: item.payload.neededBy, responsiblePerson: item.payload.responsiblePerson });
        if (item.kind === 'closeout') item.payload.punchItems.forEach(function (punch) {
          if (punch.state === 'open') reminders.push({ id: punch.id, kind: 'punch', title: punch.title, dueDate: punch.dueDate || '', responsiblePerson: punch.responsiblePerson || { name: '' } });
        });
      });
    }
    return { jobId: id, revision: workflowItem ? workflowItem.revision : 0, stage: workflow.stage, nextAction: workflow.nextAction, holdReason: workflow.holdReason || '', latestUpdate: updates[0] || null,
      reminders: reminders,
      outstandingSelections: items.filter(function (item) { return item.kind === 'selection' && item.payload.decision.status !== 'approved'; }).length,
      openChanges: items.filter(function (item) { return item.kind === 'change' && ['closed', 'void'].indexOf(item.payload.lifecycle) === -1; }).length,
      openPunchItems: items.filter(function (item) { return item.kind === 'closeout'; }).reduce(function (total, item) { return total + item.payload.punchItems.filter(function (punch) { return punch.state === 'open'; }).length; }, 0) };
  });
  return { summaries: summaries, serverTime: new Date().toISOString() };
}
function workspaceDraftFromRow_(row) { return { draftId: row[0], recordId: row[3], revision: Number(row[4]), updatedAt: row[5], updatedBy: row[6], job: JSON.parse(row[8]) }; }
function saveWorkspaceDraft_(user, request) {
  return withWriteLock_(function () {
    requireWorkflowUser_(user, true); ensureWorkflowSchema_();
    workspaceAssert_(workspaceId_(request.jobId) && workspaceId_(request.deviceId) && workspaceObject_(request.job), 'jobId, deviceId and job snapshot are required.');
    workspaceAssert_(!request.job.recordId || request.job.recordId === request.jobId, 'The draft must belong to its job.');
    var savedJob = coreJobRow_(request.jobId); if (savedJob && coreJobDeleted_(savedJob.values)) throw appError_('not_found', 'Deleted jobs cannot receive drafts.');
    workspaceMutationId_(request.mutationId); workspaceRevision_(request.expectedRevision);
    workspaceAssert_(JSON.stringify(request.job).length <= 48000, 'This draft is too large.', 'record_too_large');
    var actor = user.email.toLowerCase(); var id = 'draft:' + workspaceDigest_(actor + ':' + request.deviceId + ':' + request.jobId); var target = id;
    var binding = journalBinding_(user, request.jobId, target, 'saveWorkspaceDraft', { deviceId: request.deviceId, job: request.job, expectedRevision: request.expectedRevision });
    var replay = journalReplay_(request.mutationId, binding); if (replay) return replay.result;
    recoverWorkspaceTarget_(target);
    var row = workspaceRow_(workflowTable_('WorkspaceDrafts'), function (values) { return values[0] === id; });
    var revision = row ? Number(row.values[4]) : 0;
    if (revision !== request.expectedRevision) workspaceConflict_(row && workspaceDraftFromRow_(row.values));
    var draft = { draftId: id, recordId: request.jobId, revision: revision + 1, updatedAt: new Date().toISOString(), updatedBy: user.email, job: cloneWorkspace_(request.job) };
    return commitWorkspaceIntent_(request.mutationId, binding, revision, { type: 'draft', draft: draft, actor: actor, jobId: request.jobId, deviceId: request.deviceId });
  });
}
function listWorkspaceDrafts_(user, request) {
  requireWorkflowUser_(user, false); workspaceAssert_(workspaceId_(request.deviceId), 'deviceId is required.');
  var rows = workflowTable_('WorkspaceDrafts').getDataRange().getValues(); var drafts = [];
  for (var i = 1; i < rows.length; i++) if (rows[i][1] === user.email.toLowerCase() && rows[i][2] === request.deviceId) drafts.push(workspaceDraftFromRow_(rows[i]));
  var page = workspacePage_(drafts, user.email.toLowerCase() + ':' + request.deviceId, request, function (draft) { return draft.draftId; });
  return { drafts: page.items, nextCursor: page.nextCursor, serverTime: page.serverTime };
}

/* Private, reserved Drive files. No sharing or public-link operation is used. */
function requireWorkspaceStorage_() {
  var root = PropertiesService.getScriptProperties().getProperty(PROP.WORKFLOW_DRIVE_ROOT_ID);
  if (!root || typeof Drive === 'undefined' || !Drive.Files || !Drive.Permissions) throw appError_('not_configured', 'Private file storage needs WORKFLOW_DRIVE_ROOT_ID and the Advanced Drive v3 service.');
  requireWorkspacePrivateLocation_(root);
  return root;
}
function requireWorkspacePrivateLocation_(id) {
  var pageToken;
  do {
    var page = Drive.Permissions.list(id, { fields: 'nextPageToken,permissions(type,role)', pageSize: 100, pageToken: pageToken, supportsAllDrives: true });
    workspaceAssert_(!(page.permissions || []).some(function (permission) { return permission.type === 'anyone' || permission.type === 'domain'; }), 'The configured upload folder must be private.', 'storage_not_private');
    pageToken = page.nextPageToken;
  } while (pageToken);
}
function workspaceJobFolder_(jobId, root) {
  var name = 'job-' + workspaceDigest_(jobId).slice(0, 32);
  var parent = DriveApp.getFolderById(root); var folders = parent.getFoldersByName(name);
  var id = folders.hasNext() ? folders.next().getId() : parent.createFolder(name).getId();
  requireWorkspacePrivateLocation_(id);
  return id;
}
function safeWorkspaceFilename_(filename) {
  workspaceAssert_(workspaceText_(filename, 255) && !!filename.trim() && !/[\x00-\x1f\x7f\/\\]/.test(filename) && filename !== '.' && filename !== '..' && !/^[=+@]/.test(filename), 'Use a safe filename without paths or control characters.');
  return filename.trim();
}
function reserveJobAttachment_(user, request) {
  return withWriteLock_(function () {
    requireWorkflowUser_(user, true); requireWorkspaceJob_(user, request.jobId, true);
    workspaceAssert_(workspaceId_(request.attachmentId) && workspaceObject_(request.parent) && WORKFLOW_KINDS.indexOf(request.parent.kind) !== -1 && ['attachment'].indexOf(request.parent.kind) === -1 && workspaceId_(request.parent.itemId), 'A valid attachment ID and parent record are required.');
    workspaceMutationId_(request.mutationId);
    var root = requireWorkspaceStorage_();
    var filename = safeWorkspaceFilename_(request.filename);
    var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (request.parent.kind === 'artifact') allowed.push('application/json');
    workspaceAssert_(allowed.indexOf(request.mimeType) !== -1, 'Choose a JPEG, PNG, WebP or PDF file. HEIC must be converted before upload.', 'unsupported_file_type');
    workspaceAssert_(Number.isSafeInteger(request.byteSize) && request.byteSize > 0, 'The file must have a valid byte size.');
    workspaceAssert_(request.byteSize <= 5242880, 'Each file must be 5 MiB or smaller.', 'file_too_large');
    workspaceAssert_(typeof request.sha256 === 'string' && /^[a-f0-9]{64}$/.test(request.sha256), 'A SHA-256 hash is required.');
    var parent = workspaceItem_(request.jobId, request.parent.kind, request.parent.itemId);
    workspaceAssert_(parent.kind !== 'artifact' || parent.payload.reviewState !== 'final', 'Published artifact files cannot be replaced.', 'immutable_artifact');
    var target = 'item:' + request.jobId + ':attachment:' + request.attachmentId;
    var metadata = { parent: request.parent, filename: filename, mimeType: request.mimeType, byteSize: request.byteSize, sha256: request.sha256, caption: request.caption || '', category: request.category || '' };
    var binding = journalBinding_(user, request.jobId, target, 'reserveJobAttachment', metadata);
    var replay = journalReplay_(request.mutationId, binding); if (replay) return replay.result;
    recoverWorkspaceTarget_(target);
    var current = workspaceItem_(request.jobId, 'attachment', request.attachmentId, true);
    if (current) workspaceConflict_(current);
    var ids = Drive.Files.generateIds({ count: 1, space: 'drive', type: 'files' });
    workspaceAssert_(ids && ids.ids && ids.ids[0], 'Drive could not reserve a stable file ID.', 'storage_error');
    var payload = { filename: filename, mimeType: request.mimeType, byteSize: request.byteSize, sha256: request.sha256, driveFileId: ids.ids[0], parent: cloneWorkspace_(request.parent), uploadState: 'reserved', driveFolderId: workspaceJobFolder_(request.jobId, root) };
    if (request.caption) payload.caption = request.caption;
    if (request.category) payload.category = request.category;
    validateWorkspacePayload_('attachment', payload);
    var now = new Date().toISOString();
    var item = { jobId: request.jobId, kind: 'attachment', itemId: request.attachmentId, revision: 1, createdAt: now, createdBy: user.email, updatedAt: now, updatedBy: user.email, deletedAt: null, lastMutationId: request.mutationId, payload: payload };
    return commitWorkspaceIntent_(request.mutationId, binding, 0, { type: 'item', item: item, operation: 'create' });
  });
}
function workspaceBytesMatch_(bytes, metadata) {
  workspaceAssert_(bytes.length === metadata.byteSize && bytes.length <= 5242880 && workspaceDigest_(bytes) === metadata.sha256, 'The uploaded bytes do not match the reserved size and SHA-256.', 'invalid_file');
  var unsigned = bytes.slice(0, 16).map(function (byte) { return (byte + 256) % 256; });
  var ascii = unsigned.map(function (byte) { return String.fromCharCode(byte); }).join('');
  var valid = metadata.mimeType === 'application/pdf' ? ascii.indexOf('%PDF-') === 0 : metadata.mimeType === 'image/jpeg' ? unsigned[0] === 255 && unsigned[1] === 216 && unsigned[2] === 255 : metadata.mimeType === 'image/png' ? unsigned.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' : metadata.mimeType === 'image/webp' ? ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP' : false;
  if (metadata.mimeType === 'application/json' && metadata.parent.kind === 'artifact') {
    try { var value = JSON.parse(Utilities.newBlob(bytes).getDataAsString('UTF-8')); valid = workspaceObject_(value); } catch (err) { valid = false; }
  }
  workspaceAssert_(valid, 'The file signature does not match its declared type.', 'invalid_file');
}
function workspaceExistingDriveFile_(metadata, metadataOnly) {
  var file;
  try { file = Drive.Files.get(metadata.driveFileId, { fields: 'id,name,mimeType,size,parents,trashed,sha256Checksum', supportsAllDrives: true }); }
  catch (err) { if (/not[ -]?found|404|file not found/i.test(String(err && err.message || err))) return null; throw err; }
  workspaceAssert_(file && !file.trashed && file.mimeType === metadata.mimeType && Number(file.size) === metadata.byteSize && (file.parents || []).indexOf(metadata.driveFolderId) !== -1, 'The staged Drive file does not match its reservation.', 'invalid_file');
  if (metadataOnly) {
    // Drive's output-only blob checksum verifies the staged file without a
    // byte download while the script-wide commit lock is held.
    workspaceAssert_(!!file.sha256Checksum, 'Drive is still verifying the file. Retry the original upload.', 'busy');
    workspaceAssert_(String(file.sha256Checksum).toLowerCase() === metadata.sha256, 'The staged file checksum does not match its reservation.', 'invalid_file');
    return true;
  }
  var bytes = DriveApp.getFileById(metadata.driveFileId).getBlob().getBytes();
  workspaceBytesMatch_(bytes, metadata);
  return bytes;
}
function uploadJobAttachment_(user, request) {
  requireWorkflowUser_(user, true); requireWorkspaceJob_(user, request.jobId, true);
  workspaceAssert_(workspaceId_(request.attachmentId), 'attachmentId is required.'); workspaceMutationId_(request.mutationId);
  var base64 = request.base64 || request.bytesBase64;
  workspaceAssert_(typeof base64 === 'string' && base64.length <= 6990508 && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64), 'Provide valid base64 file bytes.', 'invalid_file');
  var bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (err) { throw appError_('invalid_file', 'File bytes could not be decoded.'); }
  var reservation = workspaceItem_(request.jobId, 'attachment', request.attachmentId);
  workspaceBytesMatch_(bytes, reservation.payload);
  requireWorkspaceStorage_();
  requireWorkspacePrivateLocation_(reservation.payload.driveFolderId);
  var target = 'item:' + request.jobId + ':attachment:' + request.attachmentId;
  var binding = journalBinding_(user, request.jobId, target, 'uploadJobAttachment', { attachmentId: request.attachmentId, sha256: reservation.payload.sha256, byteSize: reservation.payload.byteSize });
  var staged = withWriteLock_(function () {
    requireWorkspaceJob_(user, request.jobId, true);
    var sheet = workflowTable_('JobMutations');
    var entry = workspaceRow_(sheet, function (row) { return row[0] === request.mutationId; });
    if (entry) {
      var row = entry.values;
      workspaceAssert_(row[1] === binding.actor && row[2] === binding.jobId && row[3] === binding.target && row[4] === binding.action && row[5] === binding.hash, 'This mutationId is bound to another request.', 'idempotency_conflict');
      if (row[7] === 'applied') return { result: JSON.parse(row[9]) };
      return { entry: entry, intent: JSON.parse(row[8]) };
    }
    recoverWorkspaceTarget_(target);
    var current = workspaceItem_(request.jobId, 'attachment', request.attachmentId);
    var item = cloneWorkspace_(current); item.revision++; item.updatedAt = new Date().toISOString(); item.updatedBy = user.email; item.lastMutationId = request.mutationId; item.payload.uploadState = 'ready';
    var intent = { type: 'upload', item: item, operation: 'update', mutationId: request.mutationId };
    var now = new Date().toISOString();
    var values = [request.mutationId, binding.actor, request.jobId, target, binding.action, binding.hash, current.revision, 'transferring', JSON.stringify(intent), '', now, now];
    sheet.appendRow(values); SpreadsheetApp.flush();
    return { entry: { row: sheet.getLastRow(), values: values }, intent: intent };
  });
  if (staged.result) return staged.result;
  // Transfer happens outside the script lock. The reservation and transfer
  // journal survive a timeout; a retry verifies this exact Drive ID first.
  if (!workspaceExistingDriveFile_(staged.intent.item.payload)) {
    var p = staged.intent.item.payload;
    try {
      Drive.Files.create({ id: p.driveFileId, name: p.filename, mimeType: p.mimeType, parents: [p.driveFolderId] }, Utilities.newBlob(bytes, p.mimeType, p.filename), { fields: 'id', supportsAllDrives: true });
    } catch (err) {
      if (!/already exists|409|conflict/i.test(String(err && err.message || err)) || !workspaceExistingDriveFile_(p)) throw err;
    }
  }
  return withWriteLock_(function () {
    requireWorkspaceJob_(user, request.jobId, true);
    var replay = journalReplay_(request.mutationId, binding);
    return replay.result;
  });
}
function getJobAttachment_(user, request) {
  requireWorkspaceJob_(user, request.jobId, false); workspaceAssert_(workspaceId_(request.attachmentId), 'attachmentId is required.');
  var item = workspaceItem_(request.jobId, 'attachment', request.attachmentId);
  workspaceAssert_(item.payload.uploadState === 'ready', 'The file is still waiting to upload.', 'dependency_pending');
  var bytes = workspaceExistingDriveFile_(item.payload);
  workspaceAssert_(!!bytes, 'The stored file is unavailable. Your file selection has been retained.', 'file_unavailable');
  return { item: item, filename: item.payload.filename, mimeType: item.payload.mimeType, byteSize: item.payload.byteSize, base64: Utilities.base64Encode(bytes) };
}

/* ---------------------------------------------------------------------------
 * 8. AUDIT LOGGING & UTILITIES
 * ------------------------------------------------------------------------ */

function appendLog_(userEmail, action, recordId, jobNumber, detail) {
  try {
    var sheet = logSheet_();
    if (!sheet) return;
    sheet.appendRow([
      new Date().toISOString(),
      userEmail || 'ANONYMOUS',
      action || '',
      recordId || '',
      jobNumber || '',
      detail || ''
    ]);
  } catch (err) {
    Logger.log('Audit log failure: ' + err);
  }
}

function currentSchemaVersion_() {
  var props = PropertiesService.getScriptProperties();
  return Number(props.getProperty(PROP.SCHEMA_VERSION)) || DEFAULTS.SCHEMA_VERSION;
}

/* ---------------------------------------------------------------------------
 * 9. SELF TEST & DIAGNOSTICS
 * ------------------------------------------------------------------------ */

function selfTest() {
  Logger.log('Starting Self-Test verification...');
  ensureDatabaseReady_();

  var testEmail = 'selftest.' + new Date().getTime() + '@example.com';
  var testPass = 'SelfTestPass123!';

  // 1. Create User
  var user = createUser(testEmail, 'Self-Test Operator', testPass, 'editor');
  if (!user || user.email !== testEmail) throw new Error('SelfTest: Failed to create user.');

  // 2. Login
  var loginResult = loginUser_(testEmail, testPass);
  if (!loginResult.sessionToken) throw new Error('SelfTest: Login did not return sessionToken.');

  // 3. Save Job
  var template = emptyRecordTemplate_();
  template.jobNumber = 'TEST-001';
  template.jobName = 'Self-Test Drying Phase';
  template.customerName = 'Test Property';
  template.status = 'Draft';

  var saved = saveJob_(loginResult.user, template);
  if (!saved.recordId) throw new Error('SelfTest: Job save failed to produce recordId.');

  // 4. Retrieve Job
  var fetched = getJob_(loginResult.user, saved.recordId);
  if (fetched.jobName !== 'Self-Test Drying Phase') throw new Error('SelfTest: Fetched job mismatch.');

  // 5. Delete Job
  var deleted = deleteJob_(loginResult.user, saved.recordId);
  if (!deleted.deleted) throw new Error('SelfTest: Job deletion failed.');

  // 6. Shared workspace draft round trip
  saveDraft_(loginResult.user, { job: template, recordId: saved.recordId });
  var draft = getDraft_(loginResult.user);
  if (!draft || !draft.job) throw new Error('SelfTest: Draft save failed.');
  if (draft.updatedBy !== testEmail) throw new Error('SelfTest: Draft updatedBy mismatch.');
  if (draft.job.jobName !== 'Self-Test Drying Phase') throw new Error('SelfTest: Draft payload mismatch.');
  if (!draftsSheet_()) throw new Error('SelfTest: Drafts sheet is missing.');

  // 7. Cleanup. Remove the self-test draft row, but never a real one: the
  //    draft only goes if this test wrote it.
  var draftCleanupSheet = draftsSheet_();
  var draftRows = draftCleanupSheet.getDataRange().getValues();
  for (var dr = draftRows.length - 1; dr >= 1; dr--) {
    if (String(draftRows[dr][0]) === DRAFT_ROW_ID && String(draftRows[dr][2]) === testEmail) {
      draftCleanupSheet.deleteRow(dr + 1);
    }
  }

  removeUser_(testEmail);
  cleanupSessions();

  Logger.log('=============================');
  Logger.log('>>> SELF TEST RESULT: PASS <<<');
  Logger.log('=============================');
  return 'PASS';
}
