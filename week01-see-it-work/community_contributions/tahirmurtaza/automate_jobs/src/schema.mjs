// Single source of truth for the Google Sheet layout.
// The Sheets nodes map by column NAME, so a drifted header is a silent failure.
// scripts/build-workflows.mjs asserts the Queue columns here match the keys
// actually emitted by the "Build Queue Row" node.

export const QUEUE_COLUMNS = [
  'job_id',
  'date_found',
  'title',
  'company',
  'domain',
  'location',
  'is_remote',
  'url',
  'match_score',
  'ats_score',
  'verdict',
  'matched_skills',
  'ats_missing',
  'ats_note',
  'reasoning',
  'recruiter_name',
  'recruiter_email',
  'recruiter_title',
  'contact_source',
  'subject',
  'cover_letter',
  'status',
  'sent_at',
  'notes',
];

export const CONTACTS_COLUMNS = [
  'domain',
  'company',
  'recruiter_name',
  'recruiter_email',
  'recruiter_title',
  'found_at',
];

export const SKIPPED_COLUMNS = [
  'date_found',
  'job_id',
  'title',
  'company',
  'url',
  'match_score',
  'reason',
];

export const TABS = {
  Queue: QUEUE_COLUMNS,
  Contacts: CONTACTS_COLUMNS,
  Skipped: SKIPPED_COLUMNS,
  Meta: ['key', 'value'],
};
