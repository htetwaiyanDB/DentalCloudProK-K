/**
 * Rate Limited API Wrapper
 * 
 * Wraps the `api` object from services/api.ts with rate limiting on critical
 * security-sensitive endpoints to prevent abuse and brute-force attacks.
 * 
 * Usage:
 *   import { rateLimitedApi } from './utils/rateLimitedApi';
 *   // Use rateLimitedApi instead of api for protected endpoints
 *   await rateLimitedApi.patients.authenticate(identifier, password);
 */

import { api } from '../services/api';
import {
  createRateLimitedFunction,
  RATE_LIMIT_PRESETS,
} from './rateLimiter';

/**
 * Apply rate limiting to the most security-critical endpoints.
 * This returns a new object mirroring the api structure but with
 * rate-limited wrappers around sensitive methods.
 *
 * Endpoints that are not rate-limited pass through transparently.
 */
export const rateLimitedApi = {
  locations: api.locations,
  patientTypes: api.patientTypes,
  appointmentTypes: api.appointmentTypes,

  patients: {
    ...api.patients,
    authenticate: createRateLimitedFunction('patients:authenticate', api.patients.authenticate, RATE_LIMIT_PRESETS.AUTH),
    register: createRateLimitedFunction('patients:register', api.patients.register, RATE_LIMIT_PRESETS.REGISTRATION),
    registerWithSupabase: createRateLimitedFunction('patients:registerWithSupabase', api.patients.registerWithSupabase, RATE_LIMIT_PRESETS.REGISTRATION),
    updatePasswordByEmail: createRateLimitedFunction('patients:updatePasswordByEmail', api.patients.updatePasswordByEmail, RATE_LIMIT_PRESETS.REGISTRATION),
  },

  appointments: {
    ...api.appointments,
    create: createRateLimitedFunction('appointments:create', api.appointments.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('appointments:update', api.appointments.update, RATE_LIMIT_PRESETS.WRITE),
    updateStatus: createRateLimitedFunction('appointments:updateStatus', api.appointments.updateStatus, RATE_LIMIT_PRESETS.WRITE),
    updateCancellationOutcome: createRateLimitedFunction('appointments:updateCancellationOutcome', api.appointments.updateCancellationOutcome, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('appointments:delete', api.appointments.delete, RATE_LIMIT_PRESETS.WRITE),
    cleanupOld: createRateLimitedFunction('appointments:cleanupOld', api.appointments.cleanupOld, RATE_LIMIT_PRESETS.WRITE),
  },

  treatments: {
    ...api.treatments,
    record: createRateLimitedFunction('treatments:record', api.treatments.record, RATE_LIMIT_PRESETS.WRITE),
    undoRecord: createRateLimitedFunction('treatments:undoRecord', api.treatments.undoRecord, RATE_LIMIT_PRESETS.WRITE),
    deleteAllRecords: createRateLimitedFunction('treatments:deleteAllRecords', api.treatments.deleteAllRecords, RATE_LIMIT_PRESETS.WRITE),
    createType: createRateLimitedFunction('treatments:createType', api.treatments.createType, RATE_LIMIT_PRESETS.WRITE),
    updateType: createRateLimitedFunction('treatments:updateType', api.treatments.updateType, RATE_LIMIT_PRESETS.WRITE),
    deleteType: createRateLimitedFunction('treatments:deleteType', api.treatments.deleteType, RATE_LIMIT_PRESETS.WRITE),
  },

  doctors: {
    ...api.doctors,
    create: createRateLimitedFunction('doctors:create', api.doctors.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('doctors:update', api.doctors.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('doctors:delete', api.doctors.delete, RATE_LIMIT_PRESETS.WRITE),
  },

  finance: {
    ...api.finance,
    processPayment: createRateLimitedFunction('finance:processPayment', api.finance.processPayment, RATE_LIMIT_PRESETS.WRITE),
  },

  appSettings: {
    ...api.appSettings,
    saveS3Settings: createRateLimitedFunction('appSettings:saveS3Settings', api.appSettings.saveS3Settings, RATE_LIMIT_PRESETS.WRITE),
    saveSupabaseStorage: createRateLimitedFunction('appSettings:saveSupabaseStorage', api.appSettings.saveSupabaseStorage, RATE_LIMIT_PRESETS.WRITE),
    saveEmailSettings: createRateLimitedFunction('appSettings:saveEmailSettings', api.appSettings.saveEmailSettings, RATE_LIMIT_PRESETS.WRITE),
  },

  files: {
    ...api.files,
    upload: createRateLimitedFunction('files:upload', api.files.upload, RATE_LIMIT_PRESETS.UPLOAD),
    uploadWithTus: createRateLimitedFunction('files:uploadWithTus', api.files.uploadWithTus, RATE_LIMIT_PRESETS.UPLOAD),
    uploadMultipleWithTus: createRateLimitedFunction('files:uploadMultipleWithTus', api.files.uploadMultipleWithTus, RATE_LIMIT_PRESETS.UPLOAD),
    remove: createRateLimitedFunction('files:remove', api.files.remove, RATE_LIMIT_PRESETS.UPLOAD),
  },

  expenses: {
    ...api.expenses,
    create: createRateLimitedFunction('expenses:create', api.expenses.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('expenses:update', api.expenses.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('expenses:delete', api.expenses.delete, RATE_LIMIT_PRESETS.WRITE),
  },

  users: {
    ...api.users,
    authenticate: createRateLimitedFunction('users:authenticate', api.users.authenticate, RATE_LIMIT_PRESETS.AUTH),
    create: createRateLimitedFunction('users:create', api.users.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('users:update', api.users.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('users:delete', api.users.delete, RATE_LIMIT_PRESETS.WRITE),
  },

  medicines: {
    ...api.medicines,
    create: createRateLimitedFunction('medicines:create', api.medicines.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('medicines:update', api.medicines.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('medicines:delete', api.medicines.delete, RATE_LIMIT_PRESETS.WRITE),
    sell: createRateLimitedFunction('medicines:sell', api.medicines.sell, RATE_LIMIT_PRESETS.WRITE),
    undoSale: createRateLimitedFunction('medicines:undoSale', api.medicines.undoSale, RATE_LIMIT_PRESETS.WRITE),
  },

  doctorSchedules: {
    ...api.doctorSchedules,
    create: createRateLimitedFunction('doctorSchedules:create', api.doctorSchedules.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('doctorSchedules:update', api.doctorSchedules.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('doctorSchedules:delete', api.doctorSchedules.delete, RATE_LIMIT_PRESETS.WRITE),
  },

  treatmentTypes: {
    ...api.treatmentTypes,
    create: createRateLimitedFunction('treatmentTypes:create', api.treatmentTypes.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('treatmentTypes:update', api.treatmentTypes.update, RATE_LIMIT_PRESETS.WRITE),
    delete: createRateLimitedFunction('treatmentTypes:delete', api.treatmentTypes.delete, RATE_LIMIT_PRESETS.WRITE),
  },

  loyalty: {
    ...api.loyalty,
    addTransaction: createRateLimitedFunction('loyalty:addTransaction', api.loyalty.addTransaction, RATE_LIMIT_PRESETS.WRITE),
    redeemPoints: createRateLimitedFunction('loyalty:redeemPoints', api.loyalty.redeemPoints, RATE_LIMIT_PRESETS.WRITE),
    updateRule: createRateLimitedFunction('loyalty:updateRule', api.loyalty.updateRule, RATE_LIMIT_PRESETS.WRITE),
    createRule: createRateLimitedFunction('loyalty:createRule', api.loyalty.createRule, RATE_LIMIT_PRESETS.WRITE),
    deleteRule: createRateLimitedFunction('loyalty:deleteRule', api.loyalty.deleteRule, RATE_LIMIT_PRESETS.WRITE),
    resetAllPoints: createRateLimitedFunction('loyalty:resetAllPoints', api.loyalty.resetAllPoints, RATE_LIMIT_PRESETS.WRITE),
  },

  messages: {
    ...api.messages,
    createMessage: createRateLimitedFunction('messages:createMessage', api.messages.createMessage, RATE_LIMIT_PRESETS.WRITE),
    createConversation: createRateLimitedFunction('messages:createConversation', api.messages.createConversation, RATE_LIMIT_PRESETS.WRITE),
    removeAllMessages: createRateLimitedFunction('messages:removeAllMessages', api.messages.removeAllMessages, RATE_LIMIT_PRESETS.WRITE),
  },

  email: {
    sendManagerEmail: createRateLimitedFunction('email:sendManagerEmail', api.email.sendManagerEmail, RATE_LIMIT_PRESETS.WRITE),
  },

  scheduledTasks: {
    ...api.scheduledTasks,
    create: createRateLimitedFunction('scheduledTasks:create', api.scheduledTasks.create, RATE_LIMIT_PRESETS.WRITE),
    update: createRateLimitedFunction('scheduledTasks:update', api.scheduledTasks.update, RATE_LIMIT_PRESETS.WRITE),
    cancel: createRateLimitedFunction('scheduledTasks:cancel', api.scheduledTasks.cancel, RATE_LIMIT_PRESETS.WRITE),
  },

  assistantMemory: {
    ...api.assistantMemory,
    upsert: createRateLimitedFunction('assistantMemory:upsert', api.assistantMemory.upsert, RATE_LIMIT_PRESETS.WRITE),
  },

  planning: api.planning,
};
