// Re-export from the schemas directory for backward compatibility.
// New code should import directly from './schemas/...' instead.
export {
  initDatabase,
  initSessionsTable,
  initArticlesTable,
  initReviewTables,
  initPublishTables,
  initCredentialsTable,
  initPipelineTables,
  initMonitorTables,
  initUserTables,
  initPlanTables,
  DEFAULT_REVIEW_DIMENSION_SCORE,
  DEFAULT_MAX_PUBLISH_RETRIES,
  DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS,
} from './schemas/index.js';
